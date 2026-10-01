import chalk from "chalk";
import Table from "cli-table3";
import type {
  V1Page,
  V1Pagination,
  V1ShareGrant,
  V1MeResponse,
  Reservation,
  TrashEmptyResult,
  EphemeralLink,
  EphemeralLinkPeopleResult,
} from "../client/types.js";
import type { FolderNode } from "../client/api-client.js";

export interface FormatOptions {
  json?: boolean;
}

export function isTTY(): boolean {
  return process.stdout.isTTY === true;
}

export function shouldOutputJson(opts: FormatOptions): boolean {
  return opts.json === true || !isTTY();
}

export function formatUpload(page: V1Page, opts: FormatOptions): string {
  if (shouldOutputJson(opts)) {
    return JSON.stringify({ data: page }, null, 2);
  }
  return [
    chalk.bold(page.title),
    `  ${chalk.cyan(page.full_url)}`,
    chalk.dim(`  ID: ${page.id}`),
  ].join("\n");
}

export function formatPage(page: V1Page, opts: FormatOptions): string {
  if (shouldOutputJson(opts)) {
    return JSON.stringify({ data: page }, null, 2);
  }
  return [
    chalk.bold(page.title),
    `  URL:        ${chalk.cyan(page.full_url)}`,
    `  ID:         ${page.id}`,
    `  Mode:       ${page.mode}`,
    `  Visibility: ${page.visibility}`,
    `  Size:       ${(page.file_size / 1024).toFixed(1)} KB`,
    `  Created:    ${new Date(page.created_at).toLocaleDateString()}`,
  ].join("\n");
}

export function formatPageList(pages: V1Page[], pagination: V1Pagination, opts: FormatOptions): string {
  if (shouldOutputJson(opts)) {
    return JSON.stringify({ data: pages, pagination }, null, 2);
  }

  if (pages.length === 0) {
    return chalk.dim("No pages found.");
  }

  const table = new Table({
    head: ["ID", "Title", "URL", "Visibility", "Created"],
    style: { head: ["cyan"] },
  });

  for (const p of pages) {
    table.push([
      p.id,
      p.title.length > 40 ? p.title.slice(0, 37) + "..." : p.title,
      chalk.cyan(p.full_url),
      p.visibility,
      new Date(p.created_at).toLocaleDateString(),
    ]);
  }

  let output = table.toString();
  if (pagination.has_more && pagination.next_cursor) {
    output += "\n" + chalk.dim(`More pages available. Use --cursor ${pagination.next_cursor}`);
  }
  return output;
}

export function formatShare(grant: V1ShareGrant, pageTitle: string, opts: FormatOptions): string {
  if (shouldOutputJson(opts)) {
    return JSON.stringify({ data: grant }, null, 2);
  }
  const shared = chalk.green(`Shared "${pageTitle}" with ${grant.email}`);
  // #366 — the share stands, but the daily share-email limit stopped the email.
  return grant.email_warning
    ? `${shared}\n${chalk.yellow(`  ${grant.email_warning.message}`)}`
    : shared;
}

export function formatDelete(pageTitle: string, opts: FormatOptions): string {
  if (shouldOutputJson(opts)) {
    return JSON.stringify({ success: true }, null, 2);
  }
  return chalk.dim(`Deleted "${pageTitle}"`);
}

// ─── #185 folder formatters ───────────────────────────────────────────────
//
// One flat row per folder: id, name, direct item count. All copy is em-dash
// free (project rule). --json mode emits the structured object verbatim.

/** A folder row shaped for the list table (direct-child count computed upstream). */
export interface FolderListRow {
  id: string;
  name: string;
  items: number;
}

export function formatFolderList(folders: FolderListRow[], opts: FormatOptions): string {
  if (shouldOutputJson(opts)) {
    return JSON.stringify({ folders }, null, 2);
  }

  if (folders.length === 0) {
    return chalk.dim("No folders found.");
  }

  const table = new Table({
    head: ["ID", "Name", "Items"],
    style: { head: ["cyan"] },
  });

  for (const f of folders) {
    table.push([f.id, f.name, String(f.items)]);
  }

  return table.toString();
}

export function formatFolderCreated(folder: FolderNode, opts: FormatOptions): string {
  if (shouldOutputJson(opts)) {
    return JSON.stringify({ folder }, null, 2);
  }
  return [chalk.bold(folder.name), chalk.dim(`  ID: ${folder.id}`)].join("\n");
}

/**
 * #191 — a nested `folder create` whose whole path already existed. Idempotent:
 * nothing was created, exit 0. Names the leaf id so the caller can act on it.
 */
export function formatFolderAlreadyExists(path: string, id: string, opts: FormatOptions): string {
  if (shouldOutputJson(opts)) {
    return JSON.stringify({ folder: { id }, alreadyExists: true }, null, 2);
  }
  return chalk.dim(`Folder "${path}" already exists (${id}).`);
}

export function formatFolderRenamed(id: string, name: string, opts: FormatOptions): string {
  if (shouldOutputJson(opts)) {
    return JSON.stringify({ success: true, id, name }, null, 2);
  }
  return chalk.green(`Renamed folder ${id} to "${name}".`);
}

export function formatFolderMoved(
  id: string,
  parentId: string | null,
  opts: FormatOptions,
): string {
  if (shouldOutputJson(opts)) {
    return JSON.stringify({ success: true, id, parentId }, null, 2);
  }
  const where = parentId === null ? "your top level" : `folder ${parentId}`;
  return chalk.green(`Moved folder ${id} to ${where}.`);
}

export function formatPageMoved(
  id: string,
  parentId: string | null,
  opts: FormatOptions,
): string {
  if (shouldOutputJson(opts)) {
    return JSON.stringify({ success: true, id, parentId }, null, 2);
  }
  const where = parentId === null ? "your top level" : `folder ${parentId}`;
  return chalk.green(`Moved page ${id} to ${where}.`);
}

export function formatFolderDeleted(
  id: string,
  res: { pages: number; folders: number },
  opts: FormatOptions,
): string {
  if (shouldOutputJson(opts)) {
    return JSON.stringify({ success: true, pages: res.pages, folders: res.folders }, null, 2);
  }
  const pageLabel = `${res.pages} page${res.pages === 1 ? "" : "s"}`;
  const folderLabel = `${res.folders} folder${res.folders === 1 ? "" : "s"}`;
  return chalk.dim(`Deleted folder ${id}. Moved ${pageLabel} and ${folderLabel} to trash.`);
}

/**
 * The non-forced delete refusal. Names the descendant counts and points at
 * --force. Printed to stderr by the command, which then exits non-zero.
 */
export function formatFolderNotEmpty(
  id: string,
  details: { pages: number; folders: number } | undefined,
  opts: FormatOptions,
): string {
  const pages = details?.pages ?? 0;
  const folders = details?.folders ?? 0;
  if (shouldOutputJson(opts)) {
    return JSON.stringify(
      { error: { code: "FOLDER_NOT_EMPTY", pages, folders } },
      null,
      2,
    );
  }
  const pageLabel = `${pages} page${pages === 1 ? "" : "s"}`;
  const folderLabel = `${folders} folder${folders === 1 ? "" : "s"}`;
  return chalk.red(
    `Folder ${id} is not empty: it holds ${pageLabel} and ${folderLabel}. ` +
      `Pass --force to move the whole subtree to trash.`,
  );
}

export function formatRestore(
  id: string,
  res: { reparentedToRoot: boolean },
  opts: FormatOptions,
): string {
  if (shouldOutputJson(opts)) {
    return JSON.stringify({ success: true, reparentedToRoot: res.reparentedToRoot }, null, 2);
  }
  const where = res.reparentedToRoot
    ? " Its original parent is gone, so it now sits at your top level."
    : "";
  return chalk.green(`Restored ${id} from trash.${where}`);
}

export function formatTrashEmptied(
  result: TrashEmptyResult,
  freedSize: string,
  opts: FormatOptions,
): string {
  if (shouldOutputJson(opts)) {
    return JSON.stringify(result, null, 2);
  }
  const itemLabel = `${result.purged} item${result.purged === 1 ? "" : "s"}`;
  return chalk.green(`Emptied trash: ${itemLabel} purged, ${freedSize} freed.`);
}

// ─── #198 (RES-CLI-2) reservation formatters ──────────────────────────────
//
// All copy is em-dash free (project rule). The one-time claim token is printed
// by formatReservationCreated exactly once with a store-now warning; no other
// formatter has access to a token (the Reservation shape carries none), so a
// list can never leak it.

export function formatReservationCreated(
  result: { reservation: Reservation; claim_token: string },
  opts: FormatOptions,
): string {
  if (shouldOutputJson(opts)) {
    // Raw one-time structure verbatim (reservation + sibling claim_token).
    return JSON.stringify(result, null, 2);
  }

  const { reservation, claim_token } = result;
  const lines = [
    chalk.bold(reservation.title),
    `  ${chalk.cyan(reservation.full_url)}`,
    `  Status: ${reservation.status}`,
  ];
  if (reservation.intended_agent_name) {
    lines.push(`  Agent:  ${reservation.intended_agent_name}`);
  }
  lines.push("");
  lines.push(`  Claim token: ${chalk.yellow(claim_token)}`);
  lines.push(
    chalk.dim("  Store this token now. It is shown once and cannot be retrieved again."),
  );
  return lines.join("\n");
}

export function formatReservationList(
  reservations: Reservation[],
  pagination: V1Pagination,
  opts: FormatOptions,
): string {
  if (shouldOutputJson(opts)) {
    return JSON.stringify({ data: reservations, pagination }, null, 2);
  }

  if (reservations.length === 0) {
    return chalk.dim("No reservations found.");
  }

  const table = new Table({
    head: ["Slug", "Status", "Agent", "URL", "Expires"],
    style: { head: ["cyan"] },
  });

  for (const r of reservations) {
    table.push([
      r.slug,
      r.status,
      r.intended_agent_name ?? "",
      chalk.cyan(r.full_url),
      r.expires_at ? new Date(r.expires_at).toLocaleDateString() : "",
    ]);
  }

  let output = table.toString();
  if (pagination.has_more && pagination.next_cursor) {
    output += "\n" + chalk.dim(`More reservations available. Use --cursor ${pagination.next_cursor}`);
  }
  return output;
}

export function formatReservationRevoked(reservation: Reservation, opts: FormatOptions): string {
  if (shouldOutputJson(opts)) {
    return JSON.stringify({ data: reservation }, null, 2);
  }
  return chalk.green(`Revoked reservation "${reservation.slug}" (status: ${reservation.status}).`);
}

// ─── #255 disappearing links ─────────────────────────────────────────────

function linkAudienceLabel(link: { audience: string; emails: string[] }): string {
  if (link.audience !== "people") return "Anyone with the link";
  const n = link.emails.length;
  return `${n} ${n === 1 ? "person" : "people"}`;
}

function linkViewsLabel(link: { view_count: number; max_views: number | null }): string {
  return link.max_views != null
    ? `${link.view_count} of ${link.max_views}`
    : String(link.view_count);
}

export function formatLinkCreated(link: EphemeralLink, opts: FormatOptions): string {
  if (shouldOutputJson(opts)) {
    return JSON.stringify({ data: link }, null, 2);
  }
  const lines = [
    chalk.green("Disappearing link created"),
    `  ${chalk.cyan(link.url)}`,
    chalk.dim(`  ID: ${link.id}`),
    `  ${linkAudienceLabel(link)}`,
  ];
  if (link.audience === "people" && link.emails.length > 0) {
    lines.push(`  People: ${link.emails.join(", ")}`);
    lines.push(
      link.email_warning
        ? chalk.yellow(`  They sign in with one of these emails to open it. ${link.email_warning.message}`)
        : chalk.dim(
            link.emailed === false
              ? "  They sign in with one of these emails to open it. They were not emailed, so send them the link yourself."
              : "  They sign in with one of these emails to open it. Sharedrop is emailing them the link.",
          ),
    );
  }
  if (link.summary) lines.push(`  ${link.summary}`);
  lines.push(chalk.dim("  The page's own visibility and sharing are unchanged."));
  return lines.join("\n");
}

export function formatLinkList(links: EphemeralLink[], opts: FormatOptions): string {
  if (shouldOutputJson(opts)) {
    return JSON.stringify({ data: { links } }, null, 2);
  }
  if (links.length === 0) {
    return chalk.dim("No disappearing links on this page.");
  }
  const table = new Table({
    head: ["ID", "Status", "Who", "Views", "Expires", "URL"],
    style: { head: ["cyan"] },
  });
  for (const link of links) {
    table.push([
      link.id,
      link.status,
      link.audience === "people" && link.emails.length > 0
        ? link.emails.join("\n")
        : linkAudienceLabel(link),
      linkViewsLabel(link),
      link.expires_at ? new Date(link.expires_at).toLocaleString() : "no time limit",
      link.status === "active" ? chalk.cyan(link.url) : chalk.dim(link.url),
    ]);
  }
  return table.toString();
}

export function formatLinkPeopleUpdated(
  result: EphemeralLinkPeopleResult,
  opts: FormatOptions,
): string {
  if (shouldOutputJson(opts)) {
    return JSON.stringify({ data: result }, null, 2);
  }
  return [
    chalk.green(`Updated link ${result.id}: ${result.added} added, ${result.removed} removed.`),
    result.emails.length > 0
      ? `  People: ${result.emails.join(", ")}`
      : chalk.dim("  Nobody is on this link now, so nobody can open it."),
    // #366 — the daily share-email limit could not cover everyone added.
    ...(result.email_warning ? [chalk.yellow(`  ${result.email_warning.message}`)] : []),
  ].join("\n");
}

export function formatLinkRevoked(linkId: string, opts: FormatOptions): string {
  if (shouldOutputJson(opts)) {
    return JSON.stringify({ data: { revoked: true, link_id: linkId } }, null, 2);
  }
  return chalk.green(`Revoked disappearing link ${linkId}. The page itself is unchanged.`);
}

export function formatWhoami(me: V1MeResponse, baseUrl: string, opts: FormatOptions): string {
  if (shouldOutputJson(opts)) {
    return JSON.stringify({ data: me }, null, 2);
  }

  const tierColor = me.tier === "pro" ? chalk.cyan : me.tier === "team" ? chalk.magenta : chalk.dim;
  const limitDisplay = me.pages_limit === -1 ? "unlimited" : String(me.pages_limit);
  const storageKB = (me.storage_used / 1024).toFixed(1);
  const storageMB = (me.storage_used / (1024 * 1024)).toFixed(2);
  const storageDisplay = me.storage_used > 1024 * 1024 ? `${storageMB} MB` : `${storageKB} KB`;

  let host = baseUrl;
  try {
    host = new URL(baseUrl).host;
  } catch {
    /* not a parseable URL — show the raw value */
  }

  const lines = [
    chalk.bold(me.username),
    `  Email:   ${me.email}`,
    `  Tier:    ${tierColor(me.tier)}`,
    `  Pages:   ${me.pages_used} / ${limitDisplay}`,
    `  Storage: ${storageDisplay}`,
    `  Host:    ${host}`,
  ];

  // #198 (RES-ME-1): reserved-addresses headroom, only when the server
  // advertises it (older servers omit the field and render the prior output).
  const reservations = me.entitlements?.reservations;
  if (reservations) {
    const reservedDisplay =
      reservations.maxReservations === -1
        ? "unlimited"
        : `${reservations.remaining} of ${reservations.maxReservations} remaining`;
    lines.push(`  Reserved: ${reservedDisplay}`);
  }

  return lines.join("\n");
}
