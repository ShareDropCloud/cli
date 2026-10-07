// #383 (P7): exit codes match the docs. No token found locally exits 2; a token
// the server rejects (401) exits 3, the same as a 403. The single-use upload
// token expiring is not an API-token failure and exits 1.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../src/auth/resolve.js", () => ({
  resolveAuth: vi.fn(async () => ({ token: "sd_test", source: "flag" })),
  resolveBaseUrl: vi.fn(() => "https://app.example.com"),
}));

import { resolveAuth } from "../src/auth/resolve.js";
import { SharedropApiClient, SharedropApiError } from "../src/client/api-client.js";
import { getCommand } from "../src/commands/get.js";
import { EXIT_CODES, statusToExitCode } from "../src/output/errors.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Run a command with process.exit trapped; returns the FIRST exit code. */
async function runForExit(fn: () => Promise<void>): Promise<number | undefined> {
  const codes: number[] = [];
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    codes.push(code ?? 0);
    throw new Error(`exit:${code}`);
  }) as never);
  try {
    await fn();
  } catch {
    /* exit throws by design */
  }
  return codes[0];
}

function stderrJson(spy: ReturnType<typeof vi.spyOn>): { error: { code: string } } | undefined {
  for (const call of spy.mock.calls) {
    try {
      return JSON.parse(String(call[0]));
    } catch {
      /* not JSON */
    }
  }
  return undefined;
}

describe("CLI exit codes (#383)", () => {
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("no token found locally exits 2", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const code = await runForExit(() => getCommand("abc123", { json: true }));

    expect(code).toBe(2);
    expect(code).toBe(EXIT_CODES.AUTH_REQUIRED);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a server 401 on the API token exits 3 (token rejected or revoked)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(401, { error: { code: "UNAUTHORIZED", message: "Invalid or missing API key" } }),
      ),
    );

    const code = await runForExit(() => getCommand("abc123", { json: true }));

    expect(code).toBe(3);
    expect(stderrJson(stderr)?.error.code).toBe("UNAUTHORIZED");
  });

  it("a server 403 exits 3", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(403, { error: { code: "FORBIDDEN", message: "Missing scope pages:read" } }),
      ),
    );

    const code = await runForExit(() => getCommand("abc123", { json: true }));

    expect(code).toBe(3);
  });

  it("maps statuses: 401 and 403 to AUTH_FAILED", () => {
    expect(statusToExitCode(401)).toBe(EXIT_CODES.AUTH_FAILED);
    expect(statusToExitCode(403)).toBe(EXIT_CODES.AUTH_FAILED);
  });

  it("finalize 401 'Unauthorized' (API token) is an auth failure, exit 3", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, { error: "Unauthorized" })));
    const client = new SharedropApiClient({ apiKey: "sd_test", baseUrl: "https://app.example.com" });
    const err = await client
      .finalizeUpload({ object_key: "k", upload_token: "t" })
      .catch((e: unknown) => e as SharedropApiError);
    expect(err).toBeInstanceOf(SharedropApiError);
    expect((err as SharedropApiError).code).toBe("FINALIZE_FAILED");

    const { handleError } = await import("../src/output/errors.js");
    const code = await runForExit(async () => handleError(err, { json: true }));
    expect(code).toBe(3);
  });

  it("finalize 401 'Invalid token' (upload token expired) is TOKEN_EXPIRED, exit 1", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, { error: "Invalid token" })));
    const client = new SharedropApiClient({ apiKey: "sd_test", baseUrl: "https://app.example.com" });
    const err = await client
      .finalizeUpload({ object_key: "k", upload_token: "t" })
      .catch((e: unknown) => e as SharedropApiError);
    expect((err as SharedropApiError).code).toBe("TOKEN_EXPIRED");

    const { handleError } = await import("../src/output/errors.js");
    const code = await runForExit(async () => handleError(err, { json: true }));
    expect(code).toBe(1);
    expect(stderrJson(stderr)?.error.code).toBe("TOKEN_EXPIRED");
  });

  it("bundle finalize distinguishes the same two 401s", async () => {
    const client = new SharedropApiClient({ apiKey: "sd_test", baseUrl: "https://app.example.com" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, { error: "Invalid token" })));
    await expect(client.finalizeBundle({ files: [] })).rejects.toMatchObject({ code: "TOKEN_EXPIRED" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, { error: "Unauthorized" })));
    await expect(client.finalizeBundle({ files: [] })).rejects.toMatchObject({
      code: "BUNDLE_FINALIZE_FAILED",
      status: 401,
    });
  });

  // Server body from #383 hardening, verbatim.
  const UPLOAD_TOKEN_401 = { error: "Invalid token", code: "upload_token_invalid" };

  it("finalize 401 with code upload_token_invalid is TOKEN_EXPIRED, exit 1 (JSON)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, UPLOAD_TOKEN_401)));
    const client = new SharedropApiClient({ apiKey: "sd_test", baseUrl: "https://app.example.com" });
    const err = await client
      .finalizeUpload({ object_key: "k", upload_token: "t" })
      .catch((e: unknown) => e as SharedropApiError);
    expect((err as SharedropApiError).code).toBe("TOKEN_EXPIRED");

    const { handleError } = await import("../src/output/errors.js");
    const code = await runForExit(async () => handleError(err, { json: true }));
    expect(code).toBe(1);
    expect(stderrJson(stderr)?.error.code).toBe("TOKEN_EXPIRED");
  });

  it("the code wins even when the error text changes", async () => {
    const body = { error: "Upload token expired", code: "upload_token_invalid" };
    const client = new SharedropApiClient({ apiKey: "sd_test", baseUrl: "https://app.example.com" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, body)));
    await expect(client.finalizeUpload({ object_key: "k", upload_token: "t" })).rejects.toMatchObject({
      code: "TOKEN_EXPIRED",
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, body)));
    await expect(client.finalizeBundle({ files: [] })).rejects.toMatchObject({ code: "TOKEN_EXPIRED" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, body)));
    await expect(client.lintUpload({ object_key: "k", upload_token: "t" })).rejects.toMatchObject({
      code: "TOKEN_EXPIRED",
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, body)));
    await expect(client.lintBundle({ files: [] })).rejects.toMatchObject({ code: "TOKEN_EXPIRED" });
  });

  it("lint 401 'Unauthorized' (API token) still exits 3 (JSON)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, { error: "Unauthorized" })));
    const client = new SharedropApiClient({ apiKey: "sd_test", baseUrl: "https://app.example.com" });
    const err = await client
      .lintUpload({ object_key: "k", upload_token: "t" })
      .catch((e: unknown) => e as SharedropApiError);
    expect((err as SharedropApiError).code).toBe("LINT_FAILED");

    const { handleError } = await import("../src/output/errors.js");
    const code = await runForExit(async () => handleError(err, { json: true }));
    expect(code).toBe(3);
  });

  it("a Worker PUT 401 rejects the upload token, so it is TOKEN_EXPIRED", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, { error: "invalid_token" })));
    const client = new SharedropApiClient({ apiKey: "sd_test", baseUrl: "https://app.example.com" });
    const { Readable } = await import("node:stream");
    await expect(
      client.streamUpload("https://uploads.example.com/k", "t", Readable.from("x"), "text/html", 1),
    ).rejects.toMatchObject({ code: "TOKEN_EXPIRED", status: 401 });
  });
});
