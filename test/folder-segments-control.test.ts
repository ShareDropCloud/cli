// #410 hardening: the control-character guard in parseFolderSegments must be
// written with escapes. Raw NUL, 0x1F and 0x7F bytes in the source made git
// treat folder.ts as a binary file, hiding every later change from review.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseFolderSegments } from "../src/commands/folder.js";

describe("parseFolderSegments control characters", () => {
  it.each([
    ["NUL", "a\u0000b"],
    ["unit separator 0x1F", "a\u001fb"],
    ["DEL 0x7F", "a\u007fb"],
    ["tab inside a name", "a\tb"],
  ])("refuses a name containing %s", (_label, name) => {
    expect(() => parseFolderSegments(`reports/${name}`)).toThrow("cannot contain control characters");
  });

  it("accepts ordinary names, spaces and punctuation", () => {
    expect(parseFolderSegments("Q3 reports/2026 ~ final!")).toEqual(["Q3 reports", "2026 ~ final!"]);
  });

  it("keeps folder.ts plain text: no raw control bytes in the source", () => {
    const bytes = readFileSync(fileURLToPath(new URL("../src/commands/folder.ts", import.meta.url)));
    const raw = [...bytes].filter((b) => (b < 0x20 && b !== 0x0a && b !== 0x09 && b !== 0x0d) || b === 0x7f);
    expect(raw).toEqual([]);
  });
});
