// #416 hardening: a standalone --version before any command prints the CLI
// version (also after --url / --token), -V still works, and after a command
// name --version stays that command's option (`download <page> --version <n>`).

import { describe, it, expect, vi, afterEach } from "vitest";

afterEach(() => {
  vi.doUnmock("../src/commands/download.js");
  vi.doUnmock("../src/commands/versions.js");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

async function run(argv: string[]) {
  const download = vi.fn();
  const versions = vi.fn();
  vi.resetModules();
  vi.doMock("../src/commands/download.js", () => ({ downloadCommand: download }));
  vi.doMock("../src/commands/versions.js", () => ({ versionsCommand: versions }));
  vi.stubGlobal("__CLI_VERSION__", "0.0.0-test");
  const exits: number[] = [];
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    exits.push(code ?? 0);
    throw new Error(`exit:${code}`);
  }) as never);
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const saved = process.argv;
  process.argv = ["node", "sharedrop", ...argv];
  try {
    await import("../src/cli.js");
  } catch {
    /* exit throws by design */
  } finally {
    process.argv = saved;
  }
  const printed = [
    ...log.mock.calls.map((c) => String(c[0])),
    ...write.mock.calls.map((c) => String(c[0])),
  ].join("");
  return { download, versions, exits, printed };
}

describe("#416 CLI --version handling", () => {
  it("sharedrop --version prints the version", async () => {
    const { exits, printed, download } = await run(["--version"]);
    expect(printed.trim()).toBe("0.0.0-test");
    expect(exits).toEqual([0]);
    expect(download).not.toHaveBeenCalled();
  });

  it("sharedrop --url https://x --version prints the version", async () => {
    const { exits, printed } = await run(["--url", "https://x", "--version"]);
    expect(printed.trim()).toBe("0.0.0-test");
    expect(exits).toEqual([0]);
  });

  it("sharedrop --token=t --url=https://x --version prints the version", async () => {
    const { exits, printed } = await run(["--token=t", "--url=https://x", "--version"]);
    expect(printed.trim()).toBe("0.0.0-test");
    expect(exits).toEqual([0]);
  });

  it("sharedrop -V prints the version", async () => {
    const { exits, printed } = await run(["-V"]);
    expect(printed.trim()).toBe("0.0.0-test");
    expect(exits).toEqual([0]);
  });

  it("download <page> --version 2 routes to download", async () => {
    const { download, exits, printed } = await run(["download", "p", "--version", "2"]);
    expect(exits).toEqual([]);
    expect(printed).not.toContain("0.0.0-test");
    expect(download).toHaveBeenCalledOnce();
    expect(download.mock.calls[0][0]).toBe("p");
    expect(download.mock.calls[0][1]).toMatchObject({ version: "2" });
  });

  it("--url before download <page> --version 2 still routes to download", async () => {
    const { download, exits } = await run(["--url", "https://x", "download", "p", "--version", "2"]);
    expect(exits).toEqual([]);
    expect(download.mock.calls[0][1]).toMatchObject({ version: "2" });
    expect(download.mock.calls[0][2]).toMatchObject({ url: "https://x" });
  });

  it("versions <page> is unaffected", async () => {
    const { versions, download, exits } = await run(["versions", "p"]);
    expect(exits).toEqual([]);
    expect(versions).toHaveBeenCalledOnce();
    expect(versions.mock.calls[0][0]).toBe("p");
    expect(download).not.toHaveBeenCalled();
  });
});
