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

