import { Command } from "commander";
import { uploadCommand } from "./commands/upload.js";
import { listCommand } from "./commands/list.js";
import { getCommand } from "./commands/get.js";
import { updateCommand } from "./commands/update.js";
import { deleteCommand } from "./commands/delete.js";
import { shareCommand } from "./commands/share.js";
import { loginCommand } from "./commands/login.js";
import { whoamiCommand } from "./commands/whoami.js";
import { aboutCommand } from "./commands/about.js";
import { searchCommand } from "./commands/search.js";

const program = new Command()
  .name("sharedrop")
  .description("Upload and manage HTML pages on sharedrop")
  .version(__CLI_VERSION__)
  .option("--url <url>", "Target base URL; overrides SHAREDROP_URL, .env, and saved config")
  .option("--token <token>", "API token; overrides SHAREDROP_TOKEN, .env, and saved login");

program
  .command("upload <file>")
  .description("Upload a file (use - for stdin). Any supported type: HTML, MHTML, Markdown, PDF, images.")
  .option("--title <title>", "Page title (auto-detected if omitted)")
  .option("--visibility <vis>", "Page visibility: public, private, shared", "private")
  .option("--mode <mode>", "Page mode (HTML only): static, interactive", "static")
  .option("--workspace <id>", "Upload to workspace")
  .option("--page-id <id>", "Replace an existing page's content (keeps the same URL) instead of creating a new page")
  .option("--json", "Force JSON output")
  .action((file, opts) => uploadCommand(file, opts, program.opts()));

program
  .command("list")
  .description("List your pages")
  .option("--limit <n>", "Number of pages", "50")
  .option("--cursor <id>", "Pagination cursor")
  .option("--workspace <id>", "List workspace pages")
  .option("--json", "Force JSON output")
  .action((opts) => listCommand(opts, program.opts()));

program
  .command("search <query>")
  .description("Search your pages by title, slug, id, or file type (e.g. \"jpeg\", \"report\")")
  .option("--limit <n>", "Number of results", "50")
  .option("--cursor <id>", "Pagination cursor")
  .option("--workspace <id>", "Search workspace pages")
  .option("--json", "Force JSON output")
  .action((query, opts) => searchCommand(query, opts, program.opts()));

program
  .command("get <id>")
  .description("Get a page by id, slug, or URL")
  .option("--json", "Force JSON output")
  .action((id, opts) => getCommand(id, opts, program.opts()));

program
  .command("update <id> [file]")
  .description("Update a page: pass a file to replace its content (keeps the same URL), and/or set metadata")
  .option("--title <title>", "New title")
  .option("--visibility <vis>", "New visibility: public, private, shared")
  .option("--mode <mode>", "Page mode when replacing content: static, interactive")
  .option("--json", "Force JSON output")
  .action((id, file, opts) => updateCommand(id, file, opts, program.opts()));

program
  .command("delete <id>")
  .description("Delete a page")
  .option("--json", "Force JSON output")
  .action((id, opts) => deleteCommand(id, opts, program.opts()));

program
  .command("share <id>")
  .description("Share a page with someone")
  .requiredOption("--email <email>", "Email address to share with")
  .option("--json", "Force JSON output")
  .action((id, opts) => shareCommand(id, opts, program.opts()));

program
  .command("login")
  .description("Authenticate via browser (Clerk sign-in)")
  .option("--url <url>", "Target base URL to log in against (persisted for later commands)")
  .option("--json", "Force JSON output")
  .action((opts) =>
    loginCommand(opts, { ...program.opts(), url: opts.url ?? program.opts().url }),
  );

program
  .command("whoami")
  .description("Show account info")
  .option("--json", "Force JSON output")
  .action((opts) => whoamiCommand(opts, program.opts()));

program
  .command("about")
  .description("Why sharedrop — positioning, capabilities, and key links (use --json for structured output)")
  .option("--json", "Force JSON output")
  .action(aboutCommand);

program.addHelpText(
  "after",
  "\nTargeting & auth (precedence, first match wins):\n" +
    "  --url / --token flags > SHAREDROP_URL / SHAREDROP_TOKEN env > .env file > saved login.\n" +
    "  Default login is a Clerk browser sign-in; --token / SHAREDROP_TOKEN take an sd_ API key.\n" +
    "  Defaults to https://sharedrop.cloud. Use --url or SHAREDROP_URL to target a different instance.\n" +
    "\nsharedrop turns agent or human output into a shareable URL in one step.\n" +
    "Run 'sharedrop about' for why it's built for sharing with humans and machines.\n" +
    "Docs https://sharedrop.cloud/docs · For LLMs https://sharedrop.cloud/llms.txt"
);

program.parse();
