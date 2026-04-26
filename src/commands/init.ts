import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { ensureEnvFile, envFilePath } from "../service/envfile.js";
import { isGhWebhookExtensionInstalled, GH_EXTENSION_INSTALL_CMD } from "../precheck.js";

export const SKILL_DST = join(homedir(), ".claude", "skills", "issue-worker", "SKILL.md");

export function bundledSkillPath(): string {
  const here = fileURLToPath(import.meta.url);
  return resolve(dirname(here), "..", "..", "skills", "issue-worker", "SKILL.md");
}

export type SkillState = "missing" | "matches-bundled" | "differs-from-bundled";

export function compareSkill(): SkillState {
  if (!existsSync(SKILL_DST)) return "missing";
  const src = bundledSkillPath();
  if (!existsSync(src)) return "matches-bundled"; // bundle missing, can't compare; don't alarm
  const a = readFileSync(SKILL_DST);
  const b = readFileSync(src);
  return a.equals(b) ? "matches-bundled" : "differs-from-bundled";
}

// Resolve the bundled package root from this file's installed location.
// dist/commands/init.js -> dist/.. (the package root, where config.example.yaml + skills/ live)
function packageRoot(): string {
  const here = fileURLToPath(import.meta.url);
  return resolve(dirname(here), "..", "..");
}

function copyIfMissing(src: string, dst: string, label: string, force: boolean): "wrote" | "exists" {
  mkdirSync(dirname(dst), { recursive: true });
  if (existsSync(dst) && !force) {
    console.log(`  ${label}: already exists at ${dst} (use --force to overwrite)`);
    return "exists";
  }
  copyFileSync(src, dst);
  console.log(`  ${label}: wrote ${dst}`);
  return "wrote";
}

export function run(args: string[]): number {
  const force = args.includes("--force") || args.includes("-f");
  const root = packageRoot();

  console.log("april init");
  console.log("");

  const configSrc = join(root, "config.example.yaml");
  const configDst = join(homedir(), ".config", "april", "config.yaml");
  if (!existsSync(configSrc)) {
    console.error(`  Cannot find bundled config.example.yaml at ${configSrc}`);
    return 1;
  }
  const configResult = copyIfMissing(configSrc, configDst, "config", force);

  const skillSrc = bundledSkillPath();
  if (!existsSync(skillSrc)) {
    console.error(`  Cannot find bundled skill at ${skillSrc}`);
    return 1;
  }
  copyIfMissing(skillSrc, SKILL_DST, "skill", force);

  const envState = ensureEnvFile();
  console.log(
    `  env:    ${envState === "created" ? "wrote" : "already exists"} ${envFilePath()}`
  );

  console.log("");
  console.log("Checks:");
  if (isGhWebhookExtensionInstalled()) {
    console.log("  ✓ gh extension cli/gh-webhook installed");
  } else {
    console.log("  ✗ gh extension cli/gh-webhook NOT installed");
    console.log(`    Install with:  ${GH_EXTENSION_INSTALL_CMD}`);
    console.log("    (april will refuse to start without it.)");
  }

  console.log("");
  if (configResult === "wrote") {
    console.log(`Next: edit ${configDst}, then run \`april install\`.`);
  } else {
    console.log(`Next: review ${configDst}, then run \`april install\`.`);
  }
  return 0;
}
