import chalk from "chalk";
import Table from "cli-table3";
import type { V1Page, V1Pagination, V1ShareGrant, V1MeResponse } from "../client/types.js";
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
  return chalk.green(`Shared "${pageTitle}" with ${grant.email}`);
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

  return [
    chalk.bold(me.username),
    `  Email:   ${me.email}`,
    `  Tier:    ${tierColor(me.tier)}`,
    `  Pages:   ${me.pages_used} / ${limitDisplay}`,
    `  Storage: ${storageDisplay}`,
    `  Host:    ${host}`,
  ].join("\n");
}
