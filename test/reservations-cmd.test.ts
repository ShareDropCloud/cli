// #198 Phase 31 (31-03) Tasks 2 & 3 — reserve verb, reservations group,
// formatters, and the drop/upload --to claim ergonomics.
//
// Auth resolution is mocked so the commands build a client without touching
// env/config; client methods are spied on the prototype. Human (TTY) output is
// forced on where a formatter's non-JSON branch is under test. The one-time
// claim token is asserted to appear in `reserve` output with its store-now
// warning, and to NEVER appear in `reservations list` output.

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
  reserveCommand,
  reservationsListCommand,
  reservationsRevokeCommand,
  resolveReservationTarget,
} from "../src/commands/reservation.js";
import { uploadFileStreamed, uploadCommand } from "../src/commands/upload.js";
import {
  formatReservationCreated,
  formatReservationList,
  formatReservationRevoked,
} from "../src/output/format.js";
import type { Reservation } from "../src/client/types.js";

const EM_DASH = "—";

const sampleReservation: Reservation = {
  id: "rsv_1",
  slug: "weekly-metrics",
  title: "Weekly metrics",
  description: null,
  intended_agent_name: "metrics-bot",
  visibility: "private",
  mode: "static",
  watermark_enabled: false,
  status: "reserved",
  claimed_page_id: null,
  url: "/alice/weekly-metrics",
  full_url: "https://app.example.com/alice/weekly-metrics",
  expires_at: null,
  created_at: "2026-07-19T00:00:00.000Z",
  updated_at: "2026-07-19T00:00:00.000Z",
};

function silenceLog() {
  return vi.spyOn(console, "log").mockImplementation(() => {});
}

function writeTmpFile(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "sharedrop-cli-reserve-test-"));
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

function forceTTY(): (() => void) {
  const prev = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  return () => {
    if (prev) Object.defineProperty(process.stdout, "isTTY", prev);
  };
}

describe("reserveCommand — create + one-time token reveal", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("maps flags to the snake_case create body (agent-name -> intended_agent_name)", async () => {
    const create = vi
      .spyOn(SharedropApiClient.prototype, "createReservation")
      .mockResolvedValue({ reservation: sampleReservation, claim_token: "sdr_secret" });
    silenceLog();

    await reserveCommand(
      { title: "Weekly metrics", agentName: "metrics-bot", visibility: "private", json: true },
      {},
    );

    expect(create).toHaveBeenCalledWith({
      title: "Weekly metrics",
      intended_agent_name: "metrics-bot",
      visibility: "private",
    });
  });

  it("prints the claim token once with a store-now warning in human output", async () => {
    vi.spyOn(SharedropApiClient.prototype, "createReservation").mockResolvedValue({
      reservation: sampleReservation,
      claim_token: "sdr_secret_value",
    });
    const restore = forceTTY();
    const log = silenceLog();
    try {
      await reserveCommand({ title: "Weekly metrics" }, {});
    } finally {
      restore();
    }
    const printed = log.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toContain("sdr_secret_value");
    expect(printed.toLowerCase()).toContain("once");
    // The one-time token must appear exactly once in the output.
    expect(printed.split("sdr_secret_value").length - 1).toBe(1);
  });

  it("--json emits the raw { reservation, claim_token } structure", async () => {
    vi.spyOn(SharedropApiClient.prototype, "createReservation").mockResolvedValue({
      reservation: sampleReservation,
      claim_token: "sdr_secret",
    });
    const log = silenceLog();
    await reserveCommand({ title: "Weekly metrics", json: true }, {});
    const printed = JSON.parse(log.mock.calls[0][0] as string);
    expect(printed).toEqual({ reservation: sampleReservation, claim_token: "sdr_secret" });
  });
});

describe("reservationsListCommand — table, no token leak", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("lists reservations and never prints an sdr_ token", async () => {
    vi.spyOn(SharedropApiClient.prototype, "listReservations").mockResolvedValue({
      data: [sampleReservation],
      pagination: { next_cursor: null, has_more: false },
    });
    const restore = forceTTY();
    const log = silenceLog();
    try {
      await reservationsListCommand({}, {});
    } finally {
      restore();
    }
    const printed = log.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toContain("weekly-metrics");
    expect(printed).toContain("reserved");
    expect(printed).not.toContain("sdr_");
  });

  it("--json emits the enveloped list without any claim token", async () => {
    vi.spyOn(SharedropApiClient.prototype, "listReservations").mockResolvedValue({
      data: [sampleReservation],
      pagination: { next_cursor: null, has_more: false },
    });
    const log = silenceLog();
    await reservationsListCommand({ json: true }, {});
    const raw = log.mock.calls[0][0] as string;
    expect(raw).not.toContain("sdr_");
    const printed = JSON.parse(raw);
    expect(printed.data[0].slug).toBe("weekly-metrics");
    expect(printed.data[0]).not.toHaveProperty("claim_token");
  });

  it("forwards --cursor and --limit to listReservations (WR-01)", async () => {
    const list = vi
      .spyOn(SharedropApiClient.prototype, "listReservations")
      .mockResolvedValue({ data: [], pagination: { next_cursor: null, has_more: false } });
    silenceLog();
    await reservationsListCommand({ json: true, cursor: "rsv_9", limit: "25" }, {});
    expect(list).toHaveBeenCalledWith({ cursor: "rsv_9", limit: 25 });
  });
});

describe("reservationsRevokeCommand", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("revokes by id and confirms", async () => {
    const revoke = vi
      .spyOn(SharedropApiClient.prototype, "revokeReservation")
      .mockResolvedValue({ reservation: { ...sampleReservation, status: "revoked" } });
    const log = silenceLog();
    await reservationsRevokeCommand("rsv_1", { json: true }, {});
    expect(revoke).toHaveBeenCalledWith("rsv_1");
    const printed = JSON.parse(log.mock.calls[0][0] as string);
    expect(printed.data.status).toBe("revoked");
  });

  it("surfaces a 404 and exits non-zero", async () => {
    vi.spyOn(SharedropApiClient.prototype, "revokeReservation").mockRejectedValue(
      new SharedropApiError("NOT_FOUND", "Reservation not found", 404),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);

    await expect(reservationsRevokeCommand("rsv_x", { json: true }, {})).rejects.toThrow("exit:5");
    exit.mockRestore();
  });
});

describe("resolveReservationTarget — slug vs id resolution (Task 3)", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  function newClient(): SharedropApiClient {
    return new SharedropApiClient({ apiKey: "sd_test", baseUrl: "https://app.example.com" });
  }

  it("passes a uuid value straight through without listing", async () => {
    const list = vi.spyOn(SharedropApiClient.prototype, "listReservations");
    const id = "11111111-2222-4333-8444-555555555555";
    const out = await resolveReservationTarget(newClient(), id);
    expect(out).toBe(id);
    expect(list).not.toHaveBeenCalled();
  });

  it("resolves an exact reserved slug to its id", async () => {
    vi.spyOn(SharedropApiClient.prototype, "listReservations").mockResolvedValue({
      data: [sampleReservation],
      pagination: { next_cursor: null, has_more: false },
    });
    const out = await resolveReservationTarget(newClient(), "weekly-metrics");
    expect(out).toBe("rsv_1");
  });

  it("ignores a same-slug entry that is not status reserved", async () => {
    vi.spyOn(SharedropApiClient.prototype, "listReservations").mockResolvedValue({
      data: [{ ...sampleReservation, status: "claimed" }],
      pagination: { next_cursor: null, has_more: false },
    });
    await expect(
      resolveReservationTarget(newClient(), "weekly-metrics"),
    ).rejects.toMatchObject({ code: "RESERVATION_NOT_FOUND" });
  });

  it("throws RESERVATION_NOT_FOUND with a hint when no slug matches", async () => {
    vi.spyOn(SharedropApiClient.prototype, "listReservations").mockResolvedValue({
      data: [],
      pagination: { next_cursor: null, has_more: false },
    });
    await expect(
      resolveReservationTarget(newClient(), "nope"),
    ).rejects.toMatchObject({ code: "RESERVATION_NOT_FOUND", status: 404 });
  });

  it("walks pagination to resolve an older reserved slug past page 1 (WR-02)", async () => {
    const list = vi
      .spyOn(SharedropApiClient.prototype, "listReservations")
      .mockResolvedValueOnce({
        data: [{ ...sampleReservation, id: "rsv_new", slug: "newest" }],
        pagination: { next_cursor: "rsv_new", has_more: true },
      })
      .mockResolvedValueOnce({
        data: [{ ...sampleReservation, id: "rsv_old", slug: "older-one" }],
        pagination: { next_cursor: null, has_more: false },
      });
    const out = await resolveReservationTarget(newClient(), "older-one");
    expect(out).toBe("rsv_old");
    expect(list).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenNthCalledWith(2, { limit: 100, cursor: "rsv_new" });
  });
});

describe("upload --to — reservation claim threading (Task 3)", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  function newClient(): SharedropApiClient {
    return new SharedropApiClient({ apiKey: "sd_test", baseUrl: "https://app.example.com" });
  }

  function stubPipeline(client: SharedropApiClient) {
    const sign = vi.spyOn(client, "signUpload").mockResolvedValue({
      upload_url: "https://uploads.example.com/k",
      upload_token: "tkn",
      finalize_url: "https://app.example.com/api/upload/finalize",
      object_key: "k",
    });
    vi.spyOn(client, "streamUpload").mockResolvedValue(undefined);
    vi.spyOn(client, "finalizeUpload").mockResolvedValue({
      url: "/alice/weekly-metrics",
      page_id: "p",
      slug: "weekly-metrics",
      visibility: "private",
      mode: "static",
      kind: "html",
      contentType: "text/html",
    });
    return sign;
  }

  it("threads reservationId into signUpload as reservation_id, leaving finalize untouched", async () => {
    const client = newClient();
    const sign = stubPipeline(client);
    const finalize = vi.spyOn(client, "finalizeUpload");
    const file = writeTmpFile("a.html", "<p>x</p>");

    await uploadFileStreamed(client, file, { reservationId: "rsv_1" });

    expect(sign).toHaveBeenCalledWith(expect.objectContaining({ reservation_id: "rsv_1" }));
    const finalizeArg = finalize.mock.calls[0][0];
    expect(finalizeArg).not.toHaveProperty("reservation_id");
  });

  it("omits reservation_id from sign when no reservation is claimed", async () => {
    const client = newClient();
    const sign = stubPipeline(client);
    const file = writeTmpFile("a.html", "<p>x</p>");

    await uploadFileStreamed(client, file, {});
    const signArg = sign.mock.calls[0][0];
    expect(signArg).not.toHaveProperty("reservation_id");
  });
});

describe("uploadCommand --to conflict guards (WR-03)", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("rejects --to + --page-id pre-flight without signing", async () => {
    const sign = vi.spyOn(SharedropApiClient.prototype, "signUpload");
    const resolve = vi.spyOn(SharedropApiClient.prototype, "listReservations");
    silenceLog();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    const file = writeTmpFile("a.html", "<p>x</p>");

    await expect(
      uploadCommand(file, { to: "weekly-metrics", pageId: "p_1", json: true }, {}),
    ).rejects.toThrow(/exit:/);
    const printed = JSON.parse(err.mock.calls[0][0] as string);
    expect(printed.error.code).toBe("VALIDATION_ERROR");
    expect(sign).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    exit.mockRestore();
  });
});

describe("reservation formatters — em-dash copy rule", () => {
  it("no reservation formatter emits an em dash in human (TTY) output", () => {
    const restore = forceTTY();
    try {
      const strings = [
        formatReservationCreated(
          { reservation: sampleReservation, claim_token: "sdr_x" },
          {},
        ),
        formatReservationList([sampleReservation], { next_cursor: null, has_more: false }, {}),
        formatReservationList([], { next_cursor: null, has_more: false }, {}),
        formatReservationRevoked({ ...sampleReservation, status: "revoked" }, {}),
      ];
      for (const s of strings) {
        expect(s).not.toContain(EM_DASH);
      }
    } finally {
      restore();
    }
  });
});
