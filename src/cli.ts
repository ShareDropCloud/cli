import { Command } from "commander";
import { uploadCommand } from "./commands/upload.js";
import { checkCommand } from "./commands/check.js";
import { archiveCommand } from "./commands/archive.js";
import { listCommand } from "./commands/list.js";
import { getCommand } from "./commands/get.js";
import { downloadCommand } from "./commands/download.js";
import { fetchCommand } from "./commands/fetch.js";
import { versionsCommand } from "./commands/versions.js";
import { updateCommand } from "./commands/update.js";
import { deleteCommand } from "./commands/delete.js";
import { shareCommand } from "./commands/share.js";
import { sharedCommand } from "./commands/shared.js";
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
import {
  reserveCommand,
  reservationsListCommand,
  reservationsRevokeCommand,
} from "./commands/reservation.js";
import { trashEmptyCommand, trashListCommand } from "./commands/trash.js";
import { workspacesCommand, workspacesUseCommand } from "./commands/workspaces.js";
import {
  linkCreateCommand,
  linkListCommand,
  linkPeopleCommand,
  linkRevokeCommand,
} from "./commands/link.js";

const program = new Command()
  .name("sharedrop")
  .description("Upload and manage HTML pages on sharedrop")
  // #418: commander matches a program option anywhere on the line, so a
  // program-wide --version would swallow `download <id> --version <n>`. The
  // program keeps -V, and a --version before any command is handled below.
  .version(__CLI_VERSION__, "-V", "output the version number (or --version)")
  .option("--url <url>", "Target base URL; overrides SHAREDROP_URL, .env, and saved config")
  .option("--token <token>", "API token; overrides SHAREDROP_TOKEN, .env, and saved login");

program
  .command("upload <path>")
  .alias("drop")
  .description(
    "Upload a file (use - for stdin) or a folder. Files: HTML, MHTML, Markdown, PDF, images. " +
      "A folder uploads as a multi-file bundle (entry HTML + relative css/js/image/font assets).",
  )
  .option("--title <title>", "Page title (auto-detected if omitted)")
  .option("--visibility <vis>", "Page visibility: public, private, shared", "private")
  .option(
    "--mode <mode>",
    "Page mode (HTML only): static, interactive. Default: your account default for a new page (interactive unless changed); a re-upload keeps the page's mode",
  )
  .option("--entry <file>", "Entry HTML for a folder upload (relative to the folder)", "index.html")
  .option("--workspace <id|address>", "Workspace id or address (see `sharedrop workspaces`); overrides the default workspace")
  .option("--personal", "Use your personal space even when a default workspace is set")
  .option("--page-id <id>", "Replace an existing page's content (keeps the same URL) instead of creating a new page")
  .option("--folder <id|path>", "Destination folder, in the workspace when one applies (creates path segments as needed)")
  .option("--to <slug|id>", "Claim a reserved address created with sharedrop reserve (single file uploads only)")
  .option("--json", "Force JSON output")
  .action((path, opts) => uploadCommand(path, opts, program.opts()));

program
  .command("check <path>")
  .description(
    "Run the real upload checks on a file or folder without publishing: what would be removed, " +
      "blocked or moved, the effective mode, size, and pages with the same title. Exits 1 when the upload would change anything.",
  )
  .option("--mode <mode>", "Check as this mode: static, interactive (default: what upload would use)")
  .option("--page-id <id>", "Check as a re-upload of this page (uses its mode)")
  .option("--slides", "Check a single HTML file as a slide deck")
  .option("--entry <file>", "Entry HTML for a folder (relative to the folder)", "index.html")
  .option("--workspace <id|address>", "Workspace id or address (see `sharedrop workspaces`); overrides the default workspace")
  .option("--personal", "Use your personal space even when a default workspace is set")
  .option("--json", "Force JSON output")
  .action((path, opts) => checkCommand(path, opts, program.opts()));

program
  .command("archive <file>")
  .description(
    "Upload a large archive (zip, tar, gz, tgz, sql, sql.gz). Pro plan or higher. " +
      "Counts against your storage quota. Download-only and private.",
  )
  .option("--title <title>", "Page title (auto-detected if omitted)")
  .option("--folder <id|path>", "Destination folder, in the workspace when one applies (creates path segments as needed)")
  .option("--workspace <id|address>", "Workspace id or address (see `sharedrop workspaces`); overrides the default workspace")
  .option("--personal", "Use your personal space even when a default workspace is set")
  .option(
    "--store-as-file",
    "Store ANY file as a download-only blob, bypassing the archive-extension check (for a large non-archive file)",
  )
  .option("--json", "Force JSON output")
  .action((file, opts) => archiveCommand(file, opts, program.opts()));

program
  .command("list")
  .description("List your pages")
  .option("--limit <n>", "Number of pages", "50")
  .option("--cursor <id>", "Pagination cursor")
  .option("--workspace <id|address>", "Workspace id or address (see `sharedrop workspaces`); overrides the default workspace")
  .option("--personal", "Use your personal space even when a default workspace is set")
  .option("--folder <id|path>", "List pages inside a folder, in the workspace when one applies (id or existing path)")
  .option("--json", "Force JSON output")
  .action((opts) => listCommand(opts, program.opts()));

program
  .command("search <query>")
  .description("Search your pages by title, slug, id, or file type (e.g. \"jpeg\", \"report\")")
  .option("--limit <n>", "Number of results", "50")
  .option("--cursor <id>", "Pagination cursor")
  .option("--workspace <id|address>", "Workspace id or address (see `sharedrop workspaces`); overrides the default workspace")
  .option("--personal", "Use your personal space even when a default workspace is set")
  .option("--json", "Force JSON output")
  .action((query, opts) => searchCommand(query, opts, program.opts()));

program
  .command("get <id>")
  .description("Get a page by id, slug, or URL")
  .option("--json", "Force JSON output")
  .action((id, opts) => getCommand(id, opts, program.opts()));

program
  .command("download <id>")
  .description("Download a page's artefact as a zip, or with --version the exact file uploaded for that version")
  .option("-o, --output <path>", "Output file path ('-' for stdout)")
  .option(
    "--version <n|latest>",
    "Download this version's original upload (a folder upload as a zip); see `sharedrop versions <id>`",
  )
  .option("--json", "Force JSON output")
  .action((id, opts) => downloadCommand(id, opts, program.opts()));

program
  .command("versions <id>")
  .description("List a page's versions (the current one first) with their numbers, for download --version")
  .option("--json", "Force JSON output")
  .action((id, opts) => versionsCommand(id, opts, program.opts()));

program
  .command("fetch <id>")
  .description("Fetch a page's raw content (prints to stdout by default)")
  .option("-o, --output <path>", "Output file path ('-' for stdout)")
  .option("--json", "Force JSON output")
  .action((id, opts) => fetchCommand(id, opts, program.opts()));

program
  .command("update <id> [file]")
  .description("Update a page: pass a file or folder to replace its content (keeps the same URL), and/or set metadata")
  .option("--title <title>", "New title")
  .option("--slug <slug>", "New readable address (Pro, public pages only). The old address redirects.")
  .option("--visibility <vis>", "New visibility: public, private, shared")
  .option("--mode <mode>", "Page mode when replacing content: static, interactive (default: keep the page's mode)")
  .option("--json", "Force JSON output")
  .action((id, file, opts) => updateCommand(id, file, opts, program.opts()));

program
  .command("delete <id>")
  .description("Delete a page")
  .option("--json", "Force JSON output")
  .action((id, opts) => deleteCommand(id, opts, program.opts()));

program
  .command("move <id>")
  .description("Move a page into a folder or back to the top level (in the page's own space)")
  .option("--folder <id|path>", "Destination folder in the page's own space, personal or workspace (creates path segments as needed)")
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
  .command("shared")
  .description("List pages other people have shared with you, newest first (needs a personal key, not sdw_)")
  .option("--limit <n>", "Number of shares", "50")
  .option("--cursor <id>", "Pagination cursor")
  .option("--json", "Force JSON output")
  .action((opts) => sharedCommand(opts, program.opts()));

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

const workspaces = program
  .command("workspaces")
  .description("List the team workspaces you belong to, with the address to pass to --workspace, and your default workspace")
  .option("--json", "Force JSON output")
  .action((opts) => workspacesCommand(opts, program.opts()));
workspaces
  .command("use [id|address]")
  .description(
    "Save a default workspace for this server, used by commands that take --workspace (--clear removes it)",
  )
  .option("--clear", "Remove the saved default workspace")
  .option("--json", "Force JSON output")
  .action((ref, opts) => workspacesUseCommand(ref, opts, program.opts()));

const folder = program
  .command("folder")
  .description("Manage folders (personal folders need Pro or higher; workspace folders come with Team)");
folder
  .command("create <path>")
  .description("Create a folder (a slash path auto-creates missing segments)")
  .option("--parent <id>", "Parent folder id in the same space (omit for root)")
  .option("--workspace <id|address>", "Workspace id or address (see `sharedrop workspaces`); overrides the default workspace")
  .option("--personal", "Use your personal space even when a default workspace is set")
  .option("--json", "Force JSON output")
  .action((path, opts) => folderCreateCommand(path, opts, program.opts()));
folder
  .command("list")
  .description("List your folders, or a workspace's folders")
  .option("--parent <id>", "List children of this folder (omit for root)")
  .option("--workspace <id|address>", "Workspace id or address (see `sharedrop workspaces`); overrides the default workspace")
  .option("--personal", "Use your personal space even when a default workspace is set")
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

const trash = program.command("trash").description("Manage trash");
trash
  .command("list")
  .description("List the pages and folders in your trash")
  .option("--workspace <id|address>", "Workspace id or address (see `sharedrop workspaces`); overrides the default workspace")
  .option("--personal", "Use your personal space even when a default workspace is set")
  .option("--json", "Force JSON output")
  .action((opts) => trashListCommand(opts, program.opts()));
trash
  .command("empty")
  .description("Permanently delete every item in your trash, or your items in a workspace's trash")
  .option("--workspace <id|address>", "Workspace id or address (see `sharedrop workspaces`); overrides the default workspace")
  .option("--personal", "Use your personal space even when a default workspace is set")
  .option("--json", "Force JSON output")
  .action((opts) => trashEmptyCommand(opts, program.opts()));

program
  .command("reserve")
  .description("Reserve a stable page address before the content exists")
  .option("--slug <slug>", "Optional readable address for the reserved public page.")
  .option("--title <title>", "Reservation title")
  .option("--agent-name <name>", "Name of the agent expected to claim this address")
  .option("--visibility <vis>", "Reserved visibility: public, private, shared")
  .option("--expires <timestamp>", "Expiry as an ISO 8601 timestamp")
  .option("--workspace <id|address>", "Workspace id or address (see `sharedrop workspaces`); overrides the default workspace")
  .option("--personal", "Use your personal space even when a default workspace is set")
  .option("--json", "Force JSON output")
  .action((opts) => reserveCommand(opts, program.opts()));

const reservations = program
  .command("reservations")
  .description("Manage reserved addresses");
reservations
  .command("list")
  .description("List your reserved addresses")
  .option("--limit <n>", "Number of results", "50")
  .option("--cursor <id>", "Pagination cursor")
  .option("--workspace <id|address>", "Workspace id or address (see `sharedrop workspaces`); overrides the default workspace")
  .option("--personal", "Use your personal space even when a default workspace is set")
  .option("--json", "Force JSON output")
  .action((opts) => reservationsListCommand(opts, program.opts()));
reservations
  .command("revoke <id>")
  .description("Revoke a reserved address")
  .option("--json", "Force JSON output")
  .action((id, opts) => reservationsRevokeCommand(id, opts, program.opts()));

// #255, disappearing links: a separate link with a time and/or view limit,
// for anyone with it or only for named people. The page itself never changes.
const link = program
  .command("link")
  .description("Manage disappearing links (Pro plan or higher)");
link
  .command("create <id>")
  .description("Create a disappearing link for a page (anyone with it, or --people only)")
  .option("--people <emails...>", "Only these people can open it, after signing in (comma or space separated)")
  .option("--expires-in <duration>", "Time limit, e.g. 30m, 12h or 7d")
  .option("--max-views <n>", "Total views allowed across everyone")
  .option("--present", "Slide decks only: open straight into fullscreen Present mode")
  .option("--no-email", "With --people: don't email them the link (send it yourself)")
  .option("--json", "Force JSON output")
  .action((id, opts) => linkCreateCommand(id, opts, program.opts()));
link
  .command("list <id>")
  .description("List a page's disappearing links with their views, limits and people")
  .option("--json", "Force JSON output")
  .action((id, opts) => linkListCommand(id, opts, program.opts()));
link
  .command("people <id> <link-id>")
  .description("Add or remove people on a link made for specific people")
  .option("--add <emails...>", "Emails to add")
  .option("--remove <emails...>", "Emails to remove")
  .option("--no-email", "Don't email the people you add")
  .option("--json", "Force JSON output")
  .action((id, linkId, opts) => linkPeopleCommand(id, linkId, opts, program.opts()));
link
  .command("revoke <id> <link-id>")
  .description("Revoke a disappearing link now (the page itself is unchanged)")
  .option("--json", "Force JSON output")
  .action((id, linkId, opts) => linkRevokeCommand(id, linkId, opts, program.opts()));

program
  .command("about")
  .description("Why sharedrop: positioning, capabilities, and key links (use --json for structured output)")
  .option("--json", "Force JSON output")
  .action(aboutCommand);

program.addHelpText(
  "after",
  "\nTargeting & auth (precedence, first match wins):\n" +
    "  --url / --token flags > SHAREDROP_URL / SHAREDROP_TOKEN env > .env file > saved login.\n" +
    "  Default login is a Clerk browser sign-in; --token / SHAREDROP_TOKEN take an sd_ API key.\n" +
    "  Defaults to https://sharedrop.cloud. Use --url or SHAREDROP_URL to target a different instance.\n" +
    "\nWorkspace (commands that take --workspace, first match wins):\n" +
    "  --workspace > --personal > SHAREDROP_WORKSPACE env > .env file > `sharedrop workspaces use` default > personal space.\n" +
    "  The saved default is per server URL. An sdw_ key always uses its own workspace.\n" +
    "\nsharedrop turns agent or human output into a shareable URL in one step.\n" +
    "Run 'sharedrop about' for why it's built for sharing with humans and machines.\n" +
    "Docs https://sharedrop.cloud/docs · For LLMs https://sharedrop.cloud/llms.txt"
);

// #416 hardening: --version before any command name prints the version, even
// after --url / --token (`sharedrop --url x --version`). After a command name
// it stays that command's option (`download <page> --version <n>`).
function hasLeadingVersionFlag(args: string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--version") return true;
    if (arg === "--url" || arg === "--token") i++;
    else if (!arg.startsWith("--url=") && !arg.startsWith("--token=")) return false;
  }
  return false;
}

if (hasLeadingVersionFlag(process.argv.slice(2))) {
  console.log(__CLI_VERSION__);
  process.exit(0);
}

program.parse();
