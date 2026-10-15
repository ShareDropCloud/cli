// #418: `sharedrop versions <page>` and `sharedrop download <page> --version`.
// The real client runs against a stubbed fetch that answers with the server's
// wire contract (fixtures/contract-418.ts, the body the route test asserts).
// node:fs is mocked so the file write is captured without touching disk.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Writable } from "node:stream";

vi.mock("../src/auth/resolve.js", () => ({
  resolveAuth: vi.fn(async () => ({ token: "sd_test", source: "flag" })),
  resolveBaseUrl: vi.fn(() => "https://app.example.com"),
}));

vi.mock("node:fs", () => ({
  writeFileSync: vi.fn(),
  createWriteStream: vi.fn(),
  statSync: vi.fn(() => ({ size: 0 })),
}));

import { writeFileSync, createWriteStream, statSync } from "node:fs";
import { versionsCommand } from "../src/commands/versions.js";
import { downloadCommand } from "../src/commands/download.js";
import { VERSIONS, VERSIONS_RESPONSE } from "./fixtures/contract-418.js";

type Call = { url: string; auth: string | undefined };

function stubFetch(answer: (url: string) => Response): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ url, auth: (init.headers as Record<string, string> | undefined)?.Authorization });
      return answer(url);
    }),
  );
  return calls;
}

function withTTY(value: boolean, fn: () => Promise<void>) {
  const previous = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process.stdout, "isTTY", { value, configurable: true });
  return fn().finally(() => {
    if (previous) Object.defineProperty(process.stdout, "isTTY", previous);
    else delete (process.stdout as { isTTY?: boolean }).isTTY;
  });
}

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

function collector(): { sink: Writable; chunks: Buffer[] } {
  const chunks: Buffer[] = [];
  const sink = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(Buffer.from(chunk));
      cb();
    },
  });
  return { sink, chunks };
}

/** A body that arrives in several chunks, like a large file. */
function chunkedBody(parts: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(new TextEncoder().encode(part));
      controller.close();
    },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(writeFileSync).mockClear();
  vi.mocked(createWriteStream).mockClear();
  vi.mocked(statSync).mockReturnValue({ size: 12 } as never);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("#418 sharedrop versions", () => {
  it("--json prints the server's list as { data }", async () => {
    const calls = stubFetch(() => Response.json(VERSIONS_RESPONSE));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await versionsCommand("https://sharedrop.cloud/alice/abc234", { json: true }, {});

    expect(calls[0].url).toBe("https://app.example.com/api/v1/pages/abc234/versions");
    expect(calls[0].auth).toBe("Bearer sd_test");
    expect(JSON.parse(log.mock.calls[0][0] as string)).toEqual(VERSIONS_RESPONSE);
  });

  it("prints JSON when stdout is not a terminal", async () => {
    stubFetch(() => Response.json(VERSIONS_RESPONSE));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await withTTY(false, () => versionsCommand("abc234", {}, {}));
    expect(JSON.parse(log.mock.calls[0][0] as string)).toEqual({ data: VERSIONS });
  });

  it("prints a table on a terminal, the live version marked latest", async () => {
    stubFetch(() => Response.json(VERSIONS_RESPONSE));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await withTTY(true, () => versionsCommand("abc234", {}, {}));

    const out = log.mock.calls[0][0] as string;
    expect(() => JSON.parse(out)).toThrow();
    for (const text of ["Version", "Original", "v3 (latest)", "v2", "v1", "markdown", "pdf", "html", "1.0 KB", "yes", "no"]) {
      expect(out).toContain(text);
    }
    expect(out).toContain("sharedrop download <page> --version <number|latest>");
  });

  it("a page you cannot edit exits NOT_FOUND (5)", async () => {
    stubFetch(() =>
      Response.json({ error: { code: "PAGE_NOT_FOUND", message: "Page not found" } }, { status: 404 }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await runForExit(() => versionsCommand("abc234", { json: true }, {}))).toBe(5);
  });
});

describe("#418 sharedrop download --version", () => {
  function fileResponse() {
    return new Response(chunkedBody(["%PDF-", "1.7 ", "body"]), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": 'attachment; filename="abc234-v2.pdf"',
      },
    });
  }

  it("streams the original to the server's file name, never buffering it", async () => {
    const calls = stubFetch(fileResponse);
    const { sink, chunks } = collector();
    vi.mocked(createWriteStream).mockReturnValue(sink as never);
    const buffered = ["arrayBuffer", "blob", "text", "json", "bytes"].map((method) =>
      vi.spyOn(Response.prototype, method as "text"),
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await downloadCommand("abc234", { version: "2" }, {});

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://app.example.com/api/v1/pages/abc234/versions/2/download");
    expect(calls[0].auth).toBe("Bearer sd_test");
    expect(createWriteStream).toHaveBeenCalledWith("abc234-v2.pdf");
    expect(Buffer.concat(chunks).toString()).toBe("%PDF-1.7 body");
    expect(chunks.length).toBeGreaterThan(1);
    for (const spy of buffered) expect(spy).not.toHaveBeenCalled();
    expect(writeFileSync).not.toHaveBeenCalled();
    expect(log.mock.calls[0][0]).toContain("abc234-v2.pdf");
  });

  it("-o names the file, latest is passed through, and - writes to stdout", async () => {
    let calls = stubFetch(fileResponse);
    const { sink } = collector();
    vi.mocked(createWriteStream).mockReturnValue(sink as never);
    vi.spyOn(console, "log").mockImplementation(() => {});

    await downloadCommand("abc234", { version: "latest", output: "mine.pdf" }, {});
    expect(calls[0].url).toBe("https://app.example.com/api/v1/pages/abc234/versions/latest/download");
    expect(createWriteStream).toHaveBeenCalledWith("mine.pdf");

    calls = stubFetch(fileResponse);
    vi.mocked(createWriteStream).mockClear();
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    await downloadCommand("abc234", { version: "2", output: "-" }, {});
    expect(Buffer.concat(stdout.mock.calls.map((c) => Buffer.from(c[0] as Buffer))).toString()).toBe(
      "%PDF-1.7 body",
    );
    expect(createWriteStream).not.toHaveBeenCalled();
  });

  // #416 hardening: --json or a non-terminal stdout prints a JSON object like
  // the other commands; a terminal keeps the one-line summary.
  it("prints { data } JSON with --json or a non-terminal stdout, plain text on a terminal", async () => {
    vi.mocked(statSync).mockReturnValue({ size: 13 } as never);
    const expected = {
      data: { id: "abc234", version: 2, path: "abc234-v2.pdf", filename: "abc234-v2.pdf", size_bytes: 13 },
    };

    for (const [tty, opts] of [
      [true, { version: "2", json: true }],
      [false, { version: "2" }],
    ] as const) {
      stubFetch(fileResponse);
      vi.mocked(createWriteStream).mockReturnValue(collector().sink as never);
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      await withTTY(tty, () => downloadCommand("abc234", { ...opts }, {}));
      expect(JSON.parse(String(log.mock.calls[0][0]))).toEqual(expected);
      log.mockRestore();
    }

    stubFetch(fileResponse);
    vi.mocked(createWriteStream).mockReturnValue(collector().sink as never);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await withTTY(true, () => downloadCommand("abc234", { version: "latest", output: "mine.pdf" }, {}));
    expect(String(log.mock.calls[0][0])).toBe("Downloaded abc234 version latest → mine.pdf (13 bytes)");

    stubFetch(fileResponse);
    vi.mocked(createWriteStream).mockReturnValue(collector().sink as never);
    log.mockClear();
    await withTTY(false, () => downloadCommand("abc234", { version: "latest", output: "mine.pdf" }, {}));
    expect(JSON.parse(String(log.mock.calls[0][0]))).toEqual({
      data: { id: "abc234", version: "latest", path: "mine.pdf", filename: "abc234-v2.pdf", size_bytes: 13 },
    });
  });

  it("a server file name never escapes the current folder", async () => {
    stubFetch(
      () =>
        new Response("x", {
          headers: { "content-disposition": 'attachment; filename="../../etc/passwd"' },
        }),
    );
    const { sink } = collector();
    vi.mocked(createWriteStream).mockReturnValue(sink as never);
    vi.spyOn(console, "log").mockImplementation(() => {});
    await downloadCommand("abc234", { version: "2" }, {});
    expect(createWriteStream).toHaveBeenCalledWith("passwd");
  });

  it("refuses a malformed --version before any request, and maps a 404 to exit 5", async () => {
    const calls = stubFetch(() =>
      Response.json({ error: { code: "PAGE_NOT_FOUND", message: "Page not found" } }, { status: 404 }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await runForExit(() => downloadCommand("abc234", { version: "v2", json: true }, {}))).toBe(6);
    expect(calls).toHaveLength(0);
    expect(await runForExit(() => downloadCommand("abc234", { version: "9", json: true }, {}))).toBe(5);
    expect(createWriteStream).not.toHaveBeenCalled();
  });
});
