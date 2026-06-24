import { writeFileSync } from "node:fs";
import { SharedropApiClient } from "../client/api-client.js";
import { normalizePageRef } from "../client/page-ref.js";
import { resolveAuth, resolveBaseUrl } from "../auth/resolve.js";
import { requireAuth, handleError } from "../output/errors.js";

/**
 * #140 — `sharedrop fetch <id>` pulls a page's RAW content (token handoff).
 *
 * Distinct from `download` (which writes a zip of the whole artefact): this
 * mints a short-lived signed URL, GETs the raw bytes, and emits just the page's
 * root document.
 *
 * Output target:
 *   - (default)            → stream the raw bytes to stdout (no log line)
 *   - "-"                  → stream the raw bytes to stdout (explicit)
 *   - --output <path>      → write to that path
 */
export async function fetchCommand(
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
    const buf = await client.fetchPage(ref);

    if (opts.output && opts.output !== "-") {
      writeFileSync(opts.output, buf);
      console.log(`Fetched ${ref} → ${opts.output} (${buf.length} bytes)`);
      return;
    }

    process.stdout.write(buf);
  } catch (err) {
    handleError(err, opts);
  }
}
