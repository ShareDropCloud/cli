import { SharedropApiClient } from "../client/api-client.js";
import { resolveAuth, resolveBaseUrl } from "../auth/resolve.js";
import {
  describeDefault,
  getDefaultWorkspace,
  isWorkspaceKey,
  noteKeyIgnoresDefault,
} from "../auth/workspace.js";
import { requireAuth, handleError } from "../output/errors.js";
import { formatWhoami } from "../output/format.js";

export async function whoamiCommand(
  opts: { json?: boolean },
  globalOpts: { url?: string; token?: string } = {},
): Promise<void> {
  try {
    const auth = await resolveAuth(globalOpts.token);
    requireAuth(auth);

    const baseUrl = resolveBaseUrl(globalOpts.url);
    const client = new SharedropApiClient({ apiKey: auth.token, baseUrl });

    const me = await client.getMe();
    // #409: an sdw_ key always uses its own workspace, so no default is active.
    const workspaceKey = isWorkspaceKey(auth.token);
    if (workspaceKey) noteKeyIgnoresDefault(getDefaultWorkspace(baseUrl), opts);
    const active = workspaceKey ? null : describeDefault(baseUrl, me.workspaces);
    console.log(formatWhoami(me, baseUrl, opts, active));
  } catch (err) {
    handleError(err, opts);
  }
}
