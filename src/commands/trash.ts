import { resolveAuth, resolveBaseUrl } from "../auth/resolve.js";
import { resolveWorkspace, staleDefaultHint, type WorkspaceChoice } from "../auth/workspace.js";
import { SharedropApiClient } from "../client/api-client.js";
import { requireAuth, handleError } from "../output/errors.js";
import { formatArchiveSize } from "./archive.js";
import { formatTrashEmptied, formatTrashList } from "../output/format.js";

interface GlobalOpts {
  url?: string;
  token?: string;
}

/**
 * Permanently empty the trash. #410: --workspace (or the default workspace)
 * empties that workspace's trash: an owner every item, a member their own items
 * and the trashed folders.
 */
export async function trashEmptyCommand(
  opts: { workspace?: string; personal?: boolean; json?: boolean },
  globalOpts: GlobalOpts = {},
): Promise<void> {
  const auth = await resolveAuth(globalOpts.token);
  requireAuth(auth);

  let ws: WorkspaceChoice | undefined;
  try {
    const baseUrl = resolveBaseUrl(globalOpts.url);
    const client = new SharedropApiClient({ apiKey: auth.token, baseUrl });
    ws = resolveWorkspace(opts, baseUrl, auth.token);
    const result = await client.emptyTrash(ws.workspace);
    console.log(
      formatTrashEmptied(result, formatArchiveSize(result.freedBytes), opts),
    );
  } catch (error) {
    handleError(error, opts, staleDefaultHint(error, ws));
  }
}

/** #408: list trashed pages and folders, or a workspace's with --workspace. */
export async function trashListCommand(
  opts: { workspace?: string; personal?: boolean; json?: boolean },
  globalOpts: GlobalOpts = {},
): Promise<void> {
  const auth = await resolveAuth(globalOpts.token);
  requireAuth(auth);

  let ws: WorkspaceChoice | undefined;
  try {
    const baseUrl = resolveBaseUrl(globalOpts.url);
    const client = new SharedropApiClient({ apiKey: auth.token, baseUrl });
    ws = resolveWorkspace(opts, baseUrl, auth.token);
    const { items } = await client.listTrash(ws.workspace);
    console.log(formatTrashList(items, opts));
  } catch (error) {
    handleError(error, opts, staleDefaultHint(error, ws));
  }
}
