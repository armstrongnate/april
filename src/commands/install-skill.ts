import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { skillDestPath, bundledSkillPath, compareSkill } from "../skill.js";

export async function run(args: string[]): Promise<number> {
  const yes = args.includes("--yes") || args.includes("-y");

  const src = bundledSkillPath();
  if (!existsSync(src)) {
    console.error(`Cannot find bundled skill at ${src}`);
    return 1;
  }

  const dst = skillDestPath();
  const state = compareSkill();

  if (state === "matches-bundled") {
    console.log(`✓ Skill at ${dst} is already up to date`);
    return 0;
  }

  if (state === "missing") {
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(src, dst);
    console.log(`✓ Installed skill at ${dst}`);
    return 0;
  }

  // differs-from-bundled
  console.log("Bundled issue-worker skill differs from the installed copy.");
  console.log(`  installed: ${dst}`);
  console.log(`  bundled:   ${src}`);
  console.log("");
  console.log(`Diff with: diff ${dst} ${src}`);
  console.log("");

  if (!yes) {
    if (!stdin.isTTY) {
      console.error(
        "Refusing to overwrite without confirmation in a non-interactive session.\n" +
          "Re-run with --yes to confirm, or run interactively to be prompted."
      );
      return 1;
    }
    const rl = createInterface({ input: stdin, output: stdout });
    const answer = (
      await rl.question("Overwrite installed skill with bundled version? [y/N] ")
    )
      .trim()
      .toLowerCase();
    rl.close();
    if (answer !== "y" && answer !== "yes") {
      console.log("Skipped — installed skill is unchanged.");
      return 0;
    }
  }

  copyFileSync(src, dst);
  console.log(`✓ Overwrote skill at ${dst}`);
  return 0;
}
