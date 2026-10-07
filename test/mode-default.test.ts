// #383 (P3): the CLI no longer hard-codes --mode static. With no --mode the
// request carries no mode, so the server applies the account default to a new
// page and keeps the page's own mode on a re-upload. The effective mode from the
// server response is printed in human output.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../src/auth/resolve.js", () => ({
  resolveAuth: vi.fn(async () => ({ token: "sd_test", source: "flag" })),
  resolveBaseUrl: vi.fn(() => "https://app.example.com"),
}));

import { uploadCommand } from "../src/commands/upload.js";
import {
  FINALIZE_NEW_PAGE,
  SIGN_RESPONSE,
  finalizeReupload,
  jsonResponse,
  routedFetch,
} from "./fixtures/contract-383.js";

function writeTmpFile(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "sharedrop-cli-mode-"));
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

function stubUploadRoutes(finalizeBody: unknown) {
  const routed = routedFetch({
    "POST /api/upload/sign": () => jsonResponse(200, SIGN_RESPONSE),
    "PUT /01HXXXEXAMPLEULID": () => jsonResponse(200, {}),
    "POST /api/upload/finalize": () => jsonResponse(200, finalizeBody),
  });
  vi.stubGlobal("fetch", vi.fn(routed.fn));
  return routed.calls;
}

function finalizeBodyOf(calls: ReturnType<typeof stubUploadRoutes>) {
  return calls.find((c) => c.url.endsWith("/api/upload/finalize"))?.body;
}

describe("upload mode default (#383)", () => {
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

  it("upload with no --mode sends no mode field to finalize", async () => {
    const calls = stubUploadRoutes(FINALIZE_NEW_PAGE);
    const file = writeTmpFile("report.html", "<h1>Q3</h1>");

    await uploadCommand(file, { json: true });

    const body = finalizeBodyOf(calls);
    expect(body).toBeDefined();
    expect(body).not.toHaveProperty("mode");
  });

  it("upload --page-id with no --mode does not send static (keeps the page's mode)", async () => {
    const calls = stubUploadRoutes(finalizeReupload(2));
    const file = writeTmpFile("report.html", "<h1>Q3 v2</h1>");

    await uploadCommand(file, { json: true, pageId: FINALIZE_NEW_PAGE.page_id });

    const body = finalizeBodyOf(calls);
    expect(body?.page_id).toBe(FINALIZE_NEW_PAGE.page_id);
    expect(body).not.toHaveProperty("mode");
    expect(JSON.stringify(calls.map((c) => c.body))).not.toContain("static");
  });

  it("an explicit --mode is still sent", async () => {
    const calls = stubUploadRoutes({ ...FINALIZE_NEW_PAGE, mode: "static" });
    const file = writeTmpFile("report.html", "<h1>Q3</h1>");

    await uploadCommand(file, { json: true, mode: "static" });

    expect(finalizeBodyOf(calls)?.mode).toBe("static");
  });

  it("human output prints the effective mode from the server", async () => {
    stubUploadRoutes(FINALIZE_NEW_PAGE);
    const file = writeTmpFile("report.html", "<h1>Q3</h1>");
    const previous = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    try {
      await uploadCommand(file, {});
    } finally {
      if (previous) Object.defineProperty(process.stdout, "isTTY", previous);
      else delete (process.stdout as { isTTY?: boolean }).isTTY;
    }
    const printed = stdout.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toContain("Mode: interactive");
  });
});

describe("commander wiring has no --mode default (#383)", () => {
  afterEach(() => {
    vi.doUnmock("../src/commands/upload.js");
    vi.doUnmock("../src/commands/update.js");
    vi.doUnmock("../src/commands/check.js");
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function parse(argv: string[]) {
    const upload = vi.fn();
    const update = vi.fn();
    const check = vi.fn();
    vi.resetModules();
    vi.doMock("../src/commands/upload.js", () => ({ uploadCommand: upload }));
    vi.doMock("../src/commands/update.js", () => ({ updateCommand: update }));
    vi.doMock("../src/commands/check.js", () => ({ checkCommand: check }));
    vi.stubGlobal("__CLI_VERSION__", "0.0.0-test");
    const saved = process.argv;
    process.argv = ["node", "sharedrop", ...argv];
    try {
      await import("../src/cli.js");
    } finally {
      process.argv = saved;
    }
    return { upload, update, check };
  }

  it("upload <file> with no --mode passes mode undefined", async () => {
    const { upload } = await parse(["upload", "report.html", "--json"]);
    expect(upload).toHaveBeenCalledOnce();
    expect(upload.mock.calls[0][1].mode).toBeUndefined();
  });

  it("update <id> <file> with no --mode passes mode undefined", async () => {
    const { update } = await parse(["update", "abc123", "report.html", "--json"]);
    expect(update).toHaveBeenCalledOnce();
    expect(update.mock.calls[0][2].mode).toBeUndefined();
  });

  it("check <path> is wired with --mode, --page-id and --slides and no mode default", async () => {
    const { check } = await parse(["check", "deck.html", "--page-id", "abc", "--slides", "--json"]);
    expect(check).toHaveBeenCalledOnce();
    const [path, opts] = check.mock.calls[0];
    expect(path).toBe("deck.html");
    expect(opts).toMatchObject({ pageId: "abc", slides: true, json: true });
    expect(opts.mode).toBeUndefined();
  });
});
