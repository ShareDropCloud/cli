// #383 (P5): --folder is honoured on a folder bundle. The CLI sends folder_id
// on bundle finalize (new pages only); a server refusal takes the normal error
// path in every output mode.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../src/auth/resolve.js", () => ({
  resolveAuth: vi.fn(async () => ({ token: "sd_test", source: "flag" })),
  resolveBaseUrl: vi.fn(() => "https://app.example.com"),
}));

import { uploadCommand } from "../src/commands/upload.js";
import {
  BUNDLE_FINALIZE_NEW_PAGE,
  FINALIZE_NEW_PAGE,
  finalizeReupload,
  jsonResponse,
  routedFetch,
} from "./fixtures/contract-383.js";

const FOLDER_ID = "11111111-1111-4111-8111-111111111111";

function makeSite(): string {
  const dir = mkdtempSync(join(tmpdir(), "sharedrop-cli-bundle-folder-"));
  writeFileSync(join(dir, "index.html"), "<h1>hi</h1>");
  return dir;
}

function stubBundle(finalize: () => Response) {
  const routed = routedFetch({
    "POST /api/upload/bundle/sign": () =>
      jsonResponse(200, {
        files: [{ filename: "index.html", upload_url: "https://uploads.example.com/b0", upload_token: "t0", object_key: "b0" }],
        finalize_url: "https://app.example.com/api/upload/bundle/finalize",
      }),
    "PUT /b0": () => jsonResponse(200, {}),
    "POST /api/upload/bundle/finalize": finalize,
  });
  vi.stubGlobal("fetch", vi.fn(routed.fn));
  return routed.calls;
}

async function runForExit(fn: () => Promise<void>): Promise<number | undefined> {
  const codes: number[] = [];
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    codes.push(code ?? 0);
    throw new Error(`exit:${code}`);
  }) as never);
  try {
    await fn();
  } catch {
    /* exit throws by design */
  }
  return codes[0];
}

describe("upload <folder> --folder (#383)", () => {
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    stderr = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("sends folder_id on bundle finalize and prints no 'ignored' note", async () => {
    const calls = stubBundle(() => jsonResponse(200, BUNDLE_FINALIZE_NEW_PAGE));

    await uploadCommand(makeSite(), { json: true, folder: FOLDER_ID });

    const finalize = calls.find((c) => c.url.endsWith("/api/upload/bundle/finalize"));
    expect(finalize?.body?.folder_id).toBe(FOLDER_ID);
    const lines = stderr.mock.calls.map((c) => String(c[0])).join("\n");
    expect(lines).not.toMatch(/ignored/i);
  });

  it("does not send folder_id on a bundle re-upload", async () => {
    const calls = stubBundle(() => jsonResponse(200, { ...finalizeReupload(2), assets: 0 }));

    await uploadCommand(makeSite(), {
      json: true,
      folder: FOLDER_ID,
      pageId: FINALIZE_NEW_PAGE.page_id,
    });

    const finalize = calls.find((c) => c.url.endsWith("/api/upload/bundle/finalize"));
    expect(finalize?.body).not.toHaveProperty("folder_id");
  });

  it("a server refusal takes the normal error path in JSON mode", async () => {
    stubBundle(() =>
      jsonResponse(403, {
        error: { code: "FOLDERS_RESTRICTED", message: "Folders require a Pro plan or higher." },
      }),
    );

    const code = await runForExit(() => uploadCommand(makeSite(), { json: true, folder: FOLDER_ID }));

    expect(code).toBe(3);
    const printed = JSON.parse(String(stderr.mock.calls.at(-1)?.[0]));
    expect(printed.error.code).toBe("FOLDERS_RESTRICTED");
  });

  it("a server refusal takes the normal error path in human mode", async () => {
    stubBundle(() =>
      jsonResponse(400, { error: { code: "VALIDATION_ERROR", message: "Folder not found." } }),
    );
    const previous = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    let code: number | undefined;
    try {
      code = await runForExit(() => uploadCommand(makeSite(), { folder: FOLDER_ID }));
    } finally {
      if (previous) Object.defineProperty(process.stdout, "isTTY", previous);
      else delete (process.stdout as { isTTY?: boolean }).isTTY;
    }

    expect(code).toBe(6);
    const lines = stderr.mock.calls.map((c) => String(c[0])).join("\n");
    expect(lines).toContain("Folder not found.");
  });
});
