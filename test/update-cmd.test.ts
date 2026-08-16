import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../src/auth/resolve.js", () => ({
  resolveAuth: vi.fn(async () => ({ token: "sd_test", source: "flag" })),
  resolveBaseUrl: vi.fn(() => "https://app.example.com"),
}));

import { SharedropApiClient } from "../src/client/api-client.js";
import { updateCommand } from "../src/commands/update.js";

afterEach(() => vi.restoreAllMocks());

describe("updateCommand", () => {
  it("passes --slug through the page PATCH", async () => {
    const update = vi.spyOn(SharedropApiClient.prototype, "updatePage").mockResolvedValue({
      id: "11111111-2222-4333-8444-555555555555",
      slug: "weekly-metrics",
      title: "Weekly metrics",
      mode: "static",
      kind: "html",
      file_size: 42,
      visibility: "public",
      url: "/alice/weekly-metrics",
      full_url: "https://app.example.com/alice/weekly-metrics",
      created_at: "2026-08-14T00:00:00.000Z",
      updated_at: "2026-08-14T00:00:00.000Z",
    });
    vi.spyOn(console, "log").mockImplementation(() => {});

    await updateCommand(
      "11111111-2222-4333-8444-555555555555",
      undefined,
      { slug: "weekly-metrics", json: true },
      {},
    );

    expect(update).toHaveBeenCalledWith(
      "11111111-2222-4333-8444-555555555555",
      { slug: "weekly-metrics" },
    );
  });
});
