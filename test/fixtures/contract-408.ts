// #408 wire contract bodies, copied verbatim from the ticket so the CLI is
// tested against exactly what the server half returns.

/** GET /api/v1/workspaces, 200. */
export const WORKSPACES_RESPONSE = {"data":{"workspaces":[{"id":"6f1c2a9e-1b7d-4c52-9a51-0d3f8e2b7a10","name":"Ascend Intelligence","slug":"ascend","role":"owner","tier":"team","can_upload":true,"can_edit_all_pages":true},{"id":"0b8e4d3c-5a21-4f6e-8c97-2d1a6b9e4f30","name":"Client Reports","slug":"client-reports","role":"member","tier":"team","can_upload":true,"can_edit_all_pages":true},{"id":"9d2f7b1a-3c84-4e5d-b6a0-7e1c5f8d2a49","name":"Partner Briefs","slug":"partner-briefs","role":"viewer","tier":"team","can_upload":false,"can_edit_all_pages":false}]}};

export const WORKSPACES = WORKSPACES_RESPONSE.data.workspaces;

/** The same list from an older server that sends only the role. */
export const WORKSPACES_ROLE_ONLY = WORKSPACES.map(
  ({ can_upload: _u, can_edit_all_pages: _e, ...rest }) => rest,
);

/** Any workspace argument the caller is not a member of: HTTP 404. */
export const WORKSPACE_NOT_FOUND_MESSAGE = "Workspace not found or you are not a member";

/** GET /api/v1/me fields every server sends (pre-#408 shape). */
export const ME_BASE = {
  username: "alice",
  email: "alice@example.com",
  tier: "free",
  pages_used: 3,
  pages_limit: 50,
  storage_used: 2048,
};

/** /api/v1/me for a personal key. */
export const ME_PERSONAL = {
  ...ME_BASE,
  scope: "personal" as const,
  workspace: null,
  workspaces: WORKSPACES,
};

/** /api/v1/me for an sdw_ key bound to Ascend Intelligence. */
export const ME_WORKSPACE_KEY = {
  ...ME_BASE,
  tier: "team",
  scope: "workspace" as const,
  workspace: WORKSPACES[0],
  workspaces: [WORKSPACES[0]],
};
