// #446: `sharedrop shared`, the pages other people have shared with you.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../src/auth/resolve.js", () => ({
  resolveAuth: vi.fn(async () => ({ token: "sd_test", source: "flag" })),
  resolveBaseUrl: vi.fn(() => "https://app.example.com"),
}));

import { sharedCommand } from "../src/commands/shared.js";
import { EXIT_CODES } from "../src/output/errors.js";
import { jsonResponse, routedFetch } from "./fixtures/contract-383.js";

const ANSI = /\x1b\[[0-9;]*m/g;

const SHARES = [
  {
    page_id: "b0000000-0000-4000-8000-000000000001",
    title: "Q3 report",
    kind: "html",
    url: "/bob/q3abcd",
    full_url: "https://app.example.com/bob/q3abcd",
    shared_by: "bob",
    shared_at: "2026-10-20T05:00:00.000Z",
    expires_at: "2026-11-20T05:00:00.000Z",
  },
  {
    page_id: "b0000000-0000-4000-8000-000000000002",
    title: "Board deck",
    kind: "slides",
    url: "/ascend/deck12",
    full_url: "https://app.example.com/ascend/deck12",
    shared_by: null,
    shared_at: "2026-10-19T05:00:00.000Z",
    expires_at: null,
  },
];
const CURSOR = "c0000000-0000-4000-8000-000000000002";
const LIST = { data: SHARES, pagination: { next_cursor: CURSOR, has_more: true } };
const WORKSPACE_KEY_MESSAGE =
  "Shares belong to a person, not a workspace. Use a personal API key.";

function forceTTY(): () => void {
  const previous = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  return () => {
    if (previous) Object.defineProperty(process.stdout, "isTTY", previous);
    else delete (process.stdout as { isTTY?: boolean }).isTTY;
  };
}

function forceNotTTY(): () => void {
  const previous = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
  return () => {
    if (previous) Object.defineProperty(process.stdout, "isTTY", previous);
    else delete (process.stdout as { isTTY?: boolean }).isTTY;
  };
}

/** Run a command with process.exit trapped; returns the first exit code. */
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

let stdout: ReturnType<typeof vi.spyOn>;
let stderr: ReturnType<typeof vi.spyOn>;
let restoreTTY: (() => void) | undefined;

function printed(): string {
  return stdout.mock.calls.map((c: unknown[]) => String(c[0])).join("\n").replace(ANSI, "");
}

function printedErr(): string {
  return stderr.mock.calls.map((c: unknown[]) => String(c[0])).join("\n").replace(ANSI, "");
}

function stub(routes: Parameters<typeof routedFetch>[0]) {
  const routed = routedFetch(routes);
  vi.stubGlobal("fetch", vi.fn(routed.fn));
  return routed.calls;
}

beforeEach(() => {
  vi.restoreAllMocks();
  stdout = vi.spyOn(console, "log").mockImplementation(() => {});
  stderr = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  restoreTTY?.();
  restoreTTY = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("sharedrop shared", () => {
  it("prints a table on a TTY with the next cursor", async () => {
    stub({ "GET /api/v1/shared": () => jsonResponse(200, LIST) });
    restoreTTY = forceTTY();

    await sharedCommand({}, {});

    const out = printed();
    for (const s of SHARES) {
      expect(out).toContain(s.page_id);
      expect(out).toContain(s.title);
      expect(out).toContain(s.full_url);
    }
    expect(out).toContain("Shared by");
    expect(out).toContain("bob");
    expect(out).toContain(`More shares available. Use --cursor ${CURSOR}`);
    expect(() => JSON.parse(out)).toThrow();
  });

  it("prints {data, pagination} JSON when stdout is not a TTY", async () => {
    stub({ "GET /api/v1/shared": () => jsonResponse(200, LIST) });
    restoreTTY = forceNotTTY();

    await sharedCommand({}, {});

    expect(JSON.parse(printed())).toEqual(LIST);
  });

  it("prints {data, pagination} JSON with --json on a TTY", async () => {
    stub({ "GET /api/v1/shared": () => jsonResponse(200, LIST) });
    restoreTTY = forceTTY();

    await sharedCommand({ json: true }, {});

    expect(JSON.parse(printed()).data).toEqual(SHARES);
  });

  it("sends --limit and --cursor, defaulting the limit to 50", async () => {
    const calls = stub({
      "GET /api/v1/shared": () =>
        jsonResponse(200, { data: [], pagination: { next_cursor: null, has_more: false } }),
    });

    await sharedCommand({ json: true, limit: "1", cursor: CURSOR }, {});
    await sharedCommand({ json: true }, {});

    const first = new URL(calls[0].url).searchParams;
    expect(first.get("limit")).toBe("1");
    expect(first.get("cursor")).toBe(CURSOR);
    const second = new URL(calls[1].url).searchParams;
    expect(second.get("limit")).toBe("50");
    expect(second.get("cursor")).toBeNull();
  });

  it("says so when nothing has been shared", async () => {
    stub({
      "GET /api/v1/shared": () =>
        jsonResponse(200, { data: [], pagination: { next_cursor: null, has_more: false } }),
    });
    restoreTTY = forceTTY();

    await sharedCommand({}, {});

    expect(printed()).toBe("Nothing has been shared with you yet.");
  });

  it("is listed in --help", async () => {
    vi.resetModules();
    vi.stubGlobal("__CLI_VERSION__", "0.0.0-test");
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const saved = process.argv;
    process.argv = ["node", "sharedrop", "--help"];
    try {
      await import("../src/cli.js");
    } catch {
      /* exit throws by design */
    } finally {
      process.argv = saved;
      vi.resetModules();
    }
    const help = write.mock.calls.map((c) => String(c[0])).join("");
    expect(help).toMatch(/\n\s+shared \[options\]\s+List pages other people have shared with you/);
  });

  it("a cursor whose share has gone gets the server's message and the validation exit", async () => {
    const message = "This cursor is no longer valid. Start again without a cursor.";
    stub({
      "GET /api/v1/shared": () =>
        jsonResponse(400, { error: { code: "VALIDATION_ERROR", message } }),
    });
    restoreTTY = forceTTY();

    const code = await runForExit(() => sharedCommand({ cursor: CURSOR }, {}));

    expect(code).toBe(EXIT_CODES.VALIDATION_ERROR);
    expect(printedErr()).toContain(message);
  });

  it("a workspace key gets the server's message and the auth-failed exit", async () => {
    stub({
      "GET /api/v1/shared": () =>
        jsonResponse(403, { error: { code: "FORBIDDEN", message: WORKSPACE_KEY_MESSAGE } }),
    });
    restoreTTY = forceTTY();

    const code = await runForExit(() => sharedCommand({}, {}));

    expect(code).toBe(EXIT_CODES.AUTH_FAILED);
    expect(printedErr()).toContain(WORKSPACE_KEY_MESSAGE);
  });
});
