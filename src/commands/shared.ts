// #446: list the pages other people have shared with you. Shares belong to a
// person, so an sdw_ workspace key is refused by the server.

import { SharedropApiClient } from "../client/api-client.js";
import { resolveAuth, resolveBaseUrl } from "../auth/resolve.js";
import { requireAuth, handleError } from "../output/errors.js";
import { formatSharedList } from "../output/format.js";

export async function sharedCommand(
  opts: { limit?: string; cursor?: string; json?: boolean },
  globalOpts: { url?: string; token?: string } = {},
): Promise<void> {
  try {
    const auth = await resolveAuth(globalOpts.token);
    requireAuth(auth);

    const baseUrl = resolveBaseUrl(globalOpts.url);
    const client = new SharedropApiClient({ apiKey: auth.token, baseUrl });

    const limit = opts.limit ? parseInt(opts.limit, 10) : 50;
    const { data, pagination } = await client.listSharedWithMe({
      limit,
      cursor: opts.cursor,
    });

    console.log(formatSharedList(data, pagination, opts));
  } catch (err) {
    handleError(err, opts);
  }
}
