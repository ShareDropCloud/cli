// #383 wire contract bodies, copied verbatim from the ticket's contract so the
// CLI is built and tested against exactly what the server half returns.

/** POST /api/upload/finalize, new page. */
export const FINALIZE_NEW_PAGE = {
  "url": "/scottoau/ab12cd34ef",
  "full_url": "https://sharedrop.cloud/scottoau/ab12cd34ef",
  "page_id": "3f0c2b4e-8f7a-4c1d-9e2b-1a2b3c4d5e6f",
  "slug": "ab12cd34ef",
  "title": "Q3 report",
  "mode": "interactive",
  "visibility": "private",
  "kind": "html",
  "contentType": "text/html",
  "was_reupload": false,
  "version": 1,
  "scripts_will_run": false,
  "external_resource_hosts": ["cdn.jsdelivr.net"],
  "warnings": [
    { "code": "images_extracted", "detail": "img", "count": 2, "message": "2 inline images were moved to hosted storage." },
    { "code": "external_refs_block_scripts", "detail": "cdn.jsdelivr.net", "count": 1, "message": "Scripts will not run because the page loads resources from 1 external host. Turn on external network for this page or vendor the files." }
  ],
  "same_title_pages": [
    { "id": "7d1e0a9c-2b3f-4e5d-8c7b-6a5f4e3d2c1b", "full_url": "https://sharedrop.cloud/scottoau/zz98yy76xx", "updated_at": "2026-10-06T22:14:03.000Z" }
  ]
};

/**
 * Re-upload response: the same fields with was_reupload true, version
 * previous + 1, and no same_title_pages key.
 */
export function finalizeReupload(version: number) {
  const { same_title_pages: _omit, ...rest } = FINALIZE_NEW_PAGE;
  return { ...rest, was_reupload: true, version };
}

/** POST /api/upload/bundle/finalize: the single-finalize fields plus assets. */
export const BUNDLE_FINALIZE_NEW_PAGE = { ...FINALIZE_NEW_PAGE, assets: 2 };

/** POST /api/upload/lint, 200. */
export const LINT_RESPONSE = {
  "kind": "html",
  "mode_effective": "interactive",
  "detected_slides": false,
  "size_ok": true,
  "size_bytes": 48211,
  "size_limit_bytes": 26214400,
  "title": "Q3 report",
  "warnings": [ { "code": "removed_tag", "detail": "iframe", "count": 1, "message": "Removed 1 <iframe> element." } ],
  "images_extracted": 2,
  "external_resource_hosts": [],
  "scripts_would_run": true,
  "same_title_pages": [],
  "would_change": true
};

/** The same lint response with nothing removed or blocked. */
export const LINT_RESPONSE_CLEAN = { ...LINT_RESPONSE, warnings: [], would_change: false };

/** POST /api/upload/bundle/lint adds the bundle's file count. */
export const BUNDLE_LINT_RESPONSE = { ...LINT_RESPONSE, files: 3 };

/** POST /api/upload/sign, 200. */
export const SIGN_RESPONSE = {
  upload_url: "https://uploads.example.com/01HXXXEXAMPLEULID",
  upload_token: "tkn_test",
  finalize_url: "https://app.example.com/api/upload/finalize",
  object_key: "01HXXXEXAMPLEULID",
};

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export interface RecordedCall {
  url: string;
  method: string;
  body: Record<string, unknown> | undefined;
}

/**
 * A fetch stub that routes by path. Each handler returns a Response; the stub
 * records every call with its parsed JSON body (PUT bodies are streams and are
 * left undefined).
 */
export function routedFetch(routes: Record<string, (call: RecordedCall) => Response>) {
  const calls: RecordedCall[] = [];
  const fn = async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    let body: Record<string, unknown> | undefined;
    if (typeof init?.body === "string") body = JSON.parse(init.body);
    const call = { url, method, body };
    calls.push(call);
    const path = new URL(url).pathname;
    const key = Object.keys(routes).find((k) => {
      const [m, p] = k.split(" ");
      return m === method && (p === path || (p.endsWith("*") && path.startsWith(p.slice(0, -1))));
    });
    if (!key) throw new Error(`unrouted fetch: ${method} ${url}`);
    return routes[key](call);
  };
  return { fn, calls };
}
