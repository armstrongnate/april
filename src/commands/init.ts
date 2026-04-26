import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { ensureEnvFile, envFilePath } from "../service/envfile.js";
import { isGhWebhookExtensionInstalled, GH_EXTENSION_INSTALL_CMD } from "../precheck.js";
import { SKILL_DST, bundledSkillPath, compareSkill } from "../skill.js";

// Resolve the bundled package root from this file's installed location.
// dist/commands/init.js -> dist/.. (the package root, where config.example.yaml lives)
function packageRoot(): string {
  const here = fileURLToPath(import.meta.url);
  return resolve(dirname(here), "..", "..");
}

function copyIfMissing(src: string, dst: string, label: string): "wrote" | "exists" {
  mkdirSync(dirname(dst), { recursive: true });
  if (existsSync(dst)) {
    console.log(`  ${label}: already exists at ${dst}`);
    return "exists";
  }
  copyFileSync(src, dst);
  console.log(`  ${label}: wrote ${dst}`);
  return "wrote";
}

export function run(_args: string[]): number {
  const root = packageRoot();

  console.log("april init");
  console.log("");

  const configSrc = join(root, "config.example.yaml");
  const configDst = join(homedir(), ".config", "april", "config.yaml");
  if (!existsSync(configSrc)) {
    console.error(`  Cannot find bundled config.example.yaml at ${configSrc}`);
    return 1;
  }
  const configResult = copyIfMissing(configSrc, configDst, "config");

  const skillSrc = bundledSkillPath();
  if (!existsSync(skillSrc)) {
    console.error(`  Cannot find bundled skill at ${skillSrc}`);
    return 1;
  }
  copyIfMissing(skillSrc, SKILL_DST, "skill");

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

  // If the installed skill differs from what we shipped, surface it without prompting.
  if (compareSkill() === "differs-from-bundled") {
    console.log("");
    console.log(`  i  installed skill differs from bundled. Refresh with: april install-skill`);
  }

  console.log("");
  if (configResult === "wrote") {
    console.log(`Next: edit ${configDst}, then run \`april install\`.`);
  } else {
    console.log(`Next: review ${configDst}, then run \`april install\`.`);
  }
  return 0;
}
