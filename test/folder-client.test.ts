// #185 Phase 4 (24-03) — CLI api-client folder methods.
//
// The folder / trash / move / tree routes return FLAT bodies ({ folder },
// { pages }, { items }, { success, pages, folders }, 409 { error, pages,
// folders }), NOT the v1 { data } envelope. These methods copy the
// signUpload/finalizeUpload direct-fetch style and must NEVER route through
// the .data-unwrapping request helpers. This suite mocks global.fetch and
// asserts the URL, verb, headers, and body per method, plus the 409 mapping.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SharedropApiClient, SharedropApiError } from "../src/client/api-client.js";

function newClient(): SharedropApiClient {
  return new SharedropApiClient({
    apiKey: "sd_test",
    baseUrl: "https://app.example.com",
  });
}

function okResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "OK",
    json: async () => body,
  };
}

function errResponse(body: unknown, status: number) {
  return {
    ok: false,
    status,
    statusText: "Error",
    json: async () => body,
  };
}

describe("SharedropApiClient — folder methods (flat-body, Bearer)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("createFolder POSTs /api/folders with Bearer + JSON body and returns the flat { folder }", async () => {
    const folder = {
      id: "f_1",
      name: "reports",
      title: "reports",
      parentId: null,
      path: "/f_1",
      nodeType: "folder",
      createdAt: "2026-07-12T00:00:00.000Z",
    };
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ folder }, 201));
    vi.stubGlobal("fetch", fetchMock);

    const client = newClient();
    const out = await client.createFolder({ name: "reports", parentId: null });

    expect(out.folder).toEqual(folder);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://app.example.com/api/folders");
    expect(init.method).toBe("POST");
    expect(init.headers["Authorization"]).toBe("Bearer sd_test");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ name: "reports", parentId: null });
  });

  it("createFolder threads a parentId into the body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ folder: {} }, 201));
    vi.stubGlobal("fetch", fetchMock);

    await newClient().createFolder({ name: "2026", parentId: "f_parent" });
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ name: "2026", parentId: "f_parent" });
  });

  it("listTree GETs /api/tree/:username and returns the flat { pages }", async () => {
    const pages = [
      { id: "f_1", title: "reports", nodeType: "folder", parentId: null, path: "/f_1" },
      { id: "p_1", title: "hello", nodeType: "page", parentId: null, path: "/p_1" },
    ];
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ pages }, 200));
    vi.stubGlobal("fetch", fetchMock);

    const out = await newClient().listTree("scotto");
    expect(out.pages).toEqual(pages);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://app.example.com/api/tree/scotto");
    expect(init.method).toBe("GET");
    expect(init.headers["Authorization"]).toBe("Bearer sd_test");
  });

  it("deleteFolder without force DELETEs /api/folders/:id (no force query)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ success: true, pages: 0, folders: 0 }, 200));
    vi.stubGlobal("fetch", fetchMock);

    const out = await newClient().deleteFolder("f_1", false);
    expect(out).toEqual({ success: true, pages: 0, folders: 0 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://app.example.com/api/folders/f_1");
    expect(init.method).toBe("DELETE");
    expect(init.headers["Authorization"]).toBe("Bearer sd_test");
  });

  it("deleteFolder with force appends ?force=true", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ success: true, pages: 3, folders: 1 }, 200));
    vi.stubGlobal("fetch", fetchMock);

    const out = await newClient().deleteFolder("f_1", true);
    expect(out).toEqual({ success: true, pages: 3, folders: 1 });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("https://app.example.com/api/folders/f_1?force=true");
  });

  it("deleteFolder maps a 409 to FOLDER_NOT_EMPTY carrying the counts", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        errResponse({ error: "This folder is not empty.", pages: 2, folders: 1 }, 409),
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = newClient();
    await expect(client.deleteFolder("f_1", false)).rejects.toMatchObject({
      code: "FOLDER_NOT_EMPTY",
      status: 409,
      details: { pages: 2, folders: 1 },
    });
  });

  it("movePage PUTs /api/pages/:id with { parentId } (null allowed)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ page: { id: "p_1" } }, 200));
    vi.stubGlobal("fetch", fetchMock);

    await newClient().movePage("p_1", null);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://app.example.com/api/pages/p_1");
    expect(init.method).toBe("PUT");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ parentId: null });
  });

  it("updateFolder PATCHes /api/folders/:id with a rename body", async () => {
    const folder = {
      id: "f_1",
      name: "invoices",
      title: "invoices",
      parentId: null,
      path: "/f_1",
      nodeType: "folder",
      createdAt: "2026-07-12T00:00:00.000Z",
    };
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ folder }, 200));
    vi.stubGlobal("fetch", fetchMock);

    const out = await newClient().updateFolder("f_1", { name: "invoices" });
    expect(out.folder).toEqual(folder);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://app.example.com/api/folders/f_1");
    expect(init.method).toBe("PATCH");
    expect(init.headers["Authorization"]).toBe("Bearer sd_test");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ name: "invoices" });
  });

  it("updateFolder PATCHes a reparent body ({ parentId }, null allowed)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ folder: {} }, 200));
    vi.stubGlobal("fetch", fetchMock);

    await newClient().updateFolder("f_1", { parentId: null });
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ parentId: null });
  });

  it("updateFolder preserves FOLDERS_RESTRICTED on a free-tier reparent", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        errResponse(
          { error: "Folders require a Pro plan or higher.", code: "FOLDERS_RESTRICTED" },
          403,
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      newClient().updateFolder("f_1", { parentId: "f_2" }),
    ).rejects.toMatchObject({ code: "FOLDERS_RESTRICTED", status: 403 });
  });

  it("restoreNode POSTs /api/trash/:id/restore", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ success: true, reparentedToRoot: false }, 200));
    vi.stubGlobal("fetch", fetchMock);

    const out = await newClient().restoreNode("n_1");
    expect(out).toEqual({ success: true, reparentedToRoot: false });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://app.example.com/api/trash/n_1/restore");
    expect(init.method).toBe("POST");
    expect(init.headers["Authorization"]).toBe("Bearer sd_test");
  });

  it("listTrash GETs /api/trash and returns the flat { items }", async () => {
    const items = [{ id: "p_1", title: "old", nodeType: "page", parentId: null, path: "/p_1" }];
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ items }, 200));
    vi.stubGlobal("fetch", fetchMock);

    const out = await newClient().listTrash();
    expect(out.items).toEqual(items);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://app.example.com/api/trash");
    expect(init.method).toBe("GET");
  });

  it("preserves a non-409 flat error code verbatim (FOLDERS_RESTRICTED 403)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        errResponse(
          { error: "Folders require a Pro plan or higher.", code: "FOLDERS_RESTRICTED" },
          403,
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = newClient();
    await expect(client.createFolder({ name: "x" })).rejects.toMatchObject({
      code: "FOLDERS_RESTRICTED",
      status: 403,
      message: "Folders require a Pro plan or higher.",
    });
    expect(client.createFolder).toBeInstanceOf(Function);
    // Ensure the thrown value is a SharedropApiError instance.
    await expect(client.createFolder({ name: "x" })).rejects.toBeInstanceOf(SharedropApiError);
  });
});
