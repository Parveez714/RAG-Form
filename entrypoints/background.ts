import { defineBackground } from "wxt/utils/define-background";
import { type ExtensionSettings, type FillSuggestion, type FormField, type WorkerRequest, type WorkerResponse } from "../src/shared/types";
import { clearToken, readSettings, readToken, writeSettings, writeToken } from "../src/shared/storage";
import { fillFormField, scanFormFields } from "../src/shared/page-bridge";

export default defineBackground(() => {
  // 1. Click on action opens side panel
  chrome.action.onClicked.addListener((tab) => {
    if (tab.id !== undefined) void chrome.sidePanel.open({ tabId: tab.id });
  });

  // 2. Autonomous Background Form Detection & Auto-fill when visiting approved sites
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === "complete" && tab.url) {
      void handleAutoFillForTab(tabId, tab.url);
    }
  });

  // 3. Runtime messaging router
  chrome.runtime.onMessage.addListener((request: WorkerRequest, _sender, sendResponse) => {
    void handleRequest(request)
      .then(sendResponse)
      .catch((error: unknown) => {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : "Unexpected extension error." });
      });
    return true;
  });
});

async function handleAutoFillForTab(tabId: number, tabUrl: string): Promise<void> {
  try {
    const parsed = new URL(tabUrl);
    const settings = await readSettings();
    if (!settings.allowedOrigins.includes(parsed.origin)) return;

    // Check if sidePanel can be opened automatically on this approved tab
    if ("sidePanel" in chrome && "open" in chrome.sidePanel) {
      void chrome.sidePanel.open({ tabId }).catch(() => {});
    }

    // Inspect form controls
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: scanFormFields
    });
    const fields = result[0]?.result as FormField[] | undefined;
    if (!fields || fields.length === 0) return;

    // Request RAG suggestions from backend
    const accessToken = await getValidToken();
    const response = await fetch(`${settings.apiUrl.replace(/\/+$/, "")}/fill-suggestions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
      },
      body: JSON.stringify({
        fields,
        user_email: settings.userEmail || "parveezbackup@gmail.com"
      })
    });
    if (!response.ok) return;

    const payload: unknown = await response.json();
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("suggestions" in payload) ||
      !Array.isArray(payload.suggestions) ||
      !payload.suggestions.every(isFillSuggestion)
    ) return;

    const suggestions = payload.suggestions;

    // Automatically fill the fields on the webpage
    const fillable = suggestions
      .filter((s) => s.proposed_value && s.proposed_value.trim().length > 0 && s.confidence >= 0.5)
      .map((s) => ({ fieldId: s.field_id, value: s.proposed_value }));

    if (fillable.length > 0) {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: executeFillOnPage,
        args: [fillable]
      });
    }

    // Store latest inspection result in session storage for the SidePanel to display
    await chrome.storage.session.set({
      latestRAGResult: {
        tabId,
        url: tabUrl,
        timestamp: Date.now(),
        fields,
        suggestions
      }
    });

    // Notify any open side panel
    void chrome.runtime.sendMessage({
      type: "AUTONOMOUS_FILL_COMPLETE",
      tabId,
      fields,
      suggestions
    }).catch(() => {});
  } catch {
    // Ignore errors for non-matching background tabs
  }
}

async function handleRequest(request: WorkerRequest): Promise<WorkerResponse> {
  switch (request.type) {
    case "GET_SETTINGS":
      return { ok: true, settings: await readSettings() };
    case "SAVE_SETTINGS":
      await saveSettings(request.settings);
      return { ok: true, message: "Settings saved." };
    case "SIGN_IN":
      await signIn();
      return { ok: true, message: "Signed in. The access token is held for this browser session only." };
    case "SIGN_OUT":
      await clearToken();
      return { ok: true, message: "Signed out." };
    case "SCAN_ACTIVE_TAB":
      return scanActiveTab();
    case "FILL_FIELD":
      return fillActiveField(request.fieldId, request.value);
    case "FILL_ALL_FIELDS":
      return fillAllActiveFields(request.items);
  }
}

async function saveSettings(settings: ExtensionSettings): Promise<void> {
  const api = new URL(settings.apiUrl);
  if (api.protocol !== "https:" && !isLocalhost(api.hostname)) {
    throw new Error("Use HTTPS for non-local API endpoints.");
  }
  if (api.username || api.password || api.search || api.hash) {
    throw new Error("The API URL must contain only an origin and optional path.");
  }
  for (const origin of settings.allowedOrigins) {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || (parsed.protocol !== "https:" && !isLocalhost(parsed.hostname))) {
      throw new Error(`Approved site must be an HTTPS origin: ${origin}`);
    }
  }
  await writeSettings(settings);
}

async function scanActiveTab(): Promise<WorkerResponse> {
  const tab = await getActiveTab();
  await ensureApprovedTab(tab);
  const result = await chrome.scripting.executeScript({
    target: { tabId: tab.id! },
    func: scanFormFields
  });
  const fields = result[0]?.result;
  if (!fields) throw new Error("Could not inspect this page. Reload it and try again.");
  const settings = await readSettings();
  const accessToken = await getValidToken();
  const response = await fetch(`${settings.apiUrl.replace(/\/+$/, "")}/fill-suggestions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
    },
    body: JSON.stringify({
      fields,
      user_email: settings.userEmail || "parveezbackup@gmail.com"
    })
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Suggestion service returned ${response.status}: ${detail.slice(0, 300)}`);
  }
  const payload: unknown = await response.json();
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("suggestions" in payload) ||
    !Array.isArray(payload.suggestions) ||
    !payload.suggestions.every(isFillSuggestion)
  ) {
    throw new Error("Suggestion service returned an invalid response.");
  }
  return { ok: true, fields, suggestions: payload.suggestions };
}

async function fillActiveField(fieldId: string, value: string): Promise<WorkerResponse> {
  const tab = await getActiveTab();
  await ensureApprovedTab(tab);
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id! },
    func: fillFormField,
    args: [fieldId, value]
  });
  if (results[0]?.result !== true) {
    throw new Error("The field could not be filled. It may have changed since the scan.");
  }
  return { ok: true, message: "Field filled. The form was not submitted." };
}

function executeFillOnPage(fieldsToFill: Array<{ fieldId: string; value: string }>): number {
  let count = 0;

  function dispatchFieldEvents(element: HTMLElement): void {
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function highlight(element: HTMLElement): void {
    element.dataset.embassyFilled = "true";
    element.style.outline = "2px solid #167a58";
    element.style.outlineOffset = "2px";
  }

  for (const item of fieldsToFill) {
    if (!item.value) continue;

    const members = Array.from(
      document.querySelectorAll<HTMLElement>("[data-embassy-field-id]")
    ).filter((el) => el.getAttribute("data-embassy-field-id") === item.fieldId);

    if (members.length === 0) continue;
    const first = members[0];

    if (first instanceof HTMLInputElement && first.type === "radio") {
      const selected = members.find((member) => (member as HTMLInputElement).value === item.value);
      if (selected instanceof HTMLInputElement) {
        selected.checked = true;
        dispatchFieldEvents(selected);
        highlight(selected);
        count++;
      }
    } else if (first instanceof HTMLInputElement && first.type === "checkbox") {
      const norm = item.value.trim().toLowerCase();
      if (!["yes", "no", "true", "false", "1", "0"].includes(norm)) continue;
      first.checked = ["yes", "true", "1"].includes(norm);
      dispatchFieldEvents(first);
      highlight(first);
      count++;
    } else if (first instanceof HTMLSelectElement) {
      first.value = item.value;
      dispatchFieldEvents(first);
      highlight(first);
      count++;
    } else if (first instanceof HTMLInputElement || first instanceof HTMLTextAreaElement) {
      const proto = Object.getPrototypeOf(first);
      const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
      if (descriptor && descriptor.set) {
        descriptor.set.call(first, item.value);
      } else {
        first.value = item.value;
      }
      dispatchFieldEvents(first);
      highlight(first);
      count++;
    }
  }
  return count;
}

async function fillAllActiveFields(items: Array<{ fieldId: string; value: string }>): Promise<WorkerResponse> {
  const tab = await getActiveTab();
  await ensureApprovedTab(tab);
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id! },
    func: executeFillOnPage,
    args: [items]
  });

  const filledCount = Number(results[0]?.result ?? 0);
  return { ok: true, filledCount, message: `Filled ${filledCount} fields in the active form.` };
}

async function getActiveTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !tab.url) throw new Error("No active webpage is available.");
  return tab;
}

async function ensureApprovedTab(tab: chrome.tabs.Tab): Promise<void> {
  const url = new URL(tab.url!);
  const settings = await readSettings();
  if (!settings.allowedOrigins.includes(url.origin)) {
    throw new Error(`This site is not approved. Add ${url.origin} in extension options first.`);
  }
}

async function getValidToken(): Promise<string | undefined> {
  const token = await readToken();
  if (!token) return undefined;
  if (token.expiresAt <= Date.now() + 60_000) {
    await clearToken();
    throw new Error("Your sign-in expired. Sign in again from extension options.");
  }
  return token.accessToken;
}

async function signIn(): Promise<void> {
  const settings = await readSettings();
  if (!settings.tenantId || !settings.clientId || !settings.scopes.trim()) {
    throw new Error("Configure the Entra tenant, client ID, and API scope in extension options first.");
  }
  const authority = `https://login.microsoftonline.com/${encodeURIComponent(settings.tenantId)}/oauth2/v2.0`;
  const redirectUri = chrome.identity.getRedirectURL("entra");
  const state = randomBase64Url(32);
  const verifier = randomBase64Url(64);
  const challenge = await sha256Base64Url(verifier);
  const authorize = new URL(`${authority}/authorize`);
  authorize.search = new URLSearchParams({
    client_id: settings.clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: settings.scopes.trim(),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256"
  }).toString();
  const redirected = await chrome.identity.launchWebAuthFlow({
    url: authorize.toString(),
    interactive: true
  });
  if (!redirected) throw new Error("Entra sign-in did not return a response.");
  const callback = new URL(redirected);
  if (callback.searchParams.get("state") !== state) throw new Error("Sign-in state validation failed.");
  const code = callback.searchParams.get("code");
  const oauthError = callback.searchParams.get("error_description") ?? callback.searchParams.get("error");
  if (!code) throw new Error(oauthError || "Entra sign-in did not return an authorization code.");
  const tokenResponse = await fetch(`${authority}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: settings.clientId,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      scope: settings.scopes.trim()
    })
  });
  if (!tokenResponse.ok) {
    throw new Error(`Entra token exchange failed (${tokenResponse.status}): ${(await tokenResponse.text()).slice(0, 300)}`);
  }
  const tokenPayload = await tokenResponse.json() as { access_token?: string; expires_in?: number };
  if (!tokenPayload.access_token || !tokenPayload.expires_in) {
    throw new Error("Entra returned an incomplete token response.");
  }
  await writeToken(tokenPayload.access_token, tokenPayload.expires_in);
}

function randomBase64Url(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Base64Url(value: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function isLocalhost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function isFillSuggestion(value: unknown): value is FillSuggestion {
  if (typeof value !== "object" || value === null) return false;
  const suggestion = value as Record<string, unknown>;
  const source = suggestion.source;
  const validSource = source === null || (
    typeof source === "object" &&
    source !== null &&
    "document_id" in source &&
    typeof source.document_id === "string" &&
    "title" in source &&
    typeof source.title === "string" &&
    "excerpt" in source &&
    typeof source.excerpt === "string"
  );
  return typeof suggestion.field_id === "string" &&
    typeof suggestion.proposed_value === "string" &&
    typeof suggestion.confidence === "number" &&
    Number.isFinite(suggestion.confidence) &&
    suggestion.confidence >= 0 &&
    suggestion.confidence <= 1 &&
    typeof suggestion.needs_review === "boolean" &&
    (typeof suggestion.reason === "string" || suggestion.reason === null) &&
    validSource;
}
