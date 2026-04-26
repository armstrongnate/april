import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

// Resolve the daemon entry point relative to this file's installed location.
// When published to npm, both cli.js and index.js live in dist/ alongside service/.
export function daemonEntryPath(): string {
  const here = fileURLToPath(import.meta.url);
  // dist/service/paths.js -> dist/index.js
  return resolve(dirname(here), "..", "index.js");
}

export function nodeBinaryPath(): string {
  return process.execPath;
}

export const SERVICE_NAME = "april";
export const LAUNCHD_LABEL = "dev.april.daemon";

export function systemdUnitPath(): string {
  return join(homedir(), ".config", "systemd", "user", `${SERVICE_NAME}.service`);
}

export function launchdPlistPath(): string {
  return join(homedir(), "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
}

export function launchdLogPath(): string {
  return join(homedir(), "Library", "Logs", "april", "april.log");
}

export function launchdLogDir(): string {
  return join(homedir(), "Library", "Logs", "april");
}
