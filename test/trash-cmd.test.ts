import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/auth/resolve.js", () => ({
  resolveAuth: vi.fn(async () => ({ token: "sd_test", source: "flag" })),
  resolveBaseUrl: vi.fn(() => "https://app.example.com"),
}));

import { resolveAuth } from "../src/auth/resolve.js";
import { SharedropApiClient, SharedropApiError } from "../src/client/api-client.js";
import { trashEmptyCommand } from "../src/commands/trash.js";
import { handleError } from "../src/output/errors.js";

function forceTTY(): () => void {
  const previous = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process.stdout, "isTTY", {
    value: true,
    configurable: true,
  });
  return () => {
    if (previous) Object.defineProperty(process.stdout, "isTTY", previous);
  };
}

function mockExit() {
  return vi
    .spyOn(process, "exit")
    .mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
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

describe("trash empty command", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("requires authentication before calling the API", async () => {
    vi.mocked(resolveAuth).mockResolvedValueOnce(null);
    const empty = vi.spyOn(SharedropApiClient.prototype, "emptyTrash");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = mockExit();

    await expect(trashEmptyCommand({ json: true }, {})).rejects.toThrow("exit:2");

    expect(exit).toHaveBeenCalledWith(2);
    expect(empty).not.toHaveBeenCalled();
  });

  it("calls emptyTrash exactly once and prints count plus formatted bytes for humans", async () => {
    const empty = vi
      .spyOn(SharedropApiClient.prototype, "emptyTrash")
      .mockResolvedValue({ success: true, purged: 3, freedBytes: 1024 });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const restoreTTY = forceTTY();

    try {
      await trashEmptyCommand({}, {});
    } finally {
      restoreTTY();
    }

    expect(empty).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toContain("3 items");
    expect(String(log.mock.calls[0][0])).toContain("1.0 KB");
  });

  it("--json preserves numeric purged and freedBytes values", async () => {
    vi.spyOn(SharedropApiClient.prototype, "emptyTrash").mockResolvedValue({
      success: true,
      purged: 2,
      freedBytes: 4096,
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await trashEmptyCommand({ json: true }, {});

    expect(JSON.parse(log.mock.calls[0][0] as string)).toEqual({
      success: true,
      purged: 2,
      freedBytes: 4096,
    });
  });

  it("routes API failures through the normal structured error exit", async () => {
    vi.spyOn(SharedropApiClient.prototype, "emptyTrash").mockRejectedValue(
      new SharedropApiError("NOT_FOUND", "Trash endpoint not found", 404),
    );
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = mockExit();

    await expect(trashEmptyCommand({ json: true }, {})).rejects.toThrow("exit:5");

    expect(exit).toHaveBeenCalledWith(5);
    expect(JSON.parse(errorLog.mock.calls[0][0] as string)).toEqual({
      error: { code: "NOT_FOUND", message: "Trash endpoint not found" },
    });
  });
});

describe("trash-aware STORAGE_LIMIT terminal output", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("adds Empty trash guidance only when trashedGb is positive", () => {
    const restoreTTY = forceTTY();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    mockExit();
    const envelope = {
      code: "STORAGE_LIMIT" as const,
      message: "Storage limit reached",
      currentTier: "pro" as const,
      currentUsageGb: 25,
      trashedGb: 2.5,
      capGb: 25,
      upgradeUrl: "https://app.example.com/settings/billing",
      pricing,
    };

    try {
      expect(() =>
        handleError(
          new SharedropApiError("STORAGE_LIMIT", envelope.message, 402, envelope),
          {},
        ),
      ).toThrow("exit:7");
      expect(String(errorLog.mock.calls[0][0])).toContain(
        "Trash: 2.5 GB. Empty trash to release it.",
      );

      errorLog.mockClear();
      expect(() =>
        handleError(
          new SharedropApiError(
            "STORAGE_LIMIT",
            envelope.message,
            402,
            { ...envelope, trashedGb: 0 },
          ),
          {},
        ),
      ).toThrow("exit:7");
      expect(String(errorLog.mock.calls[0][0])).not.toContain("Trash:");
    } finally {
      restoreTTY();
    }
  });
});
