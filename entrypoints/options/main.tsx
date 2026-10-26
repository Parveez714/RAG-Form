import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { DEFAULT_SETTINGS, type ExtensionSettings, type WorkerRequest, type WorkerResponse } from "../../src/shared/types";
import "./style.css";

function Options(): React.JSX.Element {
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [originText, setOriginText] = useState("");
  const [status, setStatus] = useState("Loading settings…");

  useEffect(() => {
    void chrome.runtime.sendMessage({ type: "GET_SETTINGS" } satisfies WorkerRequest)
      .then((response: WorkerResponse) => {
        if (!response.ok) throw new Error(response.error);
        if (response.settings) {
          setSettings(response.settings);
          setOriginText(response.settings.allowedOrigins.join("\n"));
        }
        setStatus("");
      })
      .catch((error: unknown) => setStatus(error instanceof Error ? error.message : "Could not load settings."));
  }, []);

  function update<K extends keyof ExtensionSettings>(key: K, value: ExtensionSettings[K]): void {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  async function save(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setStatus("");
    try {
      const parsed = new URL(settings.apiUrl);
      const permissions = await chrome.permissions.request({ origins: [`${parsed.origin}/*`] });
      if (!permissions) throw new Error("The API host permission was not granted.");
      const normalized: ExtensionSettings = {
        ...settings,
        apiUrl: `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`,
        allowedOrigins: originText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
      };
      const response = await chrome.runtime.sendMessage({
        type: "SAVE_SETTINGS",
        settings: normalized
      } satisfies WorkerRequest) as WorkerResponse;
      if (!response.ok) throw new Error(response.error);
      setSettings(normalized);
      setStatus("Settings saved. Approved website origins are used only with activeTab access.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Settings could not be saved.");
    }
  }

  async function signIn(): Promise<void> {
    try {
      const granted = await chrome.permissions.request({
        origins: ["https://login.microsoftonline.com/*"]
      });
      if (!granted) throw new Error("The Entra sign-in host permission was not granted.");
      const response = await chrome.runtime.sendMessage({ type: "SIGN_IN" } satisfies WorkerRequest) as WorkerResponse;
      setStatus(response.ok ? response.message ?? "Signed in." : response.error);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Sign-in failed.");
    }
  }

  async function signOut(): Promise<void> {
    const response = await chrome.runtime.sendMessage({ type: "SIGN_OUT" } satisfies WorkerRequest) as WorkerResponse;
    setStatus(response.ok ? response.message ?? "Signed out." : response.error);
  }

  return (
    <main>
      <p className="eyebrow">EMBASSY FORM ASSISTANT</p>
      <h1>Extension settings</h1>
      <p>Only approved HTTPS origins are scanned. Your API endpoint and site list are stored locally in this browser.</p>
      <form onSubmit={(event) => void save(event)}>
        <label>Your Profile Email
          <input
            type="email"
            placeholder="e.g. parveezbackup@gmail.com"
            value={settings.userEmail ?? ""}
            onChange={(event) => update("userEmail", event.target.value)}
          />
        </label>
        <label>Backend API URL
          <input type="url" required value={settings.apiUrl} onChange={(event) => update("apiUrl", event.target.value)} />
        </label>
        <label>Approved website origins <span>(one origin per line; no paths or wildcards)</span>
          <textarea rows={5} placeholder="https://forms.example.gov" value={originText} onChange={(event) => setOriginText(event.target.value)} />
        </label>
        <h2>Microsoft Entra ID (optional)</h2>
        <p className="hint">Register the extension redirect URI shown in the identity setup guide as a Single-page application (SPA). Configure an API scope accepted by your backend.</p>
        <label>Tenant ID or domain
          <input value={settings.tenantId} onChange={(event) => update("tenantId", event.target.value)} />
        </label>
        <label>Public client application ID
          <input value={settings.clientId} onChange={(event) => update("clientId", event.target.value)} />
        </label>
        <label>Scopes
          <input placeholder="api://your-api-id/access_as_user" value={settings.scopes} onChange={(event) => update("scopes", event.target.value)} />
        </label>
        <label>Extension redirect URI
          <input readOnly value={chrome.identity.getRedirectURL("entra")} />
        </label>
        <div className="actions">
          <button className="primary" type="submit">Save settings</button>
          <button type="button" onClick={() => void signIn()}>Sign in</button>
          <button type="button" onClick={() => void signOut()}>Sign out</button>
        </div>
      </form>
      <p role="status" className="status">{status}</p>
      <p className="privacy">Access tokens are kept in session storage and are not persisted across browser restarts. No form is submitted automatically.</p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Options />);
