// #418 wire contract: GET /api/v1/pages/:id/versions, 200. The server test
// (tests/unit/v1-page-versions.test.ts) asserts the real route returns exactly
// this body, and the CLI and MCP tests use it as the server's answer, so the
// three agree.

export const VERSIONS_PAGE_ID = "6f0d6a52-3c1e-4f43-9a51-7c2b0e6f1d2a";

export const VERSIONS_RESPONSE = {"data":[{"version":3,"selector":"latest","live":true,"file_size":27,"kind":"markdown","content_type":"text/markdown; charset=utf-8","has_original":true,"created_at":"2026-10-14T09:30:00.000Z"},{"version":2,"selector":"3b9f1c2e-8a47-4d61-9e25-5c0a7f3d1b84","live":false,"file_size":1024,"kind":"pdf","content_type":"application/pdf","has_original":true,"created_at":"2026-10-13T08:00:00.000Z"},{"version":1,"selector":"9c4e2a7b-1d58-4f3a-8b06-2e7d9a5c4f13","live":false,"file_size":512,"kind":"html","content_type":"text/html; charset=utf-8","has_original":false,"created_at":"2026-10-12T07:00:00.000Z"}]};

export const VERSIONS = VERSIONS_RESPONSE.data;
