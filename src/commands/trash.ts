import { resolveAuth, resolveBaseUrl } from "../auth/resolve.js";
import { SharedropApiClient } from "../client/api-client.js";
import { requireAuth, handleError } from "../output/errors.js";
import { formatArchiveSize } from "./archive.js";
import { formatTrashEmptied } from "../output/format.js";

interface GlobalOpts {
  url?: string;
  token?: string;
}

export async function trashEmptyCommand(
  opts: { json?: boolean },
  globalOpts: GlobalOpts = {},
): Promise<void> {
  const auth = await resolveAuth(globalOpts.token);
  requireAuth(auth);

  try {
    const baseUrl = resolveBaseUrl(globalOpts.url);
    const client = new SharedropApiClient({ apiKey: auth.token, baseUrl });
    const result = await client.emptyTrash();
    console.log(
      formatTrashEmptied(result, formatArchiveSize(result.freedBytes), opts),
    );
  } catch (error) {
    handleError(error, opts);
  }
}
