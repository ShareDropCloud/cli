import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../src/auth/resolve.js", () => ({
  resolveAuth: vi.fn(async () => ({ token: "sd_test", source: "flag" })),
  resolveBaseUrl: vi.fn(() => "https://app.example.com"),
}));

import { SharedropApiClient } from "../src/client/api-client.js";
import { updateCommand } from "../src/commands/update.js";
import { uploadCommand } from "../src/commands/upload.js";
import {
  FINALIZE_NEW_PAGE,
  SIGN_RESPONSE,
  finalizeReupload,
  jsonResponse,
  routedFetch,
} from "./fixtures/contract-383.js";

function writeTmpFile(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "sharedrop-cli-update-"));
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

afterEach(() => vi.restoreAllMocks());

describe("updateCommand", () => {
  it("passes --slug through the page PATCH", async () => {
    const update = vi.spyOn(SharedropApiClient.prototype, "updatePage").mockResolvedValue({
      id: "11111111-2222-4333-8444-555555555555",
      slug: "weekly-metrics",
      title: "Weekly metrics",
      mode: "static",
      kind: "html",
      file_size: 42,
      visibility: "public",
      url: "/alice/weekly-metrics",
      full_url: "https://app.example.com/alice/weekly-metrics",
      created_at: "2026-08-14T00:00:00.000Z",
      updated_at: "2026-08-14T00:00:00.000Z",
    });
    vi.spyOn(console, "log").mockImplementation(() => {});

    await updateCommand(
      "11111111-2222-4333-8444-555555555555",
      undefined,
      { slug: "weekly-metrics", json: true },
      {},
    );

    expect(update).toHaveBeenCalledWith(
      "11111111-2222-4333-8444-555555555555",
      { slug: "weekly-metrics" },
    );
  });
});

// #383 (P2, P5): update prints the re-upload result in the same JSON shape as
// upload, and a folder updates a folder page in place via the bundle pipeline.
describe("updateCommand re-upload output (#383)", () => {
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

  function printed(i: number) {
    return JSON.parse(String(stdout.mock.calls[i][0])).data;
  }

  it("upload then update the same file twice: versions 1, 2, 3 on one id and url", async () => {
    let version = 0;
    const routed = routedFetch({
      "POST /api/upload/sign": () => jsonResponse(200, SIGN_RESPONSE),
      "PUT /01HXXXEXAMPLEULID": () => jsonResponse(200, {}),
      "POST /api/upload/finalize": (call) => {
        version += 1;
        return jsonResponse(200, call.body?.page_id ? finalizeReupload(version) : FINALIZE_NEW_PAGE);
      },
    });
    vi.stubGlobal("fetch", vi.fn(routed.fn));
    const file = writeTmpFile("q3.html", "<h1>Q3</h1>");

    await uploadCommand(file, { json: true });
    const created = printed(0);
    await updateCommand(created.id, file, { json: true }, {});
    await updateCommand(created.id, file, { json: true }, {});

    const first = printed(1);
    const second = printed(2);
    expect([created.version, first.version, second.version]).toEqual([1, 2, 3]);
    expect(created.was_reupload).toBe(false);
    for (const revision of [first, second]) {
      expect(revision.id).toBe(created.id);
      expect(revision.url).toBe(created.url);
      expect(revision.full_url).toBe(created.full_url);
      expect(revision.was_reupload).toBe(true);
      expect(revision.warnings).toEqual(FINALIZE_NEW_PAGE.warnings);
      expect(revision).not.toHaveProperty("same_title_pages");
    }
    // Both updates sent the page id at sign and finalize, and no mode.
    const finalizeBodies = routed.calls
      .filter((c) => c.url.endsWith("/api/upload/finalize"))
      .map((c) => c.body);
    expect(finalizeBodies[1]?.page_id).toBe(created.id);
    expect(finalizeBodies[2]?.page_id).toBe(created.id);
    expect(finalizeBodies[1]).not.toHaveProperty("mode");
    const signBodies = routed.calls.filter((c) => c.url.endsWith("/api/upload/sign")).map((c) => c.body);
    expect(signBodies[1]?.page_id).toBe(created.id);
  });

  it("update <id> <folder> updates the folder page in place via the bundle pipeline", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sharedrop-cli-update-site-"));
    writeFileSync(join(dir, "index.html"), '<script src="app.js"></script>');
    writeFileSync(join(dir, "app.js"), "1");
    const routed = routedFetch({
      "POST /api/upload/bundle/sign": () =>
        jsonResponse(200, {
          files: [
            { filename: "index.html", upload_url: "https://uploads.example.com/b0", upload_token: "t0", object_key: "b0" },
            { filename: "app.js", upload_url: "https://uploads.example.com/b1", upload_token: "t1", object_key: "b1" },
          ],
          finalize_url: "https://app.example.com/api/upload/bundle/finalize",
        }),
      "PUT /b*": () => jsonResponse(200, {}),
      "POST /api/upload/bundle/finalize": () =>
        jsonResponse(200, { ...finalizeReupload(4), assets: 1 }),
    });
    vi.stubGlobal("fetch", vi.fn(routed.fn));
    const finalizeSingle = vi.spyOn(SharedropApiClient.prototype, "finalizeUpload");

    await updateCommand(FINALIZE_NEW_PAGE.page_id, dir, { json: true }, {});

    const sign = routed.calls.find((c) => c.url.endsWith("/api/upload/bundle/sign"));
    const finalize = routed.calls.find((c) => c.url.endsWith("/api/upload/bundle/finalize"));
    expect(sign?.body?.page_id).toBe(FINALIZE_NEW_PAGE.page_id);
    expect(finalize?.body?.page_id).toBe(FINALIZE_NEW_PAGE.page_id);
    expect(finalize?.body).not.toHaveProperty("mode");
    expect(finalizeSingle).not.toHaveBeenCalled();

    const data = printed(0);
    expect(data.id).toBe(FINALIZE_NEW_PAGE.page_id);
    expect(data.version).toBe(4);
    expect(data.was_reupload).toBe(true);
    expect(data.skipped).toEqual([]);
  });

  it("update <id> <file> --visibility reflects the patched page in the result", async () => {
    const routed = routedFetch({
      "POST /api/upload/sign": () => jsonResponse(200, SIGN_RESPONSE),
      "PUT /01HXXXEXAMPLEULID": () => jsonResponse(200, {}),
      "POST /api/upload/finalize": () => jsonResponse(200, finalizeReupload(2)),
    });
    vi.stubGlobal("fetch", vi.fn(routed.fn));
    vi.spyOn(SharedropApiClient.prototype, "updatePage").mockResolvedValue({
      id: FINALIZE_NEW_PAGE.page_id,
      slug: "ab12cd34ef",
      title: "Q3 report",
      mode: "interactive",
      kind: "html",
      file_size: 42,
      visibility: "public",
      url: "/scottoau/ab12cd34ef",
      full_url: "https://sharedrop.cloud/scottoau/ab12cd34ef",
      created_at: "2026-10-06T00:00:00.000Z",
      updated_at: "2026-10-07T00:00:00.000Z",
    });

    await updateCommand(
      FINALIZE_NEW_PAGE.page_id,
      writeTmpFile("q3.html", "<h1>Q3</h1>"),
      { json: true, visibility: "public" },
      {},
    );

    const data = printed(0);
    expect(data.visibility).toBe("public");
    expect(data.version).toBe(2);
    expect(data.warnings).toEqual(FINALIZE_NEW_PAGE.warnings);
  });
});
