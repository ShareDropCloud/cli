// #227: the published `sharedrop` entry. It checks the Node version BEFORE the
// real CLI loads: an ES module's static imports are all parsed up front, so on an
// old Node a dependency's newer syntax would crash with a SyntaxError before any
// check inside cli.ts could run. Keep this file free of dependency imports.
import { isSupportedNodeVersion, unsupportedNodeMessage } from "./node-version.js";

if (!isSupportedNodeVersion(process.versions.node)) {
  process.stderr.write(unsupportedNodeMessage(process.versions.node) + "\n");
  process.exit(1);
}

await import("./cli.js");
