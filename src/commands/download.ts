import { writeFileSync, createWriteStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { SharedropApiClient, SharedropApiError } from "../client/api-client.js";
import { normalizePageRef } from "../client/page-ref.js";
import { resolveAuth, resolveBaseUrl } from "../auth/resolve.js";
import { requireAuth, handleError } from "../output/errors.js";
import { shouldOutputJson } from "../output/format.js";

/**
 * #139: `sharedrop download <id>` writes a page's artefact to disk.
 * #207: the command is now kind-aware. A getPage round-trip reads the page kind,
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
 *
 * #418: `--version <N|latest>` skips all of the above and streams that
 * version's exact original from GET /api/v1/pages/:id/versions/:version/download
 * (default name from the server's Content-Disposition, e.g. "abc234-v2.pdf").
 */

/** True when a title is safe to use as a bare filename (no path parts, has an ext). */
function isFilenameLike(title: string): boolean {
  if (title === "." || title === "..") return false;
  if (title.includes("/") || title.includes("\\")) return false;
  return /^[^\s][^/\\]*\.[A-Za-z0-9]{1,10}$/.test(title);
}

/** #418: the file name from `Content-Disposition`, without any path part. */
function dispositionFilename(header: string | null): string | null {
  const name = header?.match(/filename="([^"]+)"/)?.[1];
  const base = name?.split(/[/\\]/).pop();
  return base && base !== "." && base !== ".." ? base : null;
}

/** Write a streamed body to stdout ("-") or a file, never buffering it whole. */
async function writeStream(res: Response, output: string | null): Promise<string | null> {
  const body = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream);
  if (output === null) {
    // Write chunks by hand rather than pipeline(): pipeline would call end()
    // on process.stdout and close it.
    for await (const chunk of body) process.stdout.write(chunk as Buffer);
    return null;
  }
  await pipeline(body, createWriteStream(output));
  return output;
}

export async function downloadCommand(
  id: string,
  opts: { output?: string; version?: string; json?: boolean },
  globalOpts: { url?: string; token?: string } = {},
): Promise<void> {
  try {
    const auth = await resolveAuth(globalOpts.token);
    requireAuth(auth);

    const baseUrl = resolveBaseUrl(globalOpts.url);
    const client = new SharedropApiClient({ apiKey: auth.token, baseUrl });

    const ref = normalizePageRef(id);

    // #418: --version downloads that version's exact original upload (a
    // folder upload as a zip), named as the server names it unless -o is set.
    if (opts.version !== undefined) {
      if (!/^(latest|[1-9][0-9]*)$/.test(opts.version)) {
        throw new SharedropApiError(
          "VALIDATION_ERROR",
          "--version takes a version number (see `sharedrop versions <page>`) or latest.",
          400,
        );
      }
      const res = await client.openVersionDownload(ref, opts.version);
      if (opts.output === "-") {
        await writeStream(res, null);
        return;
      }
      const filename = dispositionFilename(res.headers.get("content-disposition"));
      const path = opts.output ?? filename ?? `${ref}-v${opts.version}`;
      await writeStream(res, path);
      const size = statSync(path).size;
      // #416 hardening: --json or a non-terminal stdout gets a JSON object.
      if (shouldOutputJson(opts)) {
        const version = opts.version === "latest" ? "latest" : Number(opts.version);
        console.log(
          JSON.stringify({ data: { id: ref, version, path, filename, size_bytes: size } }, null, 2),
        );
      } else {
        console.log(`Downloaded ${ref} version ${opts.version} → ${path} (${size} bytes)`);
      }
      return;
    }

    const page = await client.getPage(ref);

    if (page.kind === "archive") {
      // #207: pass the resolved page.id (a UUID), NOT the raw ref: the archive
      // download route looks the page up by id, so a slug ref would be compared to
      // a uuid column and 500 (Fable #9). Stream the body straight through instead
      // of buffering: a 10 GB archive must never sit in memory.
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
