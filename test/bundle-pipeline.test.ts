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

    // sign: root index.html (text/html) + the two assets with BARE MIME types.
    const signArg = signSpy.mock.calls[0][0];
    expect(signArg.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ filename: "index.html", content_type: "text/html" }),
        expect.objectContaining({ filename: "styles.css", content_type: "text/css" }),
        expect.objectContaining({ filename: "script.js", content_type: "text/javascript" }),
      ]),
    );

    // Regression guard (#mime_mismatch): the signed content_type must never
    // carry a `; charset=…` parameter — the Worker compares the param-stripped
    // PUT header against the verbatim token claim, so charset → mime_mismatch.
    for (const f of signArg.files) {
      expect(f.content_type).not.toContain(";");
      expect(f.content_type).not.toContain("charset");
    }

    // One PUT per file (root + 2 assets), and each PUT's Content-Type must equal
    // the content_type signed for that same file (so claim === actual).
    expect(streamSpy).toHaveBeenCalledTimes(3);
    for (const call of streamSpy.mock.calls) {
      const putContentType = call[3];
      expect(putContentType).not.toContain("charset");
      expect(signArg.files.map((f) => f.content_type)).toContain(putContentType);
    }

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

  it("retries only a transiently failed bundle member with fresh coordinates", async () => {
    const client = newClient();
    const dir = makeSite({ "index.html": "<h1>retry</h1>" });
    const signBundle = vi.spyOn(client, "signBundle").mockResolvedValue({
      files: [
        {
          filename: "index.html",
          upload_url: "https://up.example.com/old",
          upload_token: "old-token",
          object_key: "old-key",
        },
      ],
      finalize_url: "https://app.example.com/api/upload/bundle/finalize",
    });
    const signUpload = vi.spyOn(client, "signUpload").mockResolvedValue({
      upload_url: "https://up.example.com/fresh",
      upload_token: "fresh-token",
      finalize_url: "https://app.example.com/api/upload/finalize",
      object_key: "fresh-key",
    });
    const streamUpload = vi
      .spyOn(client, "streamUpload")
      .mockRejectedValueOnce(
        new SharedropApiError(
          "UPLOAD_FAILED",
          "upload_failed",
          503,
          undefined,
          undefined,
          { retryable: true },
        ),
      )
      .mockResolvedValueOnce(undefined);
    const finalize = vi.spyOn(client, "finalizeBundle").mockResolvedValue({
      url: "/scotto/retried",
      page_id: "page-retried",
      slug: "retried",
      visibility: "private",
      mode: "interactive",
      kind: "html",
      assets: 0,
    });
    const sleep = vi.fn().mockResolvedValue(undefined);

    await uploadBundleStreamed(client, dir, "index.html", { sleep });

    expect(signBundle).toHaveBeenCalledOnce();
    expect(signUpload).toHaveBeenCalledOnce();
    expect(streamUpload.mock.calls.map((call) => call[1])).toEqual([
      "old-token",
      "fresh-token",
    ]);
    expect(finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [
          expect.objectContaining({
            object_key: "fresh-key",
            upload_token: "fresh-token",
          }),
        ],
      }),
    );
  });

  it("caps a bundle run at eight extra sign calls", async () => {
    const client = newClient();
    const dir = makeSite({
      "index.html": "<h1>budget</h1>",
      "asset-1.js": "1",
      "asset-2.js": "2",
      "asset-3.js": "3",
      "asset-4.js": "4",
      "asset-5.js": "5",
      "asset-6.js": "6",
      "asset-7.js": "7",
      "asset-8.js": "8",
    });
    const files = Array.from({ length: 9 }, (_, i) => ({
      filename: i === 0 ? "index.html" : `asset-${i}.js`,
      upload_url: `https://up.example.com/batch-${i}`,
      upload_token: `batch-${i}`,
      object_key: `batch-key-${i}`,
    }));
    vi.spyOn(client, "signBundle").mockResolvedValue({
      files,
      finalize_url: "https://app.example.com/api/upload/bundle/finalize",
    });
    const signUpload = vi.spyOn(client, "signUpload").mockImplementation(async () => {
      const i = signUpload.mock.calls.length;
      return {
        upload_url: `https://up.example.com/fresh-${i}`,
        upload_token: `fresh-${i}`,
        finalize_url: "https://app.example.com/api/upload/finalize",
        object_key: `fresh-key-${i}`,
      };
    });
    vi.spyOn(client, "streamUpload").mockImplementation(async (_url, token) => {
      if (token.startsWith("batch-")) {
        throw new SharedropApiError(
          "UPLOAD_FAILED",
          "transient",
          503,
          undefined,
          undefined,
          { retryable: true },
        );
      }
    });
    const finalize = vi.spyOn(client, "finalizeBundle");

    await expect(
      uploadBundleStreamed(client, dir, "index.html", {
        sleep: vi.fn().mockResolvedValue(undefined),
      }),
    ).rejects.toMatchObject({ status: 503 });
    expect(signUpload).toHaveBeenCalledTimes(8);
    expect(finalize).not.toHaveBeenCalled();
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
