// #198 Phase 31 (31-03) Task 1 — CLI api-client reservation methods.
//
// Reservation routes are ENVELOPED v1 routes ({ data } / { data, pagination }),
// so createReservation / listReservations / revokeReservation MUST route through
// the request<T> / requestList<T> spine (the .data-unwrapping helpers), NEVER the
// flat folderFetch spine. This suite mocks global.fetch and asserts the URL,
// verb, Bearer + JSON headers, exact create body (only-defined keys), the
// envelope unwrap, and the 402 billing-code propagation on create.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SharedropApiClient, SharedropApiError } from "../src/client/api-client.js";
import type { Reservation } from "../src/client/types.js";

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

describe("SharedropApiClient — reservation methods (enveloped, Bearer)", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("createReservation POSTs /api/v1/reservations with Bearer + JSON and unwraps { reservation, claim_token }", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        okResponse({ data: { reservation: sampleReservation, claim_token: "sdr_secret" } }, 201),
      );
    vi.stubGlobal("fetch", fetchMock);

    const out = await newClient().createReservation({
      title: "Weekly metrics",
      intended_agent_name: "metrics-bot",
    });

    expect(out.reservation).toEqual(sampleReservation);
    expect(out.claim_token).toBe("sdr_secret");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://app.example.com/api/v1/reservations");
    expect(init.method).toBe("POST");
    expect(init.headers["Authorization"]).toBe("Bearer sd_test");
    expect(init.headers["Content-Type"]).toBe("application/json");
    // Only the provided keys ride the body — no explicit undefined fields.
    expect(JSON.parse(init.body)).toEqual({
      title: "Weekly metrics",
      intended_agent_name: "metrics-bot",
    });
  });

  it("createReservation sends only-defined keys (drops undefined flags)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        okResponse({ data: { reservation: sampleReservation, claim_token: "sdr_x" } }, 201),
      );
    vi.stubGlobal("fetch", fetchMock);

    await newClient().createReservation({
      title: "T",
      description: undefined,
      visibility: "public",
      mode: undefined,
      expires_at: "2026-08-01T00:00:00.000Z",
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      title: "T",
      visibility: "public",
      expires_at: "2026-08-01T00:00:00.000Z",
    });
  });

  it("createReservation surfaces a 402 as SharedropApiError with the billing code + envelope", async () => {
    const envelope = {
      code: "TIER_LIMIT",
      message: "You have reached your reservation limit.",
      currentTier: "free",
      requiredTier: "pro",
      upgradeUrl: "https://sharedrop.cloud/pricing",
      pricing: {},
    };
    const fetchMock = vi.fn().mockResolvedValue(errResponse({ error: envelope }, 402));
    vi.stubGlobal("fetch", fetchMock);

    const client = newClient();
    await expect(client.createReservation({ title: "T" })).rejects.toMatchObject({
      code: "TIER_LIMIT",
      status: 402,
    });
    await expect(client.createReservation({ title: "T" })).rejects.toBeInstanceOf(
      SharedropApiError,
    );
    // The billing envelope is attached so handleError can render the 402 block.
    try {
      await client.createReservation({ title: "T" });
    } catch (err) {
      expect((err as SharedropApiError).envelope).toBeDefined();
      expect((err as SharedropApiError).envelope?.code).toBe("TIER_LIMIT");
    }
  });

  it("listReservations GETs /api/v1/reservations and returns { data, pagination }", async () => {
    const pagination = { next_cursor: "cur_2", has_more: true };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ data: [sampleReservation], pagination }, 200));
    vi.stubGlobal("fetch", fetchMock);

    const out = await newClient().listReservations();
    expect(out.data).toEqual([sampleReservation]);
    expect(out.pagination).toEqual(pagination);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://app.example.com/api/v1/reservations");
    expect(init.headers["Authorization"]).toBe("Bearer sd_test");
  });

  it("revokeReservation POSTs /api/v1/reservations/:id/revoke and unwraps { reservation }", async () => {
    const revoked = { ...sampleReservation, status: "revoked" };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ data: { reservation: revoked } }, 200));
    vi.stubGlobal("fetch", fetchMock);

    const out = await newClient().revokeReservation("rsv_1");
    expect(out.reservation.status).toBe("revoked");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://app.example.com/api/v1/reservations/rsv_1/revoke");
    expect(init.method).toBe("POST");
    expect(init.headers["Authorization"]).toBe("Bearer sd_test");
  });

  it("revokeReservation maps a 404 (foreign or terminal) to a NOT_FOUND SharedropApiError", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        errResponse({ error: { code: "NOT_FOUND", message: "Reservation not found" } }, 404),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(newClient().revokeReservation("rsv_missing")).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });
});
