import { defineConfig } from "tsup";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf-8"),
) as { version: string };

export default defineConfig({
  entry: { cli: "src/cli.ts" },
  format: ["esm"],
  dts: false,
  clean: true,
  target: "node18",
  banner: { js: "#!/usr/bin/env node" },
  // Compile-time constant injected into src/cli.ts (declared in globals.d.ts),
  // so the --version flag always matches the published package version.
  define: { __CLI_VERSION__: JSON.stringify(version) },
});
