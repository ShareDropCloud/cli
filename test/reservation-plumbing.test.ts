// Phase 31 / RES-ME-1 — CLI shared reservation plumbing.
//
// Locks two contracts:
//   1. signUpload carries an optional reservation_id into the /api/upload/sign
//      JSON body (present when set, absent when omitted) with zero method-body
//      change — the field flows through JSON.stringify(params).
//   2. formatWhoami renders a reserved-addresses line only when the server
//      advertises the reservations entitlement, degrading silently against
//      older servers, and renders the -1 cap as "unlimited". No em dashes.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SharedropApiClient } from "../src/client/api-client.js";
import { formatWhoami } from "../src/output/format.js";
import type { V1MeResponse } from "../src/client/types.js";

function newClient(): SharedropApiClient {
  return new SharedropApiClient({
    apiKey: "sd_test",
    baseUrl: "https://app.example.com",
  });
}

function signOkResponse(): Response {
  return new Response(
    JSON.stringify({
      upload_url: "https://uploads.example.com/OBJ",
      upload_token: "tkn_test",
      finalize_url: "https://app.example.com/api/upload/finalize",
      object_key: "OBJ",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("signUpload — reservation_id passthrough (RES-ME-1)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends reservation_id in the POST /api/upload/sign body when set", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(signOkResponse());

    await newClient().signUpload({
      filename: "report.html",
      content_type: "text/html",
      size_bytes: 1234,
      reservation_id: "rsv_abc",
    });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.reservation_id).toBe("rsv_abc");
  });

  it("omits reservation_id from the body when not set", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(signOkResponse());

    await newClient().signUpload({
      filename: "report.html",
      content_type: "text/html",
      size_bytes: 1234,
    });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect("reservation_id" in body).toBe(false);
  });
});

describe("formatWhoami — reserved-addresses line (RES-ME-1)", () => {
  // formatWhoami emits JSON when stdout is not a TTY (shouldOutputJson). Force
  // TTY so the human-readable line rendering is exercised.
  const originalIsTTY = process.stdout.isTTY;
  beforeEach(() => {
    process.stdout.isTTY = true;
  });
  afterEach(() => {
    process.stdout.isTTY = originalIsTTY;
  });

  const baseMe: V1MeResponse = {
    username: "alice",
    email: "alice@example.com",
    tier: "free",
    pages_used: 3,
    pages_limit: 25,
    storage_used: 512,
  };

  it("renders remaining-of-cap when the server advertises reservations", () => {
    const me: V1MeResponse = {
      ...baseMe,
      entitlements: {
        maxFileSizeBytes: 10 * 1024 * 1024,
        allowedVisibilities: ["public", "private"],
        maxVersionRetention: 0,
        reservations: { enabled: true, maxReservations: 2, remaining: 2 },
      },
    };
    const out = formatWhoami(me, "https://app.example.com", { json: false });
    expect(out).toContain("Reserved:");
    expect(out).toContain("2 of 2 remaining");
  });

  it("renders unlimited when maxReservations is -1", () => {
    const me: V1MeResponse = {
      ...baseMe,
      entitlements: {
        maxFileSizeBytes: 100 * 1024 * 1024,
        allowedVisibilities: ["public", "private", "shared"],
        maxVersionRetention: 25,
        reservations: { enabled: true, maxReservations: -1, remaining: -1 },
      },
    };
    const out = formatWhoami(me, "https://app.example.com", { json: false });
    expect(out).toContain("Reserved:");
    expect(out).toContain("unlimited");
  });

  it("omits the reserved line entirely against an older server (no reservations field)", () => {
    const out = formatWhoami(baseMe, "https://app.example.com", { json: false });
    expect(out).not.toContain("Reserved:");
  });

  it("adds no em dash to any output line", () => {
    const me: V1MeResponse = {
      ...baseMe,
      entitlements: {
        maxFileSizeBytes: 10 * 1024 * 1024,
        allowedVisibilities: ["public", "private"],
        maxVersionRetention: 0,
        reservations: { enabled: true, maxReservations: 2, remaining: 1 },
      },
    };
    const out = formatWhoami(me, "https://app.example.com", { json: false });
    expect(out.includes("—")).toBe(false);
  });
});
