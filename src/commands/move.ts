// #191 — top-level `move <id>`: move a PAGE into a folder or back to your top
// level. A page reparent goes through the same `movePage` (PUT /api/pages/:id)
// spine the dashboard + MCP use; --folder resolves a uuid directly or walks/
// auto-creates a slash path (mirrors `upload --folder`), --root sends null.

import { SharedropApiClient, SharedropApiError } from "../client/api-client.js";
import { resolveAuth, resolveBaseUrl } from "../auth/resolve.js";
import { requireAuth, handleError } from "../output/errors.js";
import { resolveDestinationFolder } from "./folder.js";
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
      parentId = await resolveDestinationFolder(client, opts.folder as string, { create: true });
    }

    await client.movePage(id, parentId);
    console.log(formatPageMoved(id, parentId, opts));
  } catch (err) {
    handleError(err, opts);
  }
}
