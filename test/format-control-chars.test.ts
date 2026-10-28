// #446: server text printed in a table never carries terminal control
// characters (escape sequences, OSC links, bells). JSON output stays raw.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  formatPage,
  formatPageList,
  formatReservationCreated,
  formatSharedList,
  formatTrashList,
} from "../src/output/format.js";
import type { Reservation, SharedPage, V1Page } from "../src/client/types.js";
import type { TrashItem } from "../src/client/api-client.js";

// Any C0 or C1 control character other than the table's own line breaks.
const CONTROL = /[\x00-\x09\x0b-\x1f\x7f-\x9f]/;
// The colours the formatters themselves add (bold, dim, cyan, yellow, grey
// borders), and nothing else, so any escape left over came from the server text.
const OWN_COLOURS = /\x1b\[(?:1|2|22|33|36|39|90)m/g;
const table = (out: string) => out.replace(OWN_COLOURS, "");
const HOSTILE_TITLE = "a\x1b[31mb\x1b]8;;https://x\x07c";
const PAGINATION = { has_more: false, next_cursor: null };

const share: SharedPage = {
  page_id: "b0000000-0000-4000-8000-000000000001",
  title: HOSTILE_TITLE,
  kind: "html",
  url: "/bob/q3abcd\x9b2J",
  full_url: "https://app.example.com/bob/q3abcd\x9b2J",
  shared_by: "x\x1b[2Ky",
  shared_at: "2026-10-20T05:00:00.000Z",
  expires_at: null,
};

const page = {
  id: "b0000000-0000-4000-8000-000000000002\x1b[1A",
  slug: "q3abcd",
  title: HOSTILE_TITLE,
  mode: "static",
  kind: "html",
  version: 1,
  file_size: 10,
  visibility: "private\x07",
  url: "/bob/q3abcd",
  full_url: "https://app.example.com/bob/q3abcd\x1b]8;;https://evil\x07",
  created_at: "2026-10-20T05:00:00.000Z",
  updated_at: "2026-10-20T05:00:00.000Z",
} as unknown as V1Page;

const trashItem: TrashItem = {
  id: "b0000000-0000-4000-8000-000000000003\x1b[1A",
  title: HOSTILE_TITLE,
  nodeType: "page\x07",
  parentId: null,
  path: "/b0000000-0000-4000-8000-000000000003",
  deletedAt: "2026-10-20T05:00:00.000Z",
  kind: "html",
  fileSize: 10,
};

const reservation = {
  id: "b0000000-0000-4000-8000-000000000004",
  slug: "q3abcd",
  title: HOSTILE_TITLE,
  intended_agent_name: "x\x1b[2Ky",
  status: "pending\x07",
  url: "/bob/q3abcd",
  full_url: "https://app.example.com/bob/q3abcd\x9b2J",
} as unknown as Reservation;

let restoreTTY: () => void;

beforeAll(() => {
  const previous = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  restoreTTY = () => {
    if (previous) Object.defineProperty(process.stdout, "isTTY", previous);
    else delete (process.stdout as { isTTY?: boolean }).isTTY;
  };
});
afterAll(() => {
  restoreTTY();
});

describe("table output drops control characters from server text", () => {
  it("formatSharedList", () => {
    const out = table(formatSharedList([share], PAGINATION, {}));
    expect(out).not.toMatch(CONTROL);
    expect(out).toContain("a[31mb]8;;https://xc");
    expect(out).toContain("x[2Ky");
  });

  it("formatPageList", () => {
    const out = table(formatPageList([page], PAGINATION, {}));
    expect(out).not.toMatch(CONTROL);
    expect(out).toContain("a[31mb]8;;https://xc");
  });

  it("formatPage", () => {
    const out = table(formatPage(page, {}));
    expect(out).not.toMatch(CONTROL);
    expect(out).toContain("a[31mb]8;;https://xc");
  });

  it("formatTrashList", () => {
    const out = table(formatTrashList([trashItem], {}));
    expect(out).not.toMatch(CONTROL);
    expect(out).toContain("a[31mb]8;;https://xc");
  });

  it("formatReservationCreated", () => {
    const out = table(formatReservationCreated({ reservation, claim_token: "sdr_test" }, {}));
    expect(out).not.toMatch(CONTROL);
    expect(out).toContain("a[31mb]8;;https://xc");
    expect(out).toContain("x[2Ky");
  });
});

describe("JSON output stays raw", () => {
  it("formatSharedList --json", () => {
    const out = formatSharedList([share], PAGINATION, { json: true });
    expect(out).toBe(JSON.stringify({ data: [share], pagination: PAGINATION }, null, 2));
    expect(JSON.parse(out).data[0]).toEqual(share);
  });

  it("formatPageList --json", () => {
    const out = formatPageList([page], PAGINATION, { json: true });
    expect(out).toBe(JSON.stringify({ data: [page], pagination: PAGINATION }, null, 2));
    expect(JSON.parse(out).data[0]).toEqual(page);
  });

  it("formatPage --json", () => {
    expect(formatPage(page, { json: true })).toBe(JSON.stringify({ data: page }, null, 2));
  });

  it("formatTrashList --json", () => {
    expect(formatTrashList([trashItem], { json: true })).toBe(
      JSON.stringify({ items: [trashItem] }, null, 2),
    );
  });

  it("formatReservationCreated --json", () => {
    const result = { reservation, claim_token: "sdr_test" };
    expect(formatReservationCreated(result, { json: true })).toBe(JSON.stringify(result, null, 2));
  });
});
