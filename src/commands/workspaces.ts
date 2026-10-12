// #408: list the workspaces this account belongs to, so an agent can pass a
// workspace address (or id) to --workspace.
// #409: `workspaces use` saves a default workspace for this server.

import { SharedropApiClient, SharedropApiError } from "../client/api-client.js";
import { resolveAuth, resolveBaseUrl } from "../auth/resolve.js";
import { clearSavedWorkspace, saveWorkspace } from "../auth/store.js";
import {
  describeDefault,
  findWorkspace,
  getDefaultWorkspace,
  isWorkspaceKey,
  noteKeyIgnoresDefault,
} from "../auth/workspace.js";
import { requireAuth, handleError } from "../output/errors.js";
import { formatWorkspaceList, formatWorkspaceUse } from "../output/format.js";

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

export async function workspacesCommand(
  opts: { json?: boolean },
  globalOpts: { url?: string; token?: string } = {},
): Promise<void> {
  try {
    const auth = await resolveAuth(globalOpts.token);
    requireAuth(auth);

    const baseUrl = resolveBaseUrl(globalOpts.url);
    const client = new SharedropApiClient({ apiKey: auth.token, baseUrl });

    const { workspaces } = await client.listWorkspaces();
    // #409: an sdw_ key always uses its own workspace, so no default is active.
    const workspaceKey = isWorkspaceKey(auth.token);
    if (workspaceKey) noteKeyIgnoresDefault(getDefaultWorkspace(baseUrl), opts);
    const active = workspaceKey ? null : describeDefault(baseUrl, workspaces);
    console.log(formatWorkspaceList(workspaces, opts, active));
  } catch (err) {
    handleError(err, opts);
  }
}

export async function workspacesUseCommand(
  ref: string | undefined,
  opts: { clear?: boolean; json?: boolean },
  globalOpts: { url?: string; token?: string } = {},
): Promise<void> {
  try {
    if (Boolean(ref) === Boolean(opts.clear)) {
      throw new SharedropApiError(
        "VALIDATION_ERROR",
        "Pass a workspace id or address, or --clear.",
        400,
      );
    }
    const baseUrl = resolveBaseUrl(globalOpts.url);
    const host = hostOf(baseUrl);

    let workspace = null;
    let cleared: boolean | undefined;
    if (opts.clear) {
      cleared = clearSavedWorkspace(baseUrl);
    } else {
      const auth = await resolveAuth(globalOpts.token);
      requireAuth(auth);
      if (isWorkspaceKey(auth.token)) {
        throw new SharedropApiError(
          "VALIDATION_ERROR",
          "This sdw_ key is bound to its own workspace, so a default workspace would never apply. Use a personal key or `sharedrop login` to set one.",
          400,
        );
      }
      const client = new SharedropApiClient({ apiKey: auth.token, baseUrl });
      const { workspaces } = await client.listWorkspaces();
      const match = findWorkspace(workspaces, ref as string);
      if (!match) {
        throw new SharedropApiError(
          "NOT_FOUND",
          "Workspace not found or you are not a member",
          404,
        );
      }
      saveWorkspace(baseUrl, { id: match.id, slug: match.slug });
      workspace = match;
    }

    const active = getDefaultWorkspace(baseUrl);
    const overriddenBy = active && active.source !== "saved" ? active.source : undefined;
    console.log(formatWorkspaceUse({ workspace, cleared, host, overriddenBy }, opts));
  } catch (err) {
    handleError(err, opts);
  }
}
