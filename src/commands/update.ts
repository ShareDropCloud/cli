import chalk from "chalk";
import { SharedropApiClient } from "../client/api-client.js";
import { normalizePageRef } from "../client/page-ref.js";
import { resolveAuth, resolveBaseUrl } from "../auth/resolve.js";
import { requireAuth, handleError, EXIT_CODES } from "../output/errors.js";
import { formatPage, isTTY, shouldOutputJson } from "../output/format.js";
import {
  formatUploadResult,
  isDirectory,
  reportSkipped,
  uploadBundleStreamed,
  uploadFileStreamed,
  type UploadResult,
} from "./upload.js";

export async function updateCommand(
  id: string,
  file: string | undefined,
  opts: { title?: string; slug?: string; visibility?: string; mode?: string; json?: boolean },
  globalOpts: { url?: string; token?: string } = {},
): Promise<void> {
  try {
    if (!file && !opts.title && !opts.slug && !opts.visibility) {
      if (shouldOutputJson(opts)) {
        console.error(JSON.stringify({ error: { code: "VALIDATION_ERROR", message: "Nothing to update. Provide a file to replace content, or --title / --slug / --visibility." } }, null, 2));
      } else {
        console.error(chalk.red("Nothing to update. Provide a file to replace content, or --title / --slug / --visibility."));
      }
      process.exit(EXIT_CODES.VALIDATION_ERROR);
    }

    const auth = await resolveAuth(globalOpts.token);
    requireAuth(auth);

    const baseUrl = resolveBaseUrl(globalOpts.url);
    const client = new SharedropApiClient({ apiKey: auth.token, baseUrl });
    const ref = normalizePageRef(id);

    if (file) {
      // Re-upload via the streamed pipeline targeting the existing page_id, so
      // the slug/URL stay stable. A folder goes through the bundle pipeline.
      const pipelineOpts = {
        // No `--title` on an update means "keep the current title": replacing
        // content shouldn't rename the page. Sending the filename stem here forced
        // a rename; leaving it undefined lets the server preserve the existing title.
        title: opts.title,
        mode: opts.mode as "static" | "interactive" | undefined,
        pageId: ref,
      };
      let result: UploadResult = file !== "-" && isDirectory(file)
        ? await uploadBundleStreamed(client, file, "index.html", pipelineOpts)
        : await uploadFileStreamed(client, file, pipelineOpts);
      if (opts.slug || opts.visibility) {
        const page = await client.updatePage(ref, {
          ...(opts.slug ? { slug: opts.slug } : {}),
          ...(opts.visibility ? { visibility: opts.visibility } : {}),
        });
        result = {
          ...result,
          url: page.url,
          full_url: page.full_url,
          visibility: page.visibility,
        };
      }

      // #383: print the re-upload result (version, warnings and all), the same
      // shape as `upload`, instead of a page fetch that dropped the warnings.
      if (isTTY() && !shouldOutputJson(opts)) {
        console.log(chalk.green("Updated"));
      }
      console.log(formatUploadResult(result, baseUrl, opts));
      reportSkipped(result.skipped ?? [], opts);
      return;
    }

    const updates: { title?: string; slug?: string; visibility?: string } = {};
    if (opts.title) updates.title = opts.title;
    if (opts.slug) updates.slug = opts.slug;
    if (opts.visibility) updates.visibility = opts.visibility;
    const page = await client.updatePage(ref, updates);

    if (isTTY() && !shouldOutputJson(opts)) {
      console.log(chalk.green("Updated"));
    }
    console.log(formatPage(page, opts));
  } catch (err) {
    handleError(err, opts);
  }
}
