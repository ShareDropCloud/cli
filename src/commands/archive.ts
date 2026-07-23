import { createReadStream, statSync } from "node:fs";
import { basename, resolve as resolvePath } from "node:path";
import ora from "ora";
import {
  SharedropApiClient,
  SharedropApiError,
  type ArchiveCreatePlan,
  type ArchiveSinglePlan,
  type ArchiveMultipartPlan,
} from "../client/api-client.js";
import { resolveAuth, resolveBaseUrl } from "../auth/resolve.js";
import { requireAuth, handleError } from "../output/errors.js";
import { isTTY, shouldOutputJson } from "../output/format.js";
import { resolveDestinationFolder } from "./folder.js";
import { defaultTitle } from "./upload.js";

// Re-export the plan types so the command + its tests import one archive module.
export type { ArchiveSinglePlan, ArchiveMultipartPlan } from "../client/api-client.js";

/**
 * The six locked archive extensions, mirrored from `lib/uploads/types.ts`
 * ARCHIVE_EXTENSIONS. Duplicated because the CLI is published as @sharedrop/cli
 * and cannot import from `@/lib/...`. The server is authoritative
 * (isAllowedArchiveFilename); this is a fast client-side reject so a wrong file
 * fails before create. Note `.sql.gz` is a DOUBLE extension matched explicitly.
 */
export const ARCHIVE_EXTENSIONS = ["zip", "tar", "gz", "tgz", "sql", "sql.gz"] as const;

/** True if `filename` is an allowed archive name (mirrors isAllowedArchiveFilename). */
export function isAllowedArchiveFilename(filename: string): boolean {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".sql.gz")) return true;
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return false;
  const ext = lower.slice(dot + 1);
  return (ARCHIVE_EXTENSIONS as readonly string[]).includes(ext);
}

// ─── Pure plan-follower (testable without network or disk) ─────────────────

export interface ArchiveResult {
  page_id: string;
  slug?: string;
  download_url?: string;
}

/** Injected transport + disk primitives so the multipart loop is unit-testable. */
export interface ArchiveTransport {
  /** Single lane: PUT the whole file then finalize. Returns the created page. */
  runSingle(plan: ArchiveSinglePlan): Promise<ArchiveResult>;
  /** Mint fresh presigned UploadPart URLs for `partNumbers`. */
  signParts(
    signPartsUrl: string,
    partNumbers?: number[],
  ): Promise<{
    parts: Array<{ part_number: number; url: string }>;
    uploaded: Array<{ part_number: number; etag: string }>;
    part_size_bytes: number;
  }>;
  /** Stream one part's byte range [offset, offset+length) to `url`; resolve to its ETag. */
  uploadPart(url: string, offset: number, length: number): Promise<string>;
  /** CompleteMultipartUpload with the sorted part manifest. */
  complete(
    completeUrl: string,
    parts: Array<{ part_number: number; etag: string }>,
  ): Promise<ArchiveResult>;
  /** AbortMultipartUpload — best-effort cleanup on failure so quota is released. */
  abort(abortUrl: string): Promise<void>;
  /** Progress callback: parts finished / total. */
  onProgress?(done: number, total: number): void;
  /** Backoff sleep, injected so tests run without real delays. */
  sleep?(ms: number): Promise<void>;
}

/** Mint at most this many part URLs per sign-parts call so TTLs stay fresh on slow links. */
const SIGN_BATCH_SIZE = 20;
/**
 * Per-part attempts (#207 / Fable #6). A multi-hour 10 GB upload must survive a
 * minutes-long network blip WITHOUT discarding every uploaded part, so this is far
 * more than the original 3-tries/~1.5 s. 7 attempts with exponential backoff
 * (1s,2s,4s,8s,16s,30s cap) spans ~1 min of retry per part before giving up.
 */
const PART_MAX_ATTEMPTS = 7;
const PART_BACKOFF_CAP_MS = 30_000;

/**
 * Follow whichever plan the server returned. Single delegates to the single
 * upload path; multipart runs the resumable, abortable part loop.
 */
export async function followArchivePlan(
  plan: ArchiveCreatePlan,
  totalBytes: number,
  io: ArchiveTransport,
): Promise<ArchiveResult> {
  if (plan.transport === "single") {
    return io.runSingle(plan);
  }
  return runMultipartUpload(plan, totalBytes, io);
}

async function runMultipartUpload(
  plan: ArchiveMultipartPlan,
  totalBytes: number,
  io: ArchiveTransport,
): Promise<ArchiveResult> {
  // The server may scale part_size up for pathologically large objects, so the
  // offset math ALWAYS reads the plan's size — never a hardcoded default.
  const partSize = plan.part_size_bytes;
  const partCount = plan.part_count;
  const sleep = io.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  // part_number -> etag. Seeded from R2's `uploaded` list (resume), filled by PUTs.
  const collected = new Map<number, string>();

  try {
    for (let start = 1; start <= partCount; start += SIGN_BATCH_SIZE) {
      const end = Math.min(start + SIGN_BATCH_SIZE - 1, partCount);
      // Request only the parts still outstanding (skip ones already carried).
      const batch: number[] = [];
      for (let n = start; n <= end; n++) if (!collected.has(n)) batch.push(n);
      if (batch.length === 0) continue;

      const signed = await io.signParts(plan.sign_parts_url, batch);
      // `uploaded` is R2's full received-parts list on every response — merge it
      // so a resumed run never re-PUTs a part R2 already has, in this batch or a later one.
      for (const u of signed.uploaded) {
        if (!collected.has(u.part_number)) collected.set(u.part_number, u.etag);
      }
      const urlByPart = new Map(signed.parts.map((p) => [p.part_number, p.url]));

      for (const n of batch) {
        if (collected.has(n)) continue; // already in R2 (resume)
        const url = urlByPart.get(n);
        if (!url) {
          throw new SharedropApiError(
            "ARCHIVE_SIGN_PARTS_FAILED",
            `The server did not return an upload URL for part ${n}.`,
            502,
          );
        }
        const offset = (n - 1) * partSize;
        const length = Math.min(partSize, totalBytes - offset);
        const etag = await uploadPartWithRetry(io, url, offset, length, sleep);
        collected.set(n, etag);
        io.onProgress?.(collected.size, partCount);
      }
    }

    const parts = [...collected.entries()]
      .map(([part_number, etag]) => ({ part_number, etag }))
      .sort((a, b) => a.part_number - b.part_number);
    return await io.complete(plan.complete_url, parts);
  } catch (err) {
    // Terminal failure or interrupt: abort so the quota reservation is released
    // (server sweep cron is the backstop). Best-effort — never mask the cause.
    await io.abort(plan.abort_url).catch(() => {});
    throw err;
  }
}

async function uploadPartWithRetry(
  io: ArchiveTransport,
  url: string,
  offset: number,
  length: number,
  sleep: (ms: number) => Promise<void>,
): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= PART_MAX_ATTEMPTS; attempt++) {
    try {
      return await io.uploadPart(url, offset, length);
    } catch (err) {
      lastErr = err;
      if (attempt < PART_MAX_ATTEMPTS) {
        // 1s, 2s, 4s, 8s, 16s, 30s (capped) — survive a real outage, not just a hiccup.
        await sleep(Math.min(2 ** (attempt - 1) * 1000, PART_BACKOFF_CAP_MS));
      }
    }
  }
  throw lastErr;
}

// ─── GB-aware size formatting ──────────────────────────────────────────────

const KB = 1024;
const MB = 1024 * 1024;
const GB = 1024 * 1024 * 1024;

/** Human size that scales to GB (page-table formatBytes caps at MB and misprints archives). */
export function formatArchiveSize(bytes: number): string {
  if (bytes >= GB) return `${(bytes / GB).toFixed(2)} GB`;
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  if (bytes >= KB) return `${(bytes / KB).toFixed(1)} KB`;
  return `${bytes} B`;
}

// ─── CLI command wrapper (thin) ────────────────────────────────────────────

export async function archiveCommand(
  file: string,
  opts: {
    title?: string;
    workspace?: string;
    folder?: string;
    storeAsFile?: boolean;
    json?: boolean;
  },
  globalOpts: { url?: string; token?: string } = {},
): Promise<void> {
  try {
    const auth = await resolveAuth(globalOpts.token);
    requireAuth(auth);

    const baseUrl = resolveBaseUrl(globalOpts.url);
    const client = new SharedropApiClient({ apiKey: auth.token, baseUrl });

    // Archive uploads read byte ranges from disk, so stdin has no path to range.
    if (file === "-") {
      throw new SharedropApiError(
        "VALIDATION_ERROR",
        "Archive uploads need a file path, not stdin.",
        400,
      );
    }

    const abs = resolvePath(file);
    let stat;
    try {
      stat = statSync(abs);
    } catch (err: unknown) {
      if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
        console.error(`Error: File not found: ${file}`);
        process.exit(6);
      }
      throw err;
    }
    if (stat.isDirectory()) {
      throw new SharedropApiError(
        "VALIDATION_ERROR",
        `"${file}" is a directory. Archive uploads take a single file.`,
        400,
      );
    }

    const filename = basename(abs);
    // #207 (Fable #5) — --store-as-file stores ANY file as a download-only blob, so
    // it bypasses the archive-extension check (the render-ceiling "store as file"
    // hand-off passes it). Without the flag, keep the fast client-side reject so a
    // typo fails before create.
    if (!opts.storeAsFile && !isAllowedArchiveFilename(filename)) {
      throw new SharedropApiError(
        "UNSUPPORTED_FILE_TYPE",
        `Not an allowed archive: ${filename}. Allowed: ${ARCHIVE_EXTENSIONS.join(", ")}. Use --store-as-file to store any file as a download-only blob.`,
        400,
      );
    }
    const size = stat.size;

    // Resolve the destination folder up front (path -> id, auto-creating missing
    // segments). Any error (notably FOLDERS_RESTRICTED on a free key) aborts
    // before any bytes move, never a silent root fallback.
    const folderId = opts.folder
      ? await resolveDestinationFolder(client, opts.folder)
      : undefined;

    // The one decision point: create returns the plan the client follows.
    const plan = await client.createArchive({
      filename,
      size_bytes: size,
      workspace: opts.workspace,
      folder_id: folderId,
      ...(opts.storeAsFile ? { as_archive: true } : {}),
    });

    // Best-effort abort on Ctrl-C during a multipart run so quota is released.
    let sigintHandler: (() => void) | undefined;
    if (plan.transport === "multipart") {
      const abortUrl = plan.abort_url;
      sigintHandler = () => {
        client
          .abortArchive(abortUrl)
          .catch(() => {})
          .finally(() => process.exit(130));
      };
      process.once("SIGINT", sigintHandler);
    }

    const useProgress = isTTY() && !shouldOutputJson(opts);
    const spinner =
      useProgress && plan.transport === "single" ? ora("Uploading...").start() : null;

    try {
      const io: ArchiveTransport = {
        runSingle: async (p) => {
          await client.streamUpload(
            p.upload_url,
            p.upload_token,
            createReadStream(abs),
            "application/octet-stream",
            size,
          );
          const r = await client.finalizeUpload({
            object_key: p.object_key,
            upload_token: p.upload_token,
            title: opts.title ?? defaultTitle(file),
            ...(folderId ? { folder_id: folderId } : {}),
          });
          return { page_id: r.page_id, slug: r.slug };
        },
        signParts: (url, partNumbers) => client.signArchiveParts(url, partNumbers),
        uploadPart: (url, offset, length) =>
          client.putArchivePart(
            url,
            createReadStream(abs, { start: offset, end: offset + length - 1 }),
            length,
          ),
        complete: async (url, parts) => {
          const r = await client.completeArchive(url, parts);
          return { page_id: r.page.id, slug: r.page.slug, download_url: r.download_url };
        },
        abort: (url) => client.abortArchive(url),
        onProgress: (done, total) => {
          if (!useProgress || plan.transport !== "multipart") return;
          const uploaded = Math.min(done * plan.part_size_bytes, size);
          process.stderr.write(
            `\rUploading part ${done}/${total} (${formatArchiveSize(uploaded)} / ${formatArchiveSize(size)})`,
          );
        },
      };

      const result = await followArchivePlan(plan, size, io);

      // create names a multipart page after the file; apply a custom title after.
      if (plan.transport === "multipart" && opts.title) {
        try {
          await client.updatePage(result.page_id, { title: opts.title });
        } catch {
          if (!shouldOutputJson(opts)) {
            console.error("Note: uploaded, but the title could not be updated.");
          }
        }
      }

      if (spinner) spinner.succeed("Uploaded");
      if (useProgress && plan.transport === "multipart") process.stderr.write("\n");

      if (shouldOutputJson(opts)) {
        console.log(
          JSON.stringify(
            {
              data: {
                id: result.page_id,
                size_bytes: size,
                ...(result.download_url ? { download_url: result.download_url } : {}),
              },
            },
            null,
            2,
          ),
        );
      } else {
        console.log(
          [
            `Uploaded ${filename}`,
            `  ID: ${result.page_id}`,
            `  Size: ${formatArchiveSize(size)}`,
            `  Download with: sharedrop download ${result.page_id}`,
          ].join("\n"),
        );
      }
    } catch (err) {
      if (spinner) spinner.fail("Upload failed");
      throw err;
    } finally {
      if (sigintHandler) process.removeListener("SIGINT", sigintHandler);
    }
  } catch (err) {
    handleError(err, opts);
  }
}
