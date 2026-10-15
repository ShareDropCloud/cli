import { SharedropApiClient } from "../client/api-client.js";
import { normalizePageRef } from "../client/page-ref.js";
import { resolveAuth, resolveBaseUrl } from "../auth/resolve.js";
import { requireAuth, handleError } from "../output/errors.js";
import { formatVersionList } from "../output/format.js";

/**
 * #418: `sharedrop versions <page>` lists a page's versions (the live one
 * first) from GET /api/v1/pages/:id/versions. A table on a terminal, JSON with
 * --json or when stdout is not a terminal. Download one with
 * `sharedrop download <page> --version <number|latest>`.
 */
export async function versionsCommand(
  id: string,
  opts: { json?: boolean },
  globalOpts: { url?: string; token?: string } = {},
): Promise<void> {
  try {
    const auth = await resolveAuth(globalOpts.token);
    requireAuth(auth);

    const baseUrl = resolveBaseUrl(globalOpts.url);
    const client = new SharedropApiClient({ apiKey: auth.token, baseUrl });

    const versions = await client.listVersions(normalizePageRef(id));
    console.log(formatVersionList(versions, opts));
  } catch (err) {
    handleError(err, opts);
  }
}
