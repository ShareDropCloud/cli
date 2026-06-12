import { createReadStream, readFileSync, statSync } from "node:fs";
import { Readable } from "node:stream";
import { basename, extname, resolve as resolvePath } from "node:path";
import ora from "ora";
import { SharedropApiClient } from "../client/api-client.js";
import { resolveAuth, resolveBaseUrl } from "../auth/resolve.js";
import { requireAuth, handleError } from "../output/errors.js";
import { isTTY, shouldOutputJson } from "../output/format.js";

/**
 * Subset of the filename→MIME map maintained in lib/uploads/types.ts.
 * Duplicated here because the CLI package is published as @sharedrop/cli and
 * cannot import from `@/lib/...` (Next.js app boundary). Keep aligned with
 * lib/uploads/types.ts:7-77.
 */
const EXTENSION_TO_MIME: Record<string, string> = {
  html: "text/html",
  htm: "text/html",
  mhtml: "multipart/related",
  mht: "multipart/related",
  md: "text/markdown",
  markdown: "text/markdown",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  apng: "image/apng",
  svg: "image/svg+xml",
  heic: "image/heic",
  heif: "image/heif",
  tif: "image/tiff",
  tiff: "image/tiff",
};

function detectContentType(filename: string): string {
  const ext = extname(filename).replace(/^\./, "").toLowerCase();
  return EXTENSION_TO_MIME[ext] ?? "application/octet-stream";
}

async function readStdin(): Promise<Buffer> {
  if (process.stdin.isTTY) {
    throw new Error("No input on stdin. Use: cat file.html | sharedrop upload -");
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/**
 * Read HTML from a file path or stdin ("-"). Used by `update <id> <file>`
 * (kept as a back-compat export — update still uses the streamed pipeline
 * via `uploadFileStreamed` below for the file branch; this helper survives
 * for any caller that wants the raw HTML string).
 */
export async function readHtmlInput(file: string): Promise<string> {
  if (file === "-") {
    const buf = await readStdin();
    return buf.toString("utf-8");
  }
  try {
    const buf = readFileSync(file);
    return buf.toString("utf-8");
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      console.error(`Error: File not found: ${file}`);
      process.exit(6);
    }
    throw err;
  }
}

/** Default page title from a file path, matching upload/update behaviour. */
export function defaultTitle(file: string): string | undefined {
  if (file === "-") return undefined;
  const ext = extname(file);
  return basename(file, ext);
}

interface PipelineOptions {
  title?: string;
  visibility?: "public" | "private" | "shared";
  mode?: "static" | "interactive";
  workspace?: string;
  pageId?: string;
}

/**
 * UPLOAD-07 streamed pipeline. Used by `upload` and `update <id> <file>`:
 *   1. sign  — POST /api/upload/sign with filename/content_type/size_bytes
 *   2. PUT   — streaming PUT to Worker (uploads.sharedrop.cloud) with
 *              duplex: "half" and explicit Content-Length
 *   3. final — POST /api/upload/finalize with the object_key + token
 *
 * Single locked path: no Buffer fallback, no fetch capability sniffing —
 * the engines.node >= 18.5.0 pin in packages/cli/package.json is the
 * executor's guarantee that streaming fetch with duplex: "half" is
 * available.
 */
export async function uploadFileStreamed(
  client: SharedropApiClient,
  filePath: string,
  options: PipelineOptions,
): Promise<{ url: string; title: string; page_id: string }> {
  let bodyStream: Readable;
  let size_bytes: number;
  let filename: string;
  let content_type: string;

  if (filePath === "-") {
    const buf = await readStdin();
    bodyStream = Readable.from(buf);
    size_bytes = buf.byteLength;
    filename = "stdin.html";
    content_type = "text/html";
  } else {
    const abs = resolvePath(filePath);
    let stat;
    try {
      stat = statSync(abs);
    } catch (err: unknown) {
      if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
        console.error(`Error: File not found: ${filePath}`);
        process.exit(6);
      }
      throw err;
    }
    size_bytes = stat.size;
    filename = basename(abs);
    content_type = detectContentType(filename);
    bodyStream = createReadStream(abs);
  }

  // Step 1 — sign
  const signed = await client.signUpload({
    filename,
    content_type,
    size_bytes,
    workspace: options.workspace,
  });

  // Step 2 — streaming PUT to the Worker
  await client.streamUpload(
    signed.upload_url,
    signed.upload_token,
    bodyStream,
    content_type,
    size_bytes,
  );

  // Step 3 — finalize
  const result = await client.finalizeUpload({
    object_key: signed.object_key,
    upload_token: signed.upload_token,
    title: options.title,
    visibility: options.visibility,
    mode: options.mode,
    workspace: options.workspace,
    page_id: options.pageId,
  });

  return {
    url: result.url,
    title: options.title ?? filename,
    page_id: result.page_id,
  };
}

function formatUploadResult(
  result: { url: string; title: string; page_id: string },
  baseUrl: string,
  opts: { json?: boolean },
): string {
  // Construct the full URL — the finalize response returns a relative path.
  const fullUrl = result.url.startsWith("http")
    ? result.url
    : `${baseUrl.replace(/\/$/, "")}${result.url}`;

  if (shouldOutputJson(opts)) {
    return JSON.stringify(
      { data: { id: result.page_id, title: result.title, url: result.url, full_url: fullUrl } },
      null,
      2,
    );
  }
  return [result.title, `  ${fullUrl}`, `  ID: ${result.page_id}`].join("\n");
}

export async function uploadCommand(
  file: string,
  opts: {
    title?: string;
    visibility?: string;
    mode?: string;
    json?: boolean;
    workspace?: string;
    pageId?: string;
  },
  globalOpts: { url?: string; token?: string } = {},
): Promise<void> {
  try {
    const auth = await resolveAuth(globalOpts.token);
    requireAuth(auth);

    const baseUrl = resolveBaseUrl(globalOpts.url);
    const client = new SharedropApiClient({ apiKey: auth.token, baseUrl });

    const replacing = Boolean(opts.pageId);

    const useSpinner = isTTY() && !shouldOutputJson(opts);
    const spinner = useSpinner ? ora(replacing ? "Updating..." : "Uploading...").start() : null;

    try {
      const result = await uploadFileStreamed(client, file, {
        title: opts.title || defaultTitle(file),
        visibility: opts.visibility as "public" | "private" | "shared" | undefined,
        mode: opts.mode as "static" | "interactive" | undefined,
        workspace: opts.workspace,
        pageId: opts.pageId,
      });

      if (spinner) spinner.succeed(replacing ? "Updated" : "Uploaded");
      console.log(formatUploadResult(result, baseUrl, opts));
    } catch (err) {
      if (spinner) spinner.fail(replacing ? "Update failed" : "Upload failed");
      throw err;
    }
  } catch (err) {
    handleError(err, opts);
  }
}
