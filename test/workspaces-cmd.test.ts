// #408: `sharedrop workspaces`, the whoami workspace block, and --workspace
// taking an id or an address everywhere it is accepted.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../src/auth/resolve.js", () => ({
  resolveAuth: vi.fn(async () => ({ token: "sd_test", source: "flag" })),
  resolveBaseUrl: vi.fn(() => "https://app.example.com"),
}));

import { workspacesCommand } from "../src/commands/workspaces.js";
import { whoamiCommand } from "../src/commands/whoami.js";
import { uploadCommand } from "../src/commands/upload.js";
import { updateCommand } from "../src/commands/update.js";
import { listCommand } from "../src/commands/list.js";
import { moveCommand } from "../src/commands/move.js";
import { trashListCommand } from "../src/commands/trash.js";
import { reserveCommand, reservationsListCommand } from "../src/commands/reservation.js";
import { EXIT_CODES } from "../src/output/errors.js";
import {
  FINALIZE_NEW_PAGE,
  SIGN_RESPONSE,
  finalizeReupload,
  jsonResponse,
  routedFetch,
} from "./fixtures/contract-383.js";
import {
  ME_BASE,
  ME_PERSONAL,
  ME_WORKSPACE_KEY,
  WORKSPACES,
  WORKSPACES_RESPONSE,
  WORKSPACES_ROLE_ONLY,
  WORKSPACE_NOT_FOUND_MESSAGE,
} from "./fixtures/contract-408.js";

const ANSI = /\x1b\[[0-9;]*m/g;

function forceTTY(): () => void {
  const previous = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  return () => {
    if (previous) Object.defineProperty(process.stdout, "isTTY", previous);
    else delete (process.stdout as { isTTY?: boolean }).isTTY;
  };
}

function writeTmpFile(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "sharedrop-cli-408-"));
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
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

function stub(routes: Parameters<typeof routedFetch>[0]) {
  const routed = routedFetch(routes);
  vi.stubGlobal("fetch", vi.fn(routed.fn));
  return routed.calls;
}

describe("sharedrop workspaces", () => {
  const LIST_LINES = [
    "Ascend Intelligence  address: ascend  id: 6f1c2a9e-1b7d-4c52-9a51-0d3f8e2b7a10  role: owner  access: upload, edit all pages",
    "Client Reports  address: client-reports  id: 0b8e4d3c-5a21-4f6e-8c97-2d1a6b9e4f30  role: member  access: upload, edit own pages",
    "Partner Briefs  address: partner-briefs  id: 9d2f7b1a-3c84-4e5d-b6a0-7e1c5f8d2a49  role: viewer  access: read only",
  ];

  it("text mode prints one line per workspace with name, address, id, role and access", async () => {
    stub({ "GET /api/v1/workspaces": () => jsonResponse(200, WORKSPACES_RESPONSE) });
    restoreTTY = forceTTY();

    await workspacesCommand({}, {});

    expect(printed().split("\n")).toEqual(LIST_LINES);
  });

  it("the access phrase follows the booleans over the role", async () => {
    const flipped = WORKSPACES.map((w) => ({ ...w, can_upload: false }));
    stub({
      "GET /api/v1/workspaces": () => jsonResponse(200, { data: { workspaces: flipped } }),
    });
    restoreTTY = forceTTY();

    await workspacesCommand({}, {});

    expect(printed().split("\n").every((l) => l.endsWith("access: read only"))).toBe(true);
  });

  it("an older server without the access booleans falls back to the role", async () => {
    stub({
      "GET /api/v1/workspaces": () =>
        jsonResponse(200, { data: { workspaces: WORKSPACES_ROLE_ONLY } }),
    });
    restoreTTY = forceTTY();

    await workspacesCommand({}, {});

    expect(printed().split("\n")).toEqual(LIST_LINES);
  });

  it("--json prints the server's data envelope plus the default workspace (#409)", async () => {
    stub({ "GET /api/v1/workspaces": () => jsonResponse(200, WORKSPACES_RESPONSE) });

    await workspacesCommand({ json: true }, {});

    expect(JSON.parse(printed())).toEqual({
      data: { ...WORKSPACES_RESPONSE.data, default_workspace: null },
    });
  });

  it("with no workspaces it says uploads go to the personal space", async () => {
    stub({ "GET /api/v1/workspaces": () => jsonResponse(200, { data: { workspaces: [] } }) });
    restoreTTY = forceTTY();

    await workspacesCommand({}, {});

    expect(printed()).toBe(
      "You are not a member of any team workspace. Uploads go to your personal space.",
    );
  });

  it("an older server without the endpoint gets a clear message and the not-found exit", async () => {
    stub({
      "GET /api/v1/workspaces": () =>
        new Response("<!DOCTYPE html><html>404</html>", {
          status: 404,
          headers: { "Content-Type": "text/html" },
        }),
    });
    restoreTTY = forceTTY();

    const code = await runForExit(() => workspacesCommand({}, {}));

    expect(code).toBe(EXIT_CODES.NOT_FOUND);
    expect(printedErr()).toContain("This Sharedrop server cannot list workspaces yet.");
    expect(printedErr()).not.toContain("SyntaxError");
  });
});

describe("sharedrop whoami workspace fields", () => {
  it("a personal key shows the personal plan and lists its workspaces", async () => {
    stub({ "GET /api/v1/me": () => jsonResponse(200, { data: ME_PERSONAL }) });
    restoreTTY = forceTTY();

    await whoamiCommand({}, {});

    const out = printed();
    expect(out).toContain("  Plan:    Free (personal)");
    expect(out).not.toContain("Tier:");
    expect(out).toContain(
      [
        "  Workspaces:",
        "    Ascend Intelligence  address: ascend  role: owner  access: upload, edit all pages",
        "    Client Reports  address: client-reports  role: member  access: upload, edit own pages",
        "    Partner Briefs  address: partner-briefs  role: viewer  access: read only",
      ].join("\n"),
    );
  });

  it("an older server without the access booleans still gets an access phrase from the role", async () => {
    stub({
      "GET /api/v1/me": () =>
        jsonResponse(200, { data: { ...ME_PERSONAL, workspaces: WORKSPACES_ROLE_ONLY } }),
    });
    restoreTTY = forceTTY();

    await whoamiCommand({}, {});

    expect(printed()).toContain("    Partner Briefs  address: partner-briefs  role: viewer  access: read only");
    expect(printed()).toContain(
      "    Client Reports  address: client-reports  role: member  access: upload, edit own pages",
    );
  });

  it("a personal key with no workspaces says none", async () => {
    stub({
      "GET /api/v1/me": () => jsonResponse(200, { data: { ...ME_PERSONAL, workspaces: [] } }),
    });
    restoreTTY = forceTTY();

    await whoamiCommand({}, {});

    expect(printed()).toContain("  Workspaces: none");
  });

  it("an sdw_ key says which workspace it is bound to and shows that plan", async () => {
    stub({ "GET /api/v1/me": () => jsonResponse(200, { data: ME_WORKSPACE_KEY }) });
    restoreTTY = forceTTY();

    await whoamiCommand({}, {});

    const out = printed();
    expect(out).toContain("  Key:     bound to workspace Ascend Intelligence (address: ascend)");
    expect(out).toContain("  Plan:    Team (workspace)");
    expect(out).not.toContain("Workspaces:");
  });

  it("--json passes the new fields through", async () => {
    stub({ "GET /api/v1/me": () => jsonResponse(200, { data: ME_PERSONAL }) });

    await whoamiCommand({ json: true }, {});

    const data = JSON.parse(printed()).data;
    expect(data.scope).toBe("personal");
    expect(data.workspace).toBeNull();
    expect(data.workspaces).toEqual(WORKSPACES);
  });

  it("an older server without the fields prints as before", async () => {
    stub({ "GET /api/v1/me": () => jsonResponse(200, { data: ME_BASE }) });
    restoreTTY = forceTTY();

    await whoamiCommand({}, {});

    expect(printed()).toBe(
      [
        "alice",
        "  Email:   alice@example.com",
        "  Tier:    free",
        "  Pages:   3 / 50",
        "  Storage: 2.0 KB",
        "  Host:    app.example.com",
      ].join("\n"),
    );
  });
});

describe("--workspace takes an id or an address", () => {
  it("upload passes an address to sign and finalize unchanged", async () => {
    const calls = stub({
      "POST /api/upload/sign": () => jsonResponse(200, SIGN_RESPONSE),
      "PUT /01HXXXEXAMPLEULID": () => jsonResponse(200, {}),
      "POST /api/upload/finalize": () => jsonResponse(200, FINALIZE_NEW_PAGE),
    });

    await uploadCommand(writeTmpFile("r.html", "<h1>R</h1>"), { json: true, workspace: "ascend" });

    expect(calls.find((c) => c.url.endsWith("/api/upload/sign"))?.body?.workspace).toBe("ascend");
    expect(calls.find((c) => c.url.endsWith("/api/upload/finalize"))?.body?.workspace_id).toBe(
      "ascend",
    );
  });

  it("list passes an address as workspace_id", async () => {
    const calls = stub({
      "GET /api/v1/pages": () =>
        jsonResponse(200, { data: [], pagination: { next_cursor: null, has_more: false } }),
    });

    await listCommand({ json: true, workspace: "client-reports" }, {});

    expect(new URL(calls[0].url).searchParams.get("workspace_id")).toBe("client-reports");
  });

  it("an unknown workspace prints the server's message and exits not-found", async () => {
    stub({
      "POST /api/upload/sign": () => jsonResponse(404, { error: WORKSPACE_NOT_FOUND_MESSAGE }),
    });
    restoreTTY = forceTTY();

    const code = await runForExit(() =>
      uploadCommand(writeTmpFile("r.html", "<h1>R</h1>"), { workspace: "nope" }),
    );

    expect(code).toBe(EXIT_CODES.NOT_FOUND);
    expect(printedErr()).toContain(WORKSPACE_NOT_FOUND_MESSAGE);
  });

  it("reserve sends workspace_id", async () => {
    const calls = stub({
      "POST /api/v1/reservations": () =>
        jsonResponse(201, { data: { reservation: { id: "rsv_1" }, claim_token: "sdr_x" } }),
    });

    await reserveCommand({ json: true, workspace: "ascend" }, {});

    expect(calls[0].body).toEqual({ workspace_id: "ascend" });
  });

  it("reservations list sends workspace_id", async () => {
    const calls = stub({
      "GET /api/v1/reservations": () =>
        jsonResponse(200, { data: [], pagination: { next_cursor: null, has_more: false } }),
    });

    await reservationsListCommand({ json: true, workspace: "ascend" }, {});

    expect(new URL(calls[0].url).searchParams.get("workspace_id")).toBe("ascend");
  });

  it("trash list sends workspace_id and prints the items", async () => {
    const item = {
      id: "p_1",
      title: "Old report",
      nodeType: "page",
      parentId: null,
      path: "/p_1",
      deletedAt: "2026-10-10T00:00:00.000Z",
      kind: "html",
      fileSize: 10,
    };
    const calls = stub({ "GET /api/trash": () => jsonResponse(200, { items: [item] }) });

    await trashListCommand({ json: true, workspace: "ascend" }, {});

    expect(new URL(calls[0].url).searchParams.get("workspace_id")).toBe("ascend");
    expect(JSON.parse(printed())).toEqual({ items: [item] });
  });

  it("trash list without --workspace sends no workspace", async () => {
    const calls = stub({ "GET /api/trash": () => jsonResponse(200, { items: [] }) });

    await trashListCommand({ json: true }, {});

    expect(new URL(calls[0].url).search).toBe("");
  });
});

// #385: the server derives a workspace page's workspace on re-upload, so update
// must work without --workspace and must not invent one.
describe("update on a workspace page (#385)", () => {
  it("sends no workspace to sign or finalize and prints the result", async () => {
    const PAGE = FINALIZE_NEW_PAGE.page_id;
    const derived = {
      ...finalizeReupload(4),
      url: "/w/ascend/ab12cd34ef",
      full_url: "https://sharedrop.cloud/w/ascend/ab12cd34ef",
    };
    const calls = stub({
      "POST /api/upload/sign": () => jsonResponse(200, SIGN_RESPONSE),
      "PUT /01HXXXEXAMPLEULID": () => jsonResponse(200, {}),
      "POST /api/upload/finalize": () => jsonResponse(200, derived),
    });

    await updateCommand(PAGE, writeTmpFile("r.html", "<h1>v4</h1>"), { json: true }, {});

    const sign = calls.find((c) => c.url.endsWith("/api/upload/sign"))?.body;
    const finalize = calls.find((c) => c.url.endsWith("/api/upload/finalize"))?.body;
    expect(sign).toMatchObject({ page_id: PAGE });
    expect(sign).not.toHaveProperty("workspace");
    expect(finalize).toMatchObject({ page_id: PAGE });
    expect(finalize).not.toHaveProperty("workspace_id");
    const out = JSON.parse(printed()).data;
    expect(out).toMatchObject({ id: PAGE, version: 4, full_url: derived.full_url });
  });
});

describe("move --folder into a folder in another space", () => {
  it("prints the server's message, not a generic not-found", async () => {
    const FOLDER = "11111111-2222-4333-8444-555555555555";
    stub({
      "PUT /api/pages/p_1": () =>
        jsonResponse(400, { error: "A folder and its pages must be in the same space." }),
    });
    restoreTTY = forceTTY();

    const code = await runForExit(() => moveCommand("p_1", { folder: FOLDER }, {}));

    expect(code).toBe(EXIT_CODES.VALIDATION_ERROR);
    expect(printedErr()).toContain("A folder and its pages must be in the same space.");
    expect(printedErr()).not.toMatch(/not found/i);
  });
});
