import { Command } from "commander";
import { uploadCommand } from "./commands/upload.js";
import { listCommand } from "./commands/list.js";
import { getCommand } from "./commands/get.js";
import { downloadCommand } from "./commands/download.js";
import { fetchCommand } from "./commands/fetch.js";
import { updateCommand } from "./commands/update.js";
import { deleteCommand } from "./commands/delete.js";
import { shareCommand } from "./commands/share.js";
import { loginCommand } from "./commands/login.js";
import { whoamiCommand } from "./commands/whoami.js";
import { aboutCommand } from "./commands/about.js";
import { searchCommand } from "./commands/search.js";
import {
  folderCreateCommand,
  folderListCommand,
  folderDeleteCommand,
  folderRestoreCommand,
  folderRenameCommand,
  folderMoveCommand,
} from "./commands/folder.js";
import { moveCommand } from "./commands/move.js";

const program = new Command()
  .name("sharedrop")
  .description("Upload and manage HTML pages on sharedrop")
  .version(__CLI_VERSION__)
  .option("--url <url>", "Target base URL; overrides SHAREDROP_URL, .env, and saved config")
  .option("--token <token>", "API token; overrides SHAREDROP_TOKEN, .env, and saved login");

program
  .command("upload <path>")
  .description(
    "Upload a file (use - for stdin) or a folder. Files: HTML, MHTML, Markdown, PDF, images. " +
      "A folder uploads as a multi-file bundle (entry HTML + relative css/js/image/font assets) — use --mode interactive to keep its JavaScript.",
  )
  .option("--title <title>", "Page title (auto-detected if omitted)")
  .option("--visibility <vis>", "Page visibility: public, private, shared", "private")
  .option("--mode <mode>", "Page mode (HTML only): static, interactive", "static")
  .option("--entry <file>", "Entry HTML for a folder upload (relative to the folder)", "index.html")
  .option("--workspace <id>", "Upload to workspace")
  .option("--page-id <id>", "Replace an existing page's content (keeps the same URL) instead of creating a new page")
  .option("--folder <id|path>", "Destination folder in your Sharedrop tree (creates path segments as needed)")
  .option("--json", "Force JSON output")
  .action((path, opts) => uploadCommand(path, opts, program.opts()));

program
  .command("list")
  .description("List your pages")
  .option("--limit <n>", "Number of pages", "50")
  .option("--cursor <id>", "Pagination cursor")
  .option("--workspace <id>", "List workspace pages")
  .option("--folder <id|path>", "List pages inside a folder in your Sharedrop tree (id or existing path)")
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
  .command("download <id>")
  .description("Download a page's artefact as a zip")
  .option("-o, --output <path>", "Output file path ('-' for stdout)")
  .option("--json", "Force JSON output")
  .action((id, opts) => downloadCommand(id, opts, program.opts()));

program
  .command("fetch <id>")
  .description("Fetch a page's raw content (prints to stdout by default)")
  .option("-o, --output <path>", "Output file path ('-' for stdout)")
  .option("--json", "Force JSON output")
  .action((id, opts) => fetchCommand(id, opts, program.opts()));

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
  .command("move <id>")
  .description("Move a page into a folder or back to your top level")
  .option("--folder <id|path>", "Destination folder in your Sharedrop tree (creates path segments as needed)")
  .option("--root", "Move the page to your top level")
  .option("--json", "Force JSON output")
  .action((id, opts) => moveCommand(id, opts, program.opts()));

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

const folder = program.command("folder").description("Manage folders (Pro plan or higher)");
folder
  .command("create <path>")
  .description("Create a folder (a slash path auto-creates missing segments)")
  .option("--parent <id>", "Parent folder id (omit for root)")
  .option("--json", "Force JSON output")
  .action((path, opts) => folderCreateCommand(path, opts, program.opts()));
folder
  .command("list")
  .description("List your folders")
  .option("--parent <id>", "List children of this folder (omit for root)")
  .option("--json", "Force JSON output")
  .action((opts) => folderListCommand(opts, program.opts()));
folder
  .command("rename <id> <new-name>")
  .description("Rename a folder")
  .option("--json", "Force JSON output")
  .action((id, newName, opts) => folderRenameCommand(id, newName, opts, program.opts()));
folder
  .command("move <id>")
  .description("Move a folder to a new parent (or to your top level)")
  .option("--parent <id>", "New parent folder id")
  .option("--root", "Move to your top level")
  .option("--json", "Force JSON output")
  .action((id, opts) => folderMoveCommand(id, opts, program.opts()));
folder
  .command("delete <id>")
  .description("Delete a folder (moves its contents to trash)")
  .option("--force", "Delete even when the folder is not empty")
  .option("--json", "Force JSON output")
  .action((id, opts) => folderDeleteCommand(id, opts, program.opts()));
folder
  .command("restore <id>")
  .description("Restore a folder or page from trash")
  .option("--json", "Force JSON output")
  .action((id, opts) => folderRestoreCommand(id, opts, program.opts()));

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
