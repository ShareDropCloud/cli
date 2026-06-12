import { SharedropApiClient } from "../client/api-client.js";
import { resolveAuth, resolveBaseUrl } from "../auth/resolve.js";
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
    console.log(formatWhoami(me, baseUrl, opts));
  } catch (err) {
    handleError(err, opts);
  }
}
