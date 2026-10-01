// #227: the oldest Node the CLI actually runs on. Its dependencies (commander 14,
// conf 15, open 11, ora 9) declare Node >= 20, and ora's cli-spinners uses JSON
// import attributes (`with { type: "json" }`), which Node 20 only parses from
// 20.10.0. Keep this in step with `engines.node` in package.json.
export const MIN_NODE_VERSION = "20.10.0";

function parse(version: string): [number, number, number] {
  const [major = 0, minor = 0, patch = 0] = version
    .replace(/^v/, "")
    .split(".")
    .map((part) => parseInt(part, 10) || 0);
  return [major, minor, patch];
}

export function isSupportedNodeVersion(
  version: string,
  min: string = MIN_NODE_VERSION,
): boolean {
  const have = parse(version);
  const need = parse(min);
  for (let i = 0; i < 3; i++) {
    if (have[i] !== need[i]) return have[i] > need[i];
  }
  return true;
}

export function unsupportedNodeMessage(version: string): string {
  return (
    `sharedrop needs Node.js ${MIN_NODE_VERSION} or newer, but this is Node.js ${version.replace(/^v/, "")}.\n` +
    "Install a current LTS release from https://nodejs.org and run the command again."
  );
}
