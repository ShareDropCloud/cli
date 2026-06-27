import chalk from "chalk";
import { SharedropApiClient } from "../client/api-client.js";
import { normalizePageRef } from "../client/page-ref.js";
import { resolveAuth, resolveBaseUrl } from "../auth/resolve.js";
import { requireAuth, handleError, EXIT_CODES } from "../output/errors.js";
import { formatPage, isTTY, shouldOutputJson } from "../output/format.js";
import { uploadFileStreamed } from "./upload.js";

export async function updateCommand(
  id: string,
  file: string | undefined,
  opts: { title?: string; visibility?: string; mode?: string; json?: boolean },
  globalOpts: { url?: string; token?: string } = {},
): Promise<void> {
  try {
    if (!file && !opts.title && !opts.visibility) {
      if (shouldOutputJson(opts)) {
        console.error(JSON.stringify({ error: { code: "VALIDATION_ERROR", message: "Nothing to update. Provide a file to replace content, or --title / --visibility." } }, null, 2));
      } else {
        console.error(chalk.red("Nothing to update. Provide a file to replace content, or --title / --visibility."));
      }
      process.exit(EXIT_CODES.VALIDATION_ERROR);
    }

    const auth = await resolveAuth(globalOpts.token);
    requireAuth(auth);

    const baseUrl = resolveBaseUrl(globalOpts.url);
    const client = new SharedropApiClient({ apiKey: auth.token, baseUrl });
    const ref = normalizePageRef(id);

    let page;
    if (file) {
      // Re-upload via the streamed pipeline targeting the existing page_id.
      // The finalize endpoint accepts a `page_id` so the slug/URL stay stable.
      await uploadFileStreamed(client, file, {
        // No `--title` on an update means "keep the current title" — replacing
        // content shouldn't rename the page. Sending the filename stem here forced
        // a rename; leaving it undefined lets the server preserve the existing title.
        title: opts.title,
        mode: opts.mode as "static" | "interactive" | undefined,
        pageId: ref,
      });
      // Pull the latest page row for display + optional visibility update.
      page = await client.getPage(ref);
      if (opts.visibility) {
        page = await client.updatePage(ref, { visibility: opts.visibility });
      }
    } else {
      const updates: { title?: string; visibility?: string } = {};
      if (opts.title) updates.title = opts.title;
      if (opts.visibility) updates.visibility = opts.visibility;
      page = await client.updatePage(ref, updates);
    }

    if (isTTY() && !shouldOutputJson(opts)) {
      console.log(chalk.green("Updated"));
    }
    console.log(formatPage(page, opts));
  } catch (err) {
    handleError(err, opts);
  }
}
