// #366: the CLI names the daily share-email limit when the server says it
// stopped an invite email; the share or link itself still succeeded.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  formatLinkCreated,
  formatLinkPeopleUpdated,
  formatShare,
} from "../src/output/format.js";
import type { EphemeralLink } from "../src/client/types.js";

const WARNING = {
  code: "SHARE_EMAIL_LIMIT_REACHED",
  limit: 10,
  message:
    "No email was sent because you have reached your daily limit of 10 share emails. Send the link yourself, or try again tomorrow.",
};

const link: EphemeralLink = {
  id: "link-1",
  url: "https://sharedrop.cloud/alice/abc123?e=tok",
  token: "tok",
  audience: "people",
  emails: ["a@example.com"],
  emailed: true,
  expires_at: null,
  max_views: 5,
  view_count: 0,
  present_only: false,
  status: "active",
};

describe("#366 share-email limit in CLI output", () => {
  // Human output only renders on a TTY; otherwise the formatters emit JSON.
  let prev: PropertyDescriptor | undefined;
  beforeEach(() => {
    prev = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  });
  afterEach(() => {
    if (prev) Object.defineProperty(process.stdout, "isTTY", prev);
    else delete (process.stdout as { isTTY?: boolean }).isTTY;
  });

  it("share prints the limit message under the success line", () => {
    const out = formatShare(
      { id: "g", email: "a@example.com", status: "pending", created_at: "", email_warning: WARNING },
      "Report",
      {},
    );
    expect(out).toContain('Shared "Report" with a@example.com');
    expect(out).toContain("daily limit of 10 share emails");
  });

  it("share prints no warning when there is room", () => {
    const out = formatShare(
      { id: "g", email: "a@example.com", status: "pending", created_at: "", email_warning: null },
      "Report",
      {},
    );
    expect(out).not.toContain("daily limit");
  });

  it("share --json keeps email_warning in the payload", () => {
    const out = formatShare(
      { id: "g", email: "a@example.com", status: "pending", created_at: "", email_warning: WARNING },
      "Report",
      { json: true },
    );
    expect(JSON.parse(out).data.email_warning).toEqual(WARNING);
  });

  it("link create replaces 'Sharedrop is emailing them' with the limit message", () => {
    const out = formatLinkCreated({ ...link, email_warning: WARNING }, {});
    expect(out).toContain("daily limit of 10 share emails");
    expect(out).not.toContain("Sharedrop is emailing them the link");
  });

  it("link people update prints the limit message", () => {
    const out = formatLinkPeopleUpdated(
      {
        id: "link-1",
        audience: "people",
        emails: ["a@example.com"],
        added: 1,
        removed: 0,
        emailed: ["a@example.com"],
        email_warning: WARNING,
        view_count: 0,
        max_views: 5,
        expires_at: null,
        status: "active",
      },
      {},
    );
    expect(out).toContain("daily limit of 10 share emails");
  });
});
