// #409: the default workspace. Commands that take --workspace resolve it in
// this order: --workspace, then --personal (no workspace), then
// SHAREDROP_WORKSPACE (env, then .env), then the default saved for this server
// by `sharedrop workspaces use`, then the personal space.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SharedropApiError } from "../client/api-client.js";
import type { Workspace } from "../client/types.js";
import { shouldOutputJson } from "../output/format.js";
import { getSavedWorkspace } from "./store.js";

export type DefaultSource = "env" | "dotenv" | "saved";

export interface DefaultWorkspace {
  /** What is sent as the workspace: an id or an address. */
  value: string;
  source: DefaultSource;
}

/** The active default for this server, before any per-command flag. */
export function getDefaultWorkspace(baseUrl: string): DefaultWorkspace | null {
  const env = process.env.SHAREDROP_WORKSPACE?.trim();
  if (env) return { value: env, source: "env" };

  try {
    const envFile = readFileSync(resolve(process.cwd(), ".env"), "utf-8");
    const value = envFile.match(/^SHAREDROP_WORKSPACE=(.+)$/m)?.[1]?.trim();
    if (value) return { value, source: "dotenv" };
  } catch {
    /* no .env file */
  }

  const saved = getSavedWorkspace(baseUrl);
  return saved ? { value: saved.id, source: "saved" } : null;
}

/** An sdw_ key is bound to one workspace; the server applies that one. */
export function isWorkspaceKey(token: string): boolean {
  return token.startsWith("sdw_");
}

export function defaultSourceLabel(source: DefaultSource): string {
  if (source === "env") return "SHAREDROP_WORKSPACE";
  if (source === "dotenv") return "SHAREDROP_WORKSPACE in .env";
  return "`sharedrop workspaces use`";
}

export interface WorkspaceChoice {
  /** Undefined sends no workspace (personal space, or the server derives it). */
  workspace?: string;
  source: "flag" | "personal" | "none" | DefaultSource;
}

/**
 * Pick the workspace for one command. `useDefault` is false where the target
 * already has a workspace the server derives (a re-upload with --page-id, a
 * reservation claim with --to), so a default never redirects it.
 */
export function resolveWorkspace(
  opts: { workspace?: string; personal?: boolean; json?: boolean },
  baseUrl: string,
  token: string,
  useDefault = true,
): WorkspaceChoice {
  if (opts.workspace && opts.personal) {
    throw new SharedropApiError(
      "VALIDATION_ERROR",
      "Pass --workspace or --personal, not both.",
      400,
    );
  }
  if (opts.workspace) return { workspace: opts.workspace, source: "flag" };
  if (opts.personal) return { source: "personal" };
  if (!useDefault) return { source: "none" };

  const def = getDefaultWorkspace(baseUrl);
  if (!def) return { source: "none" };
  if (isWorkspaceKey(token)) {
    noteKeyIgnoresDefault(def, opts);
    return { source: "none" };
  }
  return { workspace: def.value, source: def.source };
}

/** Text mode only: say once that an sdw_ key ignores the default. */
export function noteKeyIgnoresDefault(def: DefaultWorkspace | null, opts: { json?: boolean }): void {
  if (!def || shouldOutputJson(opts)) return;
  console.error(
    `Note: this sdw_ key is bound to its own workspace, so the default workspace (set by ${defaultSourceLabel(def.source)}) is ignored.`,
  );
}

/** One text-mode hint when a default (not a flag) names a workspace the caller left. */
export function staleDefaultHint(err: unknown, choice?: WorkspaceChoice): string | undefined {
  if (!choice || !(err instanceof SharedropApiError) || err.status !== 404) return undefined;
  if (!/workspace not found/i.test(err.message)) return undefined;
  if (choice.source === "saved") {
    return "Your saved default workspace is not one you belong to. Run `sharedrop workspaces use --clear` or pass --personal.";
  }
  if (choice.source === "env" || choice.source === "dotenv") {
    return `Your default workspace (set by ${defaultSourceLabel(choice.source)}) is not one you belong to. Unset it, run \`sharedrop workspaces use --clear\` if one is saved, or pass --personal.`;
  }
  return undefined;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Find a workspace by id or address, as the server matches it. */
export function findWorkspace(workspaces: Workspace[], ref: string): Workspace | undefined {
  const value = ref.trim().toLowerCase();
  return workspaces.find((w) => w.id.toLowerCase() === value || w.slug.toLowerCase() === value);
}

export interface DefaultWorkspaceInfo {
  id: string | null;
  slug: string | null;
  source: DefaultSource;
  /** Display only; not part of the JSON shape. */
  name?: string;
  /** False when the caller's workspace list does not contain it. */
  member?: boolean;
}

/** Describe the active default for whoami and workspaces, matched against the caller's list. */
export function describeDefault(
  baseUrl: string,
  workspaces?: Workspace[],
): DefaultWorkspaceInfo | null {
  const def = getDefaultWorkspace(baseUrl);
  if (!def) return null;
  const saved = def.source === "saved" ? getSavedWorkspace(baseUrl) : undefined;
  const match = workspaces ? findWorkspace(workspaces, def.value) : undefined;
  const isId = UUID_PATTERN.test(def.value);
  return {
    id: match?.id ?? saved?.id ?? (isId ? def.value : null),
    slug: match?.slug ?? saved?.slug ?? (isId ? null : def.value),
    source: def.source,
    ...(match ? { name: match.name } : {}),
    ...(workspaces ? { member: Boolean(match) } : {}),
  };
}

/** The JSON shape: { id, slug, source } or null. */
export function defaultWorkspaceJson(info: DefaultWorkspaceInfo | null) {
  return info ? { id: info.id, slug: info.slug, source: info.source } : null;
}
