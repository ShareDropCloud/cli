import { SharedropApiClient } from "../client/api-client.js";
import { resolveAuth, resolveBaseUrl } from "../auth/resolve.js";
import { requireAuth, handleError } from "../output/errors.js";
import { formatPageList } from "../output/format.js";

export async function searchCommand(
  query: string,
  opts: {
    limit?: string;
    cursor?: string;
    json?: boolean;
    workspace?: string;
  },
  globalOpts: { url?: string; token?: string } = {},
): Promise<void> {
  try {
    const auth = await resolveAuth(globalOpts.token);
    requireAuth(auth);

    const baseUrl = resolveBaseUrl(globalOpts.url);
    const client = new SharedropApiClient({ apiKey: auth.token, baseUrl });

    const limit = opts.limit ? parseInt(opts.limit, 10) : 50;
    const { data, pagination } = await client.listPages({
      limit,
      cursor: opts.cursor,
      workspace: opts.workspace,
      search: query,
    });

    console.log(formatPageList(data, pagination, opts));
  } catch (err) {
    handleError(err, opts);
  }
}
