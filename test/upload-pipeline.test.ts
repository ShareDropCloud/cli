// Phase 15 / UPLOAD-07 — CLI streamed-upload pipeline.
//
// Locks the three-step flow (sign → PUT → finalize) against accidental
// regression to the legacy direct-POST to /api/v1/pages and against
// silently dropping `duplex: "half"` (the streaming-PUT contract).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { SharedropApiClient, SharedropApiError } from "../src/client/api-client.js";
import { uploadFileStreamed } from "../src/commands/upload.js";

function writeTmpFile(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "sharedrop-cli-test-"));
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

function newClient(): SharedropApiClient {
  return new SharedropApiClient({
    apiKey: "sd_test",
    baseUrl: "https://app.example.com",
  });
}

describe("sharedrop upload — three-step pipeline (UPLOAD-07)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("HTML happy path: sign → fetch PUT → finalize → returns share URL", async () => {
    const client = newClient();
    const signSpy = vi
      .spyOn(client, "signUpload")
      .mockResolvedValue({
        upload_url: "https://uploads.example.com/01HXXXEXAMPLEULID",
        upload_token: "tkn_test",
        finalize_url: "https://app.example.com/api/upload/finalize",
        object_key: "01HXXXEXAMPLEULID",
      });
    const streamSpy = vi
      .spyOn(client, "streamUpload")
      .mockResolvedValue(undefined);
    const finalizeSpy = vi
      .spyOn(client, "finalizeUpload")
      .mockResolvedValue({
        url: "/scotto/abc123",
        page_id: "p_1",
        slug: "abc123",
        visibility: "private",
        mode: "interactive",
        kind: "html",
        contentType: "text/html",
      });

    const file = writeTmpFile("hello.html", "<h1>hi</h1>");
    const out = await uploadFileStreamed(client, file, {
      title: "Hello",
      visibility: "private",
      mode: "interactive",
    });

    // Order assertions — sign before PUT before finalize.
    expect(signSpy).toHaveBeenCalledBefore(streamSpy as never);
    expect(streamSpy).toHaveBeenCalledBefore(finalizeSpy as never);

    // sign payload: filename + html MIME + the byte count of the tmp file.
    expect(signSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: "hello.html",
        content_type: "text/html",
        size_bytes: expect.any(Number),
      }),
    );

    // streamUpload received the upload_url, token, and content-type from sign.
    expect(streamSpy).toHaveBeenCalledWith(
      "https://uploads.example.com/01HXXXEXAMPLEULID",
      "tkn_test",
      expect.anything(),
      "text/html",
      expect.any(Number),
    );

    // finalize payload: object_key + token forwarded.
    expect(finalizeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        object_key: "01HXXXEXAMPLEULID",
        upload_token: "tkn_test",
        title: "Hello",
        visibility: "private",
        mode: "interactive",
      }),
    );

    expect(out.url).toBe("/scotto/abc123");
    expect(out.page_id).toBe("p_1");
  });

  it("PDF happy path: signs with application/pdf content_type", async () => {
    const client = newClient();
    const signSpy = vi
      .spyOn(client, "signUpload")
      .mockResolvedValue({
        upload_url: "https://uploads.example.com/k",
        upload_token: "tkn",
        finalize_url: "https://app.example.com/api/upload/finalize",
        object_key: "k",
      });
    vi.spyOn(client, "streamUpload").mockResolvedValue(undefined);
    vi.spyOn(client, "finalizeUpload").mockResolvedValue({
      url: "/scotto/pdf123",
      page_id: "p_2",
      slug: "pdf123",
      visibility: "private",
      mode: "static",
      kind: "pdf",
      contentType: "application/pdf",
    });

    const file = writeTmpFile("doc.pdf", "%PDF-1.4\n...");
    await uploadFileStreamed(client, file, {});

    expect(signSpy).toHaveBeenCalledWith(
      expect.objectContaining({ content_type: "application/pdf" }),
    );
  });

  it("streamUpload uses duplex: \"half\" on the underlying fetch PUT", async () => {
    // Lock the streaming-PUT contract. duplex: "half" is REQUIRED by Node
    // 18.5+ when body is a stream; silently losing it would re-introduce
    // the buffer-everything-in-memory failure mode.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = newClient();
    const body = Readable.from(Buffer.from("hello"));
    await client.streamUpload(
      "https://uploads.example.com/key",
      "tkn",
      body,
      "text/html",
      5,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://uploads.example.com/key");
    expect(init.method).toBe("PUT");
    expect((init as { duplex?: string }).duplex).toBe("half");
    expect(init.headers["Authorization"]).toBe("Bearer tkn");
    expect(init.headers["Content-Type"]).toBe("text/html");
    expect(init.headers["Content-Length"]).toBe("5");
  });

  it("propagates 402 STORAGE_LIMIT envelope from sign", async () => {
    const client = newClient();
    const envelopeErr = new SharedropApiError(
      "STORAGE_LIMIT",
      "Storage limit reached",
      402,
      {
        code: "STORAGE_LIMIT",
        message: "Storage limit reached",
        currentTier: "free",
        currentUsageGb: 5,
        capGb: 5,
        upgradeUrl: "https://example.com/upgrade",
        pricing: {} as never,
      },
    );
    vi.spyOn(client, "signUpload").mockRejectedValue(envelopeErr);
    const streamSpy = vi
      .spyOn(client, "streamUpload")
      .mockResolvedValue(undefined);

    const file = writeTmpFile("hello.html", "<h1>hi</h1>");
    await expect(
      uploadFileStreamed(client, file, {}),
    ).rejects.toMatchObject({
      code: "STORAGE_LIMIT",
      status: 402,
    });
    // PUT must not fire when sign rejected.
    expect(streamSpy).not.toHaveBeenCalled();
  });

  it("propagates Worker rejection from PUT (413 too_large)", async () => {
    const client = newClient();
    vi.spyOn(client, "signUpload").mockResolvedValue({
      upload_url: "https://uploads.example.com/k",
      upload_token: "tkn",
      finalize_url: "https://app.example.com/api/upload/finalize",
      object_key: "k",
    });
    vi.spyOn(client, "streamUpload").mockRejectedValue(
      new SharedropApiError("UPLOAD_FAILED", "too_large", 413),
    );
    const finalizeSpy = vi
      .spyOn(client, "finalizeUpload")
      .mockResolvedValue({} as never);

    const file = writeTmpFile("hello.html", "<h1>hi</h1>");
    await expect(
      uploadFileStreamed(client, file, {}),
    ).rejects.toMatchObject({
      code: "UPLOAD_FAILED",
      status: 413,
      message: "too_large",
    });
    expect(finalizeSpy).not.toHaveBeenCalled();
  });

  it("does NOT call the legacy direct-POST endpoint (/api/v1/pages)", async () => {
    // Static guarantee: the SharedropApiClient no longer exposes uploadPage
    // and no method calls /api/v1/pages with a POST body. We assert the
    // absence at the type level (uploadPage is removed) and dynamically.
    const client = newClient();
    expect(
      (client as unknown as Record<string, unknown>)["uploadPage"],
    ).toBeUndefined();

    // Belt-and-braces dynamic check: spy on global fetch, run the happy
    // path with sign+stream+finalize stubbed, assert no fetch call lands
    // on /api/v1/pages.
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    vi.spyOn(client, "signUpload").mockResolvedValue({
      upload_url: "https://uploads.example.com/k",
      upload_token: "tkn",
      finalize_url: "https://app.example.com/api/upload/finalize",
      object_key: "k",
    });
    vi.spyOn(client, "streamUpload").mockResolvedValue(undefined);
    vi.spyOn(client, "finalizeUpload").mockResolvedValue({
      url: "/scotto/x",
      page_id: "p",
      slug: "x",
      visibility: "private",
      mode: "static",
      kind: "html",
      contentType: "text/html",
    });

    const file = writeTmpFile("x.html", "<p>x</p>");
    await uploadFileStreamed(client, file, {});

    for (const [url] of fetchMock.mock.calls) {
      expect(String(url)).not.toMatch(/\/api\/v1\/pages/);
    }
  });
});
