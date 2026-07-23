import { writeFileSync, createWriteStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { SharedropApiClient } from "../client/api-client.js";
import { normalizePageRef } from "../client/page-ref.js";
import { resolveAuth, resolveBaseUrl } from "../auth/resolve.js";
import { requireAuth, handleError } from "../output/errors.js";

/**
 * #139 — `sharedrop download <id>` writes a page's artefact to disk.
 * #207 — the command is now kind-aware. A getPage round-trip reads the page kind,
 * then branches:
 *
 *   - archive kind → raw bytes via GET /api/archives/:id/download (302 to a
 *     presigned octet-stream URL). The archive lives in the archives bucket, so
 *     the v1 zip route has nothing to zip and 404s; this branch never touches it.
 *   - every other kind (or an older server that omits `kind`) → the existing v1
 *     zip route, byte-for-byte unchanged.
 *
 * Output target:
 *   - "-"                  → stream the raw bytes to stdout (no log line)
 *   - --output <path>      → write to that path
 *   - (default)            → archive: the page title when it is filename-like,
 *                            else the bare ref (NO .zip); every other kind:
 *                            "<ref>.zip"
 *
 * The getPage round-trip also powers the archive filename default: the page title
 * (e.g. "backup.tar.gz") is used when it looks like a filename, else the ref.
 */

/** True when a title is safe to use as a bare filename (no path parts, has an ext). */
function isFilenameLike(title: string): boolean {
  if (title === "." || title === "..") return false;
  if (title.includes("/") || title.includes("\\")) return false;
  return /^[^\s][^/\\]*\.[A-Za-z0-9]{1,10}$/.test(title);
}

export async function downloadCommand(
  id: string,
  opts: { output?: string; json?: boolean },
  globalOpts: { url?: string; token?: string } = {},
): Promise<void> {
  try {
    const auth = await resolveAuth(globalOpts.token);
    requireAuth(auth);

    const baseUrl = resolveBaseUrl(globalOpts.url);
    const client = new SharedropApiClient({ apiKey: auth.token, baseUrl });

    const ref = normalizePageRef(id);
    const page = await client.getPage(ref);

    if (page.kind === "archive") {
      // #207 — pass the resolved page.id (a UUID), NOT the raw ref: the archive
      // download route looks the page up by id, so a slug ref would be compared to
      // a uuid column and 500 (Fable #9). Stream the body straight through instead
      // of buffering — a 10 GB archive must never sit in memory.
      const res = await client.openArchiveDownload(page.id);
      const body = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream);

      if (opts.output === "-") {
        // Write chunks by hand rather than pipeline(): pipeline would call end()
        // on process.stdout and close it. This never buffers the whole file.
        for await (const chunk of body) process.stdout.write(chunk as Buffer);
        return;
      }

      const path =
        opts.output ??
        (page.title && isFilenameLike(page.title) ? page.title : ref);
      await pipeline(body, createWriteStream(path));
      console.log(`Downloaded ${ref} → ${path} (${statSync(path).size} bytes)`);
      return;
    }

    const buf = await client.downloadPage(ref);

    if (opts.output === "-") {
      process.stdout.write(buf);
      return;
    }

    const path = opts.output ?? `${ref}.zip`;
    writeFileSync(path, buf);
    console.log(`Downloaded ${ref} → ${path} (${buf.length} bytes)`);
  } catch (err) {
    handleError(err, opts);
  }
}
