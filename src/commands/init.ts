import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { ensureEnvFile, envFilePath } from "../service/envfile.js";
import { isGhWebhookExtensionInstalled, GH_EXTENSION_INSTALL_CMD } from "../precheck.js";
import { skillDestPath, bundledSkillPath, compareSkill, ALL_BUNDLED_SKILLS } from "../skill.js";

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

  // Skill install paths depend on the configured LLM. Before init writes
  // a config, configuredLlmKind() falls back to claude, which matches the
  // bundled example. If the user switches the agent later, they re-run
  // `april install-skill`.
  for (const skill of ALL_BUNDLED_SKILLS) {
    const skillSrc = bundledSkillPath(skill);
    if (!existsSync(skillSrc)) {
      console.error(`  Cannot find bundled skill at ${skillSrc}`);
      return 1;
    }
    copyIfMissing(skillSrc, skillDestPath(skill), `skill ${skill}`);
  }

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

  // If any installed skill differs from what we shipped, surface it without prompting.
  if (ALL_BUNDLED_SKILLS.some((s) => compareSkill(s) === "differs-from-bundled")) {
    console.log("");
    console.log(`  i  an installed skill differs from bundled. Refresh with: april install-skill`);
  }

  console.log("");
  if (configResult === "wrote") {
    console.log(`Next: edit ${configDst}, then run \`april install\`.`);
  } else {
    console.log(`Next: review ${configDst}, then run \`april install\`.`);
  }
  return 0;
}
