// #191, top-level `move <id>`: move a PAGE into a folder or back to your top
// level. A page reparent goes through the same `movePage` (PUT /api/pages/:id)
// spine the dashboard + MCP use; --folder resolves a uuid directly or walks/
// auto-creates a slash path (mirrors `upload --folder`), --root sends null.
// #410: a path resolves in the page's own space (its workspace's tree for a
// workspace page), so it never creates folders in the wrong tree.

import { SharedropApiClient, SharedropApiError } from "../client/api-client.js";
import { resolveAuth, resolveBaseUrl } from "../auth/resolve.js";
import { requireAuth, handleError } from "../output/errors.js";
import { resolveDestinationFolder, UUID_RE } from "./folder.js";
import { formatPageMoved } from "../output/format.js";

interface GlobalOpts {
  url?: string;
  token?: string;
}

export async function moveCommand(
  id: string,
  opts: { folder?: string; root?: boolean; json?: boolean },
  globalOpts: GlobalOpts = {},
): Promise<void> {
  try {
    // Exactly one destination: --folder <id|path> or --root. Reject before auth
    // so a bad flag combo fails fast with a clear validation message.
    if (Boolean(opts.folder) === Boolean(opts.root)) {
      throw new SharedropApiError(
        "VALIDATION_ERROR",
        "Specify exactly one destination: --folder <id|path> or --root.",
        400,
      );
    }

    const auth = await resolveAuth(globalOpts.token);
    requireAuth(auth);
    const baseUrl = resolveBaseUrl(globalOpts.url);
    const client = new SharedropApiClient({ apiKey: auth.token, baseUrl });

    let parentId: string | null;
    if (opts.root) {
      parentId = null;
    } else {
      // uuid used directly, else a path is walked/auto-created (FOLDERS_RESTRICTED
      // and any walk error propagate so a page never silently lands at root).
      const folder = opts.folder as string;
      const workspace = UUID_RE.test(folder.trim()) ? undefined : await pageWorkspace(client, id);
      parentId = await resolveDestinationFolder(client, folder, { create: true, workspace });
    }

    await client.movePage(id, parentId);
    console.log(formatPageMoved(id, parentId, opts));
  } catch (err) {
    handleError(err, opts);
  }
}

/**
 * #410: the workspace address of a page, or undefined for a personal page. The
 * page's url is `/<owner>/<slug>`, and the owner is the workspace's address for
 * a workspace page (usernames and workspace addresses share one namespace).
 */
async function pageWorkspace(client: SharedropApiClient, id: string): Promise<string | undefined> {
  const [page, me] = await Promise.all([client.getPage(id), client.getMe()]);
  const owner = page.url.split("/")[1];
  return owner && owner !== me.username ? owner : undefined;
}
