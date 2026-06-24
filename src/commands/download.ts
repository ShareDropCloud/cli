import { writeFileSync } from "node:fs";
import { SharedropApiClient } from "../client/api-client.js";
import { normalizePageRef } from "../client/page-ref.js";
import { resolveAuth, resolveBaseUrl } from "../auth/resolve.js";
import { requireAuth, handleError } from "../output/errors.js";

/**
 * #139 — `sharedrop download <id>` writes a page's artefact zip to disk.
 *
 * Output target:
 *   - "-"                  → stream the raw zip bytes to stdout (no log line)
 *   - --output <path>      → write to that path
 *   - (default)            → write to "<id>.zip"
 *
 * The filename defaults to the page ref (not the page slug): the slug is not
 * available client-side without an extra GET round-trip, so we use the supplied
 * ref. Pass -o to control the exact filename.
 */
export async function downloadCommand(
  id: string,
  opts: { output?: string; json?: boolean },
  globalOpts: { url?: string; token?: string } = {},
): Promise<void> {
  try {
    const auth = await resolveAuth(globalOpts.token);
    requireAuth(auth);

    const baseUrl = resolveBaseUrl(globalOpts.url);
    const client = new SharedropApiClient({ apiKey: auth.token, baseUrl });

    const ref = normalizePageRef(id);
    const buf = await client.downloadPage(ref);

    if (opts.output === "-") {
      process.stdout.write(buf);
      return;
    }

    const path = opts.output ?? `${ref}.zip`;
    writeFileSync(path, buf);
    console.log(`Downloaded ${ref} → ${path} (${buf.length} bytes)`);
  } catch (err) {
    handleError(err, opts);
  }
}
