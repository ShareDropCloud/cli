// #185 Phase 4 (24-03) — CLI folder command group + formatters.
//
// Covers arg/option threading (create/list/delete/restore), the 409 counts
// refusal path, --force, the buildFolderRows tree reduction, and the em-dash
// copy rule on the folder formatters. Auth resolution is mocked so the commands
// build a client without touching env/config; client methods are spied on the
// prototype (the command constructs its own client internally).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../src/auth/resolve.js", () => ({
  resolveAuth: vi.fn(async () => ({ token: "sd_test", source: "flag" })),
  resolveBaseUrl: vi.fn(() => "https://app.example.com"),
}));

import { SharedropApiClient, SharedropApiError } from "../src/client/api-client.js";
import {
  folderCreateCommand,
  folderListCommand,
  folderDeleteCommand,
  folderRestoreCommand,
  folderRenameCommand,
  folderMoveCommand,
  buildFolderRows,
  parseFolderSegments,
  resolveDestinationFolder,
} from "../src/commands/folder.js";
import { uploadFileStreamed } from "../src/commands/upload.js";
import { listCommand } from "../src/commands/list.js";
import { handleError } from "../src/output/errors.js";

function newClient(): SharedropApiClient {
  return new SharedropApiClient({ apiKey: "sd_test", baseUrl: "https://app.example.com" });
}

function writeTmpFile(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "sharedrop-cli-folder-test-"));
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}
import {
  formatFolderAlreadyExists,
  formatFolderCreated,
  formatFolderDeleted,
  formatFolderList,
  formatFolderMoved,
  formatFolderNotEmpty,
  formatFolderRenamed,
  formatPageMoved,
  formatRestore,
} from "../src/output/format.js";

const EM_DASH = "—";

function silenceLog() {
  return vi.spyOn(console, "log").mockImplementation(() => {});
}

describe("folder commands — arg/option threading", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("folderCreateCommand passes name + --parent to createFolder", async () => {
    vi.spyOn(SharedropApiClient.prototype, "getMe").mockResolvedValue({
      username: "scotto",
    } as never);
    vi.spyOn(SharedropApiClient.prototype, "listTree").mockResolvedValue({ pages: [] });
    const spy = vi
      .spyOn(SharedropApiClient.prototype, "createFolder")
      .mockResolvedValue({
        folder: {
          id: "f_1",
          name: "reports",
          title: "reports",
          parentId: "f_p",
          path: "/f_p/f_1",
          nodeType: "folder",
          createdAt: "2026-07-12T00:00:00.000Z",
        },
      });
    const log = silenceLog();

    await folderCreateCommand("reports", { parent: "f_p", json: true }, {});

    expect(spy).toHaveBeenCalledWith({ name: "reports", parentId: "f_p" });
    expect(log).toHaveBeenCalledOnce();
  });

  it("folderCreateCommand defaults parentId to null at root", async () => {
    vi.spyOn(SharedropApiClient.prototype, "getMe").mockResolvedValue({
      username: "scotto",
    } as never);
    vi.spyOn(SharedropApiClient.prototype, "listTree").mockResolvedValue({ pages: [] });
    const spy = vi
      .spyOn(SharedropApiClient.prototype, "createFolder")
      .mockResolvedValue({
        folder: {
          id: "f_1",
          name: "reports",
          title: "reports",
          parentId: null,
          path: "/f_1",
          nodeType: "folder",
          createdAt: "",
        },
      });
    silenceLog();

    await folderCreateCommand("reports", { json: true }, {});
    expect(spy).toHaveBeenCalledWith({ name: "reports", parentId: null });
  });

  it("folderCreateCommand auto-creates only the missing tail of a nested path", async () => {
    vi.spyOn(SharedropApiClient.prototype, "getMe").mockResolvedValue({
      username: "scotto",
    } as never);
    vi.spyOn(SharedropApiClient.prototype, "listTree").mockResolvedValue({
      pages: [
        { id: "f_reports", title: "reports", nodeType: "folder", parentId: null, path: "/f_reports" },
      ],
    });
    const create = vi.spyOn(SharedropApiClient.prototype, "createFolder");
    create.mockResolvedValueOnce({
      folder: {
        id: "f_2026",
        name: "2026",
        title: "2026",
        parentId: "f_reports",
        path: "/f_reports/f_2026",
        nodeType: "folder",
        createdAt: "",
      },
    });
    create.mockResolvedValueOnce({
      folder: {
        id: "f_q1",
        name: "q1",
        title: "q1",
        parentId: "f_2026",
        path: "/f_reports/f_2026/f_q1",
        nodeType: "folder",
        createdAt: "",
      },
    });
    const log = silenceLog();

    await folderCreateCommand("reports/2026/q1", { json: true }, {});

    // "reports" already exists (matched from the tree); only 2026 + q1 are created.
    expect(create).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenNthCalledWith(1, { name: "2026", parentId: "f_reports" });
    expect(create).toHaveBeenNthCalledWith(2, { name: "q1", parentId: "f_2026" });
    // Prints the leaf (last created) node.
    const printed = JSON.parse(log.mock.calls[0][0] as string);
    expect(printed.folder.id).toBe("f_q1");
  });

  it("folderCreateCommand prints an idempotent already-exists line when the whole path exists", async () => {
    vi.spyOn(SharedropApiClient.prototype, "getMe").mockResolvedValue({
      username: "scotto",
    } as never);
    vi.spyOn(SharedropApiClient.prototype, "listTree").mockResolvedValue({
      pages: [
        { id: "f_reports", title: "reports", nodeType: "folder", parentId: null, path: "/f_reports" },
        { id: "f_2026", title: "2026", nodeType: "folder", parentId: "f_reports", path: "/f_reports/f_2026" },
      ],
    });
    const create = vi.spyOn(SharedropApiClient.prototype, "createFolder");
    const log = silenceLog();

    await folderCreateCommand("reports/2026", { json: true }, {});

    expect(create).not.toHaveBeenCalled();
    const printed = JSON.parse(log.mock.calls[0][0] as string);
    expect(printed).toEqual({ folder: { id: "f_2026" }, alreadyExists: true });
  });

  it("folderRenameCommand calls updateFolder(id, { name })", async () => {
    const update = vi
      .spyOn(SharedropApiClient.prototype, "updateFolder")
      .mockResolvedValue({
        folder: {
          id: "f_1",
          name: "invoices",
          title: "invoices",
          parentId: null,
          path: "/f_1",
          nodeType: "folder",
          createdAt: "",
        },
      });
    const log = silenceLog();

    await folderRenameCommand("f_1", "invoices", { json: true }, {});
    expect(update).toHaveBeenCalledWith("f_1", { name: "invoices" });
    const printed = JSON.parse(log.mock.calls[0][0] as string);
    expect(printed).toMatchObject({ success: true, id: "f_1", name: "invoices" });
  });

  it("folderMoveCommand --parent maps to updateFolder(id, { parentId })", async () => {
    const update = vi
      .spyOn(SharedropApiClient.prototype, "updateFolder")
      .mockResolvedValue({ folder: {} as never });
    silenceLog();

    await folderMoveCommand("f_1", { parent: "f_new", json: true }, {});
    expect(update).toHaveBeenCalledWith("f_1", { parentId: "f_new" });
  });

  it("folderMoveCommand --root maps to updateFolder(id, { parentId: null })", async () => {
    const update = vi
      .spyOn(SharedropApiClient.prototype, "updateFolder")
      .mockResolvedValue({ folder: {} as never });
    silenceLog();

    await folderMoveCommand("f_1", { root: true, json: true }, {});
    expect(update).toHaveBeenCalledWith("f_1", { parentId: null });
  });

  it("folderMoveCommand errors when neither --parent nor --root is given", async () => {
    const update = vi.spyOn(SharedropApiClient.prototype, "updateFolder");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw new Error(`exit:${code}`);
      }) as never);

    await expect(folderMoveCommand("f_1", { json: true }, {})).rejects.toThrow("exit:6");
    expect(update).not.toHaveBeenCalled();
    const printed = JSON.parse(err.mock.calls[0][0] as string);
    expect(printed.error.code).toBe("VALIDATION_ERROR");
    exit.mockRestore();
  });

  it("folderMoveCommand errors when both --parent and --root are given", async () => {
    const update = vi.spyOn(SharedropApiClient.prototype, "updateFolder");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw new Error(`exit:${code}`);
      }) as never);

    await expect(
      folderMoveCommand("f_1", { parent: "f_new", root: true, json: true }, {}),
    ).rejects.toThrow("exit:6");
    expect(update).not.toHaveBeenCalled();
    exit.mockRestore();
  });

  it("folderListCommand resolves the username via whoami then filters the tree", async () => {
    vi.spyOn(SharedropApiClient.prototype, "getMe").mockResolvedValue({
      username: "scotto",
    } as never);
    const tree = vi.spyOn(SharedropApiClient.prototype, "listTree").mockResolvedValue({
      pages: [
        { id: "f_root", title: "reports", nodeType: "folder", parentId: null, path: "/f_root" },
        { id: "f_child", title: "2026", nodeType: "folder", parentId: "f_root", path: "/f_root/f_child" },
        { id: "p_1", title: "hi", nodeType: "page", parentId: "f_root", path: "/f_root/p_1" },
      ],
    });
    const log = silenceLog();

    await folderListCommand({ json: true }, {});

    expect(tree).toHaveBeenCalledWith("scotto");
    const printed = JSON.parse(log.mock.calls[0][0] as string);
    expect(printed.folders).toEqual([{ id: "f_root", name: "reports", items: 2 }]);
  });

  it("folderListCommand --parent lists that folder's children", async () => {
    vi.spyOn(SharedropApiClient.prototype, "getMe").mockResolvedValue({
      username: "scotto",
    } as never);
    vi.spyOn(SharedropApiClient.prototype, "listTree").mockResolvedValue({
      pages: [
        { id: "f_root", title: "reports", nodeType: "folder", parentId: null, path: "/f_root" },
        { id: "f_child", title: "2026", nodeType: "folder", parentId: "f_root", path: "/f_root/f_child" },
      ],
    });
    const log = silenceLog();

    await folderListCommand({ parent: "f_root", json: true }, {});
    const printed = JSON.parse(log.mock.calls[0][0] as string);
    expect(printed.folders).toEqual([{ id: "f_child", name: "2026", items: 0 }]);
  });

  it("folderDeleteCommand without --force calls deleteFolder(id, false)", async () => {
    const del = vi
      .spyOn(SharedropApiClient.prototype, "deleteFolder")
      .mockResolvedValue({ success: true, pages: 0, folders: 0 });
    silenceLog();

    await folderDeleteCommand("f_1", { json: true }, {});
    expect(del).toHaveBeenCalledWith("f_1", false);
  });

  it("folderDeleteCommand with --force calls deleteFolder(id, true)", async () => {
    const del = vi
      .spyOn(SharedropApiClient.prototype, "deleteFolder")
      .mockResolvedValue({ success: true, pages: 3, folders: 1 });
    silenceLog();

    await folderDeleteCommand("f_1", { force: true, json: true }, {});
    expect(del).toHaveBeenCalledWith("f_1", true);
  });

  it("folderDeleteCommand prints the counts refusal and exits non-zero on FOLDER_NOT_EMPTY", async () => {
    vi.spyOn(SharedropApiClient.prototype, "deleteFolder").mockRejectedValue(
      new SharedropApiError("FOLDER_NOT_EMPTY", "This folder is not empty.", 409, undefined, {
        pages: 2,
        folders: 1,
      }),
    );
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw new Error(`exit:${code}`);
      }) as never);

    await expect(folderDeleteCommand("f_1", { json: true }, {})).rejects.toThrow("exit:1");
    expect(exit).toHaveBeenCalledWith(1);

    const printed = JSON.parse(err.mock.calls[0][0] as string);
    expect(printed.error).toMatchObject({ code: "FOLDER_NOT_EMPTY", pages: 2, folders: 1 });
  });

  it("folderRestoreCommand passes the id to restoreNode", async () => {
    const restore = vi
      .spyOn(SharedropApiClient.prototype, "restoreNode")
      .mockResolvedValue({ success: true, reparentedToRoot: true });
    const log = silenceLog();

    await folderRestoreCommand("n_1", { json: true }, {});
    expect(restore).toHaveBeenCalledWith("n_1");
    const printed = JSON.parse(log.mock.calls[0][0] as string);
    expect(printed.reparentedToRoot).toBe(true);
  });
});

describe("buildFolderRows — tree reduction", () => {
  const pages = [
    { id: "f_root", title: "reports", nodeType: "folder" as const, parentId: null, path: "/f_root" },
    { id: "f_child", title: "2026", nodeType: "folder" as const, parentId: "f_root", path: "/f_root/f_child" },
    { id: "p_1", title: "hi", nodeType: "page" as const, parentId: "f_root", path: "/f_root/p_1" },
  ];

  it("returns root folders with direct-child counts", () => {
    expect(buildFolderRows(pages, null)).toEqual([{ id: "f_root", name: "reports", items: 2 }]);
  });

  it("returns a parent's folder children", () => {
    expect(buildFolderRows(pages, "f_root")).toEqual([{ id: "f_child", name: "2026", items: 0 }]);
  });
});

describe("parseFolderSegments", () => {
  it("trims, splits on slash, and drops empties", () => {
    expect(parseFolderSegments(" reports // 2026 / ")).toEqual(["reports", "2026"]);
  });

  it("rejects an empty path", () => {
    expect(() => parseFolderSegments("   ")).toThrow(/cannot be empty/);
  });

  it("rejects a path deeper than 10 levels", () => {
    const deep = Array.from({ length: 11 }, (_, i) => `s${i}`).join("/");
    expect(() => parseFolderSegments(deep)).toThrow(/deeper than 10/);
  });
});

describe("resolveDestinationFolder", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("uses a uuid value directly without reading the tree", async () => {
    const getMe = vi.spyOn(SharedropApiClient.prototype, "getMe");
    const id = "11111111-2222-4333-8444-555555555555";
    const out = await resolveDestinationFolder(newClient(), id);
    expect(out).toBe(id);
    expect(getMe).not.toHaveBeenCalled();
  });

  it("matches existing segments case-insensitively and creates the missing tail", async () => {
    vi.spyOn(SharedropApiClient.prototype, "getMe").mockResolvedValue({
      username: "scotto",
    } as never);
    vi.spyOn(SharedropApiClient.prototype, "listTree").mockResolvedValue({
      pages: [
        { id: "f_reports", title: "Reports", nodeType: "folder", parentId: null, path: "/f_reports" },
      ],
    });
    const create = vi
      .spyOn(SharedropApiClient.prototype, "createFolder")
      .mockResolvedValue({
        folder: {
          id: "f_2026",
          name: "2026",
          title: "2026",
          parentId: "f_reports",
          path: "/f_reports/f_2026",
          nodeType: "folder",
          createdAt: "",
        },
      });

    // "reports" matches the existing "Reports" case-insensitively; "2026" is created.
    const out = await resolveDestinationFolder(newClient(), "reports/2026");
    expect(out).toBe("f_2026");
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({ name: "2026", parentId: "f_reports" });
  });

  it("propagates FOLDERS_RESTRICTED from the walk and never falls back to root", async () => {
    vi.spyOn(SharedropApiClient.prototype, "getMe").mockResolvedValue({
      username: "scotto",
    } as never);
    vi.spyOn(SharedropApiClient.prototype, "listTree").mockResolvedValue({ pages: [] });
    vi.spyOn(SharedropApiClient.prototype, "createFolder").mockRejectedValue(
      new SharedropApiError("FOLDERS_RESTRICTED", "Folders require a Pro plan or higher.", 403),
    );

    await expect(resolveDestinationFolder(newClient(), "reports")).rejects.toMatchObject({
      code: "FOLDERS_RESTRICTED",
      status: 403,
    });
  });

  it("with create:false, an unknown path throws FOLDER_NOT_FOUND and creates nothing", async () => {
    vi.spyOn(SharedropApiClient.prototype, "getMe").mockResolvedValue({
      username: "scotto",
    } as never);
    vi.spyOn(SharedropApiClient.prototype, "listTree").mockResolvedValue({ pages: [] });
    const create = vi.spyOn(SharedropApiClient.prototype, "createFolder");

    await expect(
      resolveDestinationFolder(newClient(), "nope", { create: false }),
    ).rejects.toMatchObject({ code: "FOLDER_NOT_FOUND", status: 404 });
    expect(create).not.toHaveBeenCalled();
  });
});

describe("upload --folder threading", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  function stubPipeline(client: SharedropApiClient) {
    vi.spyOn(client, "signUpload").mockResolvedValue({
      upload_url: "https://uploads.example.com/k",
      upload_token: "tkn",
      finalize_url: "https://app.example.com/api/upload/finalize",
      object_key: "k",
    });
    vi.spyOn(client, "streamUpload").mockResolvedValue(undefined);
    return vi.spyOn(client, "finalizeUpload").mockResolvedValue({
      url: "/scotto/x",
      page_id: "p",
      slug: "x",
      visibility: "private",
      mode: "static",
      kind: "html",
      contentType: "text/html",
    });
  }

  it("threads folderId into finalize as snake_case folder_id on a new upload", async () => {
    const client = newClient();
    const finalize = stubPipeline(client);
    const file = writeTmpFile("a.html", "<p>x</p>");

    await uploadFileStreamed(client, file, { folderId: "f_1" });
    expect(finalize).toHaveBeenCalledWith(expect.objectContaining({ folder_id: "f_1" }));
  });

  it("does NOT send folder_id on a re-upload (pageId set)", async () => {
    const client = newClient();
    const finalize = stubPipeline(client);
    const file = writeTmpFile("a.html", "<p>x</p>");

    await uploadFileStreamed(client, file, { folderId: "f_1", pageId: "p_existing" });
    const arg = finalize.mock.calls[0][0];
    expect(arg).not.toHaveProperty("folder_id");
    expect(arg.page_id).toBe("p_existing");
  });
});

describe("list --folder", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("scopes the listing to the folder's pages", async () => {
    const FID = "11111111-1111-4111-8111-111111111111";
    vi.spyOn(SharedropApiClient.prototype, "getMe").mockResolvedValue({
      username: "scotto",
    } as never);
    vi.spyOn(SharedropApiClient.prototype, "listTree").mockResolvedValue({
      pages: [
        { id: FID, title: "reports", nodeType: "folder", parentId: null, path: `/${FID}` },
        {
          id: "p_1",
          slug: "abc",
          title: "In folder",
          nodeType: "page",
          parentId: FID,
          path: `/${FID}/p_1`,
          visibility: "private",
          mode: "static",
          fileSize: 10,
          createdAt: "2026-07-12T00:00:00.000Z",
          updatedAt: "2026-07-12T00:00:00.000Z",
        },
        { id: "p_2", slug: "def", title: "Root page", nodeType: "page", parentId: null, path: "/p_2" },
      ],
    });
    const log = silenceLog();

    await listCommand({ folder: FID, json: true }, {});
    const printed = JSON.parse(log.mock.calls[0][0] as string);
    expect(printed.data.map((p: { id: string }) => p.id)).toEqual(["p_1"]);
    expect(printed.data[0].full_url).toBe("https://app.example.com/scotto/abc");
  });
});

describe("FOLDERS_RESTRICTED error rendering", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  function withExit(fn: () => void): number | undefined {
    let seen: number | undefined;
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      seen = code;
      throw new Error(`exit:${code}`);
    }) as never);
    try {
      fn();
    } catch {
      /* exit throws by design */
    }
    exit.mockRestore();
    return seen;
  }

  it("prints the server reason plus an upgrade link (human TTY, no Error: prefix)", () => {
    const prev = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const code = withExit(() =>
        handleError(
          new SharedropApiError("FOLDERS_RESTRICTED", "Folders require a Pro plan or higher.", 403),
          {},
        ),
      );
      expect(code).toBe(3); // statusToExitCode(403)
      const lines = err.mock.calls.map((c) => String(c[0]));
      expect(lines.some((l) => l.includes("Folders require a Pro plan or higher."))).toBe(true);
      expect(lines.some((l) => l.includes("Upgrade:") && l.includes("sharedrop.cloud/pricing"))).toBe(true);
      expect(lines.some((l) => l.includes("Error:"))).toBe(false);
    } finally {
      if (prev) Object.defineProperty(process.stdout, "isTTY", prev);
    }
  });

  it("emits the verbatim code + message in --json mode", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    withExit(() =>
      handleError(
        new SharedropApiError("FOLDERS_RESTRICTED", "Folders require a Pro plan or higher.", 403),
        { json: true },
      ),
    );
    const printed = JSON.parse(err.mock.calls[0][0] as string);
    expect(printed.error).toEqual({
      code: "FOLDERS_RESTRICTED",
      message: "Folders require a Pro plan or higher.",
    });
  });
});

describe("folder formatters — em-dash copy rule", () => {
  it("no folder formatter emits an em dash in human (TTY) output", () => {
    const prev = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    try {
      const strings = [
        formatFolderCreated(
          {
            id: "f_1",
            name: "reports",
            title: "reports",
            parentId: null,
            path: "/f_1",
            nodeType: "folder",
            createdAt: "",
          },
          {},
        ),
        formatFolderDeleted("f_1", { pages: 1, folders: 0 }, {}),
        formatFolderNotEmpty("f_1", { pages: 2, folders: 1 }, {}),
        formatFolderAlreadyExists("reports/2026", "f_1", {}),
        formatFolderRenamed("f_1", "invoices", {}),
        formatFolderMoved("f_1", "f_new", {}),
        formatFolderMoved("f_1", null, {}),
        formatPageMoved("p_1", "f_new", {}),
        formatPageMoved("p_1", null, {}),
        formatRestore("n_1", { reparentedToRoot: true }, {}),
        formatRestore("n_1", { reparentedToRoot: false }, {}),
        formatFolderList([{ id: "f_1", name: "reports", items: 3 }], {}),
        formatFolderList([], {}),
      ];
      for (const s of strings) {
        expect(s).not.toContain(EM_DASH);
      }
    } finally {
      if (prev) Object.defineProperty(process.stdout, "isTTY", prev);
    }
  });
});
