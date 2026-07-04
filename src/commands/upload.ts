import { createReadStream, readFileSync, readdirSync, statSync } from "node:fs";
import { Readable } from "node:stream";
import {
  basename,
  extname,
  join,
  relative,
  resolve as resolvePath,
  sep,
} from "node:path";
import ora from "ora";
import { SharedropApiClient, SharedropApiError } from "../client/api-client.js";
import { resolveAuth, resolveBaseUrl } from "../auth/resolve.js";
import { requireAuth, handleError } from "../output/errors.js";
import { isTTY, shouldOutputJson } from "../output/format.js";

/**
 * Filename→MIME map, kept aligned with `lib/uploads/types.ts` EXTENSION_TO_KIND
 * (7-69). Duplicated because the CLI is published as @sharedrop/cli and cannot
 * import from `@/lib/...` (Next.js app boundary).
 *
 * The server derives the page KIND from the extension (`detectKind`), so this
 * value is informational — it becomes the `upload.sign` correlation log entry
 * and the upload token's `mime` claim. We send the file's NATURAL, bare MIME
 * (no `; charset` — the uploads Worker 415s on parameters). A complete map keeps
 * uploads out of `application/octet-stream` and lets the CLI reject unsupported
 * files before the PUT (see `isSupportedUpload`).
 */
const EXTENSION_TO_MIME: Record<string, string> = {
  // HTML
  html: "text/html",
  htm: "text/html",
  // MHTML (single-file web archives)
  mhtml: "multipart/related",
  mht: "multipart/related",
  // Markdown
  md: "text/markdown",
  markdown: "text/markdown",
  // PDF
  pdf: "application/pdf",
  // JSON / JSONL
  json: "application/json",
  jsonl: "application/jsonl",
  // Images
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
  // Video — Pro/Team only (v1 allow-list: mp4/webm/mov). Kind gate is server-side.
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  // Source code — rendered to syntax-highlighted HTML server-side (vj9). Free-tier.
  js: "text/javascript", mjs: "text/javascript", cjs: "text/javascript",
  jsx: "text/javascript", ts: "text/plain", tsx: "text/plain",
  py: "text/plain", go: "text/plain", rs: "text/plain", rb: "text/plain",
  java: "text/plain", c: "text/plain", cc: "text/plain", cpp: "text/plain",
  h: "text/plain", hpp: "text/plain", cs: "text/plain", php: "text/plain",
  swift: "text/plain", kt: "text/plain", kts: "text/plain",
  sh: "text/plain", bash: "text/plain", zsh: "text/plain",
  sql: "text/plain", yaml: "text/plain", yml: "text/plain",
  toml: "text/plain", ini: "text/plain", jsonc: "text/plain",
  css: "text/css", scss: "text/plain", less: "text/plain", xml: "application/xml",
  // Plain text (vj9). Free-tier.
  txt: "text/plain", log: "text/plain", text: "text/plain",
  // Office documents (wxj) — doc (.docx) + sheet (.csv/.xlsx). Free-tier, v1.
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/**
 * Skill files are detected by FILENAME, not extension (mirrors detectKind):
 * `SKILL.md`, `*.skill.md`, `*.skill` → the "skill" kind.
 */
function isSkillFile(filename: string): boolean {
  const b = basename(filename).toLowerCase();
  return b === "skill.md" || b.endsWith(".skill.md") || b.endsWith(".skill");
}

function detectContentType(filename: string): string {
  if (isSkillFile(filename)) return "text/markdown";
  const ext = extname(filename).replace(/^\./, "").toLowerCase();
  return EXTENSION_TO_MIME[ext] ?? "application/octet-stream";
}

/** Sorted list of supported single-file extensions, for error messages. */
const SUPPORTED_EXTENSIONS = Object.keys(EXTENSION_TO_MIME).sort();

/**
 * True if the CLI recognises this filename as an uploadable single file.
 * Mirrors `lib/uploads/types.ts` detectKind acceptance (extension map + skill
 * filenames). Lets us reject unsupported files client-side before signing,
 * instead of burning a PUT and failing at finalize with `unsupported_file_type`.
 */
export function isSupportedUpload(filename: string): boolean {
  if (isSkillFile(filename)) return true;
  const ext = extname(filename).replace(/^\./, "").toLowerCase();
  return ext in EXTENSION_TO_MIME;
}

/**
 * Serveable bundle-asset extensions → the MIME sent on the wire (the bundle/sign
 * `content_type` and the matching PUT `Content-Type`). These are the extensions
 * the server's allowlist (lib/uploads/bundle-path.ts:ASSET_CONTENT_TYPES) accepts;
 * a file whose extension isn't here is skipped from a folder upload (the server
 * would reject the whole bundle otherwise — e.g. a stray .DS_Store or README.md).
 *
 * MUST be bare types with NO `; charset=…` parameter. The uploads Worker checks
 * the PUT against the signed token's `mime` claim by stripping parameters from
 * the actual header but comparing it against the VERBATIM claim — so a
 * charset-qualified value ("text/css; charset=utf-8") never matches the stripped
 * "text/css" and fails with `mime_mismatch`. (The server re-derives the stored
 * content-type from the extension at finalize, so charset isn't lost on serve.)
 */
const BUNDLE_ASSET_MIME: Record<string, string> = {
  js: "text/javascript",
  mjs: "text/javascript",
  css: "text/css",
  json: "application/json",
  map: "application/json",
  csv: "text/csv",
  txt: "text/plain",
  svg: "image/svg+xml",
  png: "image/png",
  apng: "image/apng",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  wasm: "application/wasm",
};

function bundleAssetMime(filename: string): string | undefined {
  const ext = extname(filename).replace(/^\./, "").toLowerCase();
  return BUNDLE_ASSET_MIME[ext];
}

/** True when a path points at an existing directory. */
function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
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
    // Guard the single-file path against a directory — streaming a dir into the
    // PUT body fails late with an opaque "fetch failed". `sharedrop upload <dir>`
    // routes folders to the bundle pipeline; `update` has no bundle path yet.
    if (stat.isDirectory()) {
      throw new SharedropApiError(
        "UNSUPPORTED_INPUT",
        `"${filePath}" is a directory. Use \`sharedrop upload <folder>\` to upload it as a bundle; folder bundles aren't supported here.`,
        400,
      );
    }
    size_bytes = stat.size;
    filename = basename(abs);
    // Reject unsupported extensions client-side, before signing/PUT — otherwise
    // the file streams to storage and only fails at finalize with
    // `unsupported_file_type`, after burning bandwidth and quota checks.
    if (!isSupportedUpload(filename)) {
      throw new SharedropApiError(
        "UNSUPPORTED_FILE_TYPE",
        `Unsupported file type: ${filename}. Supported: ${SUPPORTED_EXTENSIONS.join(", ")}. (Upload a folder as an HTML bundle with \`sharedrop upload <folder>\`.)`,
        400,
      );
    }
    content_type = detectContentType(filename);
    bodyStream = createReadStream(abs);
  }

  // Step 1 — sign. On a re-upload (--page-id), pass page_id so sign exempts the
  // page-count cap (260703-pzs); finalize re-checks the cap on its create branch.
  const signed = await client.signUpload({
    filename,
    content_type,
    size_bytes,
    workspace: options.workspace,
    page_id: options.pageId,
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

// ── Folder / bundle upload (#81) ──────────────────────────────────────────
//
// `sharedrop upload <dir>` ships a multi-file interactive page: one entry HTML
// (default index.html) plus its relative assets (css/js/images/fonts/data).
// Mirrors the dashboard + MCP `finalize_bundle` flow against the same server
// endpoints, so relative refs in the HTML keep resolving and JS runs without
// inlining anything.

/** A maximum that matches the server's MAX_BUNDLE_ASSETS (lib/uploads/bundle-path.ts). */
const MAX_BUNDLE_ASSETS = 100;

interface BundleEntry {
  /** Path as referenced in the entry HTML / sent to finalize. Root is "index.html". */
  refPath: string;
  /** Absolute path on disk. */
  abs: string;
  /** MIME for the sign request + PUT Content-Type. */
  contentType: string;
  size: number;
}

/** Recursively collect every file under `dir`, returning POSIX paths relative to it. */
function walkFiles(dir: string): string[] {
  const out: string[] = [];
  const visit = (current: string) => {
    for (const dirent of readdirSync(current, { withFileTypes: true })) {
      const abs = join(current, dirent.name);
      if (dirent.isDirectory()) {
        visit(abs);
      } else if (dirent.isFile()) {
        out.push(relative(dir, abs).split(sep).join("/"));
      }
    }
  };
  visit(dir);
  return out;
}

interface BundlePlan {
  entries: BundleEntry[];
  /** Files left out because their type isn't a serveable bundle asset. */
  skipped: string[];
}

/**
 * Plan a folder upload: resolve the entry HTML, classify every other file as a
 * serveable asset or skip it. Throws a clear validation error (no network) when
 * the entry is missing or the asset count exceeds the server cap.
 */
function planBundleUpload(dir: string, entry: string): BundlePlan {
  const entryRel = entry.split(sep).join("/").replace(/^\.\//, "");
  const all = walkFiles(dir);

  const entryAbs = join(dir, entryRel);
  if (!all.includes(entryRel)) {
    throw new SharedropApiError(
      "VALIDATION_ERROR",
      `No "${entryRel}" found in ${dir}. A folder upload needs an entry HTML file — ` +
        `name it index.html or pass --entry <file>.`,
      400,
    );
  }

  const entries: BundleEntry[] = [
    {
      refPath: "index.html",
      abs: entryAbs,
      contentType: "text/html",
      size: statSync(entryAbs).size,
    },
  ];
  const skipped: string[] = [];

  for (const rel of all) {
    if (rel === entryRel) continue;
    const contentType = bundleAssetMime(rel);
    if (!contentType) {
      skipped.push(rel);
      continue;
    }
    const abs = join(dir, rel);
    entries.push({ refPath: rel, abs, contentType, size: statSync(abs).size });
  }

  const assetCount = entries.length - 1;
  if (assetCount > MAX_BUNDLE_ASSETS) {
    throw new SharedropApiError(
      "VALIDATION_ERROR",
      `Bundle has ${assetCount} assets — the limit is ${MAX_BUNDLE_ASSETS}.`,
      400,
    );
  }

  return { entries, skipped };
}

/**
 * Stream a folder bundle: batch-sign the manifest, PUT each file to its signed
 * Worker URL, then finalize into one page. Returns the same shape as
 * `uploadFileStreamed` so the caller's formatting is unchanged.
 */
export async function uploadBundleStreamed(
  client: SharedropApiClient,
  dir: string,
  entry: string,
  options: PipelineOptions,
): Promise<{ url: string; title: string; page_id: string; skipped: string[] }> {
  const absDir = resolvePath(dir);
  const { entries, skipped } = planBundleUpload(absDir, entry);

  // Step 1 — one batch sign for the whole manifest (single rate-limit charge).
  // On a re-upload (--page-id), pass page_id so sign exempts the page-count cap
  // (260703-pzs); bundle finalize re-checks the cap on its create branch.
  const signed = await client.signBundle({
    files: entries.map((e) => ({
      filename: basename(e.refPath),
      content_type: e.contentType,
      size_bytes: e.size,
    })),
    workspace: options.workspace,
    page_id: options.pageId,
  });

  // Step 2 — stream each file to its own signed Worker URL.
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const slot = signed.files[i];
    await client.streamUpload(
      slot.upload_url,
      slot.upload_token,
      createReadStream(e.abs),
      e.contentType,
      e.size,
    );
  }

  // Step 3 — finalize the bundle into one page.
  const result = await client.finalizeBundle({
    files: entries.map((e, i) => ({
      path: e.refPath,
      object_key: signed.files[i].object_key,
      upload_token: signed.files[i].upload_token,
    })),
    title: options.title,
    visibility: options.visibility,
    mode: options.mode,
    workspace_id: options.workspace,
    page_id: options.pageId,
  });

  return {
    url: result.url,
    title: options.title ?? basename(absDir),
    page_id: result.page_id,
    skipped,
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
    entry?: string;
  },
  globalOpts: { url?: string; token?: string } = {},
): Promise<void> {
  try {
    const auth = await resolveAuth(globalOpts.token);
    requireAuth(auth);

    const baseUrl = resolveBaseUrl(globalOpts.url);
    const client = new SharedropApiClient({ apiKey: auth.token, baseUrl });

    const replacing = Boolean(opts.pageId);
    // A directory uploads as a multi-file bundle; "-" and plain files stay on
    // the single-file streamed path.
    const bundle = file !== "-" && isDirectory(file);

    const useSpinner = isTTY() && !shouldOutputJson(opts);
    const spinner = useSpinner ? ora(replacing ? "Updating..." : "Uploading...").start() : null;

    try {
      const pipelineOpts = {
        // Default the title from the filename only for a brand-new single file.
        // On a re-upload (`--page-id`) send no title so the server keeps the page's
        // existing title; bundles derive their title server-side too.
        title: opts.title || (opts.pageId || bundle ? undefined : defaultTitle(file)),
        visibility: opts.visibility as "public" | "private" | "shared" | undefined,
        mode: opts.mode as "static" | "interactive" | undefined,
        workspace: opts.workspace,
        pageId: opts.pageId,
      };

      let skipped: string[] = [];
      let result: { url: string; title: string; page_id: string };
      if (bundle) {
        const out = await uploadBundleStreamed(client, file, opts.entry ?? "index.html", pipelineOpts);
        skipped = out.skipped;
        result = out;
      } else {
        result = await uploadFileStreamed(client, file, pipelineOpts);
      }

      if (spinner) spinner.succeed(replacing ? "Updated" : "Uploaded");
      console.log(formatUploadResult(result, baseUrl, opts));
      // Surface skipped non-serveable files so a missing asset isn't a silent
      // mystery (kept off stdout/JSON so it never pollutes machine output).
      if (skipped.length > 0 && !shouldOutputJson(opts)) {
        console.error(
          `Skipped ${skipped.length} unsupported file${skipped.length === 1 ? "" : "s"}: ${skipped.slice(0, 10).join(", ")}${skipped.length > 10 ? "…" : ""}`,
        );
      }
    } catch (err) {
      if (spinner) spinner.fail(replacing ? "Update failed" : "Upload failed");
      throw err;
    }
  } catch (err) {
    handleError(err, opts);
  }
}
