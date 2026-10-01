// #255 — disappearing links from the terminal: create, list, change the people
// on a link, revoke. A disappearing link is a separate URL that stops working at
// its time or view limit; it never changes the page's own visibility or sharing.
import { SharedropApiClient, SharedropApiError } from "../client/api-client.js";
import { normalizePageRef } from "../client/page-ref.js";
import type { CreateEphemeralLinkBody } from "../client/types.js";
import { resolveAuth, resolveBaseUrl } from "../auth/resolve.js";
import { requireAuth, handleError } from "../output/errors.js";
import {
  formatLinkCreated,
  formatLinkList,
  formatLinkPeopleUpdated,
  formatLinkRevoked,
} from "../output/format.js";

interface GlobalOpts {
  url?: string;
  token?: string;
}

async function connect(globalOpts: GlobalOpts): Promise<SharedropApiClient> {
  const auth = await resolveAuth(globalOpts.token);
  requireAuth(auth);
  const baseUrl = resolveBaseUrl(globalOpts.url);
  return new SharedropApiClient({ apiKey: auth.token, baseUrl });
}

/**
 * Flatten repeatable / comma-separated email flags into one lowercased list
 * (`--people a@x.com,b@x.com --people c@x.com`). The server validates each one.
 */
export function parseEmailList(values: string[] | string | undefined): string[] {
  const list = Array.isArray(values) ? values : values ? [values] : [];
  return [
    ...new Set(
      list
        .flatMap((v) => v.split(/[\s,;]+/))
        .map((v) => v.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

const UNIT_SECONDS: Record<string, number> = { m: 60, h: 3600, d: 86400 };

/** Parse a duration like `30m`, `12h` or `7d` (or bare seconds) into seconds. */
export function parseDuration(value: string): number {
  const match = value.trim().toLowerCase().match(/^(\d+)\s*([mhd]?)$/);
  const n = match ? Number(match[1]) : NaN;
  if (!match || !Number.isSafeInteger(n) || n <= 0) {
    throw new SharedropApiError(
      "VALIDATION_ERROR",
      `Invalid --expires-in "${value}". Use a number with m, h or d, for example 30m, 12h or 7d.`,
      400,
    );
  }
  return match[2] ? n * UNIT_SECONDS[match[2]] : n;
}

function parseMaxViews(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new SharedropApiError(
      "VALIDATION_ERROR",
      `Invalid --max-views "${value}". Use a whole number of 1 or more.`,
      400,
    );
  }
  return n;
}

export async function linkCreateCommand(
  id: string,
  opts: {
    people?: string[];
    expiresIn?: string;
    maxViews?: string;
    present?: boolean;
    /** Commander sets this false for --no-email. */
    email?: boolean;
    json?: boolean;
  },
  globalOpts: GlobalOpts = {},
): Promise<void> {
  try {
    const emails = parseEmailList(opts.people);
    const body: CreateEphemeralLinkBody = {
      audience: emails.length > 0 ? "people" : "anyone",
      emails: emails.length > 0 ? emails : undefined,
      notify: emails.length > 0 && opts.email === false ? false : undefined,
      expires_in_seconds: opts.expiresIn ? parseDuration(opts.expiresIn) : undefined,
      max_views: parseMaxViews(opts.maxViews),
      present_only: opts.present ? true : undefined,
    };
    if (body.expires_in_seconds === undefined && body.max_views === undefined) {
      throw new SharedropApiError(
        "VALIDATION_ERROR",
        "Set a time limit (--expires-in) or a view limit (--max-views), or both.",
        400,
      );
    }
    const client = await connect(globalOpts);
    const link = await client.createEphemeralLink(normalizePageRef(id), body);
    console.log(formatLinkCreated(link, opts));
  } catch (err) {
    handleError(err, opts);
  }
}

export async function linkListCommand(
  id: string,
  opts: { json?: boolean },
  globalOpts: GlobalOpts = {},
): Promise<void> {
  try {
    const client = await connect(globalOpts);
    const { links } = await client.listEphemeralLinks(normalizePageRef(id));
    console.log(formatLinkList(links, opts));
  } catch (err) {
    handleError(err, opts);
  }
}

export async function linkPeopleCommand(
  id: string,
  linkId: string,
  opts: { add?: string[]; remove?: string[]; email?: boolean; json?: boolean },
  globalOpts: GlobalOpts = {},
): Promise<void> {
  try {
    const add = parseEmailList(opts.add);
    const remove = parseEmailList(opts.remove);
    if (add.length === 0 && remove.length === 0) {
      throw new SharedropApiError(
        "VALIDATION_ERROR",
        "Pass --add and/or --remove with at least one email address.",
        400,
      );
    }
    const client = await connect(globalOpts);
    const result = await client.updateEphemeralLinkPeople(normalizePageRef(id), linkId, {
      add_emails: add.length > 0 ? add : undefined,
      remove_emails: remove.length > 0 ? remove : undefined,
      notify: add.length > 0 && opts.email === false ? false : undefined,
    });
    console.log(formatLinkPeopleUpdated(result, opts));
  } catch (err) {
    handleError(err, opts);
  }
}

export async function linkRevokeCommand(
  id: string,
  linkId: string,
  opts: { json?: boolean },
  globalOpts: GlobalOpts = {},
): Promise<void> {
  try {
    const client = await connect(globalOpts);
    await client.revokeEphemeralLink(normalizePageRef(id), linkId);
    console.log(formatLinkRevoked(linkId, opts));
  } catch (err) {
    handleError(err, opts);
  }
}
