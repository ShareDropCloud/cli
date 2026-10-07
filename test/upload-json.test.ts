// #383 (P2, P5, P6, P8): upload JSON passes through everything an agent needs
// from one call: kind, mode, visibility, was_reupload, version, the scripts
// decision, every warning code, same-title pages on a new page, and skipped
// files for bundles.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../src/auth/resolve.js", () => ({
  resolveAuth: vi.fn(async () => ({ token: "sd_test", source: "flag" })),
  resolveBaseUrl: vi.fn(() => "https://app.example.com"),
}));

import { uploadCommand } from "../src/commands/upload.js";
import {
  BUNDLE_FINALIZE_NEW_PAGE,
  FINALIZE_NEW_PAGE,
  SIGN_RESPONSE,
  finalizeReupload,
  jsonResponse,
  routedFetch,
} from "./fixtures/contract-383.js";

function writeTmpFile(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "sharedrop-cli-json-"));
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

function makeSite(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "sharedrop-cli-json-site-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
}

/** The CLI JSON for the contract's new-page finalize body. */
const EXPECTED_NEW_PAGE_DATA = {
  id: "3f0c2b4e-8f7a-4c1d-9e2b-1a2b3c4d5e6f",
  title: "Q3 report",
  url: "/scottoau/ab12cd34ef",
  full_url: "https://sharedrop.cloud/scottoau/ab12cd34ef",
  kind: "html",
  mode: "interactive",
  visibility: "private",
  was_reupload: false,
  version: 1,
  scripts_will_run: false,
  external_resource_hosts: ["cdn.jsdelivr.net"],
  warnings: FINALIZE_NEW_PAGE.warnings,
  same_title_pages: FINALIZE_NEW_PAGE.same_title_pages,
};

describe("upload JSON output (#383)", () => {
  let stdout: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function stubSingle(finalizeBody: unknown) {
    const routed = routedFetch({
      "POST /api/upload/sign": () => jsonResponse(200, SIGN_RESPONSE),
      "PUT /01HXXXEXAMPLEULID": () => jsonResponse(200, {}),
      "POST /api/upload/finalize": () => jsonResponse(200, finalizeBody),
    });
    vi.stubGlobal("fetch", vi.fn(routed.fn));
    return routed.calls;
  }

  function printed() {
    return JSON.parse(String(stdout.mock.calls[0][0]));
  }

  it("a new single-file upload prints every contract field", async () => {
    stubSingle(FINALIZE_NEW_PAGE);
    await uploadCommand(writeTmpFile("q3.html", "<h1>Q3</h1>"), { json: true });

    expect(printed()).toEqual({ data: EXPECTED_NEW_PAGE_DATA });
  });

  it("a re-upload prints was_reupload true, the next version, and no same_title_pages", async () => {
    stubSingle(finalizeReupload(2));
    await uploadCommand(writeTmpFile("q3.html", "<h1>Q3 v2</h1>"), {
      json: true,
      pageId: FINALIZE_NEW_PAGE.page_id,
    });

    const { data } = printed();
    expect(data.was_reupload).toBe(true);
    expect(data.version).toBe(2);
    expect(data.id).toBe(FINALIZE_NEW_PAGE.page_id);
    expect(data).not.toHaveProperty("same_title_pages");
    expect(data).not.toHaveProperty("skipped");
  });

  it("an older server: warnings fall back to sanitiser_warnings, was_reupload comes from the page id", async () => {
    const sanitiser = [
      { code: "removed_tag", detail: "script", count: 1, message: "Removed 1 script element." },
    ];
    const older = {
      url: "/scottoau/ab12cd34ef",
      page_id: FINALIZE_NEW_PAGE.page_id,
      slug: "ab12cd34ef",
      visibility: "private",
      mode: "static",
      kind: "html",
      contentType: "text/html",
      sanitiser_warnings: sanitiser,
    };
    stubSingle(older);
    await uploadCommand(writeTmpFile("q3.html", "<h1>Q3</h1>"), {
      json: true,
      pageId: FINALIZE_NEW_PAGE.page_id,
    });
    const { data } = printed();
    expect(data.warnings).toEqual(sanitiser);
    expect(data.was_reupload).toBe(true);

    stdout.mockClear();
    stubSingle({ ...older, sanitiser_warnings: undefined });
    await uploadCommand(writeTmpFile("q3.html", "<h1>Q3</h1>"), { json: true });
    const second = printed().data;
    expect(second.warnings).toEqual([]);
    expect(second.was_reupload).toBe(false);
  });

  it("a bundle upload prints the same fields plus skipped (always present)", async () => {
    const dir = makeSite({
      "index.html": '<script src="app.js"></script>',
      "app.js": "1",
      "notes/.DS_Store": "junk",
      ".cache/hidden.js": "2",
      "README.md": "# notes",
    });
    const routed = routedFetch({
      "POST /api/upload/bundle/sign": (call) => {
        const files = (call.body?.files as Array<{ filename: string }>).map((f, i) => ({
          filename: f.filename,
          upload_url: `https://uploads.example.com/b${i}`,
          upload_token: `t${i}`,
          object_key: `b${i}`,
        }));
        return jsonResponse(200, {
          files,
          finalize_url: "https://app.example.com/api/upload/bundle/finalize",
        });
      },
      "PUT /b*": () => jsonResponse(200, {}),
      "POST /api/upload/bundle/finalize": () => jsonResponse(200, BUNDLE_FINALIZE_NEW_PAGE),
    });
    vi.stubGlobal("fetch", vi.fn(routed.fn));

    await uploadCommand(dir, { json: true });

    const { data } = printed();
    expect(data).toEqual({
      ...EXPECTED_NEW_PAGE_DATA,
      skipped: expect.any(Array),
    });
    expect(
      [...data.skipped].sort((a: { path: string }, b: { path: string }) =>
        a.path < b.path ? -1 : 1,
      ),
    ).toEqual([
      { path: ".cache/hidden.js", reason: "hidden file" },
      { path: "README.md", reason: "unsupported file type" },
      { path: "notes/.DS_Store", reason: "hidden file" },
    ]);
    // The hidden .js never reached sign.
    const signed = routed.calls.find((c) => c.url.endsWith("/bundle/sign"))?.body?.files as Array<{
      filename: string;
    }>;
    expect(signed.map((f) => f.filename).sort()).toEqual(["app.js", "index.html"]);
  });

  it("a bundle with nothing skipped still prints skipped: []", async () => {
    const dir = makeSite({ "index.html": "<h1>hi</h1>" });
    const routed = routedFetch({
      "POST /api/upload/bundle/sign": () =>
        jsonResponse(200, {
          files: [{ filename: "index.html", upload_url: "https://uploads.example.com/b0", upload_token: "t0", object_key: "b0" }],
          finalize_url: "https://app.example.com/api/upload/bundle/finalize",
        }),
      "PUT /b0": () => jsonResponse(200, {}),
      "POST /api/upload/bundle/finalize": () => jsonResponse(200, BUNDLE_FINALIZE_NEW_PAGE),
    });
    vi.stubGlobal("fetch", vi.fn(routed.fn));

    await uploadCommand(dir, { json: true });

    expect(printed().data.skipped).toEqual([]);
  });
});
