// #271 — the CLI prints the recipient address the SERVER chose.
//
// Two paths previously assembled a URL from the CLI's own base URL: the upload
// formatter (finalize returned a relative path only) and `list --folder` (which
// reads the owner tree). Both now prefer the server's value, so an owner with a
// live custom domain sees their branded address. The base-URL fallback is kept
// for an older server that sends neither.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../src/auth/resolve.js", () => ({
  resolveAuth: vi.fn(async () => ({ token: "sd_test", source: "flag" })),
  resolveBaseUrl: vi.fn(() => "https://app.example.com"),
}));

import { SharedropApiClient } from "../src/client/api-client.js";
import { formatUploadResult } from "../src/commands/upload.js";
import { listCommand } from "../src/commands/list.js";

const BRANDED = "https://share.acme.com/scotto/abc";

function silenceLog() {
  return vi.spyOn(console, "log").mockImplementation(() => {});
}

describe("CLI upload output — branded delivery", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("prints the server's full_url when the page is delivered from a custom domain", () => {
    const result = {
      url: "/scotto/abc",
      full_url: BRANDED,
      title: "Report",
      page_id: "p_1",
    };
    expect(
      formatUploadResult(result, "https://app.example.com", {}),
    ).toContain(BRANDED);
    const json = JSON.parse(
      formatUploadResult(result, "https://app.example.com", { json: true }),
    );
    expect(json.data.full_url).toBe(BRANDED);
  });

  it("falls back to the base URL when the server sends no full_url", () => {
    const json = JSON.parse(
      formatUploadResult(
        { url: "/scotto/abc", title: "Report", page_id: "p_1" },
        "https://app.example.com",
        { json: true },
      ),
    );
    expect(json.data.full_url).toBe("https://app.example.com/scotto/abc");
  });

  it("never renders an em dash in the upload result", () => {
    expect(
      formatUploadResult(
        { url: "/scotto/abc", full_url: BRANDED, title: "Report", page_id: "p_1" },
        "https://app.example.com",
        {},
      ),
    ).not.toContain("—");
  });
});

describe("CLI list --folder — branded delivery", () => {
  const FID = "11111111-1111-4111-8111-111111111111";

  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  function stubTree(fullUrl: string | undefined) {
    vi.spyOn(SharedropApiClient.prototype, "getMe").mockResolvedValue({
      username: "scotto",
    } as never);
    vi.spyOn(SharedropApiClient.prototype, "listTree").mockResolvedValue({
      pages: [
        { id: FID, title: "reports", nodeType: "folder", parentId: null, path: `/${FID}` },
        {
          id: "p_1",
          slug: "abc",
          title: "In folder",
          nodeType: "page",
          parentId: FID,
          path: `/${FID}/p_1`,
          visibility: "public",
          mode: "static",
          fileSize: 10,
          ...(fullUrl ? { fullUrl } : {}),
          createdAt: "2026-07-12T00:00:00.000Z",
          updatedAt: "2026-07-12T00:00:00.000Z",
        },
      ],
    });
  }

  it("uses the tree's branded fullUrl rather than the CLI base URL", async () => {
    stubTree(BRANDED);
    const log = silenceLog();
    await listCommand({ folder: FID, json: true }, {});
    const printed = JSON.parse(log.mock.calls[0][0] as string);
    expect(printed.data[0].full_url).toBe(BRANDED);
  });

  it("falls back to the base URL when the server sends no fullUrl", async () => {
    stubTree(undefined);
    const log = silenceLog();
    await listCommand({ folder: FID, json: true }, {});
    const printed = JSON.parse(log.mock.calls[0][0] as string);
    expect(printed.data[0].full_url).toBe("https://app.example.com/scotto/abc");
  });
});
