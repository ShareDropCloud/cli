import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getStoredToken, getOAuth, storeOAuth, clearOAuth } from "./store.js";
import { refreshOAuth } from "./oauth.js";

export interface AuthResult {
  token: string;
  source: "flag" | "env" | "dotenv" | "oauth" | "stored";
}

/**
 * Resolve the Bearer credential for a command.
 *
 * Default is the Clerk OAuth session from `sharedrop login` (auto-refreshed
 * when the 24h access token is near expiry). An API key only takes over when
 * the user explicitly provides one — `--token`, then SHAREDROP_TOKEN, then a
 * `.env` entry. A legacy stored sd_ key (pre-OAuth login) is the final
 * fallback.
 *
 * Async because the OAuth path may hit Clerk's token endpoint to refresh.
 */
export async function resolveAuth(flagToken?: string): Promise<AuthResult | null> {
  // 0. --token global flag — explicit per-invocation override.
  if (flagToken) {
    return { token: flagToken, source: "flag" };
  }

  // 1. SHAREDROP_TOKEN env var — CI / machines.
  if (process.env.SHAREDROP_TOKEN) {
    return { token: process.env.SHAREDROP_TOKEN, source: "env" };
  }

  // 2. .env file in the current directory.
  try {
    const envFile = readFileSync(resolve(process.cwd(), ".env"), "utf-8");
    const match = envFile.match(/^SHAREDROP_TOKEN=(.+)$/m);
    if (match?.[1]) {
      return { token: match[1].trim(), source: "dotenv" };
    }
  } catch {
    /* no .env file */
  }

  // 3. Clerk OAuth session from `sharedrop login` (the default).
  const oauth = getOAuth();
  if (oauth) {
    // Refresh proactively when the access token is within 60s of expiry.
    if (Date.now() < oauth.expires_at - 60_000) {
      return { token: oauth.access_token, source: "oauth" };
    }
    const refreshed = await refreshOAuth(oauth);
    if (refreshed) {
      storeOAuth(refreshed);
      return { token: refreshed.access_token, source: "oauth" };
    }
    // Refresh failed — clear the dead session so requireAuth prompts re-login.
    clearOAuth();
    return null;
  }

  // 4. Legacy stored sd_ key from a pre-OAuth `login`.
  const stored = getStoredToken();
  if (stored) {
    return { token: stored, source: "stored" };
  }

  return null;
}

function normalizeUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/**
 * Resolve the target base URL. Precedence: `--url` flag > SHAREDROP_URL env >
 * `.env` > saved config (set by `login --url`) > the production default.
 */
export function resolveBaseUrl(flagUrl?: string): string {
  if (flagUrl) return normalizeUrl(flagUrl);

  if (process.env.SHAREDROP_URL) return normalizeUrl(process.env.SHAREDROP_URL);

  try {
    const envFile = readFileSync(resolve(process.cwd(), ".env"), "utf-8");
    const match = envFile.match(/^SHAREDROP_URL=(.+)$/m);
    if (match?.[1]) return normalizeUrl(match[1]);
  } catch {
    /* no .env file */
  }

  return "https://sharedrop.cloud";
}
