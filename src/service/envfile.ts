import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

export function envFilePath(): string {
  return join(homedir(), ".config", "april", "env");
}

const DEFAULT_HEADER = `# april daemon environment variables
# One KEY=VALUE per line. Lines starting with # are ignored.
# Values may be wrapped in double quotes if they contain spaces or special chars.
# After editing, run: april restart
`;

/** Create the env file with a friendly header if it doesn't exist. Never overwrites. */
export function ensureEnvFile(): "created" | "exists" {
  const path = envFilePath();
  if (existsSync(path)) return "exists";
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, DEFAULT_HEADER, "utf-8");
  return "created";
}

/**
 * Parse the env file and return key/value pairs. Used by launchd, which has
 * no native EnvironmentFile= equivalent — values must be inlined into the plist.
 *
 * Format: KEY=VALUE per line. # for comments. Optional double-quotes around the value.
 */
export function parseEnvFile(): Record<string, string> {
  const path = envFilePath();
  if (!existsSync(path)) return {};

  const result: Record<string, string> = {};
  const raw = readFileSync(path, "utf-8");

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}
