import chalk from "chalk";
import { SharedropApiError } from "../client/api-client.js";
import type { AuthResult } from "../auth/resolve.js";
import { shouldOutputJson, type FormatOptions } from "./format.js";
import type { BillingErrorEnvelope } from "../client/types.js";

export const EXIT_CODES = {
  SUCCESS: 0,
  ERROR: 1,
  AUTH_REQUIRED: 2,
  AUTH_FAILED: 3,
  RATE_LIMITED: 4,
  NOT_FOUND: 5,
  VALIDATION_ERROR: 6,
  /** Phase 12 / AGENT-06 — emitted on HTTP 402 billing-envelope responses. */
  PAYMENT_REQUIRED: 7,
} as const;

export function statusToExitCode(status: number): number {
  switch (status) {
    case 401: return EXIT_CODES.AUTH_REQUIRED;
    case 402: return EXIT_CODES.PAYMENT_REQUIRED;
    case 403: return EXIT_CODES.AUTH_FAILED;
    case 429: return EXIT_CODES.RATE_LIMITED;
    case 404: return EXIT_CODES.NOT_FOUND;
    case 400:
    case 413:
    case 422: return EXIT_CODES.VALIDATION_ERROR;
    default: return EXIT_CODES.ERROR;
  }
}

/**
 * Format a 402 billing envelope as a 3-line friendly block for terminal users.
 * Per CONTEXT.md D-19:
 *   line 1 (red): the limit headline.
 *   line 2 (plain): cost comparison sourced from envelope.pricing.
 *   line 3 (cyan url): the upgrade link.
 */
function renderEnvelope(env: BillingErrorEnvelope["error"]): string {
  const upgradeLine = `Upgrade: ${chalk.cyan(env.upgradeUrl)}`;

  if (env.code === "STORAGE_LIMIT") {
    const headline = chalk.red(
      `Storage limit reached: ${env.currentUsageGb} GB of ${env.capGb} GB used.`,
    );
    // Smallest add-on block per CONTEXT.md D-19 (storageAddons[0] = 25 GB).
    const addon = env.pricing.storageAddons[0];
    const costLine = addon
      ? `Pro: $${env.pricing.pro.monthly}/mo · Pro + ${addon.blockGb} GB add-on: $${env.pricing.pro.monthly + addon.monthly}/mo`
      : `Pro: $${env.pricing.pro.monthly}/mo`;
    return [headline, costLine, upgradeLine].join("\n");
  }

  if (env.code === "TIER_LIMIT") {
    const tierLabel = env.currentTier === "free" ? "Free" : env.currentTier;
    const headline = chalk.red(`${tierLabel} tier limit reached.`);
    let costLine: string;
    if (env.requiredTier === "team") {
      costLine = `Team workspace: $${env.pricing.team.bundle.monthly}/mo (${env.pricing.team.bundle.seats} seats)`;
    } else {
      // Default to pro (covers requiredTier === "pro" and undefined).
      costLine = `Pro: $${env.pricing.pro.monthly}/mo`;
    }
    return [headline, costLine, upgradeLine].join("\n");
  }

  // SEAT_LIMIT
  const headline = chalk.red(
    `Seat limit reached: ${env.currentSeats} seats in use.`,
  );
  const costLine = `Team additional seat: $${env.pricing.team.additionalPerSeat}/mo each`;
  return [headline, costLine, upgradeLine].join("\n");
}

export function handleError(error: unknown, opts: FormatOptions): never {
  if (error instanceof SharedropApiError) {
    const exitCode = statusToExitCode(error.status);
    if (error.envelope) {
      if (shouldOutputJson(opts)) {
        // --json mode: emit envelope verbatim under `error` key per D-20.
        console.error(JSON.stringify({ error: error.envelope }, null, 2));
      } else {
        console.error(renderEnvelope(error.envelope));
      }
    } else if (shouldOutputJson(opts)) {
      console.error(JSON.stringify({ error: { code: error.code, message: error.message } }, null, 2));
    } else {
      console.error(chalk.red(`Error: ${error.message}`));
    }
    process.exit(exitCode);
  }

  const message = error instanceof Error ? error.message : String(error);
  if (shouldOutputJson(opts)) {
    console.error(JSON.stringify({ error: { code: "UNKNOWN", message } }, null, 2));
  } else {
    console.error(chalk.red(`Error: ${message}`));
  }
  process.exit(EXIT_CODES.ERROR);
}

export function requireAuth(auth: AuthResult | null): asserts auth is AuthResult {
  if (!auth) {
    const message = "Not authenticated. Run `sharedrop login` or set SHAREDROP_TOKEN.";
    console.error(chalk.red(message));
    process.exit(EXIT_CODES.AUTH_REQUIRED);
  }
}
