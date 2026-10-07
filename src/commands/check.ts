import ora from "ora";
import {
  SharedropApiClient,
  SharedropApiError,
  type LintResponse,
} from "../client/api-client.js";
import { normalizePageRef } from "../client/page-ref.js";
import { resolveAuth, resolveBaseUrl } from "../auth/resolve.js";
import { requireAuth, handleError, EXIT_CODES } from "../output/errors.js";
import { isTTY, shouldOutputJson } from "../output/format.js";
import {
  defaultTitle,
  isDirectory,
  planBundleUpload,
  prepareSingleFile,
  signPutBundle,
  signPutThen,
} from "./upload.js";

/**
 * What `check` prints under `data`: the lint response, or, when sign or the
 * PUT refuses the size before lint can run, a short size_ok false result.
 */
export type CheckResult =
  | LintResponse
  | {
      size_ok: false;
      size_bytes: number;
      size_limit_bytes: number | null;
      would_change: true;
      warnings: [];
      message: string;
    };

/** A size refusal from sign (402 FILE_SIZE_EXCEEDED) or the Worker PUT (413). */
function sizeRefusal(error: unknown): { limit: number | null } | null {
  if (!(error instanceof SharedropApiError)) return null;
  if (error.code === "FILE_SIZE_EXCEEDED") {
    return { limit: error.envelope?.limitBytes ?? null };
  }
  if (error.status === 413) return { limit: null };
  return null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatCheckResult(result: CheckResult, opts: { json?: boolean }): string {
  if (shouldOutputJson(opts)) {
    return JSON.stringify({ data: result }, null, 2);
  }
  const lines = [
    result.would_change
      ? "Check: uploading would change or block this content."
      : "Check: no changes. It would publish as-is.",
  ];
  if (!("kind" in result)) {
    const limit = result.size_limit_bytes ? ` (limit ${formatBytes(result.size_limit_bytes)})` : "";
    lines.push(`  Too large: ${formatBytes(result.size_bytes)}${limit}`, `  ${result.message}`);
    return lines.join("\n");
  }
  lines.push(
    `  Kind: ${result.kind}${result.detected_slides ? " (slides)" : ""}`,
    `  Mode: ${result.mode_effective}`,
    `  Size: ${formatBytes(result.size_bytes)} of ${formatBytes(result.size_limit_bytes)}${result.size_ok ? "" : " (too large)"}`,
    `  Scripts would run: ${result.scripts_would_run ? "yes" : "no"}`,
    `  External hosts: ${result.external_resource_hosts.length ? result.external_resource_hosts.join(", ") : "none"}`,
  );
  if (result.images_extracted > 0) {
    lines.push(`  Inline images moved to hosted storage: ${result.images_extracted}`);
  }
  if (result.files !== undefined) lines.push(`  Files: ${result.files}`);
  if (result.warnings.length) {
    lines.push("Warnings:", ...result.warnings.map((w) => `  ${w.message}`));
  }
  if (result.same_title_pages.length) {
    lines.push(
      "Other pages with this title:",
      ...result.same_title_pages.map((page) => `  ${page.full_url}`),
    );
  }
  return lines.join("\n");
}

/**
 * #383: `sharedrop check <file|folder>` runs the real server checks without
 * publishing. It signs and streams to quarantine like `upload`, then calls the
 * lint endpoint (never finalize). Exits 1 when the upload would change or block
 * anything, 0 otherwise.
 */
export async function checkCommand(
  path: string,
  opts: {
    mode?: string;
    pageId?: string;
    slides?: boolean;
    entry?: string;
    workspace?: string;
    json?: boolean;
  },
  globalOpts: { url?: string; token?: string } = {},
): Promise<void> {
  let result: CheckResult;
  try {
    const auth = await resolveAuth(globalOpts.token);
    requireAuth(auth);

    const baseUrl = resolveBaseUrl(globalOpts.url);
    const client = new SharedropApiClient({ apiKey: auth.token, baseUrl });
    const bundle = path !== "-" && isDirectory(path);
    if (bundle && opts.slides) {
      throw new SharedropApiError(
        "VALIDATION_ERROR",
        "--slides applies to a single HTML file, not a folder.",
        400,
      );
    }

    const pageId = opts.pageId ? normalizePageRef(opts.pageId) : undefined;
    const mode = opts.mode as "static" | "interactive" | undefined;
    const options = {
      // Mirror `upload`: a new single file is titled from its filename.
      title: pageId || bundle ? undefined : defaultTitle(path),
      ...(mode ? { mode } : {}),
      workspace: opts.workspace,
      pageId,
    };

    const spinner = isTTY() && !shouldOutputJson(opts) ? ora("Checking...").start() : null;
    let sizeBytes = 0;
    try {
      if (bundle) {
        const { entries } = planBundleUpload(path, opts.entry ?? "index.html");
        sizeBytes = entries.reduce((sum, e) => sum + e.size, 0);
        const files = await signPutBundle(client, entries, options);
        result = await client.lintBundle({
          files,
          ...(mode ? { mode } : {}),
          workspace_id: opts.workspace,
          page_id: pageId,
        });
      } else {
        const file = await prepareSingleFile(path);
        sizeBytes = file.size_bytes;
        result = await signPutThen(client, file, options, (signed) =>
          client.lintUpload({
            object_key: signed.object_key,
            upload_token: signed.upload_token,
            title: options.title,
            ...(mode ? { mode } : {}),
            // Lint reads workspace_id; it must match the scope sign put in the token.
            workspace_id: opts.workspace,
            page_id: pageId,
            ...(opts.slides ? { slides: true } : {}),
          }),
        );
      }
      spinner?.stop();
    } catch (error) {
      spinner?.stop();
      const refusal = sizeRefusal(error);
      if (!refusal) throw error;
      result = {
        size_ok: false,
        size_bytes: sizeBytes,
        size_limit_bytes: refusal.limit,
        would_change: true,
        warnings: [],
        message: (error as SharedropApiError).message,
      };
    }
  } catch (err) {
    handleError(err, opts);
  }

  console.log(formatCheckResult(result, opts));
  if (result.would_change) process.exit(EXIT_CODES.ERROR);
}
