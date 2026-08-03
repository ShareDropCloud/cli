import { describe, expect, it, vi } from "vitest";
import {
  followArchivePlan,
  type ArchiveTransport,
  type ArchiveMultipartPlan,
  type ArchiveSinglePlan,
} from "../src/commands/archive.js";
import { SharedropApiError } from "../src/client/api-client.js";

const SINGLE: ArchiveSinglePlan = {
  transport: "single",
  upload_url: "https://uploads/first",
  upload_token: "token-1",
  finalize_url: "https://app/api/upload/finalize",
  object_key: "key-1",
};

function multipart(): ArchiveMultipartPlan {
  return {
    transport: "multipart",
    page_id: "page-1",
    upload_id: "upload-1",
    part_size_bytes: 10,
    part_count: 1,
    sign_parts_url: "https://app/sign-parts",
    complete_url: "https://app/complete",
    abort_url: "https://app/abort",
  };
}

describe("archive retry classification", () => {
  it("refreshes single-upload coordinates after a transient failure and honours Retry-After", async () => {
    const fresh: ArchiveSinglePlan = {
      ...SINGLE,
      upload_url: "https://uploads/second",
      upload_token: "token-2",
      object_key: "key-2",
    };
    const runSingle = vi
      .fn()
      .mockRejectedValueOnce(
        new SharedropApiError(
          "UPLOAD_FAILED",
          "temporarily unavailable",
          503,
          undefined,
          undefined,
          { retryAfterMs: 4_000, retryable: true },
        ),
      )
      .mockResolvedValueOnce({ page_id: "page-ok" });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const io = {
      runSingle,
      refreshSingle: vi.fn().mockResolvedValue(fresh),
      signParts: vi.fn(),
      uploadPart: vi.fn(),
      complete: vi.fn(),
      abort: vi.fn(),
      sleep,
    } as unknown as ArchiveTransport;

    await expect(followArchivePlan(SINGLE, 10, io)).resolves.toEqual({
      page_id: "page-ok",
    });
    expect(runSingle.mock.calls.map(([plan]) => plan.upload_token)).toEqual([
      "token-1",
      "token-2",
    ]);
    expect(io.refreshSingle).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledWith(4_000);
  });

  it("does not refresh single-upload coordinates after an ambiguous finalize database 503", async () => {
    const failure = new SharedropApiError(
      "UPLOAD_FAILED",
      "temporarily unavailable",
      503,
      undefined,
      undefined,
      { reason: "database_unavailable", retryable: true },
    );
    const runSingle = vi.fn(async (
      _plan: ArchiveSinglePlan,
      setStage: (stage: "put" | "finalize") => void,
    ) => {
      setStage("finalize");
      throw failure;
    });
    const refreshSingle = vi.fn();
    const io = {
      runSingle,
      refreshSingle,
      signParts: vi.fn(),
      uploadPart: vi.fn(),
      complete: vi.fn(),
      abort: vi.fn(),
      sleep: vi.fn(),
    } as unknown as ArchiveTransport;

    await expect(followArchivePlan(SINGLE, 10, io)).rejects.toBe(failure);
    expect(runSingle).toHaveBeenCalledOnce();
    expect(refreshSingle).not.toHaveBeenCalled();
  });

  it("refreshes single-upload coordinates after the safe finalize storage 503", async () => {
    const fresh = { ...SINGLE, upload_token: "token-2", object_key: "key-2" };
    const runSingle = vi
      .fn()
      .mockImplementationOnce(async (
        _plan: ArchiveSinglePlan,
        setStage: (stage: "put" | "finalize") => void,
      ) => {
        setStage("finalize");
        throw new SharedropApiError(
          "UPLOAD_FAILED",
          "storage unavailable",
          503,
          undefined,
          undefined,
          { reason: "storage_unavailable", retryable: true },
        );
      })
      .mockResolvedValueOnce({ page_id: "page-ok" });
    const refreshSingle = vi.fn().mockResolvedValue(fresh);
    const io = {
      runSingle,
      refreshSingle,
      signParts: vi.fn(),
      uploadPart: vi.fn(),
      complete: vi.fn(),
      abort: vi.fn(),
      sleep: vi.fn().mockResolvedValue(undefined),
    } as unknown as ArchiveTransport;

    await expect(followArchivePlan(SINGLE, 10, io)).resolves.toEqual({
      page_id: "page-ok",
    });
    expect(runSingle).toHaveBeenCalledTimes(2);
    expect(refreshSingle).toHaveBeenCalledOnce();
  });

  it("does not retry a terminal multipart 400 response", async () => {
    const uploadPart = vi
      .fn()
      .mockRejectedValue(new SharedropApiError("PART_UPLOAD_FAILED", "bad part", 400));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const abort = vi.fn().mockResolvedValue(undefined);
    const io = {
      runSingle: vi.fn(),
      signParts: vi.fn().mockResolvedValue({
        parts: [{ part_number: 1, url: "https://r2/part-1" }],
        uploaded: [],
        part_size_bytes: 10,
      }),
      uploadPart,
      complete: vi.fn(),
      abort,
      sleep,
    } as unknown as ArchiveTransport;

    await expect(followArchivePlan(multipart(), 10, io)).rejects.toThrow("bad part");
    expect(uploadPart).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
    expect(abort).toHaveBeenCalledOnce();
  });
});
