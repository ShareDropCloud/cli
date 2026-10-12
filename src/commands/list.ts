import { SharedropApiClient } from "../client/api-client.js";
import type { V1Page } from "../client/types.js";
import { resolveAuth, resolveBaseUrl } from "../auth/resolve.js";
import { resolveWorkspace, staleDefaultHint, type WorkspaceChoice } from "../auth/workspace.js";
import { requireAuth, handleError } from "../output/errors.js";
import { formatPageList } from "../output/format.js";
import { resolveDestinationFolder } from "./folder.js";

export async function listCommand(
  opts: {
    limit?: string;
    cursor?: string;
    json?: boolean;
    workspace?: string;
    personal?: boolean;
    folder?: string;
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

    // --folder scopes the listing to one folder's pages. There is no folder-aware
    // v1 list endpoint, so we resolve the folder (existing only, no create on a
    // read) and filter the owner tree client-side. #410: in a workspace, its tree.
    if (opts.folder) {
      const folderId = await resolveDestinationFolder(client, opts.folder, {
        create: false,
        workspace: ws.workspace,
      });
      const me = await client.getMe();
      const { pages } = await client.listTree(me.username, ws.workspace);
      const rows: V1Page[] = pages
        .filter((n) => n.nodeType === "page" && (n.parentId ?? null) === folderId)
        .map((n) => {
          const slug = n.slug ?? "";
          const created = n.createdAt ?? new Date(0).toISOString();
          return {
            id: n.id,
            slug,
            title: n.title,
            mode: n.mode ?? "static",
            file_size: n.fileSize ?? 0,
            visibility: n.visibility ?? "private",
            // #410: the server's /<owner>/<slug> path (the owner is the workspace
            // address for a workspace page). An older server sends none: fall back
            // to the path of its fullUrl, then to the caller's own handle.
            url:
              n.url ??
              (n.fullUrl
                ? n.fullUrl.replace(/^https?:\/\/[^/]+/, "")
                : `/${me.username}/${slug}`),
            // #271: the server owns the recipient URL (branded when the owner
            // has a live custom domain), so never reassemble it from baseUrl.
            full_url:
              n.fullUrl ?? `${baseUrl.replace(/\/$/, "")}/${me.username}/${slug}`,
            created_at: created,
            updated_at: n.updatedAt ?? created,
          };
        });
      console.log(formatPageList(rows, { next_cursor: null, has_more: false }, opts));
      return;
    }

    const limit = opts.limit ? parseInt(opts.limit, 10) : 50;
    const { data, pagination } = await client.listPages({
      limit,
      cursor: opts.cursor,
      workspace: ws.workspace,
    });

    console.log(formatPageList(data, pagination, opts));
  } catch (err) {
    handleError(err, opts, staleDefaultHint(err, ws));
  }
}
