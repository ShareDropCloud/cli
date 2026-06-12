import { SharedropApiClient } from "../client/api-client.js";
import { normalizePageRef } from "../client/page-ref.js";
import { resolveAuth, resolveBaseUrl } from "../auth/resolve.js";
import { requireAuth, handleError } from "../output/errors.js";
import { formatShare } from "../output/format.js";

export async function shareCommand(
  id: string,
  opts: { email: string; json?: boolean },
  globalOpts: { url?: string; token?: string } = {},
): Promise<void> {
  try {
    const auth = await resolveAuth(globalOpts.token);
    requireAuth(auth);

    const baseUrl = resolveBaseUrl(globalOpts.url);
    const client = new SharedropApiClient({ apiKey: auth.token, baseUrl });
    const ref = normalizePageRef(id);

    // Fetch page title for human-friendly output
    const page = await client.getPage(ref);
    const grant = await client.sharePage(ref, opts.email);
    console.log(formatShare(grant, page.title, opts));
  } catch (err) {
    handleError(err, opts);
  }
}
