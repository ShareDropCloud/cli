import chalk from "chalk";
import ora from "ora";
import { oauthLogin } from "../auth/oauth.js";
import { resolveBaseUrl } from "../auth/resolve.js";
import { storeOAuth, clearToken } from "../auth/store.js";
import { handleError, EXIT_CODES } from "../output/errors.js";
import { isTTY, shouldOutputJson } from "../output/format.js";

export async function loginCommand(
  opts: { json?: boolean; url?: string },
  globalOpts: { url?: string; token?: string } = {},
): Promise<void> {
  try {
    // Browser login needs an interactive terminal. CI/machines use
    // SHAREDROP_TOKEN (or --token) with an sd_ API key instead.
    if (!isTTY()) {
      const msg =
        "Login requires an interactive terminal. Use SHAREDROP_TOKEN (an sd_ API key) for non-interactive auth.";
      if (shouldOutputJson(opts)) {
        console.error(JSON.stringify({ error: { code: "AUTH_REQUIRED", message: msg } }, null, 2));
      } else {
        console.error(msg);
      }
      process.exit(EXIT_CODES.AUTH_REQUIRED);
    }

    const baseUrl = resolveBaseUrl(globalOpts.url);
    const spinner = ora(`Opening browser to sign in at ${baseUrl}...`).start();

    try {
      const creds = await oauthLogin(baseUrl);
      storeOAuth(creds);
      clearToken();
      spinner.succeed(chalk.green(`Logged in to ${baseUrl}`));
    } catch (err) {
      spinner.fail("Login failed");
      throw err;
    }

    // The callback server / browser-opener can leave handles open. Exit
    // explicitly so the shell prompt returns immediately.
    process.exit(0);
  } catch (err) {
    handleError(err, opts);
  }
}
