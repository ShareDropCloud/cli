// #409: the default workspace. Precedence on commands that take --workspace:
// --workspace, then --personal, then SHAREDROP_WORKSPACE (env, then .env), then
// the default saved per server by `sharedrop workspaces use`, then personal.
// The config store is real Conf under the temp HOME set in test/setup.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Conf from "conf";

const BASE = { url: "https://staging.example.com" };

vi.mock("../src/auth/resolve.js", () => ({
  resolveAuth: vi.fn(async () => ({ token: "sd_test", source: "flag" })),
  resolveBaseUrl: vi.fn(() => BASE.url),
}));

import { resolveAuth } from "../src/auth/resolve.js";
import { clearSavedWorkspace, getSavedWorkspace, saveWorkspace } from "../src/auth/store.js";
import { workspacesCommand, workspacesUseCommand } from "../src/commands/workspaces.js";
import { whoamiCommand } from "../src/commands/whoami.js";
import { uploadCommand } from "../src/commands/upload.js";
import { updateCommand } from "../src/commands/update.js";
import { checkCommand } from "../src/commands/check.js";
import { listCommand } from "../src/commands/list.js";
import { searchCommand } from "../src/commands/search.js";
import { trashEmptyCommand, trashListCommand } from "../src/commands/trash.js";
import { reserveCommand, reservationsListCommand } from "../src/commands/reservation.js";
import { EXIT_CODES } from "../src/output/errors.js";
import {
  FINALIZE_NEW_PAGE,
  LINT_RESPONSE_CLEAN,
  SIGN_RESPONSE,
  finalizeReupload,
  jsonResponse,
  routedFetch,
  type RecordedCall,
} from "./fixtures/contract-383.js";
import {
  ME_PERSONAL,
  ME_WORKSPACE_KEY,
  WORKSPACES,
  WORKSPACES_RESPONSE,
  WORKSPACE_NOT_FOUND_MESSAGE,
} from "./fixtures/contract-408.js";

const ANSI = /\x1b\[[0-9;]*m/g;
const STAGING = "https://staging.example.com";
const PROD = "https://sharedrop.example.com";
const ASCEND = WORKSPACES[0];
const CLIENT = WORKSPACES[1];

function forceTTY(): () => void {
  const previous = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  return () => {
    if (previous) Object.defineProperty(process.stdout, "isTTY", previous);
    else delete (process.stdout as { isTTY?: boolean }).isTTY;
  };
}

function writeTmpFile(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "sharedrop-cli-409-"));
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

/** Run with a .env in a temp cwd. */
function useDotenv(content: string): void {
  const dir = mkdtempSync(join(tmpdir(), "sharedrop-cli-409-env-"));
  writeFileSync(join(dir, ".env"), content);
  vi.spyOn(process, "cwd").mockReturnValue(dir);
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

let stdout: ReturnType<typeof vi.spyOn>;
let stderr: ReturnType<typeof vi.spyOn>;
let restoreTTY: (() => void) | undefined;

function printed(): string {
  return stdout.mock.calls.map((c: unknown[]) => String(c[0])).join("\n").replace(ANSI, "");
}
function printedErr(): string {
  return stderr.mock.calls.map((c: unknown[]) => String(c[0])).join("\n").replace(ANSI, "");
}

/** The same config file the CLI store uses (under the temp HOME from setup.ts). */
const rawConfig = new Conf<Record<string, unknown>>({ projectName: "sharedrop" });

beforeEach(() => {
  vi.restoreAllMocks();
  BASE.url = STAGING;
  rawConfig.delete("workspaceDefaults");
  delete process.env.SHAREDROP_WORKSPACE;
  // An empty temp cwd: no .env unless a test writes one.
  vi.spyOn(process, "cwd").mockReturnValue(mkdtempSync(join(tmpdir(), "sharedrop-cli-409-cwd-")));
  stdout = vi.spyOn(console, "log").mockImplementation(() => {});
  stderr = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  restoreTTY?.();
  restoreTTY = undefined;
  delete process.env.SHAREDROP_WORKSPACE;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stub(routes: Parameters<typeof routedFetch>[0]) {
  const routed = routedFetch(routes);
  vi.stubGlobal("fetch", vi.fn(routed.fn));
  return routed.calls;
}

function stubUpload(finalize: unknown = FINALIZE_NEW_PAGE) {
  return stub({
    "POST /api/upload/sign": () => jsonResponse(200, SIGN_RESPONSE),
    "PUT /01HXXXEXAMPLEULID": () => jsonResponse(200, {}),
    "POST /api/upload/finalize": () => jsonResponse(200, finalize),
  });
}

function signBody(calls: RecordedCall[]) {
  return calls.find((c) => c.url.endsWith("/api/upload/sign"))?.body;
}
function finalizeBody(calls: RecordedCall[]) {
  return calls.find((c) => c.url.endsWith("/api/upload/finalize"))?.body;
}

async function upload(opts: Record<string, unknown> = {}) {
  const calls = stubUpload();
  await uploadCommand(writeTmpFile("r.html", "<h1>R</h1>"), { json: true, ...opts });
  return calls;
}

function asTokenOnce(token: string) {
  vi.mocked(resolveAuth).mockResolvedValueOnce({ token, source: "flag" });
}

describe("precedence on upload", () => {
  it("no flag, env or saved default sends no workspace", async () => {
    const calls = await upload();
    expect(signBody(calls)?.workspace).toBeUndefined();
    expect(finalizeBody(calls)?.workspace_id).toBeUndefined();
  });

  it("the saved default is sent as its id to sign and finalize", async () => {
    saveWorkspace(STAGING, { id: ASCEND.id, slug: ASCEND.slug });
    const calls = await upload();
    expect(signBody(calls)?.workspace).toBe(ASCEND.id);
    expect(finalizeBody(calls)?.workspace_id).toBe(ASCEND.id);
  });

  it(".env SHAREDROP_WORKSPACE beats the saved default", async () => {
    saveWorkspace(STAGING, { id: ASCEND.id, slug: ASCEND.slug });
    useDotenv("SHAREDROP_TOKEN=sd_x\nSHAREDROP_WORKSPACE=client-reports\n");
    const calls = await upload();
    expect(signBody(calls)?.workspace).toBe("client-reports");
  });

  it("the SHAREDROP_WORKSPACE env var beats .env and the saved default", async () => {
    saveWorkspace(STAGING, { id: ASCEND.id, slug: ASCEND.slug });
    useDotenv("SHAREDROP_WORKSPACE=client-reports\n");
    process.env.SHAREDROP_WORKSPACE = "partner-briefs";
    const calls = await upload();
    expect(signBody(calls)?.workspace).toBe("partner-briefs");
  });

  it("--workspace beats the env var, .env and the saved default", async () => {
    saveWorkspace(STAGING, { id: ASCEND.id, slug: ASCEND.slug });
    useDotenv("SHAREDROP_WORKSPACE=client-reports\n");
    process.env.SHAREDROP_WORKSPACE = "partner-briefs";
    const calls = await upload({ workspace: "flagged" });
    expect(signBody(calls)?.workspace).toBe("flagged");
    expect(finalizeBody(calls)?.workspace_id).toBe("flagged");
  });

  it("--workspace beats the saved default alone", async () => {
    saveWorkspace(STAGING, { id: ASCEND.id, slug: ASCEND.slug });
    const calls = await upload({ workspace: CLIENT.slug });
    expect(signBody(calls)?.workspace).toBe(CLIENT.slug);
  });

  it("--personal sends no workspace even with the env var and a saved default", async () => {
    saveWorkspace(STAGING, { id: ASCEND.id, slug: ASCEND.slug });
    process.env.SHAREDROP_WORKSPACE = "partner-briefs";
    const calls = await upload({ personal: true });
    expect(signBody(calls)?.workspace).toBeUndefined();
    expect(finalizeBody(calls)?.workspace_id).toBeUndefined();
  });

  it("--workspace with --personal is a usage error before any request", async () => {
    const calls = stubUpload();
    restoreTTY = forceTTY();
    const code = await runForExit(() =>
      uploadCommand(writeTmpFile("r.html", "<h1>R</h1>"), { workspace: "ascend", personal: true }),
    );
    expect(code).toBe(EXIT_CODES.VALIDATION_ERROR);
    expect(printedErr()).toContain("Pass --workspace or --personal, not both.");
    expect(calls).toHaveLength(0);
  });

  it("a re-upload (--page-id) does not send the default; the server derives the page's workspace", async () => {
    saveWorkspace(STAGING, { id: ASCEND.id, slug: ASCEND.slug });
    const calls = stubUpload(finalizeReupload(2));
    await uploadCommand(writeTmpFile("r.html", "<h1>R</h1>"), {
      json: true,
      pageId: FINALIZE_NEW_PAGE.page_id,
    });
    expect(signBody(calls)).not.toHaveProperty("workspace");
    expect(finalizeBody(calls)).not.toHaveProperty("workspace_id");
  });
});

describe("the default on the other commands that take --workspace", () => {
  const PAGE_LIST = { data: [], pagination: { next_cursor: null, has_more: false } };
  const cases: Array<[string, Parameters<typeof stub>[0], (o: Record<string, unknown>) => Promise<void>]> = [
    ["list", { "GET /api/v1/pages": () => jsonResponse(200, PAGE_LIST) }, (o) => listCommand({ json: true, ...o }, {})],
    ["search", { "GET /api/v1/pages": () => jsonResponse(200, PAGE_LIST) }, (o) => searchCommand("q", { json: true, ...o }, {})],
    ["trash list", { "GET /api/trash": () => jsonResponse(200, { items: [] }) }, (o) => trashListCommand({ json: true, ...o }, {})],
    ["trash empty", { "DELETE /api/trash": () => jsonResponse(200, { success: true, purged: 0, freedBytes: 0 }) }, (o) => trashEmptyCommand({ json: true, ...o }, {})],
    ["reservations list", { "GET /api/v1/reservations": () => jsonResponse(200, PAGE_LIST) }, (o) => reservationsListCommand({ json: true, ...o }, {})],
  ];

  for (const [name, routes, run] of cases) {
    it(`${name} sends the saved default as workspace_id, and none with --personal`, async () => {
      saveWorkspace(STAGING, { id: ASCEND.id, slug: ASCEND.slug });
      let calls = stub(routes);
      await run({});
      expect(new URL(calls[0].url).searchParams.get("workspace_id")).toBe(ASCEND.id);

      calls = stub(routes);
      await run({ personal: true });
      expect(new URL(calls[0].url).searchParams.get("workspace_id")).toBeNull();
    });
  }

  it("reserve sends the saved default as workspace_id", async () => {
    saveWorkspace(STAGING, { id: ASCEND.id, slug: ASCEND.slug });
    const calls = stub({
      "POST /api/v1/reservations": () =>
        jsonResponse(201, { data: { reservation: { id: "rsv_1" }, claim_token: "sdr_x" } }),
    });
    await reserveCommand({ json: true }, {});
    expect(calls[0].body).toEqual({ workspace_id: ASCEND.id });
  });

  it("check sends the default, but not when checking a re-upload with --page-id", async () => {
    saveWorkspace(STAGING, { id: ASCEND.id, slug: ASCEND.slug });
    const routes = {
      "POST /api/upload/sign": () => jsonResponse(200, SIGN_RESPONSE),
      "PUT /01HXXXEXAMPLEULID": () => jsonResponse(200, {}),
      "POST /api/upload/lint": () => jsonResponse(200, LINT_RESPONSE_CLEAN),
    };
    let calls = stub(routes);
    await checkCommand(writeTmpFile("r.html", "<h1>R</h1>"), { json: true }, {});
    expect(signBody(calls)?.workspace).toBe(ASCEND.id);
    expect(calls.find((c) => c.url.endsWith("/api/upload/lint"))?.body?.workspace_id).toBe(ASCEND.id);

    calls = stub(routes);
    await checkCommand(writeTmpFile("r.html", "<h1>R</h1>"), { json: true, pageId: "p_1" }, {});
    expect(signBody(calls)).not.toHaveProperty("workspace");
  });

  it("update (no --workspace option) is unchanged: no workspace sent with a default saved", async () => {
    saveWorkspace(STAGING, { id: ASCEND.id, slug: ASCEND.slug });
    process.env.SHAREDROP_WORKSPACE = "client-reports";
    const calls = stubUpload(finalizeReupload(3));
    await updateCommand(FINALIZE_NEW_PAGE.page_id, writeTmpFile("r.html", "<h1>v3</h1>"), { json: true }, {});
    expect(signBody(calls)).not.toHaveProperty("workspace");
    expect(finalizeBody(calls)).not.toHaveProperty("workspace_id");
  });
});

describe("per-server keying", () => {
  it("a default saved for staging does not apply to production", async () => {
    saveWorkspace(STAGING, { id: ASCEND.id, slug: ASCEND.slug });
    BASE.url = PROD;
    const calls = await upload();
    expect(signBody(calls)?.workspace).toBeUndefined();
    expect(getSavedWorkspace(PROD)).toBeUndefined();
    expect(getSavedWorkspace(STAGING)).toEqual({ id: ASCEND.id, slug: ASCEND.slug });
  });

  it("each server keeps its own default", async () => {
    saveWorkspace(STAGING, { id: ASCEND.id, slug: ASCEND.slug });
    saveWorkspace(PROD, { id: CLIENT.id, slug: CLIENT.slug });
    BASE.url = PROD;
    const calls = await upload();
    expect(signBody(calls)?.workspace).toBe(CLIENT.id);
  });
});

describe("an sdw_ key ignores the default", () => {
  it("sends no workspace and says so once on stderr in text mode", async () => {
    saveWorkspace(STAGING, { id: ASCEND.id, slug: ASCEND.slug });
    process.env.SHAREDROP_WORKSPACE = "client-reports";
    asTokenOnce("sdw_test");
    const calls = stub({ "GET /api/v1/pages": () => jsonResponse(200, { data: [], pagination: { next_cursor: null, has_more: false } }) });
    restoreTTY = forceTTY();
    await listCommand({}, {});
    expect(new URL(calls[0].url).searchParams.get("workspace_id")).toBeNull();
    const notes = printedErr().split("\n").filter((l) => l.startsWith("Note: this sdw_ key"));
    expect(notes).toEqual([
      "Note: this sdw_ key is bound to its own workspace, so the default workspace (set by SHAREDROP_WORKSPACE) is ignored.",
    ]);
  });

  it("prints no note in --json mode", async () => {
    saveWorkspace(STAGING, { id: ASCEND.id, slug: ASCEND.slug });
    asTokenOnce("sdw_test");
    const calls = await upload();
    expect(signBody(calls)?.workspace).toBeUndefined();
    expect(printedErr()).toBe("");
  });

  it("prints no note when no default is set", async () => {
    asTokenOnce("sdw_test");
    stub({ "GET /api/v1/pages": () => jsonResponse(200, { data: [], pagination: { next_cursor: null, has_more: false } }) });
    restoreTTY = forceTTY();
    await listCommand({}, {});
    expect(printedErr()).toBe("");
  });

  it("an explicit --workspace still passes through", async () => {
    asTokenOnce("sdw_test");
    const calls = await upload({ workspace: "ascend" });
    expect(signBody(calls)?.workspace).toBe("ascend");
  });
});

describe("a stale default", () => {
  // Upload routes send a bare error string; v1 routes send { code, message }.
  const notMember = () => jsonResponse(404, { error: WORKSPACE_NOT_FOUND_MESSAGE });
  const v1NotMember = () =>
    jsonResponse(404, { error: { code: "NOT_FOUND", message: WORKSPACE_NOT_FOUND_MESSAGE } });

  it("a saved default the caller left fails with the server's 404, exit 5, plus one hint", async () => {
    saveWorkspace(STAGING, { id: ASCEND.id, slug: ASCEND.slug });
    const calls = stub({ "POST /api/upload/sign": notMember });
    restoreTTY = forceTTY();
    const code = await runForExit(() => uploadCommand(writeTmpFile("r.html", "<h1>R</h1>"), {}));
    expect(code).toBe(EXIT_CODES.NOT_FOUND);
    expect(calls.map((c) => c.url)).toEqual([`${STAGING}/api/upload/sign`]);
    const err = printedErr().split("\n");
    expect(err).toContain(`Error: ${WORKSPACE_NOT_FOUND_MESSAGE}`);
    expect(err.filter((l) => l.includes("workspaces use --clear"))).toEqual([
      "Your saved default workspace is not one you belong to. Run `sharedrop workspaces use --clear` or pass --personal.",
    ]);
  });

  it("an env default the caller left names the env var in the hint", async () => {
    process.env.SHAREDROP_WORKSPACE = "gone";
    stub({ "GET /api/v1/pages": v1NotMember });
    restoreTTY = forceTTY();
    const code = await runForExit(() => listCommand({}, {}));
    expect(code).toBe(EXIT_CODES.NOT_FOUND);
    expect(printedErr()).toContain("Your default workspace (set by SHAREDROP_WORKSPACE) is not one you belong to.");
  });

  it("--json gets the plain error envelope and no hint", async () => {
    saveWorkspace(STAGING, { id: ASCEND.id, slug: ASCEND.slug });
    stub({ "GET /api/v1/pages": v1NotMember });
    const code = await runForExit(() => listCommand({ json: true }, {}));
    expect(code).toBe(EXIT_CODES.NOT_FOUND);
    expect(JSON.parse(printedErr()).error.message).toBe(WORKSPACE_NOT_FOUND_MESSAGE);
    expect(printedErr()).not.toContain("--clear");
  });

  it("an explicit --workspace 404 gets no default hint", async () => {
    stub({ "GET /api/v1/pages": v1NotMember });
    restoreTTY = forceTTY();
    await runForExit(() => listCommand({ workspace: "nope" }, {}));
    expect(printedErr()).not.toContain("--clear");
  });
});

describe("sharedrop workspaces use", () => {
  const listRoute = { "GET /api/v1/workspaces": () => jsonResponse(200, WORKSPACES_RESPONSE) };

  it("saves the id and address of a workspace the caller belongs to (text)", async () => {
    stub(listRoute);
    restoreTTY = forceTTY();
    await workspacesUseCommand("Client-Reports", {}, {});
    expect(getSavedWorkspace(STAGING)).toEqual({ id: CLIENT.id, slug: CLIENT.slug });
    expect(printed()).toBe(
      [
        `Default workspace for staging.example.com: Client Reports (address: client-reports, id: ${CLIENT.id})`,
        "Commands that take --workspace now use it. Pass --personal for your personal space.",
      ].join("\n"),
    );
  });

  it("accepts an id and prints JSON", async () => {
    stub(listRoute);
    await workspacesUseCommand(ASCEND.id, { json: true }, {});
    expect(JSON.parse(printed())).toEqual({
      data: { default_workspace: { id: ASCEND.id, slug: "ascend", source: "saved" } },
    });
  });

  it("refuses a workspace the caller is not a member of before saving (exit 5)", async () => {
    saveWorkspace(STAGING, { id: ASCEND.id, slug: ASCEND.slug });
    stub(listRoute);
    restoreTTY = forceTTY();
    const code = await runForExit(() => workspacesUseCommand("someone-elses", {}, {}));
    expect(code).toBe(EXIT_CODES.NOT_FOUND);
    expect(printedErr()).toContain(WORKSPACE_NOT_FOUND_MESSAGE);
    expect(getSavedWorkspace(STAGING)).toEqual({ id: ASCEND.id, slug: ASCEND.slug });
  });

  it("notes when SHAREDROP_WORKSPACE overrides the saved default", async () => {
    process.env.SHAREDROP_WORKSPACE = "partner-briefs";
    stub(listRoute);
    restoreTTY = forceTTY();
    await workspacesUseCommand("ascend", {}, {});
    expect(printed()).toContain(
      "Note: SHAREDROP_WORKSPACE is set and takes precedence over the saved default.",
    );
  });

  it("--clear removes only this server's default (text and JSON)", async () => {
    saveWorkspace(STAGING, { id: ASCEND.id, slug: ASCEND.slug });
    saveWorkspace(PROD, { id: CLIENT.id, slug: CLIENT.slug });
    const calls = stub({});
    restoreTTY = forceTTY();
    await workspacesUseCommand(undefined, { clear: true }, {});
    expect(printed()).toBe("Cleared the default workspace for staging.example.com.");
    expect(getSavedWorkspace(STAGING)).toBeUndefined();
    expect(getSavedWorkspace(PROD)).toEqual({ id: CLIENT.id, slug: CLIENT.slug });
    expect(calls).toHaveLength(0);

    restoreTTY();
    restoreTTY = undefined;
    stdout.mockClear();
    await workspacesUseCommand(undefined, { clear: true, json: true }, {});
    expect(JSON.parse(printed())).toEqual({ data: { default_workspace: null, cleared: false } });
  });

  it("needs exactly one of an id or address and --clear", async () => {
    expect(await runForExit(() => workspacesUseCommand(undefined, {}, {}))).toBe(
      EXIT_CODES.VALIDATION_ERROR,
    );
    expect(await runForExit(() => workspacesUseCommand("ascend", { clear: true }, {}))).toBe(
      EXIT_CODES.VALIDATION_ERROR,
    );
  });
});

describe("whoami and workspaces show the active default", () => {
  it("whoami text shows the saved default with its name and source", async () => {
    saveWorkspace(STAGING, { id: CLIENT.id, slug: CLIENT.slug });
    stub({ "GET /api/v1/me": () => jsonResponse(200, { data: ME_PERSONAL }) });
    restoreTTY = forceTTY();
    await whoamiCommand({}, {});
    expect(printed().split("\n").at(-1)).toBe(
      "  Default workspace: client-reports (Client Reports), set by `sharedrop workspaces use`",
    );
  });

  it("whoami JSON gives { id, slug, source } for an env default matched against the list", async () => {
    process.env.SHAREDROP_WORKSPACE = ASCEND.id;
    stub({ "GET /api/v1/me": () => jsonResponse(200, { data: ME_PERSONAL }) });
    await whoamiCommand({ json: true }, {});
    expect(JSON.parse(printed()).data.default_workspace).toEqual({
      id: ASCEND.id,
      slug: "ascend",
      source: "env",
    });
  });

  it("whoami flags a .env default the caller does not belong to", async () => {
    useDotenv("SHAREDROP_WORKSPACE=gone\n");
    stub({ "GET /api/v1/me": () => jsonResponse(200, { data: ME_PERSONAL }) });
    restoreTTY = forceTTY();
    await whoamiCommand({}, {});
    expect(printed()).toContain(
      "  Default workspace: gone, set by SHAREDROP_WORKSPACE in .env. You are not a member of it",
    );
  });

  it("whoami JSON has default_workspace null with no default, and with an sdw_ key", async () => {
    stub({ "GET /api/v1/me": () => jsonResponse(200, { data: ME_PERSONAL }) });
    await whoamiCommand({ json: true }, {});
    expect(JSON.parse(printed()).data.default_workspace).toBeNull();

    saveWorkspace(STAGING, { id: CLIENT.id, slug: CLIENT.slug });
    stdout.mockClear();
    asTokenOnce("sdw_test");
    stub({ "GET /api/v1/me": () => jsonResponse(200, { data: ME_WORKSPACE_KEY }) });
    await whoamiCommand({ json: true }, {});
    expect(JSON.parse(printed()).data.default_workspace).toBeNull();
    expect(printedErr()).toBe("");
  });

  it("workspaces text ends with the default line; JSON carries default_workspace", async () => {
    saveWorkspace(STAGING, { id: ASCEND.id, slug: ASCEND.slug });
    stub({ "GET /api/v1/workspaces": () => jsonResponse(200, WORKSPACES_RESPONSE) });
    restoreTTY = forceTTY();
    await workspacesCommand({}, {});
    expect(printed().split("\n").at(-1)).toBe(
      "Default workspace: ascend (Ascend Intelligence), set by `sharedrop workspaces use`",
    );

    restoreTTY();
    restoreTTY = undefined;
    stdout.mockClear();
    stub({ "GET /api/v1/workspaces": () => jsonResponse(200, WORKSPACES_RESPONSE) });
    await workspacesCommand({ json: true }, {});
    expect(JSON.parse(printed()).data.default_workspace).toEqual({
      id: ASCEND.id,
      slug: "ascend",
      source: "saved",
    });
  });
});

// Hardening 1: `upload --to <slug>` finds a reservation made under the default.
describe("upload --to looks the slug up in the resolved workspace", () => {
  const RES_ID = "7c0d1e2f-3a4b-4c5d-8e6f-7a8b9c0d1e2f";
  const RESERVED = { id: RES_ID, slug: "wsres01", status: "reserved" };

  /** Reservations exist only in the Ascend workspace; personal has none. */
  function stubClaim() {
    return stub({
      "GET /api/v1/reservations": (call) => {
        const ws = new URL(call.url).searchParams.get("workspace_id");
        const data = ws === ASCEND.id || ws === ASCEND.slug ? [RESERVED] : [];
        return jsonResponse(200, { data, pagination: { next_cursor: null, has_more: false } });
      },
      "POST /api/upload/sign": () => jsonResponse(200, SIGN_RESPONSE),
      "PUT /01HXXXEXAMPLEULID": () => jsonResponse(200, {}),
      "POST /api/upload/finalize": () => jsonResponse(200, FINALIZE_NEW_PAGE),
    });
  }
  const listCall = (calls: RecordedCall[]) => calls.find((c) => c.url.includes("/api/v1/reservations"));

  it("a saved default finds the slug; sign and finalize still send no workspace", async () => {
    saveWorkspace(STAGING, { id: ASCEND.id, slug: ASCEND.slug });
    const calls = stubClaim();
    await uploadCommand(writeTmpFile("r.html", "<h1>R</h1>"), { json: true, to: "wsres01" });
    expect(new URL(listCall(calls)!.url).searchParams.get("workspace_id")).toBe(ASCEND.id);
    expect(signBody(calls)).toMatchObject({ reservation_id: RES_ID });
    expect(signBody(calls)).not.toHaveProperty("workspace");
    expect(finalizeBody(calls)).not.toHaveProperty("workspace_id");
  });

  it("an env default finds the slug too", async () => {
    process.env.SHAREDROP_WORKSPACE = ASCEND.slug;
    const calls = stubClaim();
    await uploadCommand(writeTmpFile("r.html", "<h1>R</h1>"), { json: true, to: "wsres01" });
    expect(new URL(listCall(calls)!.url).searchParams.get("workspace_id")).toBe(ASCEND.slug);
    expect(signBody(calls)).not.toHaveProperty("workspace");
  });

  it("--personal looks in personal reservations", async () => {
    saveWorkspace(STAGING, { id: ASCEND.id, slug: ASCEND.slug });
    const calls = stubClaim();
    restoreTTY = forceTTY();
    const code = await runForExit(() =>
      uploadCommand(writeTmpFile("r.html", "<h1>R</h1>"), { to: "wsres01", personal: true }),
    );
    expect(new URL(listCall(calls)!.url).searchParams.get("workspace_id")).toBeNull();
    expect(code).toBe(EXIT_CODES.NOT_FOUND);
    expect(printedErr()).toContain("No reserved address named wsres01");
  });

  it("an explicit --workspace still wins and is sent to sign", async () => {
    saveWorkspace(STAGING, { id: CLIENT.id, slug: CLIENT.slug });
    const calls = stubClaim();
    await uploadCommand(writeTmpFile("r.html", "<h1>R</h1>"), {
      json: true,
      to: "wsres01",
      workspace: ASCEND.slug,
    });
    expect(new URL(listCall(calls)!.url).searchParams.get("workspace_id")).toBe(ASCEND.slug);
    expect(signBody(calls)?.workspace).toBe(ASCEND.slug);
  });
});

// Hardening 2: the saved default is keyed by the normalised origin.
describe("saved default keyed by origin", () => {
  it("--url spellings that differ in case share one default", async () => {
    // resolveBaseUrl already strips a trailing slash; the store test below covers it too.
    BASE.url = "https://Staging.Example.com";
    stub({ "GET /api/v1/workspaces": () => jsonResponse(200, WORKSPACES_RESPONSE) });
    await workspacesUseCommand("ascend", { json: true }, {});

    BASE.url = "https://staging.example.com";
    const calls = await upload();
    expect(signBody(calls)?.workspace).toBe(ASCEND.id);
    expect(Object.keys(rawConfig.get("workspaceDefaults") as object)).toEqual([STAGING]);
  });

  it("a key saved by the earlier build (unnormalised) is still found and cleared", async () => {
    rawConfig.set("workspaceDefaults", {
      "https://Staging.example.com": { id: ASCEND.id, slug: ASCEND.slug },
    });
    expect(getSavedWorkspace(STAGING)).toEqual({ id: ASCEND.id, slug: ASCEND.slug });
    const calls = await upload();
    expect(signBody(calls)?.workspace).toBe(ASCEND.id);

    expect(clearSavedWorkspace(STAGING)).toBe(true);
    expect(rawConfig.get("workspaceDefaults")).toEqual({});
  });

  it("saving replaces an old spelling instead of keeping two", () => {
    rawConfig.set("workspaceDefaults", {
      "https://Staging.example.com": { id: ASCEND.id, slug: ASCEND.slug },
    });
    saveWorkspace("https://staging.example.com/", { id: CLIENT.id, slug: CLIENT.slug });
    expect(rawConfig.get("workspaceDefaults")).toEqual({
      [STAGING]: { id: CLIENT.id, slug: CLIENT.slug },
    });
  });
});

// Hardening 3: an sdw_ key cannot save a default (it would never apply).
describe("workspaces use with an sdw_ key", () => {
  it("is refused with exit 6, no request, and nothing saved", async () => {
    asTokenOnce("sdw_test");
    const calls = stub({ "GET /api/v1/workspaces": () => jsonResponse(200, WORKSPACES_RESPONSE) });
    restoreTTY = forceTTY();
    const code = await runForExit(() => workspacesUseCommand("ascend", {}, {}));
    expect(code).toBe(EXIT_CODES.VALIDATION_ERROR);
    expect(printedErr()).toContain("This sdw_ key is bound to its own workspace");
    expect(calls).toHaveLength(0);
    expect(getSavedWorkspace(STAGING)).toBeUndefined();
  });
});

// Hardening 4: --json says when SHAREDROP_WORKSPACE overrides the saved default.
describe("workspaces use --json overridden_by", () => {
  const listRoute = { "GET /api/v1/workspaces": () => jsonResponse(200, WORKSPACES_RESPONSE) };

  it("is env when the environment variable is set", async () => {
    process.env.SHAREDROP_WORKSPACE = "partner-briefs";
    stub(listRoute);
    await workspacesUseCommand("ascend", { json: true }, {});
    expect(JSON.parse(printed()).data.overridden_by).toBe("env");
  });

  it("is dotenv when .env sets it, also on --clear", async () => {
    useDotenv("SHAREDROP_WORKSPACE=partner-briefs\n");
    stub(listRoute);
    await workspacesUseCommand("ascend", { json: true }, {});
    expect(JSON.parse(printed()).data.overridden_by).toBe("dotenv");

    stdout.mockClear();
    await workspacesUseCommand(undefined, { clear: true, json: true }, {});
    expect(JSON.parse(printed()).data).toEqual({
      default_workspace: null,
      cleared: true,
      overridden_by: "dotenv",
    });
  });

  it("is absent when nothing overrides the saved default", async () => {
    stub(listRoute);
    await workspacesUseCommand("ascend", { json: true }, {});
    expect(JSON.parse(printed()).data).not.toHaveProperty("overridden_by");
  });
});
