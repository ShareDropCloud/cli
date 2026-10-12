// #410: folders inside Team workspaces. `folder create` and `folder list` take
// --workspace / --personal and the default workspace (#409); `move --folder
// <path>` and `upload --folder <path>` resolve the path in the right tree (a
// workspace page's own workspace, the upload's target workspace) and never
// create personal folders for workspace content. Server errors print verbatim.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = "https://staging.example.com";

vi.mock("../src/auth/resolve.js", () => ({
  resolveAuth: vi.fn(async () => ({ token: "sd_test", source: "flag" })),
  resolveBaseUrl: vi.fn(() => BASE),
}));

import { resolveAuth } from "../src/auth/resolve.js";
import { clearSavedWorkspace, saveWorkspace } from "../src/auth/store.js";
import {
  folderCreateCommand,
  folderDeleteCommand,
  folderListCommand,
  folderMoveCommand,
} from "../src/commands/folder.js";
import { moveCommand } from "../src/commands/move.js";
import { uploadCommand } from "../src/commands/upload.js";
import { listCommand } from "../src/commands/list.js";
import { EXIT_CODES } from "../src/output/errors.js";
import {
  FINALIZE_NEW_PAGE,
  SIGN_RESPONSE,
  jsonResponse,
  routedFetch,
  type RecordedCall,
} from "./fixtures/contract-383.js";
import { ME_PERSONAL, WORKSPACES, WORKSPACE_NOT_FOUND_MESSAGE } from "./fixtures/contract-408.js";

const ANSI = /\x1b\[[0-9;]*m/g;
const ASCEND = WORKSPACES[0];
const WS = "smoke-agents";
const OTHER_MEMBERS =
  "This folder holds pages created by other members. Only a workspace owner can move or delete it.";
const CROSS_SPACE = "A folder and its pages must be in the same space.";

/** A workspace tree: reports/ at the root holding one page, and reports/2026/. */
const WS_TREE = {
  pages: [
    { id: "f_reports", title: "Reports", nodeType: "folder", parentId: null, path: "/f_reports" },
    { id: "f_2026", title: "2026", nodeType: "folder", parentId: "f_reports", path: "/f_reports/f_2026" },
    {
      id: "p_ws",
      slug: "abc123",
      title: "Q3",
      nodeType: "page",
      parentId: "f_reports",
      path: "/f_reports/p_ws",
      fullUrl: `https://staging.example.com/${WS}/abc123`,
    },
  ],
};

function folderBody(id: string, name: string, parentId: string | null, workspaceId: string | null) {
  return {
    folder: { id, name, title: name, parentId, path: `/${id}`, nodeType: "folder", workspaceId, createdAt: "" },
  };
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

function forceTTY(): () => void {
  const previous = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  return () => {
    if (previous) Object.defineProperty(process.stdout, "isTTY", previous);
    else delete (process.stdout as { isTTY?: boolean }).isTTY;
  };
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

function stub(routes: Parameters<typeof routedFetch>[0]): RecordedCall[] {
  const routed = routedFetch(routes);
  vi.stubGlobal("fetch", vi.fn(routed.fn));
  return routed.calls;
}

const meRoute = { "GET /api/v1/me": () => jsonResponse(200, { data: ME_PERSONAL }) };

/** Every tree read, as the workspace_id it named (null for the personal tree). */
function treeReads(calls: RecordedCall[]): Array<string | null> {
  return calls
    .filter((c) => new URL(c.url).pathname.startsWith("/api/tree/"))
    .map((c) => new URL(c.url).searchParams.get("workspace_id"));
}
function folderCreates(calls: RecordedCall[]) {
  return calls.filter((c) => c.method === "POST" && new URL(c.url).pathname === "/api/folders");
}

function writeTmpFile(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "sharedrop-cli-410-"));
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

beforeEach(() => {
  vi.restoreAllMocks();
  clearSavedWorkspace(BASE);
  delete process.env.SHAREDROP_WORKSPACE;
  vi.spyOn(process, "cwd").mockReturnValue(mkdtempSync(join(tmpdir(), "sharedrop-cli-410-cwd-")));
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

describe("folder create in a workspace", () => {
  function routes(tree: unknown = { pages: [] }) {
    return {
      ...meRoute,
      "GET /api/tree/alice": () => jsonResponse(200, tree),
      "POST /api/folders": (c: RecordedCall) =>
        jsonResponse(201, folderBody("f_new", String(c.body?.name), null, ASCEND.id)),
    };
  }

  it("--workspace reads that workspace's tree and creates the folder there", async () => {
    const calls = stub(routes());
    await folderCreateCommand("reports", { workspace: WS, json: true }, {});
    expect(treeReads(calls)).toEqual([WS]);
    expect(folderCreates(calls).map((c) => c.body)).toEqual([
      { name: "reports", parentId: null, workspace_id: WS },
    ]);
    expect(JSON.parse(printed()).folder.workspaceId).toBe(ASCEND.id);
  });

  it("a nested path creates every missing segment in the workspace", async () => {
    const calls = stub(routes(WS_TREE));
    await folderCreateCommand("reports/2026/q3", { workspace: WS, json: true }, {});
    expect(folderCreates(calls).map((c) => c.body)).toEqual([
      { name: "q3", parentId: "f_2026", workspace_id: WS },
    ]);
  });

  it("uses the saved default workspace, and none with --personal", async () => {
    saveWorkspace(BASE, { id: ASCEND.id, slug: ASCEND.slug });
    let calls = stub(routes());
    await folderCreateCommand("reports", { json: true }, {});
    expect(treeReads(calls)).toEqual([ASCEND.id]);
    expect(folderCreates(calls)[0].body?.workspace_id).toBe(ASCEND.id);

    calls = stub(routes());
    await folderCreateCommand("reports", { personal: true, json: true }, {});
    expect(treeReads(calls)).toEqual([null]);
    expect(folderCreates(calls)[0].body).not.toHaveProperty("workspace_id");
  });

  it("SHAREDROP_WORKSPACE applies too", async () => {
    process.env.SHAREDROP_WORKSPACE = WS;
    const calls = stub(routes());
    await folderCreateCommand("reports", { json: true }, {});
    expect(folderCreates(calls)[0].body?.workspace_id).toBe(WS);
  });

  it("--workspace with --personal is a usage error before any request", async () => {
    const calls = stub(routes());
    const code = await runForExit(() =>
      folderCreateCommand("reports", { workspace: WS, personal: true, json: true }, {}),
    );
    expect(code).toBe(EXIT_CODES.VALIDATION_ERROR);
    expect(calls).toHaveLength(0);
  });

  it("an sdw_ key ignores the default and sends no workspace (the server uses the key's)", async () => {
    saveWorkspace(BASE, { id: ASCEND.id, slug: ASCEND.slug });
    vi.mocked(resolveAuth).mockResolvedValueOnce({ token: "sdw_test", source: "flag" });
    const calls = stub(routes());
    await folderCreateCommand("reports", { json: true }, {});
    expect(treeReads(calls)).toEqual([null]);
    expect(folderCreates(calls)[0].body).not.toHaveProperty("workspace_id");
  });

  it("FOLDERS_RESTRICTED from a workspace without folders prints the reason and exits 3", async () => {
    stub({
      ...meRoute,
      "GET /api/tree/alice": () => jsonResponse(200, { pages: [] }),
      "POST /api/folders": () =>
        jsonResponse(403, { error: "Folders need a Team workspace.", code: "FOLDERS_RESTRICTED" }),
    });
    restoreTTY = forceTTY();
    const code = await runForExit(() => folderCreateCommand("reports", { workspace: WS }, {}));
    expect(code).toBe(EXIT_CODES.AUTH_FAILED);
    expect(printedErr()).toContain("Folders need a Team workspace.");
  });

  it("a --parent in another space prints the server's cross-space message, exit 6", async () => {
    stub({
      ...meRoute,
      "GET /api/tree/alice": () => jsonResponse(200, { pages: [] }),
      "POST /api/folders": () => jsonResponse(400, { error: CROSS_SPACE }),
    });
    restoreTTY = forceTTY();
    const code = await runForExit(() =>
      folderCreateCommand("x", { parent: "f_personal", workspace: WS }, {}),
    );
    expect(code).toBe(EXIT_CODES.VALIDATION_ERROR);
    expect(printedErr()).toContain(`Error: ${CROSS_SPACE}`);
  });
});

describe("folder list in a workspace", () => {
  const routes = { ...meRoute, "GET /api/tree/alice": () => jsonResponse(200, WS_TREE) };

  it("--workspace lists that workspace's top-level folders (text)", async () => {
    const calls = stub(routes);
    restoreTTY = forceTTY();
    await folderListCommand({ workspace: WS }, {});
    expect(treeReads(calls)).toEqual([WS]);
    expect(printed()).toContain("f_reports");
    expect(printed()).toContain("Reports");
    expect(printed()).not.toContain("f_2026");
  });

  it("--json keeps the { folders } shape and --parent lists children", async () => {
    stub(routes);
    await folderListCommand({ workspace: WS, parent: "f_reports", json: true }, {});
    expect(JSON.parse(printed())).toEqual({ folders: [{ id: "f_2026", name: "2026", items: 0 }] });
  });

  it("uses the saved default, and the personal tree with --personal", async () => {
    saveWorkspace(BASE, { id: ASCEND.id, slug: ASCEND.slug });
    let calls = stub(routes);
    await folderListCommand({ json: true }, {});
    expect(treeReads(calls)).toEqual([ASCEND.id]);

    calls = stub(routes);
    await folderListCommand({ personal: true, json: true }, {});
    expect(treeReads(calls)).toEqual([null]);
  });

  it("a workspace the caller is not in prints the server 404, exit 5, with the stale-default hint", async () => {
    saveWorkspace(BASE, { id: ASCEND.id, slug: ASCEND.slug });
    stub({ ...meRoute, "GET /api/tree/alice": () => jsonResponse(404, { error: WORKSPACE_NOT_FOUND_MESSAGE }) });
    restoreTTY = forceTTY();
    const code = await runForExit(() => folderListCommand({}, {}));
    expect(code).toBe(EXIT_CODES.NOT_FOUND);
    expect(printedErr()).toContain(`Error: ${WORKSPACE_NOT_FOUND_MESSAGE}`);
    expect(printedErr()).toContain("workspaces use --clear");
  });
});

describe("move --folder <path> resolves in the page's own space", () => {
  function routes(pageUrl: string) {
    return {
      ...meRoute,
      "GET /api/v1/pages/*": () => jsonResponse(200, { data: { id: "p_1", url: pageUrl } }),
      "GET /api/tree/alice": () => jsonResponse(200, WS_TREE),
      "POST /api/folders": (c: RecordedCall) =>
        jsonResponse(201, folderBody("f_q3", String(c.body?.name), "f_2026", ASCEND.id)),
      "PUT /api/pages/p_1": () => jsonResponse(200, { page: { id: "p_1" } }),
    };
  }

  it("a workspace page walks its workspace's tree and creates folders there, never personal ones", async () => {
    const calls = stub(routes(`/${WS}/abc123`));
    await moveCommand("p_1", { folder: "reports/2026/q3", json: true }, {});
    expect(treeReads(calls)).toEqual([WS]);
    expect(folderCreates(calls).map((c) => c.body)).toEqual([
      { name: "q3", parentId: "f_2026", workspace_id: WS },
    ]);
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ parentId: "f_q3" });
  });

  it("a workspace page finds an existing workspace folder with no create", async () => {
    const calls = stub(routes(`/${WS}/abc123`));
    await moveCommand("p_1", { folder: "Reports", json: true }, {});
    expect(folderCreates(calls)).toHaveLength(0);
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ parentId: "f_reports" });
  });

  it("a personal page walks the personal tree, even with a default workspace saved", async () => {
    saveWorkspace(BASE, { id: ASCEND.id, slug: ASCEND.slug });
    const calls = stub(routes("/alice/abc123"));
    await moveCommand("p_1", { folder: "reports/2026/q3", json: true }, {});
    expect(treeReads(calls)).toEqual([null]);
    expect(folderCreates(calls)[0].body).not.toHaveProperty("workspace_id");
  });

  it("a folder id moves directly without reading the page or a tree", async () => {
    const FID = "11111111-2222-4333-8444-555555555555";
    const calls = stub({ "PUT /api/pages/p_1": () => jsonResponse(200, { page: { id: "p_1" } }) });
    await moveCommand("p_1", { folder: FID, json: true }, {});
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual(["PUT /api/pages/p_1"]);
  });

  it("a cross-space refusal prints the server message, exit 6", async () => {
    stub({ "PUT /api/pages/p_1": () => jsonResponse(400, { error: CROSS_SPACE }) });
    restoreTTY = forceTTY();
    const code = await runForExit(() =>
      moveCommand("p_1", { folder: "11111111-2222-4333-8444-555555555555" }, {}),
    );
    expect(code).toBe(EXIT_CODES.VALIDATION_ERROR);
    expect(printedErr()).toContain(`Error: ${CROSS_SPACE}`);
  });
});

describe("folder move and delete refusals for a member", () => {
  it("folder move prints the other-members message, exit 3", async () => {
    stub({ "PATCH /api/folders/*": () => jsonResponse(403, { error: OTHER_MEMBERS }) });
    restoreTTY = forceTTY();
    const code = await runForExit(() => folderMoveCommand("f_1", { root: true }, {}));
    expect(code).toBe(EXIT_CODES.AUTH_FAILED);
    expect(printedErr()).toContain(`Error: ${OTHER_MEMBERS}`);
  });

  it("folder delete --force prints the other-members message, exit 3", async () => {
    const calls = stub({ "DELETE /api/folders/*": () => jsonResponse(403, { error: OTHER_MEMBERS }) });
    const code = await runForExit(() => folderDeleteCommand("f_1", { force: true, json: true }, {}));
    expect(code).toBe(EXIT_CODES.AUTH_FAILED);
    expect(new URL(calls[0].url).search).toBe("?force=true");
    expect(JSON.parse(printedErr()).error.message).toBe(OTHER_MEMBERS);
  });
});

describe("upload --folder <path> into a workspace", () => {
  function routes() {
    return {
      ...meRoute,
      "GET /api/tree/alice": () => jsonResponse(200, WS_TREE),
      "POST /api/folders": (c: RecordedCall) =>
        jsonResponse(201, folderBody("f_q3", String(c.body?.name), "f_2026", ASCEND.id)),
      "POST /api/upload/sign": () => jsonResponse(200, SIGN_RESPONSE),
      "PUT /01HXXXEXAMPLEULID": () => jsonResponse(200, {}),
      "POST /api/upload/finalize": () => jsonResponse(200, FINALIZE_NEW_PAGE),
    };
  }
  const finalizeBody = (calls: RecordedCall[]) =>
    calls.find((c) => c.url.endsWith("/api/upload/finalize"))?.body;

  it("--workspace resolves and auto-creates the path in that workspace", async () => {
    const calls = stub(routes());
    await uploadCommand(writeTmpFile("r.html", "<h1>R</h1>"), {
      workspace: WS,
      folder: "reports/2026/q3",
      json: true,
    });
    expect(treeReads(calls)).toEqual([WS]);
    expect(folderCreates(calls).map((c) => c.body)).toEqual([
      { name: "q3", parentId: "f_2026", workspace_id: WS },
    ]);
    expect(finalizeBody(calls)).toMatchObject({ folder_id: "f_q3", workspace_id: WS });
  });

  it("the saved default workspace applies to the folder path too", async () => {
    saveWorkspace(BASE, { id: ASCEND.id, slug: ASCEND.slug });
    const calls = stub(routes());
    await uploadCommand(writeTmpFile("r.html", "<h1>R</h1>"), { folder: "reports", json: true });
    expect(treeReads(calls)).toEqual([ASCEND.id]);
    expect(finalizeBody(calls)).toMatchObject({ folder_id: "f_reports", workspace_id: ASCEND.id });
  });

  it("--personal keeps the path in the personal tree", async () => {
    saveWorkspace(BASE, { id: ASCEND.id, slug: ASCEND.slug });
    const calls = stub(routes());
    await uploadCommand(writeTmpFile("r.html", "<h1>R</h1>"), {
      personal: true,
      folder: "reports",
      json: true,
    });
    expect(treeReads(calls)).toEqual([null]);
    expect(finalizeBody(calls)).not.toHaveProperty("workspace_id");
  });
});

describe("list --folder in a workspace", () => {
  it("resolves the folder and lists its pages from the workspace tree", async () => {
    const calls = stub({ ...meRoute, "GET /api/tree/alice": () => jsonResponse(200, WS_TREE) });
    await listCommand({ workspace: WS, folder: "reports", json: true }, {});
    expect(treeReads(calls)).toEqual([WS, WS]);
    const [row] = JSON.parse(printed()).data;
    expect(row.id).toBe("p_ws");
    // The url uses the workspace address, matching full_url, never the username.
    expect(row.url).toBe(`/${WS}/abc123`);
    expect(row.full_url).toBe(`https://staging.example.com/${WS}/abc123`);
  });
});
