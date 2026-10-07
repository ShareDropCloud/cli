// #383 (P1): `sharedrop check <file|folder>` signs and streams to quarantine
// like upload, then calls the lint endpoint instead of finalize. It prints the
// lint response, exits 1 when would_change is true and 0 otherwise, and never
// publishes.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../src/auth/resolve.js", () => ({
  resolveAuth: vi.fn(async () => ({ token: "sd_test", source: "flag" })),
  resolveBaseUrl: vi.fn(() => "https://app.example.com"),
}));

import { SharedropApiClient } from "../src/client/api-client.js";
import { checkCommand } from "../src/commands/check.js";
import {
  BUNDLE_LINT_RESPONSE,
  LINT_RESPONSE,
  LINT_RESPONSE_CLEAN,
  SIGN_RESPONSE,
  jsonResponse,
  routedFetch,
  type RecordedCall,
} from "./fixtures/contract-383.js";

function writeTmpFile(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "sharedrop-cli-check-"));
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

function makeSite(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "sharedrop-cli-check-site-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
}

const finalizeNever = () => {
  throw new Error("check must never call finalize");
};

/** Single-file routes; finalize throws if reached. */
function stubSingle(overrides: Record<string, (call: RecordedCall) => Response> = {}) {
  const routed = routedFetch({
    "POST /api/upload/sign": () => jsonResponse(200, SIGN_RESPONSE),
    "PUT /01HXXXEXAMPLEULID": () => jsonResponse(200, {}),
    "POST /api/upload/lint": () => jsonResponse(200, LINT_RESPONSE),
    "POST /api/upload/finalize": finalizeNever,
    "POST /api/upload/bundle/finalize": finalizeNever,
    ...overrides,
  });
  vi.stubGlobal("fetch", vi.fn(routed.fn));
  return routed.calls;
}

function stubBundle() {
  const routed = routedFetch({
    "POST /api/upload/bundle/sign": (call) =>
      jsonResponse(200, {
        files: (call.body?.files as Array<{ filename: string }>).map((f, i) => ({
          filename: f.filename,
          upload_url: `https://uploads.example.com/b${i}`,
          upload_token: `t${i}`,
          object_key: `b${i}`,
        })),
        finalize_url: "https://app.example.com/api/upload/bundle/finalize",
      }),
    "PUT /b*": () => jsonResponse(200, {}),
    "POST /api/upload/bundle/lint": () => jsonResponse(200, BUNDLE_LINT_RESPONSE),
    "POST /api/upload/finalize": finalizeNever,
    "POST /api/upload/bundle/finalize": finalizeNever,
  });
  vi.stubGlobal("fetch", vi.fn(routed.fn));
  return routed.calls;
}

/** Run with process.exit trapped; returns the first exit code (undefined = none). */
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

function bodyOf(calls: RecordedCall[], suffix: string) {
  return calls.find((c) => c.url.endsWith(suffix))?.body;
}

describe("sharedrop check (#383)", () => {
  let stdout: ReturnType<typeof vi.spyOn>;
  let stderr: ReturnType<typeof vi.spyOn>;
  let finalizeUpload: ReturnType<typeof vi.spyOn>;
  let finalizeBundle: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    finalizeUpload = vi.spyOn(SharedropApiClient.prototype, "finalizeUpload");
    finalizeBundle = vi.spyOn(SharedropApiClient.prototype, "finalizeBundle");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function printed() {
    return JSON.parse(String(stdout.mock.calls[0][0]));
  }

  it("prints the lint response, exits 1 when would_change is true, and never finalizes", async () => {
    const calls = stubSingle();

    const code = await runForExit(() => checkCommand(writeTmpFile("q3.html", "<iframe></iframe>"), { json: true }));

    expect(code).toBe(1);
    expect(printed()).toEqual({ data: LINT_RESPONSE });
    expect(finalizeUpload).not.toHaveBeenCalled();
    expect(finalizeBundle).not.toHaveBeenCalled();
    expect(calls.some((c) => c.url.includes("finalize"))).toBe(false);
    // Order: sign, PUT, lint.
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      "POST /api/upload/sign",
      "PUT /01HXXXEXAMPLEULID",
      "POST /api/upload/lint",
    ]);
    const lint = bodyOf(calls, "/api/upload/lint");
    expect(lint).toMatchObject({
      object_key: SIGN_RESPONSE.object_key,
      upload_token: SIGN_RESPONSE.upload_token,
      title: "q3",
    });
    expect(lint).not.toHaveProperty("mode");
    expect(lint).not.toHaveProperty("slides");
  });

  it("exits 0 when would_change is false", async () => {
    stubSingle({ "POST /api/upload/lint": () => jsonResponse(200, LINT_RESPONSE_CLEAN) });

    const code = await runForExit(() => checkCommand(writeTmpFile("q3.html", "<h1>Q3</h1>"), { json: true }));

    expect(code).toBeUndefined();
    expect(printed()).toEqual({ data: LINT_RESPONSE_CLEAN });
    expect(finalizeUpload).not.toHaveBeenCalled();
  });

  it("passes --mode, --page-id and --slides to sign and lint", async () => {
    const calls = stubSingle({ "POST /api/upload/lint": () => jsonResponse(200, LINT_RESPONSE_CLEAN) });
    const pageId = "3f0c2b4e-8f7a-4c1d-9e2b-1a2b3c4d5e6f";

    await runForExit(() =>
      checkCommand(writeTmpFile("deck.html", "<h1>Deck</h1>"), {
        json: true,
        mode: "static",
        pageId,
        slides: true,
      }),
    );

    expect(bodyOf(calls, "/api/upload/sign")?.page_id).toBe(pageId);
    const lint = bodyOf(calls, "/api/upload/lint");
    expect(lint).toMatchObject({ mode: "static", page_id: pageId, slides: true });
    // A re-upload check sends no filename title, like `upload --page-id`.
    expect(lint).not.toHaveProperty("title");
  });

  it("--workspace targets the workspace at sign and lint (JSON)", async () => {
    const calls = stubSingle({ "POST /api/upload/lint": () => jsonResponse(200, LINT_RESPONSE_CLEAN) });

    const code = await runForExit(() =>
      checkCommand(writeTmpFile("q3.html", "<h1>Q3</h1>"), { json: true, workspace: "ws_123" }),
    );

    expect(code).toBeUndefined();
    expect(printed()).toEqual({ data: LINT_RESPONSE_CLEAN });
    expect(bodyOf(calls, "/api/upload/sign")?.workspace).toBe("ws_123");
    expect(bodyOf(calls, "/api/upload/lint")?.workspace_id).toBe("ws_123");
  });

  it("--workspace on a folder targets bundle sign and bundle lint (JSON)", async () => {
    const calls = stubBundle();
    const dir = makeSite({ "index.html": "<h1>Site</h1>" });

    await runForExit(() => checkCommand(dir, { json: true, workspace: "ws_123" }));

    expect(printed()).toEqual({ data: BUNDLE_LINT_RESPONSE });
    expect(bodyOf(calls, "/api/upload/bundle/sign")?.workspace).toBe("ws_123");
    expect(bodyOf(calls, "/api/upload/bundle/lint")?.workspace_id).toBe("ws_123");
  });

  it("without --workspace no workspace is sent", async () => {
    const calls = stubSingle({ "POST /api/upload/lint": () => jsonResponse(200, LINT_RESPONSE_CLEAN) });
    await runForExit(() => checkCommand(writeTmpFile("q3.html", "<h1>Q3</h1>"), { json: true }));
    expect(bodyOf(calls, "/api/upload/sign")).not.toHaveProperty("workspace");
    expect(bodyOf(calls, "/api/upload/lint")).not.toHaveProperty("workspace_id");
  });

  it("checks a folder through bundle sign, PUTs and bundle lint, never bundle finalize", async () => {
    const calls = stubBundle();
    const dir = makeSite({ "index.html": '<script src="app.js"></script>', "app.js": "1", ".DS_Store": "x" });

    const code = await runForExit(() => checkCommand(dir, { json: true }));

    expect(code).toBe(1);
    expect(printed()).toEqual({ data: BUNDLE_LINT_RESPONSE });
    expect(finalizeBundle).not.toHaveBeenCalled();
    expect(finalizeUpload).not.toHaveBeenCalled();
    const lint = bodyOf(calls, "/api/upload/bundle/lint");
    expect((lint?.files as Array<{ path: string }>).map((f) => f.path).sort()).toEqual([
      "app.js",
      "index.html",
    ]);
    expect(lint).not.toHaveProperty("mode");
  });

  it("a 413 from the PUT reports size_ok false and exits 1, without lint", async () => {
    const calls = stubSingle({
      "PUT /01HXXXEXAMPLEULID": () => jsonResponse(413, { error: "too_large" }),
    });
    const file = writeTmpFile("big.html", "<h1>big</h1>");

    const code = await runForExit(() => checkCommand(file, { json: true }));

    expect(code).toBe(1);
    expect(printed()).toEqual({
      data: {
        size_ok: false,
        size_bytes: 12,
        size_limit_bytes: null,
        would_change: true,
        warnings: [],
        message: "too_large",
      },
    });
    expect(calls.some((c) => c.url.endsWith("/lint"))).toBe(false);
    expect(finalizeUpload).not.toHaveBeenCalled();
  });

  it.each([
    ["TIER_LIMIT", "You have reached the 50-page limit."],
    ["STORAGE_LIMIT", "Storage limit reached."],
  ])("a %s refusal at sign exits 7 like upload, without lint (JSON)", async (limitCode, message) => {
    const calls = stubSingle({
      "POST /api/upload/sign": () =>
        jsonResponse(402, { error: { code: limitCode, message, currentTier: "free" } }),
    });

    const code = await runForExit(() => checkCommand(writeTmpFile("q3.html", "<h1>Q3</h1>"), { json: true }));

    expect(code).toBe(7);
    expect(calls.some((c) => c.url.endsWith("/lint"))).toBe(false);
    expect(stdout).not.toHaveBeenCalled();
  });

  it("a size refusal at sign (FILE_SIZE_EXCEEDED) reports size_ok false with the limit", async () => {
    stubSingle({
      "POST /api/upload/sign": () =>
        jsonResponse(402, {
          error: {
            code: "FILE_SIZE_EXCEEDED",
            message: "This file is over the 10 MB limit.",
            currentTier: "free",
            requiredTier: "pro",
            limitBytes: 10485760,
            requestedBytes: 12,
            upgradeUrl: "https://example.com/upgrade",
            pricing: {},
          },
        }),
    });

    const code = await runForExit(() => checkCommand(writeTmpFile("big.html", "<h1>big</h1>"), { json: true }));

    expect(code).toBe(1);
    expect(printed().data).toMatchObject({ size_ok: false, size_limit_bytes: 10485760, would_change: true });
  });

  it("other errors take the normal error path (401 exits 3)", async () => {
    stubSingle({
      "POST /api/upload/sign": () => jsonResponse(401, { error: "Unauthorized" }),
    });

    const code = await runForExit(() => checkCommand(writeTmpFile("q3.html", "<h1>Q3</h1>"), { json: true }));

    expect(code).toBe(3);
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalled();
  });

  it("--slides on a folder is a validation error", async () => {
    const calls = stubBundle();
    const code = await runForExit(() =>
      checkCommand(makeSite({ "index.html": "<h1>x</h1>" }), { json: true, slides: true }),
    );
    expect(code).toBe(6);
    expect(calls).toEqual([]);
  });

  it("human output is a short summary", async () => {
    stubSingle();
    const previous = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    let code: number | undefined;
    try {
      code = await runForExit(() => checkCommand(writeTmpFile("q3.html", "<iframe></iframe>"), {}));
    } finally {
      if (previous) Object.defineProperty(process.stdout, "isTTY", previous);
      else delete (process.stdout as { isTTY?: boolean }).isTTY;
    }
    expect(code).toBe(1);
    const text = stdout.mock.calls.map((c) => String(c[0])).join("\n");
    expect(text).toContain("Mode: interactive");
    expect(text).toContain("Scripts would run: yes");
    expect(text).toContain("Removed 1 <iframe> element.");
    expect(text).toContain("Inline images moved to hosted storage: 2");
    expect(text).not.toMatch(/[\u2013\u2014]/);
  });
});
