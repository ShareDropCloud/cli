import { SharedropApiClient } from "../client/api-client.js";
import { normalizePageRef } from "../client/page-ref.js";
import { resolveAuth, resolveBaseUrl } from "../auth/resolve.js";
import { requireAuth, handleError } from "../output/errors.js";
import { formatPage } from "../output/format.js";

export async function getCommand(
  id: string,
  opts: { json?: boolean },
  globalOpts: { url?: string; token?: string } = {},
): Promise<void> {
  try {
    const auth = await resolveAuth(globalOpts.token);
    requireAuth(auth);

    const baseUrl = resolveBaseUrl(globalOpts.url);
    const client = new SharedropApiClient({ apiKey: auth.token, baseUrl });

    const page = await client.getPage(normalizePageRef(id));
    console.log(formatPage(page, opts));
  } catch (err) {
    handleError(err, opts);
  }
}
