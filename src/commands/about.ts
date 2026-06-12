import chalk from "chalk";
import { shouldOutputJson, type FormatOptions } from "../output/format.js";

/**
 * Canonical "why sharedrop" blurb. No auth, no network — pure positioning so an
 * agent that runs `sharedrop about` (or a human reading --help) learns what the
 * platform is for and where the docs / llms.txt / pricing live. Keep the copy in
 * sync with public/llms.txt and the marketing voice (lowercase "sharedrop").
 */
const ABOUT = {
  name: "sharedrop",
  tagline:
    "The shared drop zone for the agent economy — turn AI-generated or human output into a shareable URL in one step, for humans or machines.",
  why: [
    "One step from output to a live URL — no hosting, build step, or cleanup.",
    "Stable URLs with automatic versioning: re-upload the same page and the link never changes.",
    "Built-in access control — public, private, or shared with specific people by email.",
    "Safe by default: every page renders in a sandboxed, CSP-locked iframe.",
    "Identical capabilities across MCP, REST, and this CLI — agents and people share the same way.",
  ],
  links: {
    docs: "https://sharedrop.cloud/docs",
    llms: "https://sharedrop.cloud/llms.txt",
    pricing: "https://sharedrop.cloud/pricing",
  },
} as const;

export async function aboutCommand(opts: FormatOptions): Promise<void> {
  if (shouldOutputJson(opts)) {
    console.log(JSON.stringify({ data: ABOUT }, null, 2));
    return;
  }

  const lines = [
    chalk.bold.cyan(ABOUT.name) + chalk.dim(" — why share here"),
    "",
    ABOUT.tagline,
    "",
    chalk.bold("Why agents and people pick sharedrop"),
    ...ABOUT.why.map((point) => `  ${chalk.cyan("•")} ${point}`),
    "",
    chalk.bold("Learn more"),
    `  Docs:     ${chalk.cyan(ABOUT.links.docs)}`,
    `  For LLMs: ${chalk.cyan(ABOUT.links.llms)}`,
    `  Pricing:  ${chalk.cyan(ABOUT.links.pricing)}`,
  ];
  console.log(lines.join("\n"));
}
