// #207 — `sharedrop download <id>` is kind-aware. An archive-kind page downloads
// its RAW bytes via GET /api/archives/:id/download (302 -> presigned octet-stream
// URL); every other kind keeps the existing v1 zip path byte-for-byte.
//
// Mirrors move-cmd.test.ts: auth is mocked so the command builds a client with no
// env/config, and client methods are spied on the prototype (the command
// constructs its own client). node:fs is mocked so the file write is capturable
// without touching disk. The client-unit block stubs global fetch to assert the
// downloadArchive wire contract.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Writable } from "node:stream";

vi.mock("../src/auth/resolve.js", () => ({
  resolveAuth: vi.fn(async () => ({ token: "sd_test", source: "flag" })),
  resolveBaseUrl: vi.fn(() => "https://app.example.com"),
}));

vi.mock("node:fs", () => ({
  writeFileSync: vi.fn(),
  createWriteStream: vi.fn(),
  statSync: vi.fn(() => ({ size: 8 })),
}));

import { writeFileSync, createWriteStream, statSync } from "node:fs";
import { SharedropApiClient, SharedropApiError } from "../src/client/api-client.js";
import { downloadCommand } from "../src/commands/download.js";

function silenceLog() {
  return vi.spyOn(console, "log").mockImplementation(() => {});
}

/** A real in-memory sink so pipeline() has a valid Writable to stream into. */
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

describe("downloadCommand — kind-aware download", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // node:fs is a module mock, so call counts survive restoreAllMocks — clear.
    vi.mocked(writeFileSync).mockClear();
    vi.mocked(createWriteStream).mockClear();
    vi.mocked(statSync).mockReturnValue({ size: 8 } as never);
  });
  afterEach(() => vi.restoreAllMocks());

  it("A: archive kind STREAMS raw bytes to a filename-like title by page.id, never the zip route", async () => {
    vi.spyOn(SharedropApiClient.prototype, "getPage").mockResolvedValue({
      id: "p_arc_id",
      title: "backup.tar.gz",
      kind: "archive",
    } as never);
    const arc = vi
      .spyOn(SharedropApiClient.prototype, "openArchiveDownload")
      .mockResolvedValue(new Response("rawbytes", { status: 200 }));
    const zip = vi.spyOn(SharedropApiClient.prototype, "downloadPage");
    const { sink, chunks } = collector();
    vi.mocked(createWriteStream).mockReturnValue(sink as never);
    const log = silenceLog();

    // ref is a slug, but the download must go by the RESOLVED page.id (Fable #9).
    await downloadCommand("backup-slug", {}, {});

    expect(arc).toHaveBeenCalledWith("p_arc_id");
    expect(zip).not.toHaveBeenCalled();
    expect(createWriteStream).toHaveBeenCalledWith("backup.tar.gz");
    expect(Buffer.concat(chunks).toString()).toBe("rawbytes");
    expect(writeFileSync).not.toHaveBeenCalled(); // never buffered in memory
    expect(log).toHaveBeenCalled();
  });

  it("B: archive with a non-filename-like title falls back to the bare ref (no .zip)", async () => {
    vi.spyOn(SharedropApiClient.prototype, "getPage").mockResolvedValue({
      id: "p_arc_id",
      title: "My big backup",
      kind: "archive",
    } as never);
    vi.spyOn(SharedropApiClient.prototype, "openArchiveDownload").mockResolvedValue(
      new Response("rawbytes", { status: 200 }),
    );
    const { sink } = collector();
    vi.mocked(createWriteStream).mockReturnValue(sink as never);
    silenceLog();

    await downloadCommand("p_arc", {}, {});

    expect(createWriteStream).toHaveBeenCalledWith("p_arc");
  });

  it("C: archive with --output - streams raw bytes to stdout, no log line", async () => {
    vi.spyOn(SharedropApiClient.prototype, "getPage").mockResolvedValue({
      id: "p_arc_id",
      title: "backup.tar.gz",
      kind: "archive",
    } as never);
    vi.spyOn(SharedropApiClient.prototype, "openArchiveDownload").mockResolvedValue(
      new Response("rawbytes", { status: 200 }),
    );
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const log = silenceLog();

    await downloadCommand("p_arc", { output: "-" }, {});

    expect(stdout).toHaveBeenCalled();
    expect(Buffer.concat(stdout.mock.calls.map((c) => Buffer.from(c[0] as Buffer))).toString()).toBe(
      "rawbytes",
    );
    expect(createWriteStream).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("D: html kind keeps the zip path (downloadPage, default <ref>.zip), never the archive lane", async () => {
    vi.spyOn(SharedropApiClient.prototype, "getPage").mockResolvedValue({
      id: "p_html",
      title: "report",
      kind: "html",
    } as never);
    const zip = vi
      .spyOn(SharedropApiClient.prototype, "downloadPage")
      .mockResolvedValue(Buffer.from("zipbytes"));
    const arc = vi.spyOn(SharedropApiClient.prototype, "openArchiveDownload");
    silenceLog();

    await downloadCommand("p_html", {}, {});

    expect(zip).toHaveBeenCalledWith("p_html");
    expect(arc).not.toHaveBeenCalled();
    expect(writeFileSync).toHaveBeenCalledWith("p_html.zip", Buffer.from("zipbytes"));
  });

  it("E: kind absent (older server) falls back to the zip path", async () => {
    vi.spyOn(SharedropApiClient.prototype, "getPage").mockResolvedValue({
      id: "p_old",
      title: "report",
    } as never);
    const zip = vi
      .spyOn(SharedropApiClient.prototype, "downloadPage")
      .mockResolvedValue(Buffer.from("zipbytes"));
    const arc = vi.spyOn(SharedropApiClient.prototype, "openArchiveDownload");
    silenceLog();

    await downloadCommand("p_old", {}, {});

    expect(zip).toHaveBeenCalledWith("p_old");
    expect(arc).not.toHaveBeenCalled();
    expect(writeFileSync).toHaveBeenCalledWith("p_old.zip", Buffer.from("zipbytes"));
  });
});

describe("SharedropApiClient.openArchiveDownload — wire contract", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  function newClient(): SharedropApiClient {
    return new SharedropApiClient({
      apiKey: "sd_test",
      baseUrl: "https://app.example.com",
    });
  }

  it("fetches /api/archives/:id/download with the Bearer header and returns the OK Response (no buffering)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("rawbytes", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await newClient().openArchiveDownload("p1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://app.example.com/api/archives/p1/download");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer sd_test");
    expect(res.ok).toBe(true);
    expect(await res.text()).toBe("rawbytes");
  });

  it("maps a 404 flat body to SharedropApiError (status 404, message 'Not found')", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Not found" }), { status: 404 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(newClient().openArchiveDownload("p1")).rejects.toMatchObject({
      name: "SharedropApiError",
      status: 404,
      message: "Not found",
    });
    expect(SharedropApiError).toBeDefined();
  });
});
