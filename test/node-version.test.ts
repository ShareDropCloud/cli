// #227: the Node version check that runs before the CLI loads.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";
import {
  MIN_NODE_VERSION,
  isSupportedNodeVersion,
  unsupportedNodeMessage,
} from "../src/node-version.js";

describe("Node version check", () => {
  it("accepts the minimum and anything newer", () => {
    for (const v of ["20.10.0", "v20.10.0", "20.10.1", "20.19.0", "22.0.0", "24.11.1", "25.5.0"]) {
      expect(isSupportedNodeVersion(v)).toBe(true);
    }
  });

  it("refuses anything older than the minimum", () => {
    for (const v of ["20.9.0", "v20.9.0", "20.0.0", "18.19.1", "18.5.0", "16.20.2"]) {
      expect(isSupportedNodeVersion(v)).toBe(false);
    }
  });

  it("names both the required and the running version, with no em dash", () => {
    const msg = unsupportedNodeMessage("v18.19.1");
    expect(msg).toContain(`Node.js ${MIN_NODE_VERSION} or newer`);
    expect(msg).toContain("this is Node.js 18.19.1");
    expect(msg).not.toContain("\u2014");
  });

  it("matches engines.node in package.json", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
    ) as { engines: { node: string } };
    expect(pkg.engines.node).toBe(`>=${MIN_NODE_VERSION}`);
  });

  it("the bin entry exits 1 with the message before loading the CLI on an old Node", () => {
    // Run the real entry code with process.versions.node faked to 18.19.1 and
    // the CLI import pointed at a module that throws if it is ever loaded.
    const dir = mkdtempSync(join(tmpdir(), "sd-node-check-"));
    const compile = (file: string) =>
      transformSync(readFileSync(new URL(`../src/${file}`, import.meta.url), "utf-8"), {
        loader: "ts",
        format: "esm",
      }).code;
    writeFileSync(join(dir, "package.json"), '{"type":"module"}\n');
    writeFileSync(join(dir, "node-version.js"), compile("node-version.ts"));
    writeFileSync(join(dir, "bin.js"), compile("bin.ts"));
    writeFileSync(join(dir, "cli.js"), 'throw new Error("CLI loaded");\n');
    writeFileSync(
      join(dir, "old-node.js"),
      'Object.defineProperty(process.versions, "node", { value: "18.19.1" });\nawait import("./bin.js");\n',
    );

    const old = spawnSync(process.execPath, [join(dir, "old-node.js")], { encoding: "utf-8" });
    expect(old.status).toBe(1);
    expect(old.stderr).toContain(
      `sharedrop needs Node.js ${MIN_NODE_VERSION} or newer, but this is Node.js 18.19.1.`,
    );
    expect(old.stderr).not.toContain("CLI loaded");

    // On the running (supported) Node the entry goes on to load the CLI.
    const current = spawnSync(process.execPath, [join(dir, "bin.js")], { encoding: "utf-8" });
    expect(current.stderr).toContain("CLI loaded");
  });
});
