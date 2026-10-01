// #296, `sharedrop fetch` wire contract: an ordinary page mints a fetch_url and
// returns its raw bytes; an archive surfaces the server's typed
// ARCHIVE_DOWNLOAD_REQUIRED; an unknown ref is a typed 404 (exit 5), never
// INTERNAL_ERROR.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SharedropApiClient } from "../src/client/api-client.js";
import { statusToExitCode, EXIT_CODES } from "../src/output/errors.js";

function newClient(): SharedropApiClient {
  return new SharedropApiClient({ apiKey: "sd_test", baseUrl: "https://app.example.com" });
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("SharedropApiClient.fetchPage (#296)", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("mints a fetch_url, then GETs it without the Bearer header and returns the raw bytes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        json(
          {
            data: {
              fetch_url: "https://view.example.com/api/fetch/p1?token=t",
              expires_at: "2026-09-26T00:05:00Z",
              content_type: "text/html",
              mode: "static",
              size: 11,
            },
          },
          200,
        ),
      )
      .mockResolvedValueOnce(new Response("<p>hello</p>", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const buf = await newClient().fetchPage("abc123");

    expect(fetchMock.mock.calls[0][0]).toBe("https://app.example.com/api/v1/pages/abc123/fetch");
    expect(fetchMock.mock.calls[1][0]).toBe("https://view.example.com/api/fetch/p1?token=t");
    expect(fetchMock.mock.calls[1][1]).toBeUndefined();
    expect(buf.toString()).toBe("<p>hello</p>");
  });

  it("surfaces an archive as a typed ARCHIVE_DOWNLOAD_REQUIRED error and never GETs a fetch_url", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      json(
        {
          error: {
            code: "ARCHIVE_DOWNLOAD_REQUIRED",
            message: "This page is an archive, so its raw content cannot be fetched.",
            download_url: "https://app.example.com/api/archives/p1/download",
          },
        },
        409,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(newClient().fetchPage("p1")).rejects.toMatchObject({
      name: "SharedropApiError",
      code: "ARCHIVE_DOWNLOAD_REQUIRED",
      status: 409,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps an unknown page to PAGE_NOT_FOUND with the not-found exit code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        json({ error: { code: "PAGE_NOT_FOUND", message: "Page not found" } }, 404),
      ),
    );

    const err = await newClient().fetchPage("nope").catch((e) => e);
    expect(err).toMatchObject({ code: "PAGE_NOT_FOUND", status: 404 });
    expect(statusToExitCode(err.status)).toBe(EXIT_CODES.NOT_FOUND);
  });
});
