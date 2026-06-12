import { SharedropApiClient } from "../client/api-client.js";
import { normalizePageRef } from "../client/page-ref.js";
import { resolveAuth, resolveBaseUrl } from "../auth/resolve.js";
import { requireAuth, handleError } from "../output/errors.js";
import { formatDelete, isTTY, shouldOutputJson } from "../output/format.js";

export async function deleteCommand(
  id: string,
  opts: { json?: boolean },
  globalOpts: { url?: string; token?: string } = {},
): Promise<void> {
  try {
    const auth = await resolveAuth(globalOpts.token);
    requireAuth(auth);

    const baseUrl = resolveBaseUrl(globalOpts.url);
    const client = new SharedropApiClient({ apiKey: auth.token, baseUrl });
    const ref = normalizePageRef(id);

    // Fetch page title for human-friendly output
    let pageTitle = ref;
    if (isTTY() && !shouldOutputJson(opts)) {
      try {
        const page = await client.getPage(ref);
        pageTitle = page.title;
      } catch {
        // If we can't get the title, use the ID
      }
    }

    await client.deletePage(ref);
    console.log(formatDelete(pageTitle, opts));
  } catch (err) {
    handleError(err, opts);
  }
}
