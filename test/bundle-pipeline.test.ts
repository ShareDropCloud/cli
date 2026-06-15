// #81 — CLI folder/bundle upload pipeline.
//
// Locks the batch flow (bundle/sign → PUT each file → bundle/finalize) for a
// `sharedrop upload <dir>` and the local validation that replaces the old
// opaque "fetch failed" when a directory hit the single-file stream path.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SharedropApiClient, SharedropApiError } from "../src/client/api-client.js";
import { uploadBundleStreamed, uploadFileStreamed } from "../src/commands/upload.js";

function newClient(): SharedropApiClient {
  return new SharedropApiClient({
    apiKey: "sd_test",
    baseUrl: "https://app.example.com",
  });
}

/** Build a temp site folder; returns its absolute path. */
function makeSite(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "sharedrop-cli-bundle-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
}

describe("sharedrop upload <dir> — bundle pipeline (#81)", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("happy path: batch sign → PUT each file → finalize bundle", async () => {
    const client = newClient();
    const dir = makeSite({
      "index.html": '<link rel="stylesheet" href="styles.css"><script src="script.js"></script>',
      "styles.css": "body{color:red}",
      "script.js": "console.log('hi')",
    });

    const signSpy = vi.spyOn(client, "signBundle").mockResolvedValue({
      files: [
        { filename: "index.html", upload_url: "https://up.example.com/k0", upload_token: "t0", object_key: "k0" },
        { filename: "styles.css", upload_url: "https://up.example.com/k1", upload_token: "t1", object_key: "k1" },
        { filename: "script.js", upload_url: "https://up.example.com/k2", upload_token: "t2", object_key: "k2" },
      ],
      finalize_url: "https://app.example.com/api/upload/bundle/finalize",
    });
    const streamSpy = vi.spyOn(client, "streamUpload").mockResolvedValue(undefined);
    const finalizeSpy = vi.spyOn(client, "finalizeBundle").mockResolvedValue({
      url: "/scotto/abc123",
      page_id: "p_1",
      slug: "abc123",
      visibility: "private",
      mode: "interactive",
      kind: "html",
      assets: 2,
    });

    const out = await uploadBundleStreamed(client, dir, "index.html", {
      title: "Site",
      visibility: "private",
      mode: "interactive",
    });

    // Order: sign before any PUT before finalize.
    expect(signSpy).toHaveBeenCalledBefore(streamSpy as never);
    expect(streamSpy).toHaveBeenCalledBefore(finalizeSpy as never);

    // sign: root index.html (text/html) + the two assets with their MIME.
    const signArg = signSpy.mock.calls[0][0];
    expect(signArg.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ filename: "index.html", content_type: "text/html" }),
        expect.objectContaining({ filename: "styles.css", content_type: "text/css; charset=utf-8" }),
        expect.objectContaining({ filename: "script.js", content_type: "text/javascript; charset=utf-8" }),
      ]),
    );

    // One PUT per file (root + 2 assets).
    expect(streamSpy).toHaveBeenCalledTimes(3);

    // finalize: exactly one "index.html" path, assets carry their relative refs.
    const finalizeArg = finalizeSpy.mock.calls[0][0];
    expect(finalizeArg.files.filter((f) => f.path === "index.html")).toHaveLength(1);
    expect(finalizeArg.files.map((f) => f.path).sort()).toEqual(["index.html", "script.js", "styles.css"]);
    expect(finalizeArg.mode).toBe("interactive");

    expect(out.url).toBe("/scotto/abc123");
    expect(out.page_id).toBe("p_1");
    expect(out.skipped).toEqual([]);
  });

  it("skips non-serveable files instead of failing the whole bundle", async () => {
    const client = newClient();
    const dir = makeSite({
      "index.html": "<h1>hi</h1>",
      "app.js": "1",
      ".DS_Store": "junk",
      "README.md": "# notes",
    });

    vi.spyOn(client, "signBundle").mockResolvedValue({
      files: [
        { filename: "index.html", upload_url: "https://up.example.com/k0", upload_token: "t0", object_key: "k0" },
        { filename: "app.js", upload_url: "https://up.example.com/k1", upload_token: "t1", object_key: "k1" },
      ],
      finalize_url: "https://app.example.com/api/upload/bundle/finalize",
    });
    vi.spyOn(client, "streamUpload").mockResolvedValue(undefined);
    vi.spyOn(client, "finalizeBundle").mockResolvedValue({
      url: "/scotto/x",
      page_id: "p",
      slug: "x",
      visibility: "private",
      mode: "interactive",
      kind: "html",
      assets: 1,
    });

    const out = await uploadBundleStreamed(client, dir, "index.html", {});
    expect(out.skipped.sort()).toEqual([".DS_Store", "README.md"]);
  });

  it("directory without an entry HTML fails locally (no network)", async () => {
    const client = newClient();
    const dir = makeSite({ "styles.css": "body{}", "app.js": "1" });

    const signSpy = vi.spyOn(client, "signBundle").mockResolvedValue({} as never);

    await expect(uploadBundleStreamed(client, dir, "index.html", {})).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 400,
    });
    // Validation happens before any signing call.
    expect(signSpy).not.toHaveBeenCalled();
  });

  it("--entry names a non-default root", async () => {
    const client = newClient();
    const dir = makeSite({ "main.html": "<h1>hi</h1>", "app.js": "1" });

    const signSpy = vi.spyOn(client, "signBundle").mockResolvedValue({
      files: [
        { filename: "main.html", upload_url: "https://up.example.com/k0", upload_token: "t0", object_key: "k0" },
        { filename: "app.js", upload_url: "https://up.example.com/k1", upload_token: "t1", object_key: "k1" },
      ],
      finalize_url: "https://app.example.com/api/upload/bundle/finalize",
    });
    vi.spyOn(client, "streamUpload").mockResolvedValue(undefined);
    const finalizeSpy = vi.spyOn(client, "finalizeBundle").mockResolvedValue({
      url: "/scotto/y",
      page_id: "p",
      slug: "y",
      visibility: "private",
      mode: "interactive",
      kind: "html",
      assets: 1,
    });

    await uploadBundleStreamed(client, dir, "main.html", {});

    // The entry is sent to finalize as path "index.html" regardless of its name.
    const finalizeArg = finalizeSpy.mock.calls[0][0];
    expect(finalizeArg.files.filter((f) => f.path === "index.html")).toHaveLength(1);
    expect(signSpy).toHaveBeenCalledTimes(1);
  });
});

describe("single-file path rejects a directory (#81)", () => {
  it("uploadFileStreamed throws a clear error for a directory, not 'fetch failed'", async () => {
    const client = newClient();
    const dir = makeSite({ "index.html": "<h1>hi</h1>" });
    await expect(uploadFileStreamed(client, dir, {})).rejects.toBeInstanceOf(SharedropApiError);
    await expect(uploadFileStreamed(client, dir, {})).rejects.toMatchObject({
      code: "UNSUPPORTED_INPUT",
    });
  });
});
