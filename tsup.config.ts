import { defineConfig } from "tsup";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf-8"),
) as { version: string };

export default defineConfig({
  // #227: dist/cli.js (the bin) is the Node version check in src/bin.ts, which
  // then loads the real CLI from dist/main.js.
  entry: { cli: "src/bin.ts", main: "src/cli.ts" },
  format: ["esm"],
  dts: false,
  clean: true,
  target: "node18",
  banner: { js: "#!/usr/bin/env node" },
  // Compile-time constant injected into src/cli.ts (declared in globals.d.ts),
  // so the --version flag always matches the published package version.
  define: { __CLI_VERSION__: JSON.stringify(version) },
});
