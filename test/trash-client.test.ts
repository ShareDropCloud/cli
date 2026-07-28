import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SharedropApiClient, SharedropApiError } from "../src/client/api-client.js";

function newClient(): SharedropApiClient {
  return new SharedropApiClient({
    apiKey: "sd_test",
    baseUrl: "https://app.example.com",
  });
}

function response(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? "OK" : "Error",
    json: async () => body,
  };
}

const pricing = {
  pro: { monthly: 12, storageGb: 25, currency: "USD" as const },
  team: {
    bundle: { seats: 3, monthly: 29 },
    additionalPerSeat: 9,
    storagePerSeatGb: 25,
    currency: "USD" as const,
  },
  storageAddons: [{ blockGb: 25, monthly: 5 }],
};

describe("SharedropApiClient emptyTrash", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("DELETEs /api/trash with Bearer auth, no body, and returns the stable result", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(response({ success: true, purged: 4, freedBytes: 2048 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await newClient().emptyTrash();

    expect(result).toEqual({ success: true, purged: 4, freedBytes: 2048 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://app.example.com/api/trash");
    expect(init.method).toBe("DELETE");
    expect(init.headers.Authorization).toBe("Bearer sd_test");
    expect(init).not.toHaveProperty("body");
    expect(init.headers).not.toHaveProperty("Content-Type");
  });

  it("is idempotent when the server reports an already-empty trash", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({ success: true, purged: 0, freedBytes: 0 })),
    );

    await expect(newClient().emptyTrash()).resolves.toEqual({
      success: true,
      purged: 0,
      freedBytes: 0,
    });
  });

  it("maps a flat empty-trash failure to SharedropApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          response(
            { error: "Could not empty trash", code: "TRASH_EMPTY_FAILED" },
            500,
          ),
        ),
    );

    await expect(newClient().emptyTrash()).rejects.toMatchObject({
      code: "TRASH_EMPTY_FAILED",
      message: "Could not empty trash",
      status: 500,
    });
  });

  it("preserves the full nested restore STORAGE_LIMIT envelope", async () => {
    const envelope = {
      code: "STORAGE_LIMIT" as const,
      message: "Restoring this item would exceed your storage limit.",
      currentTier: "pro" as const,
      currentUsageGb: 24,
      trashedGb: 3.5,
      capGb: 25,
      recommendedAddonGb: 25 as const,
      upgradeUrl: "https://app.example.com/settings/billing",
      pricing,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({ error: envelope }, 402)),
    );

    try {
      await newClient().restoreNode("node_1");
      expect.fail("restoreNode should reject");
    } catch (error) {
      expect(error).toBeInstanceOf(SharedropApiError);
      expect(error).toMatchObject({
        code: "STORAGE_LIMIT",
        message: envelope.message,
        status: 402,
      });
      expect((error as SharedropApiError).envelope).toEqual(envelope);
    }
  });
});
