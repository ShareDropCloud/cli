# @sharedrop/cli

Upload and manage HTML, images, PDFs, and Markdown on [sharedrop](https://sharedrop.cloud) from the terminal.

```bash
npx @sharedrop/cli upload report.html
# ✓ live at sharedrop.cloud/you/4knxz9
```

## What is Sharedrop?

Sharedrop is the agent-native file drop — a sharing platform built for a world where AI
agents generate most of the documents humans read. You (or your agent) upload a file and
get a clean, stable URL; the right people get access through private-by-default
visibility, email shares, public links, or (Pro) disappearing links. Uploaded HTML is
sanitised and rendered in a locked-down sandbox on a separate origin, so untrusted
content stays contained.

This CLI is the terminal transport. The same account also speaks
[MCP](https://sharedrop.cloud/dashboard/settings/mcp) (for AI agents) and
[REST](https://sharedrop.cloud/docs/api-reference) (for everything else). If you're
wiring up an AI agent, also install the [agent skill](https://github.com/ShareDropCloud/skills)
so it knows when to reach for sharedrop:

```bash
npx skills add ShareDropCloud/skills --skill sharedrop -g
```

## Install

Run without installing:

```bash
npx @sharedrop/cli upload report.html
```

Install globally to get the `sharedrop` command:

```bash
npm install -g @sharedrop/cli
# or
curl -fsSL https://sharedrop.cloud/install.sh | sh        # macOS / Linux
iwr https://sharedrop.cloud/install.ps1 -useb | iex       # Windows PowerShell
```

Requires Node.js **>= 18.5.0**.

## Authentication

Interactive (opens a browser, Clerk sign-in — credentials are stored locally, like `gh`
or `glab`):

```bash
sharedrop login
sharedrop whoami     # confirm
```

Non-interactive (CI, agents, headless machines) — set an API key in the environment.
Create keys (they start with `sd_`) at
[dashboard → settings → API keys](https://sharedrop.cloud/dashboard/settings/api-keys):

```bash
export SHAREDROP_TOKEN=sd_...
sharedrop upload report.html
```

**Precedence (first match wins):** `--url`/`--token` flags → `SHAREDROP_URL`/`SHAREDROP_TOKEN`
env vars → a `.env` file in the current directory → saved browser login.

Stored credentials live per-OS: macOS `~/Library/Preferences/sharedrop-nodejs/`,
Linux `~/.config/sharedrop-nodejs/`, Windows `%APPDATA%\sharedrop-nodejs\`.

## Commands

```bash
sharedrop upload <file>     # Upload a file (HTML, image, PDF, MHTML, Markdown — or - for stdin)
sharedrop list              # List your pages (shows the ID column)
sharedrop search <query>    # Find pages by title, slug, id, or file type (e.g. "jpeg")
sharedrop get <ref>         # Show page details — ref is an id, slug, or URL
sharedrop update <ref> [file]  # Re-upload content (same URL, new version) and/or update title/visibility
sharedrop delete <ref>      # Delete a page
sharedrop share <ref> --email someone@example.com   # Share with a person
sharedrop login             # Browser sign-in (persists locally)
sharedrop whoami            # Show the authenticated account
sharedrop about             # Why sharedrop + key links (--json for structured output)
```

`<ref>` is whatever's easiest to copy: the page **id** from `list`, its **slug**, or a
full **URL** like `https://sharedrop.cloud/you/ubbsrh8rwx`.

### upload

```bash
sharedrop upload report.html        # HTML
sharedrop upload screenshot.png     # image (PNG, JPEG, WebP, GIF, AVIF, BMP, ICO, APNG, SVG, HEIC, HEIF, TIFF)
sharedrop upload contract.pdf       # PDF
sharedrop upload notes.md           # Markdown
sharedrop upload archive.mhtml      # MHTML web archive
cat report.html | sharedrop upload -            # stdin
sharedrop upload report.html --title "Q4 Report" --visibility public
sharedrop upload report.html --page-id <id>     # replace an existing page — same URL, new version
```

| Flag | Default | Description |
|------|---------|-------------|
| `--title <title>` | auto | Page title (auto-detected from HTML `<title>` or document metadata if omitted) |
| `--visibility <vis>` | `private` | `public`, `private`, or `shared` |
| `--mode <mode>` | `static` | `static` or `interactive` (HTML only; ignored for image/PDF/Markdown/MHTML) |
| `--workspace <id>` | — | Upload into a workspace |
| `--page-id <id>` | — | Replace an existing page's content (keeps the same URL) instead of creating a new page |
| `--json` | — | Force machine-readable JSON output |

**Pages are private by default.** A page uploaded with no `--visibility` flag is only
viewable by you until you publish it (`--visibility public`) or share it.

Uploads stream files of any supported kind through the direct-streamed pipeline
(sign → PUT to the upload edge → finalize), so there is **no request-body cap** — the
limit is your tier's file-size cap.

**Interactive HTML must be self-contained.** Interactive pages run JavaScript in a
local-only sandbox; if the page references anything external (CDN scripts, web fonts,
remote images, external APIs), sharedrop disables all of its JavaScript and serves it
static. Inline your CSS/JS/data, or use `--mode static` for script-less documents.

### list / search

```bash
sharedrop list --limit 20
sharedrop search "report" --limit 10
sharedrop list --cursor <id>        # pagination, cursor from previous output
sharedrop list --workspace <id>     # workspace pages
```

### get / update / delete

```bash
sharedrop get 4knxz9                              # by slug
sharedrop get https://sharedrop.cloud/you/4knxz9  # by URL
sharedrop update 4knxz9 report.html               # replace content — same URL, version recorded
sharedrop update 4knxz9 --title "New title" --visibility shared
sharedrop delete 4knxz9
```

### share

```bash
sharedrop share 4knxz9 --email alice@example.com
```

Grants the recipient access by email. On paid tiers the page auto-promotes from
`private` to `shared`; on the free tier it stays private but the recipient can still
view via the grant.

### login

```bash
sharedrop login                                  # sign in to sharedrop.cloud
sharedrop login --url https://staging.example    # sign in to a different instance (persisted)
```

## JSON output & scripting

Every command accepts `--json`, and emits JSON automatically when stdout is not a TTY:

```bash
PAGE=$(sharedrop upload report.html --json | jq -r '.id')
sharedrop share "$PAGE" --email alice@example.com --json
sharedrop delete "$PAGE" --json
```

## Configuration

| Variable | Purpose |
|----------|---------|
| `SHAREDROP_TOKEN` | API key (`sd_...`) for non-interactive auth |
| `SHAREDROP_URL` | Override the API base URL (default `https://sharedrop.cloud`) |

Both can also live in a `.env` file in the working directory.

## Errors you may see

| Error | Cause | Fix |
|-------|-------|-----|
| `FILE_SIZE_EXCEEDED` | File is larger than your tier's per-file cap | Upgrade tier, or split the file |
| `STORAGE_LIMIT` | Your total storage is at cap | Delete pages, buy a storage add-on, or upgrade |
| `PAGE_LIMIT_REACHED` | Free-tier page cap reached | Delete old pages or upgrade |
| `mime_mismatch` | The file's magic bytes don't match its extension (e.g. a `.pdf` that isn't a PDF) | Re-export from the source tool or rename the file to its real extension |
| `Invalid token` | The 5-minute upload window expired between sign and PUT | Re-run the command — the CLI mints a fresh token automatically |
| `UNAUTHORIZED` | Missing/revoked key, or a prod login used against another instance | `sharedrop login`, or check `SHAREDROP_TOKEN` |

## Development

This package is TypeScript, bundled with [tsup](https://tsup.egoist.dev), tested with
[vitest](https://vitest.dev):

```bash
npm install
npm run build      # tsup → dist/
npm test           # vitest
node dist/cli.js --help
```

Layout: `src/cli.ts` (commander wiring) · `src/commands/` (one file per command) ·
`src/client/` (API client + page-ref resolution) · `src/auth/` (Clerk OAuth + token
store) · `src/output/` (formatting + error rendering).

## About this repo

[github.com/ShareDropCloud/cli](https://github.com/ShareDropCloud/cli) is a **read-only
source mirror** of the `packages/cli` workspace in the private Sharedrop monorepo —
published so you can audit exactly what `npm install -g @sharedrop/cli` runs. Releases
ship to npm via trusted publishing; the mirror is synced from the same source. Bug
reports: [GitHub issues](https://github.com/ShareDropCloud/cli/issues) or
hello@sharedrop.cloud.

## License

MIT © Scott Owen
