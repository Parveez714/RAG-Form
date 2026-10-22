import { DEFAULT_SETTINGS, type ExtensionSettings } from "./types";

const SETTINGS_KEY = "embassy-form-assistant-settings";
const TOKEN_KEY = "embassy-form-assistant-token";

export async function readSettings(): Promise<ExtensionSettings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] as Partial<ExtensionSettings> | undefined) };
}

export async function writeSettings(settings: ExtensionSettings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

export async function readToken(): Promise<{ accessToken: string; expiresAt: number } | undefined> {
  const stored = await chrome.storage.session.get(TOKEN_KEY);
  return stored[TOKEN_KEY] as { accessToken: string; expiresAt: number } | undefined;
}

export async function writeToken(accessToken: string, expiresIn: number): Promise<void> {
  await chrome.storage.session.set({
    [TOKEN_KEY]: { accessToken, expiresAt: Date.now() + expiresIn * 1000 }
  });
}

export async function clearToken(): Promise<void> {
  await chrome.storage.session.remove(TOKEN_KEY);
}
