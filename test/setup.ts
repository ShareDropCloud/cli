// #409: the CLI config store (Conf) lives under the home directory. Point HOME
// and XDG_CONFIG_HOME at a fresh temp dir so tests never read or write the
// real CLI config, and drop any SHAREDROP_WORKSPACE from the caller's shell.
import { mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "sharedrop-cli-home-"));
process.env.HOME = home;
process.env.XDG_CONFIG_HOME = join(home, ".config");
delete process.env.SHAREDROP_WORKSPACE;
if (homedir() !== home) throw new Error("test setup: HOME override did not take effect");
