// #191 — top-level `move <id>` (page into/out of a folder).
//
// Mirrors the folder-cmd.test.ts style: auth resolution is mocked so the
// command builds a client without env/config, and client methods are spied on
// the prototype. Covers --folder (uuid + path auto-create), --root, and the
// exactly-one-destination validation.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../src/auth/resolve.js", () => ({
  resolveAuth: vi.fn(async () => ({ token: "sd_test", source: "flag" })),
  resolveBaseUrl: vi.fn(() => "https://app.example.com"),
}));

import { SharedropApiClient } from "../src/client/api-client.js";
import { moveCommand } from "../src/commands/move.js";

function silenceLog() {
  return vi.spyOn(console, "log").mockImplementation(() => {});
}

describe("moveCommand — page move", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("--root moves the page to your top level (movePage(id, null))", async () => {
    const move = vi
      .spyOn(SharedropApiClient.prototype, "movePage")
      .mockResolvedValue({ page: { id: "p_1" } as never });
    const log = silenceLog();

    await moveCommand("p_1", { root: true, json: true }, {});
    expect(move).toHaveBeenCalledWith("p_1", null);
    const printed = JSON.parse(log.mock.calls[0][0] as string);
    expect(printed).toMatchObject({ success: true, id: "p_1", parentId: null });
  });

  it("--folder with a uuid moves the page directly without reading the tree", async () => {
    const FID = "11111111-2222-4333-8444-555555555555";
    const getMe = vi.spyOn(SharedropApiClient.prototype, "getMe");
    const move = vi
      .spyOn(SharedropApiClient.prototype, "movePage")
      .mockResolvedValue({ page: { id: "p_1" } as never });
    silenceLog();

    await moveCommand("p_1", { folder: FID, json: true }, {});
    expect(getMe).not.toHaveBeenCalled();
    expect(move).toHaveBeenCalledWith("p_1", FID);
  });

  it("--folder with a path resolves (auto-creating the tail) then moves", async () => {
    vi.spyOn(SharedropApiClient.prototype, "getMe").mockResolvedValue({
      username: "scotto",
    } as never);
    vi.spyOn(SharedropApiClient.prototype, "listTree").mockResolvedValue({
      pages: [
        { id: "f_reports", title: "reports", nodeType: "folder", parentId: null, path: "/f_reports" },
      ],
    });
    vi.spyOn(SharedropApiClient.prototype, "createFolder").mockResolvedValue({
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
    const move = vi
      .spyOn(SharedropApiClient.prototype, "movePage")
      .mockResolvedValue({ page: { id: "p_1" } as never });
    silenceLog();

    await moveCommand("p_1", { folder: "reports/2026", json: true }, {});
    expect(move).toHaveBeenCalledWith("p_1", "f_2026");
  });

  it("errors when neither --folder nor --root is given", async () => {
    const move = vi.spyOn(SharedropApiClient.prototype, "movePage");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw new Error(`exit:${code}`);
      }) as never);

    await expect(moveCommand("p_1", { json: true }, {})).rejects.toThrow("exit:6");
    expect(move).not.toHaveBeenCalled();
    const printed = JSON.parse(err.mock.calls[0][0] as string);
    expect(printed.error.code).toBe("VALIDATION_ERROR");
    exit.mockRestore();
  });

  it("errors when both --folder and --root are given", async () => {
    const move = vi.spyOn(SharedropApiClient.prototype, "movePage");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw new Error(`exit:${code}`);
      }) as never);

    await expect(
      moveCommand("p_1", { folder: "reports", root: true, json: true }, {}),
    ).rejects.toThrow("exit:6");
    expect(move).not.toHaveBeenCalled();
    exit.mockRestore();
  });
});
