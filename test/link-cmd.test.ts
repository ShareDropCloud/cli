// #255 — `sharedrop link` commands: create (anyone / specific people), list,
// people, revoke. Auth resolution is mocked; client methods are spied on the
// prototype so the request bodies the commands build are asserted exactly.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../src/auth/resolve.js", () => ({
  resolveAuth: vi.fn(async () => ({ token: "sd_test", source: "flag" })),
  resolveBaseUrl: vi.fn(() => "https://app.example.com"),
}));

import { SharedropApiClient } from "../src/client/api-client.js";
import {
  linkCreateCommand,
  linkListCommand,
  linkPeopleCommand,
  linkRevokeCommand,
  parseDuration,
  parseEmailList,
} from "../src/commands/link.js";
import { formatLinkCreated, formatLinkList } from "../src/output/format.js";
import type { EphemeralLink } from "../src/client/types.js";

const EM_DASH = "—";

const sample: EphemeralLink = {
  id: "link-1",
  url: "https://app.example.com/alice/abc123?e=tok",
  token: "tok",
  audience: "people",
  emails: ["friend@example.com"],
  expires_at: "2026-09-27T00:00:00.000Z",
  max_views: 3,
  view_count: 1,
  present_only: false,
  status: "active",
  summary: "Expires in 24 hours or after 3 views, whichever comes first.",
};

function forceTTY(): () => void {
  const prev = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  return () => {
    if (prev) Object.defineProperty(process.stdout, "isTTY", prev);
  };
}

describe("parsers", () => {
  it("parses durations", () => {
    expect(parseDuration("30m")).toBe(1800);
    expect(parseDuration("12h")).toBe(43200);
    expect(parseDuration("7d")).toBe(604800);
    expect(parseDuration("90")).toBe(90);
    expect(() => parseDuration("soon")).toThrow(/Invalid --expires-in/);
    expect(() => parseDuration("0h")).toThrow(/Invalid --expires-in/);
  });

  it("flattens and lowercases email lists", () => {
    expect(parseEmailList(["A@x.com,b@x.com", "c@x.com a@x.com"])).toEqual([
      "a@x.com",
      "b@x.com",
      "c@x.com",
    ]);
    expect(parseEmailList(undefined)).toEqual([]);
  });
});

describe("link commands", () => {
  let log: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.restoreAllMocks();
    log = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("create without --people makes an 'anyone' link", async () => {
    const create = vi
      .spyOn(SharedropApiClient.prototype, "createEphemeralLink")
      .mockResolvedValue({ ...sample, audience: "anyone", emails: [] });

    await linkCreateCommand("abc123", { maxViews: "5", json: true });

    expect(create).toHaveBeenCalledWith("abc123", {
      audience: "anyone",
      emails: undefined,
      notify: undefined,
      expires_in_seconds: undefined,
      max_views: 5,
      present_only: undefined,
    });
  });

  it("create with --people makes a 'people' link for those emails", async () => {
    const create = vi
      .spyOn(SharedropApiClient.prototype, "createEphemeralLink")
      .mockResolvedValue(sample);

    await linkCreateCommand(
      "https://app.example.com/alice/abc123",
      { people: ["Friend@Example.com,boss@example.com"], expiresIn: "24h", maxViews: "3", json: true },
    );

    expect(create).toHaveBeenCalledWith("abc123", {
      audience: "people",
      emails: ["friend@example.com", "boss@example.com"],
      notify: undefined,
      expires_in_seconds: 86400,
      max_views: 3,
      present_only: undefined,
    });
    expect(JSON.parse(log.mock.calls[0][0] as string).data.audience).toBe("people");
  });

  it("--no-email sends notify: false", async () => {
    const create = vi
      .spyOn(SharedropApiClient.prototype, "createEphemeralLink")
      .mockResolvedValue({ ...sample, emailed: false });
    const update = vi
      .spyOn(SharedropApiClient.prototype, "updateEphemeralLinkPeople")
      .mockResolvedValue({
        id: "link-1",
        audience: "people",
        emails: ["a@example.com"],
        added: 1,
        removed: 0,
        view_count: 0,
        max_views: 3,
        expires_at: null,
        status: "active",
      });

    await linkCreateCommand("abc123", { people: ["a@example.com"], maxViews: "3", email: false, json: true });
    await linkPeopleCommand("abc123", "link-1", { add: ["a@example.com"], email: false, json: true });

    expect(create.mock.calls[0][1]).toMatchObject({ notify: false });
    expect(update.mock.calls[0][2]).toMatchObject({ notify: false });
  });

  it("create refuses to send a link with no limit", async () => {
    const create = vi.spyOn(SharedropApiClient.prototype, "createEphemeralLink");
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    vi.spyOn(console, "error").mockImplementation(() => {});

    await linkCreateCommand("abc123", { json: true });

    expect(create).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalled();
  });

  it("people sends add_emails / remove_emails", async () => {
    const update = vi
      .spyOn(SharedropApiClient.prototype, "updateEphemeralLinkPeople")
      .mockResolvedValue({
        id: "link-1",
        audience: "people",
        emails: ["new@example.com"],
        added: 1,
        removed: 1,
        view_count: 0,
        max_views: 3,
        expires_at: null,
        status: "active",
      });

    await linkPeopleCommand("abc123", "link-1", {
      add: ["New@Example.com"],
      remove: ["old@example.com"],
      json: true,
    });

    expect(update).toHaveBeenCalledWith("abc123", "link-1", {
      add_emails: ["new@example.com"],
      remove_emails: ["old@example.com"],
      notify: undefined,
    });
  });

  it("list and revoke call the v1 client", async () => {
    const list = vi
      .spyOn(SharedropApiClient.prototype, "listEphemeralLinks")
      .mockResolvedValue({ links: [sample] });
    const revoke = vi
      .spyOn(SharedropApiClient.prototype, "revokeEphemeralLink")
      .mockResolvedValue({ revoked: true, link_id: "link-1" });

    await linkListCommand("abc123", { json: true });
    await linkRevokeCommand("abc123", "link-1", { json: true });

    expect(list).toHaveBeenCalledWith("abc123");
    expect(revoke).toHaveBeenCalledWith("abc123", "link-1");
  });
});

describe("human output", () => {
  it("names the people and says the page is unchanged, without em dashes", () => {
    const restore = forceTTY();
    try {
      const created = formatLinkCreated(sample, {});
      expect(created).toContain(sample.url);
      expect(created).toContain("friend@example.com");
      expect(created).toContain("unchanged");
      expect(created).not.toContain(EM_DASH);
      const list = formatLinkList([sample], {});
      expect(list).toContain("1 of 3");
      expect(list).not.toContain(EM_DASH);
    } finally {
      restore();
    }
  });
});
