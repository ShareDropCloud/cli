import { createServer } from "node:http";
import crypto from "node:crypto";
import open from "open";

/**
 * Clerk OAuth (Authorization Code + PKCE) login for the CLI — the default
 * `sharedrop login`. Clerk is the authorization server; we discover its
 * endpoints from the app's `/.well-known/oauth-authorization-server` mirror so
 * the same code targets prod or staging by base URL alone.
 *
 * Verified behaviour (2026-05-30): a dynamically-registered PUBLIC client
 * (token_endpoint_auth_method=none, PKCE) receives a working refresh token when
 * `offline_access` is requested. Access tokens last 24h; refresh tokens don't
 * expire and rotate on use — so once logged in, the CLI auto-refreshes and the
 * user effectively never logs in again. (The DCR registration response echoes
 * only grant_types:["authorization_code"] — that is a red herring; the refresh
 * token is still issued at the token endpoint.)
 */

const OAUTH_SCOPES = "openid email profile offline_access";

export interface OAuthCreds {
  access_token: string;
  refresh_token?: string;
  /** Epoch ms when the access token expires. */
  expires_at: number;
  token_endpoint: string;
  client_id: string;
  issuer: string;
}

interface AuthServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
}

const b64url = (buf: Buffer) =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function discover(baseUrl: string): Promise<AuthServerMetadata> {
  const url = `${baseUrl.replace(/\/$/, "")}/.well-known/oauth-authorization-server`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`OAuth discovery failed (${res.status}) at ${url}`);
  }
  const m = (await res.json()) as Partial<AuthServerMetadata>;
  if (!m.authorization_endpoint || !m.token_endpoint || !m.registration_endpoint) {
    throw new Error("OAuth discovery document is missing required endpoints.");
  }
  return m as AuthServerMetadata;
}

async function registerClient(
  registrationEndpoint: string,
  redirectUri: string,
): Promise<string> {
  const res = await fetch(registrationEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Sharedrop CLI",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: OAUTH_SCOPES,
    }),
  });
  if (!res.ok) {
    throw new Error(`OAuth client registration failed (${res.status}).`);
  }
  const data = (await res.json()) as { client_id?: string };
  if (!data.client_id) throw new Error("OAuth registration returned no client_id.");
  return data.client_id;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

function credsFromTokenResponse(
  tok: TokenResponse,
  ctx: { token_endpoint: string; client_id: string; issuer: string; prevRefresh?: string },
): OAuthCreds {
  if (!tok.access_token) {
    throw new Error(tok.error_description || tok.error || "Token endpoint returned no access_token.");
  }
  const ttl = typeof tok.expires_in === "number" ? tok.expires_in : 3600;
  return {
    access_token: tok.access_token,
    // Clerk rotates refresh tokens; keep the previous one if a refresh response omits it.
    refresh_token: tok.refresh_token ?? ctx.prevRefresh,
    expires_at: Date.now() + ttl * 1000,
    token_endpoint: ctx.token_endpoint,
    client_id: ctx.client_id,
    issuer: ctx.issuer,
  };
}

/**
 * Run the interactive browser login. Binds a loopback callback server on an
 * ephemeral port, registers a client pinned to that exact redirect URI, opens
 * the Clerk consent flow, and exchanges the returned code (with the PKCE
 * verifier) for tokens.
 */
export async function oauthLogin(baseUrl: string): Promise<OAuthCreds> {
  const meta = await discover(baseUrl);

  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));

  return new Promise<OAuthCreds>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const server = createServer((req, res) => {
      const u = new URL(req.url ?? "/", "http://127.0.0.1");
      if (!u.pathname.startsWith("/callback")) {
        res.writeHead(204);
        res.end();
        return;
      }
      const code = u.searchParams.get("code");
      const err = u.searchParams.get("error");
      const returnedState = u.searchParams.get("state");

      const done = (html: string, after: () => void) => {
        res.writeHead(200, { "Content-Type": "text/html", Connection: "close" });
        res.end(html);
        server.close();
        after();
      };
      const fail = (message: string) =>
        done(
          "<h1>Login failed</h1><p>You can close this tab and return to your terminal.</p>",
          () => settle(() => reject(new Error(message))),
        );

      if (err) return fail(err);
      if (returnedState !== state) return fail("OAuth state mismatch.");
      if (!code) {
        res.writeHead(204);
        res.end();
        return;
      }

      // Exchange the code (public client: client_id + PKCE verifier, no secret).
      fetch(meta.token_endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          client_id: clientId,
          code_verifier: verifier,
        }),
      })
        .then((r) => r.json() as Promise<TokenResponse>)
        .then((tok) => {
          const creds = credsFromTokenResponse(tok, {
            token_endpoint: meta.token_endpoint,
            client_id: clientId,
            issuer: meta.issuer,
          });
          done(
            "<h1>Logged in!</h1><p>You can close this tab and return to your terminal.</p>",
            () => settle(() => resolve(creds)),
          );
        })
        .catch((e) => fail(e instanceof Error ? e.message : "Token exchange failed."));
    });

    let redirectUri = "";
    let clientId = "";

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        settle(() => reject(new Error("Failed to start callback server.")));
        return;
      }
      redirectUri = `http://127.0.0.1:${addr.port}/callback`;
      registerClient(meta.registration_endpoint, redirectUri)
        .then((id) => {
          clientId = id;
          const authorizeUrl =
            `${meta.authorization_endpoint}?response_type=code` +
            `&client_id=${encodeURIComponent(clientId)}` +
            `&redirect_uri=${encodeURIComponent(redirectUri)}` +
            `&scope=${encodeURIComponent(OAUTH_SCOPES)}` +
            `&code_challenge=${challenge}&code_challenge_method=S256` +
            `&state=${state}`;
          void open(authorizeUrl);
        })
        .catch((e) => {
          server.close();
          settle(() => reject(e instanceof Error ? e : new Error("Client registration failed.")));
        });
    });

    const timer = setTimeout(() => {
      server.close();
      settle(() => reject(new Error("Login timed out. Please try again.")));
    }, 180_000);
    timer.unref?.();
  });
}

/**
 * Exchange a stored refresh token for a fresh access token. Returns null when
 * the refresh token is missing/rejected (the caller should prompt re-login).
 */
export async function refreshOAuth(creds: OAuthCreds): Promise<OAuthCreds | null> {
  if (!creds.refresh_token) return null;
  let tok: TokenResponse;
  try {
    const res = await fetch(creds.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: creds.refresh_token,
        client_id: creds.client_id,
      }),
    });
    tok = (await res.json()) as TokenResponse;
    if (!res.ok || tok.error) return null;
  } catch {
    return null;
  }
  try {
    return credsFromTokenResponse(tok, {
      token_endpoint: creds.token_endpoint,
      client_id: creds.client_id,
      issuer: creds.issuer,
      prevRefresh: creds.refresh_token,
    });
  } catch {
    return null;
  }
}
