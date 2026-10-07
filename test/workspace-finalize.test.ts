// #383: `--workspace` reaches finalize under the name finalize reads
// (`workspace_id`), while sign and archive create keep `workspace`. Sending
// `workspace` to finalize was ignored there, so the token's workspace claim did
// not match and finalize refused with workspace_mismatch.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../src/auth/resolve.js", () => ({
  resolveAuth: vi.fn(async () => ({ token: "sd_test", source: "flag" })),
  resolveBaseUrl: vi.fn(() => "https://app.example.com"),
}));

import { uploadCommand } from "../src/commands/upload.js";
import { archiveCommand } from "../src/commands/archive.js";
import {
  FINALIZE_NEW_PAGE,
  SIGN_RESPONSE,
  finalizeReupload,
  jsonResponse,
  routedFetch,
  type RecordedCall,
} from "./fixtures/contract-383.js";

const WS = "edc26c0e-9e41-47cc-8651-c14b971e978b";

function writeTmpFile(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "sharedrop-cli-ws-"));
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

function bodyOf(calls: RecordedCall[], suffix: string) {
  return calls.find((c) => c.url.endsWith(suffix))?.body;
}

describe("--workspace reaches finalize as workspace_id (#383)", () => {
  let stdout: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function stubSingle(finalizeBody: unknown) {
    const routed = routedFetch({
      "POST /api/upload/sign": () => jsonResponse(200, SIGN_RESPONSE),
      "PUT /01HXXXEXAMPLEULID": () => jsonResponse(200, {}),
      "POST /api/upload/finalize": () => jsonResponse(200, finalizeBody),
    });
    vi.stubGlobal("fetch", vi.fn(routed.fn));
    return routed.calls;
  }

  it("a new single-file upload sends workspace to sign and workspace_id to finalize (JSON)", async () => {
    const calls = stubSingle(FINALIZE_NEW_PAGE);

    await uploadCommand(writeTmpFile("ws.html", "<h1>WS</h1>"), { json: true, workspace: WS });

    expect(bodyOf(calls, "/api/upload/sign")?.workspace).toBe(WS);
    const finalize = bodyOf(calls, "/api/upload/finalize");
    expect(finalize?.workspace_id).toBe(WS);
    expect(finalize).not.toHaveProperty("workspace");
    expect(JSON.parse(String(stdout.mock.calls[0][0])).data.id).toBe(FINALIZE_NEW_PAGE.page_id);
  });

  it("a single-file re-upload sends workspace_id to finalize (JSON)", async () => {
    const calls = stubSingle(finalizeReupload(2));

    await uploadCommand(writeTmpFile("ws.html", "<h1>WS v2</h1>"), {
      json: true,
      workspace: WS,
      pageId: FINALIZE_NEW_PAGE.page_id,
    });

    const finalize = bodyOf(calls, "/api/upload/finalize");
    expect(finalize).toMatchObject({ workspace_id: WS, page_id: FINALIZE_NEW_PAGE.page_id });
    expect(finalize).not.toHaveProperty("workspace");
  });

  it("without --workspace finalize gets no workspace field", async () => {
    const calls = stubSingle(FINALIZE_NEW_PAGE);
    await uploadCommand(writeTmpFile("me.html", "<h1>Me</h1>"), { json: true });
    const finalize = bodyOf(calls, "/api/upload/finalize");
    expect(finalize).not.toHaveProperty("workspace_id");
    expect(finalize).not.toHaveProperty("workspace");
  });

  it("a small archive sends workspace to create and workspace_id to finalize (JSON)", async () => {
    const routed = routedFetch({
      "POST /api/archives/create": () =>
        jsonResponse(200, { transport: "single", ...SIGN_RESPONSE }),
      "PUT /01HXXXEXAMPLEULID": () => jsonResponse(200, {}),
      "POST /api/upload/finalize": () => jsonResponse(200, FINALIZE_NEW_PAGE),
    });
    vi.stubGlobal("fetch", vi.fn(routed.fn));

    await archiveCommand(writeTmpFile("dump.zip", "PK"), { json: true, workspace: WS });

    expect(bodyOf(routed.calls, "/api/archives/create")?.workspace).toBe(WS);
    const finalize = bodyOf(routed.calls, "/api/upload/finalize");
    expect(finalize?.workspace_id).toBe(WS);
    expect(finalize).not.toHaveProperty("workspace");
    expect(JSON.parse(String(stdout.mock.calls[0][0])).data.id).toBe(FINALIZE_NEW_PAGE.page_id);
  });
});
