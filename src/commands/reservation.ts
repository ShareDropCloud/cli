import { SharedropApiClient, SharedropApiError } from "../client/api-client.js";
import type { CreateReservationBody } from "../client/types.js";
import { resolveAuth, resolveBaseUrl } from "../auth/resolve.js";
import { requireAuth, handleError } from "../output/errors.js";
import {
  formatReservationCreated,
  formatReservationList,
  formatReservationRevoked,
} from "../output/format.js";

interface GlobalOpts {
  url?: string;
  token?: string;
}

/** Canonical UUID shape: a --to value matching this is used as a reservation id directly. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Build an authed client from the resolved credentials + base URL. */
async function connect(globalOpts: GlobalOpts): Promise<{ client: SharedropApiClient; baseUrl: string }> {
  const auth = await resolveAuth(globalOpts.token);
  requireAuth(auth);
  const baseUrl = resolveBaseUrl(globalOpts.url);
  return { client: new SharedropApiClient({ apiKey: auth.token, baseUrl }), baseUrl };
}

/**
 * Resolve a `--to` value to a reservation id. A uuid-shaped value passes straight
 * through (no list call). Otherwise the caller's own reservations are listed and
 * the entry whose slug matches EXACTLY and whose status is still `reserved` wins;
 * reserved slugs are server-generated nanoids, so the match is case-sensitive.
 * A miss throws RESERVATION_NOT_FOUND (404) with a hint to run
 * `sharedrop reservations list`. No client-side ownership or status invention:
 * the sign route re-validates ownership + reserved status server-side, so a wrong
 * id can never claim foreign state (T-31-05).
 */
export async function resolveReservationTarget(
  client: SharedropApiClient,
  value: string,
): Promise<string> {
  const trimmed = value.trim();
  if (UUID_RE.test(trimmed)) return trimmed;

  // Walk every page so an older reserved slug (past the first page of the
  // account's full, never-pruned reservation history) still resolves; a slug
  // that fell off page 1 must not falsely 404 while the UUID path still works.
  let cursor: string | undefined;
  do {
    const { data, pagination } = await client.listReservations({ limit: 100, cursor });
    const match = data.find((r) => r.status === "reserved" && r.slug === trimmed);
    if (match) return match.id;
    cursor = pagination.has_more ? pagination.next_cursor ?? undefined : undefined;
  } while (cursor);

  throw new SharedropApiError(
    "RESERVATION_NOT_FOUND",
    `No reserved address named ${trimmed}. Run \`sharedrop reservations list\` to see your reservations.`,
    404,
  );
}

export async function reserveCommand(
  opts: {
    title?: string;
    agentName?: string;
    visibility?: string;
    expires?: string;
    json?: boolean;
  },
  globalOpts: GlobalOpts = {},
): Promise<void> {
  try {
    const { client } = await connect(globalOpts);
    // Map flags to the snake_case create body; the server validates visibility,
    // the expiry timestamp, and the tier cap. Only-provided keys are sent.
    const body: CreateReservationBody = {
      title: opts.title,
      intended_agent_name: opts.agentName,
      visibility: opts.visibility as "public" | "private" | "shared" | undefined,
      expires_at: opts.expires,
    };
    const result = await client.createReservation(body);
    console.log(formatReservationCreated(result, opts));
  } catch (err) {
    handleError(err, opts);
  }
}

export async function reservationsListCommand(
  opts: { json?: boolean; cursor?: string; limit?: string },
  globalOpts: GlobalOpts = {},
): Promise<void> {
  try {
    const { client } = await connect(globalOpts);
    const limit = opts.limit ? Number(opts.limit) : undefined;
    const { data, pagination } = await client.listReservations({
      cursor: opts.cursor,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    console.log(formatReservationList(data, pagination, opts));
  } catch (err) {
    handleError(err, opts);
  }
}

export async function reservationsRevokeCommand(
  id: string,
  opts: { json?: boolean },
  globalOpts: GlobalOpts = {},
): Promise<void> {
  try {
    const { client } = await connect(globalOpts);
    const { reservation } = await client.revokeReservation(id);
    console.log(formatReservationRevoked(reservation, opts));
  } catch (err) {
    handleError(err, opts);
  }
}
