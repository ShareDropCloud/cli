// #313: finalize answers 409 { reason, retryable: true } with Retry-After while
// another request owns the page. The CLI repeats ONLY the finalize call (same
// token, no re-sign, no re-PUT) within a bounded budget, and when it gives up
// the error output keeps reason, retryable and the Retry-After value.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SharedropApiClient, SharedropApiError } from "../src/client/api-client.js";
import {
  FINALIZE_CONFLICT_MAX_ATTEMPTS,
  FINALIZE_CONFLICT_MIN_WAIT_MS,
  finalizeWithConflictRetry,
  uploadBundleStreamed,
  uploadFileStreamed,
} from "../src/commands/upload.js";
import { handleError } from "../src/output/errors.js";

function newClient(): SharedropApiClient {
  return new SharedropApiClient({
    apiKey: "sd_test",
    baseUrl: "https://app.example.com",
  });
}

function writeTmpFile(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "sharedrop-cli-313-"));
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

const MUTATION_409 = {
  error: "Another replacement of this page is still in progress. Please try again.",
  reason: "page_mutation_in_progress",
  retryable: true,
};
const PENDING_409 = {
  error: "target_page_pending: another finalize attempt owns this upload target. Retry shortly.",
  reason: "target_page_pending",
  retryable: true,
  retryAfter: 2,
};

function conflict(body: object, retryAfter: string): Response {
  return new Response(JSON.stringify(body), {
    status: 409,
    headers: { "Content-Type": "application/json", "Retry-After": retryAfter },
  });
}

function success(body: object): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const PAGE = {
  url: "/scotto/abc123",
  page_id: "p_1",
  slug: "abc123",
  visibility: "private",
  mode: "static",
  kind: "html",
  contentType: "text/html",
};

function stubSignAndPut(client: SharedropApiClient) {
  const sign = vi.spyOn(client, "signUpload").mockResolvedValue({
    upload_url: "https://uploads.example.com/key",
    upload_token: "token-1",
    finalize_url: "https://app.example.com/api/upload/finalize",
    object_key: "key-1",
  });
  const put = vi.spyOn(client, "streamUpload").mockResolvedValue(undefined);
  return { sign, put };
}

function captureHandleError(error: unknown, json: boolean): string {
  const originalIsTTY = process.stdout.isTTY;
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`exit:${code}`);
  });
  try {
    expect(() => handleError(error, { json })).toThrow(/^exit:/);
  } finally {
    Object.defineProperty(process.stdout, "isTTY", {
      value: originalIsTTY,
      configurable: true,
    });
  }
  return errorSpy.mock.calls.map(([line]) => String(line)).join("\n");
}

describe("finalize 409 retry (#313)", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("retries a page_mutation_in_progress 409 with the same token, honouring Retry-After", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(conflict(MUTATION_409, "3"))
      .mockResolvedValueOnce(success(PAGE));
    vi.stubGlobal("fetch", fetchMock);
    const client = newClient();
    const { sign, put } = stubSignAndPut(client);
    const sleep = vi.fn().mockResolvedValue(undefined);

    const file = writeTmpFile("page.html", "<p>v2</p>");
    const result = await uploadFileStreamed(client, file, { pageId: "p_1", sleep });

    expect(result.page_id).toBe("p_1");
    expect(sign).toHaveBeenCalledOnce();
    expect(put).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init.body)));
    expect(bodies.map((b) => b.upload_token)).toEqual(["token-1", "token-1"]);
    expect(bodies.map((b) => b.object_key)).toEqual(["key-1", "key-1"]);
    expect(sleep).toHaveBeenCalledExactlyOnceWith(3_000);
  });

  it("retries a target_page_pending 409 on a bundle finalize", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(conflict(PENDING_409, "2"))
      .mockResolvedValueOnce(conflict(PENDING_409, "2"))
      .mockResolvedValueOnce(success({ ...PAGE, assets: 0 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = newClient();
    const dir = mkdtempSync(join(tmpdir(), "sharedrop-cli-313-bundle-"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), "<p>hi</p>");
    const signBundle = vi.spyOn(client, "signBundle").mockResolvedValue({
      files: [
        { filename: "index.html", upload_url: "https://up.example.com/k0", upload_token: "t0", object_key: "k0" },
      ],
      finalize_url: "https://app.example.com/api/upload/bundle/finalize",
    });
    const put = vi.spyOn(client, "streamUpload").mockResolvedValue(undefined);
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await uploadBundleStreamed(client, dir, "index.html", { sleep });

    expect(result.page_id).toBe("p_1");
    expect(signBundle).toHaveBeenCalledOnce();
    expect(put).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://app.example.com/api/upload/bundle/finalize",
    );
    expect(sleep.mock.calls).toEqual([[2_000], [2_000]]);
  });

  it("gives up after the attempt cap and keeps reason, retryable and Retry-After in output", async () => {
    const fetchMock = vi.fn(async () => conflict(PENDING_409, "2"));
    vi.stubGlobal("fetch", fetchMock);
    const client = newClient();
    const { sign, put } = stubSignAndPut(client);
    const sleep = vi.fn().mockResolvedValue(undefined);

    const file = writeTmpFile("page.html", "<p>v2</p>");
    let caught: unknown;
    try {
      await uploadFileStreamed(client, file, { sleep });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SharedropApiError);
    expect(fetchMock).toHaveBeenCalledTimes(FINALIZE_CONFLICT_MAX_ATTEMPTS);
    expect(sleep).toHaveBeenCalledTimes(FINALIZE_CONFLICT_MAX_ATTEMPTS - 1);
    // The outer sign -> PUT -> finalize loop must not replay the upload either.
    expect(sign).toHaveBeenCalledOnce();
    expect(put).toHaveBeenCalledOnce();

    const json = JSON.parse(captureHandleError(caught, true));
    expect(json.error).toMatchObject({
      reason: "target_page_pending",
      retryable: true,
      retry_after_seconds: 2,
    });

    vi.restoreAllMocks();
    const human = captureHandleError(caught, false);
    expect(human).toContain("Reason: target_page_pending");
    expect(human).toContain("Retryable: yes, try again in 2s");
  });

  it("stops early when the next wait would pass the total budget", async () => {
    // Retry-After 30s: two waits fit the 60s budget, the third would not.
    const fetchMock = vi.fn(async () => conflict(MUTATION_409, "30"));
    vi.stubGlobal("fetch", fetchMock);
    const client = newClient();
    stubSignAndPut(client);
    const sleep = vi.fn().mockResolvedValue(undefined);

    const file = writeTmpFile("page.html", "<p>v2</p>");
    await expect(
      uploadFileStreamed(client, file, { pageId: "p_1", sleep }),
    ).rejects.toMatchObject({
      status: 409,
      response: { reason: "page_mutation_in_progress", retryable: true, retryAfterMs: 30_000 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[30_000], [30_000]]);
  });

  it("clamps a long Retry-After to the per-wait cap", async () => {
    const finalize = vi
      .fn()
      .mockRejectedValueOnce(
        new SharedropApiError("FINALIZE_FAILED", "busy", 409, undefined, undefined, {
          reason: "page_mutation_in_progress",
          retryable: true,
          retryAfterMs: 300_000,
        }),
      )
      .mockResolvedValueOnce("done");
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(finalizeWithConflictRetry(finalize, sleep)).resolves.toBe("done");
    expect(sleep).toHaveBeenCalledExactlyOnceWith(30_000);
  });

  it("waits at least the floor when Retry-After is 0", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(conflict(MUTATION_409, "0"))
      .mockResolvedValueOnce(conflict(MUTATION_409, "0"))
      .mockResolvedValueOnce(success(PAGE));
    vi.stubGlobal("fetch", fetchMock);
    const client = newClient();
    stubSignAndPut(client);
    const sleep = vi.fn().mockResolvedValue(undefined);

    const file = writeTmpFile("page.html", "<p>v2</p>");
    await uploadFileStreamed(client, file, { pageId: "p_1", sleep });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([
      [FINALIZE_CONFLICT_MIN_WAIT_MS],
      [FINALIZE_CONFLICT_MIN_WAIT_MS],
    ]);
  });

  it("does not retry a 409 that is not marked retryable", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ error: "target_page_conflict: this upload target already exists" }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = newClient();
    const { sign } = stubSignAndPut(client);
    const sleep = vi.fn().mockResolvedValue(undefined);

    const file = writeTmpFile("page.html", "<p>v2</p>");
    await expect(uploadFileStreamed(client, file, { sleep })).rejects.toMatchObject({
      code: "FINALIZE_FAILED",
      status: 409,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(sign).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });
});
