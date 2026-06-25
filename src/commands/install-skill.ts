import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { skillDestPath, bundledSkillPath, compareSkill, ALL_BUNDLED_SKILLS } from "../skill.js";

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = (await rl.question(question)).trim().toLowerCase();
  rl.close();
  return answer === "y" || answer === "yes";
}

/** Install or refresh one bundled skill. Returns 0 on success, non-zero on hard error. */
async function installSkill(skill: string, yes: boolean): Promise<number> {
  const src = bundledSkillPath(skill);
  if (!existsSync(src)) {
    console.error(`Cannot find bundled skill at ${src}`);
    return 1;
  }

  const dst = skillDestPath(skill);
  const state = compareSkill(skill);

  if (state === "matches-bundled") {
    console.log(`✓ ${skill}: already up to date (${dst})`);
    return 0;
  }

  if (state === "missing") {
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(src, dst);
    console.log(`✓ ${skill}: installed at ${dst}`);
    return 0;
  }

  // differs-from-bundled
  console.log(`${skill}: bundled copy differs from the installed one.`);
  console.log(`  installed: ${dst}`);
  console.log(`  bundled:   ${src}`);
  console.log(`  Diff with: diff ${dst} ${src}`);

  if (!yes) {
    if (!stdin.isTTY) {
      console.error(
        `Refusing to overwrite ${skill} without confirmation in a non-interactive session.\n` +
          "Re-run with --yes to confirm, or run interactively to be prompted."
      );
      return 1;
    }
    if (!(await confirm(`Overwrite installed ${skill} with bundled version? [y/N] `))) {
      console.log(`Skipped — ${skill} is unchanged.`);
      return 0;
    }
  }

  copyFileSync(src, dst);
  console.log(`✓ ${skill}: overwrote ${dst}`);
  return 0;
}

export async function run(args: string[]): Promise<number> {
  const yes = args.includes("--yes") || args.includes("-y");

  let exit = 0;
  for (const skill of ALL_BUNDLED_SKILLS) {
    const code = await installSkill(skill, yes);
    if (code !== 0) exit = code;
  }
  return exit;
}
