import Conf from "conf";
import type { OAuthCreds } from "./oauth.js";

const config = new Conf({
  projectName: "sharedrop",
  schema: {
    // Legacy single token (sd_ API key) from the pre-OAuth browser login. Still
    // read for back-compat; new logins populate `oauth` instead.
    token: { type: "string" },
    baseUrl: { type: "string", default: "https://sharedrop.cloud" },
    // Clerk OAuth credential set from `sharedrop login` (default path).
    oauth: { type: "object" },
    // #409: default workspace per server base URL, so a staging default never
    // applies to production. { [origin]: { id, slug } }
    workspaceDefaults: { type: "object" },
  },
});

export function getStoredToken(): string | undefined {
  return config.get("token") as string | undefined;
}

export function storeToken(token: string): void {
  config.set("token", token);
}

export function clearToken(): void {
  config.delete("token");
}

export function getOAuth(): OAuthCreds | undefined {
  return config.get("oauth") as OAuthCreds | undefined;
}

export function storeOAuth(creds: OAuthCreds): void {
  config.set("oauth", creds);
}

export function clearOAuth(): void {
  config.delete("oauth");
}


export interface SavedWorkspace {
  id: string;
  slug: string;
}

// Base URLs contain dots, so the map is read and written whole (Conf treats
// dots in a key as a path).
function workspaceDefaults(): Record<string, SavedWorkspace> {
  return (config.get("workspaceDefaults") as Record<string, SavedWorkspace> | undefined) ?? {};
}

/** Lowercased scheme and host, no path or trailing slash, so spellings of one server match. */
function originOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return baseUrl.trim().replace(/\/+$/, "").toLowerCase();
  }
}

/** Keys for this server, including any saved under an older, unnormalised spelling. */
function keysFor(all: Record<string, SavedWorkspace>, baseUrl: string): string[] {
  const origin = originOf(baseUrl);
  return Object.keys(all).filter((key) => originOf(key) === origin);
}

export function getSavedWorkspace(baseUrl: string): SavedWorkspace | undefined {
  const all = workspaceDefaults();
  const origin = originOf(baseUrl);
  const key = origin in all ? origin : keysFor(all, baseUrl)[0];
  return key === undefined ? undefined : all[key];
}

export function saveWorkspace(baseUrl: string, workspace: SavedWorkspace): void {
  const all = workspaceDefaults();
  for (const key of keysFor(all, baseUrl)) delete all[key];
  config.set("workspaceDefaults", { ...all, [originOf(baseUrl)]: workspace });
}

/** Returns false when no default was saved for this server. */
export function clearSavedWorkspace(baseUrl: string): boolean {
  const all = workspaceDefaults();
  const keys = keysFor(all, baseUrl);
  if (keys.length === 0) return false;
  for (const key of keys) delete all[key];
  config.set("workspaceDefaults", all);
  return true;
}
