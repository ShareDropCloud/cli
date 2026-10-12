import { SharedropApiClient } from "../client/api-client.js";
import { resolveAuth, resolveBaseUrl } from "../auth/resolve.js";
import { resolveWorkspace, staleDefaultHint, type WorkspaceChoice } from "../auth/workspace.js";
import { requireAuth, handleError } from "../output/errors.js";
import { formatPageList } from "../output/format.js";

export async function searchCommand(
  query: string,
  opts: {
    limit?: string;
    cursor?: string;
    json?: boolean;
    workspace?: string;
    personal?: boolean;
  },
  globalOpts: { url?: string; token?: string } = {},
): Promise<void> {
  let ws: WorkspaceChoice | undefined;
  try {
    const auth = await resolveAuth(globalOpts.token);
    requireAuth(auth);

    const baseUrl = resolveBaseUrl(globalOpts.url);
    const client = new SharedropApiClient({ apiKey: auth.token, baseUrl });
    ws = resolveWorkspace(opts, baseUrl, auth.token);

    const limit = opts.limit ? parseInt(opts.limit, 10) : 50;
    const { data, pagination } = await client.listPages({
      limit,
      cursor: opts.cursor,
      workspace: ws.workspace,
      search: query,
    });

    console.log(formatPageList(data, pagination, opts));
  } catch (err) {
    handleError(err, opts, staleDefaultHint(err, ws));
  }
}
