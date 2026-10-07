# @sharedrop/cli

Upload and manage HTML, images, PDFs, and Markdown on [sharedrop](https://sharedrop.cloud) from the terminal.

```bash
npx @sharedrop/cli upload report.html
# ✓ live at sharedrop.cloud/you/4knxz9
```

## What is Sharedrop?

Sharedrop is the agent-native file drop: a sharing platform built for a world where AI
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

Requires Node.js **>= 20.10.0**.

## Authentication

Interactive (opens a browser, Clerk sign-in; credentials are stored locally, like `gh`
or `glab`):

```bash
sharedrop login
sharedrop whoami     # confirm
```

Non-interactive (CI, agents, headless machines): set an API key in the environment.
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
sharedrop upload <file>     # Upload a file (HTML, image, PDF, MHTML, Markdown, or - for stdin)
sharedrop check <path>      # Run the upload checks on a file or folder without publishing
sharedrop list              # List your pages (shows the ID column)
sharedrop search <query>    # Find pages by title, slug, id, or file type (e.g. "jpeg")
sharedrop get <ref>         # Show page details (ref is an id, slug, or URL)
sharedrop fetch <ref>       # Pull a page's RAW content (stdout by default, or -o file)
sharedrop download <ref>    # Download a page's full artefact as a ZIP (root + all assets)
sharedrop update <ref> [file|folder]  # Re-upload content (same URL, new version) and/or update title/visibility
sharedrop reserve [options] # Reserve an address before the first upload
sharedrop delete <ref>      # Delete a page
sharedrop share <ref> --email someone@example.com   # Share with a person
sharedrop link create <ref> --expires-in 12h        # (Pro) Disappearing link; add --people to name who can open it
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
sharedrop upload report.html --page-id <id>     # replace an existing page (same URL, new version)
```

| Flag | Default | Description |
|------|---------|-------------|
| `--title <title>` | see description | Page title. A new single file takes its file name without the extension; stdin (`-`) and folders take the HTML `<title>` (a folder's entry file); `--page-id` keeps the current title |
| `--visibility <vis>` | `private` | `public`, `private`, or `shared` |
| `--mode <mode>` | see below | `static` or `interactive` (HTML only; ignored for image/PDF/Markdown/MHTML) |
| `--workspace <id>` | None | Upload into a workspace |
| `--page-id <id>` | None | Replace an existing page's content (keeps the same URL) instead of creating a new page |
| `--folder <id\|path>` | top level | (Pro) File a new page or folder bundle into a folder |
| `--json` | None | Force machine-readable JSON output |

**Which mode a page gets:**

| You run | Mode |
|---------|------|
| `upload` with no `--mode` (new page) | Your account's default upload mode: `interactive` unless you changed it in settings |
| `upload --page-id` or `update` with no `--mode` | The page keeps its current mode |
| `--mode static` or `--mode interactive` | That mode |

The result always says which mode the page got (`Mode:` in the terminal, `data.mode` in JSON).

**Pages are private by default.** A page uploaded with no `--visibility` flag is only
viewable by you until you publish it (`--visibility public`) or share it.

Uploads stream files of any supported kind through the direct-streamed pipeline
(sign → PUT to the upload edge → finalize), so there is **no request-body cap**; the
limit is your tier's file-size cap (Free 10 MB, Pro and Team 100 MB). HTML and other text
files (Markdown, code, plain text, JSON, JSONL, MHTML, skills, Word docs, spreadsheets) and SVG
images are capped at 10 MB on every plan (upload larger content as a zip with `sharedrop archive` on Pro
or Team), and a folder bundle is capped at your tier's file-size cap
across all its files together.

**Interactive HTML must be self-contained.** Interactive pages run JavaScript in a
local-only sandbox; if the page references anything external (CDN scripts, web fonts,
remote images, external APIs), sharedrop disables all of its JavaScript and serves it
static. Inline your CSS/JS/data, or use `--mode static` for script-less documents. The upload
result says whether scripts will run (`data.scripts_will_run`) and lists the external hosts it
found (`data.external_resource_hosts`); `sharedrop check` tells you before you publish.

### check

```bash
sharedrop check report.html            # exit 0: publishes as-is; exit 1: something would change
sharedrop check ./site --json          # a folder bundle
sharedrop check deck.html --slides     # as a slide deck
sharedrop check report.html --page-id <id>   # as a re-upload of that page
sharedrop check report.html --workspace <id> # as an upload to that workspace
```

`check` streams the file to quarantine like `upload`, runs the server's real checks (sanitiser,
inline image extraction, slides detection, size limit, external hosts), then deletes the copy.
Nothing is published and no page slot is used. JSON output is `{ "data": { kind, mode_effective,
detected_slides, size_ok, size_bytes, size_limit_bytes, title, warnings, images_extracted,
external_resource_hosts, scripts_would_run, same_title_pages, would_change } }` (a folder adds
`files`). It exits `1` when `would_change` is `true`: the file is too large, or something would be
removed or would stop scripts running. Moving inline images to hosted storage alone is not a change.

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
sharedrop update 4knxz9 report.html               # replace content (same URL, version recorded)
sharedrop update 4knxz9 ./site                    # replace a folder page's files in place
sharedrop update 4knxz9 --title "New title" --visibility shared
sharedrop update 4knxz9 --slug quarterly-report   # Pro public page custom address
sharedrop reserve --visibility public --slug quarterly-report  # reserve a readable public address
sharedrop delete 4knxz9
```

`--slug <address>` on `update` renames a public Pro page. The same option on `reserve` pre-claims a readable address for a public Pro reservation.

### fetch

Pull a page's **raw content** into your terminal or an agent's context: the original
bytes with their real content type, not the sandboxed viewer page. `get` shows metadata;
`fetch` returns the content itself. Works for your own pages, public pages, and pages
shared with you; available on every tier.

```bash
sharedrop fetch 4knxz9                 # raw content to stdout
sharedrop fetch 4knxz9 -o report.html  # write to a file
sharedrop fetch 4knxz9 | grep -i title # pipe into another tool
```

| Flag | Default | Description |
|------|---------|-------------|
| `-o, --output <path>` | stdout | Write the bytes to a file (`-` is stdout) |
| `--json` | None | Force machine-readable JSON output |

Distinct from a zip **download**: `fetch` mints a short-lived signed URL, GETs it, and
emits the raw root document. This is the agent-native read path.

### download

Download a page's **complete artefact as a zip**: the root document plus every asset
(images, CSS, JS) under it, with their original relative layout preserved. Use this when
you want the whole bundle on disk; use `fetch` when you just want the raw root document.

```bash
sharedrop download 4knxz9                 # writes 4knxz9.zip
sharedrop download 4knxz9 -o report.zip   # write to a specific path
sharedrop download 4knxz9 -o - > out.zip  # stream the zip to stdout
```

| Flag | Default | Description |
|------|---------|-------------|
| `-o, --output <path>` | `<ref>.zip` | Output file path (`-` streams the zip to stdout) |
| `--json` | None | Force machine-readable JSON output (errors only) |

You can download a page you **own**, or one that has been **shared to you with download
enabled** (the sharer ticks "allow zip download" on your access grant, matched against your
account's verified email). Pages you can't download return a not-found error, the same
response as a page that doesn't exist, so existence is never leaked.

> The default filename uses the **ref** you pass (`<ref>.zip`), not the page's slug, because the
> slug isn't known client-side without an extra lookup. Pass `-o` to control the name.

### share

```bash
sharedrop share 4knxz9 --email alice@example.com
```

Grants the recipient access by email. On paid tiers the page auto-promotes from
`private` to `shared`; on the free tier it stays private but the recipient can still
view via the grant.

### link (Pro)

```bash
sharedrop link create 4knxz9 --expires-in 12h --max-views 5              # anyone with the link
sharedrop link create 4knxz9 --people alice@example.com --expires-in 7d  # only Alice, after sign-in
sharedrop link list 4knxz9
sharedrop link people 4knxz9 <link-id> --add bob@example.com --remove alice@example.com
sharedrop link revoke 4knxz9 <link-id>
```

A disappearing link is a separate URL that stops working after its time limit or view
limit (one total across everyone). It never changes the page's own visibility or
sharing. With `--people`, only those email addresses can open it, after signing in; they
get access through the link only. Sharedrop emails them the link and its limits (also
when you add people later); add `--no-email` to send it yourself.

### archive (Pro)

Store a large file as a private, download-only archive. Archives are not rendered in the
viewer; get the bytes back with `sharedrop download <id>`.

```bash
sharedrop archive backup.zip                          # zip, tar, gz, tgz, sql or sql.gz
sharedrop archive dump.sql.gz --title "Nightly dump" --folder backups/2026
sharedrop archive model-weights.bin --store-as-file   # any other file type, stored as-is
```

| Flag | Default | Description |
|------|---------|-------------|
| `--title <title>` | file name | Page title |
| `--folder <id\|path>` | top level | Destination folder (missing path segments are created) |
| `--workspace <id>` | none | Upload into a workspace |
| `--store-as-file` | off | Accept any file type, not just archive formats |
| `--json` | off | Force machine-readable JSON output |

Limits: Pro plan or higher. Each archive can be up to your plan's archive limit (10 GB on
Pro and Team, shown as `entitlements.maxArchiveBytes` in `sharedrop whoami --json`),
which is separate from the normal file-size limit, and it counts against your storage
quota. Files over 30 MB upload in parts, retrying failed parts, and you can have one
multipart upload in progress at a time. If an upload fails or you press Ctrl-C, the CLI
cancels it so the reserved storage is released.

### folders (Pro)

Organise pages into nested folders. Folder commands need the Pro plan or higher.

```bash
sharedrop folder create reports/2026/q3     # creates any missing segments
sharedrop folder list                       # top-level folders
sharedrop folder list --parent <folder-id>  # a folder's children
sharedrop folder rename <folder-id> "Q3 reports"
sharedrop folder move <folder-id> --parent <folder-id>   # or --root for the top level
sharedrop folder delete <folder-id>         # add --force if the folder is not empty
sharedrop folder restore <id>               # bring a folder or page back from trash
sharedrop trash empty                       # permanently delete everything in trash

sharedrop upload report.html --folder reports/2026/q3   # upload straight into a folder
sharedrop list --folder reports/2026/q3                 # pages in a folder
sharedrop move <page-id> --folder reports/2026/q3       # move a page (or --root)
```

`--folder` takes a folder id or a slash path. On `upload`, `archive` and `move`, missing
path segments are created; on `list` the path must already exist. An empty folder is
deleted straight away; a folder with contents needs `--force`, which moves the whole
folder to trash. `folder restore` brings items back within 30 days (7 days for archives)
unless you empty the trash first.

### login

```bash
sharedrop login                                  # sign in to sharedrop.cloud
sharedrop login --url https://staging.example    # sign in to a different instance (persisted)
```

## JSON output & scripting

Every command accepts `--json`, and emits JSON automatically when stdout is not a TTY:

```bash
PAGE=$(sharedrop upload report.html --json | jq -r '.data.id')
sharedrop share "$PAGE" --email alice@example.com --json
sharedrop delete "$PAGE" --json
```

`upload` and `update <ref> <file|folder>` return `id`, `title`, `url`, `full_url`, `kind`, `mode`,
`visibility`, `was_reupload`, `version`, `scripts_will_run`, `external_resource_hosts` and
`warnings` (always present; codes `removed_tag`, `removed_attribute`, `images_extracted`,
`external_refs_block_scripts`). A new page also gets `same_title_pages` (your pages with the same
title, a hint only), and a folder bundle gets `skipped` (files left out, with a reason). A revision
keeps the same `id` and `url` and its `version` goes up by one.

**Exit codes:** `0` success, `1` general error (also an expired upload token, or `check` finding a
change), `2` no token found locally, `3` token rejected by the server (401) or forbidden (403),
`4` rate limited, `5` not found, `6` validation error, `7` payment required.

## Custom domains

If your account has a live custom domain, the CLI prints the branded address for any page eligible
for it. `upload`, `list`, `get` and `reservations` show
`https://share.yourcompany.com/yourhandle/abc123` instead of the `sharedrop.cloud` address, and
`--json` carries the same value in `full_url`.

Only public and shared pages are eligible. Private pages and archives keep their `sharedrop.cloud`
address. Custom domains are subdomains only: a `share` and a `view` subdomain, each with a CNAME
record plus a TXT record for pre-validation, and on a Cloudflare-proxied zone both CNAMEs must be
DNS only. The CLI keeps talking to `sharedrop.cloud`; only the recipient URL is branded.

Full setup guide: https://sharedrop.cloud/docs/custom-domains

## Configuration

| Variable | Purpose |
|----------|---------|
| `SHAREDROP_TOKEN` | API key (`sd_...`) for non-interactive auth |
| `SHAREDROP_URL` | Override the API base URL (default `https://sharedrop.cloud`) |

Both can also live in a `.env` file in the working directory.

## Errors you may see

| Error | Cause | Fix |
|-------|-------|-----|
| `FILE_SIZE_EXCEEDED` | File is larger than your tier's per-file cap, an HTML or other text file is over 10 MB, or a folder bundle is over its total cap | Upgrade tier (does not raise the 10 MB text limit), split the file, or upload it as a zip with `sharedrop archive` |
| `STORAGE_LIMIT` | Your total storage is at cap | Delete pages, buy a storage add-on, or upgrade |
| `TIER_LIMIT` | Free-tier page cap reached, or the file kind is not on your plan | Delete old pages or upgrade |
| `mime_mismatch` | The file's magic bytes don't match its extension (e.g. a `.pdf` that isn't a PDF) | Re-export from the source tool or rename the file to its real extension |
| `Invalid token` | The 5-minute upload window expired between sign and PUT | Re-run the command; the CLI mints a fresh token automatically |
| `TOKEN_EXPIRED` | The one-off upload token expired before finalize (exit 1; your API token is fine) | Re-run the command |
| `UNAUTHORIZED` | Revoked or invalid key, or a prod login used against another instance (exit 3) | `sharedrop login`, or check `SHAREDROP_TOKEN` |

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
source mirror** of the `packages/cli` workspace in the private Sharedrop monorepo,
published so you can audit exactly what `npm install -g @sharedrop/cli` runs. Releases
ship to npm via trusted publishing; the mirror is synced from the same source. Bug
reports: [GitHub issues](https://github.com/ShareDropCloud/cli/issues) or
hello@sharedrop.cloud.

## License

MIT © Scott Owen
