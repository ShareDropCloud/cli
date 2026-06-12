import chalk from "chalk";
import Table from "cli-table3";
import type { V1Page, V1Pagination, V1ShareGrant, V1MeResponse } from "../client/types.js";

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
