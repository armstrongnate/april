import { stringify as stringifyYaml } from "yaml";
import { findConfigPath, parseConfigFile } from "../config.js";

const USAGE = `april config [--path] [--validate] [--json]

  (no flags)   Print the resolved config file path and its parsed contents.
  --path       Print only the resolved config file path.
  --validate   Parse and validate the config; exit non-zero if invalid.
  --json       Emit the parsed config as JSON instead of YAML.`;

export function run(args: string[]): number {
  for (const a of args) {
    if (!["--path", "--validate", "--json"].includes(a)) {
      console.error(`Unknown option: ${a}\n\n${USAGE}`);
      return 2;
    }
  }
  const wantPath = args.includes("--path");
  const wantValidate = args.includes("--validate");
  const wantJson = args.includes("--json");

  let path: string;
  try {
    path = findConfigPath();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  if (wantPath) {
    console.log(path);
    return 0;
  }

  let config;
  try {
    config = parseConfigFile(path);
  } catch (err) {
    console.error(`✗ Invalid config (${path}):`);
    console.error(`  ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  if (wantValidate) {
    console.log(`✓ Config is valid (${path})`);
    return 0;
  }

  console.log(`# ${path}`);
  console.log(wantJson ? JSON.stringify(config, null, 2) : stringifyYaml(config).trimEnd());
  return 0;
}
