import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";

export const SKILL_DST = join(homedir(), ".claude", "skills", "issue-worker", "SKILL.md");

export function bundledSkillPath(): string {
  // dist/skill.js -> dist/.. -> package root, then skills/issue-worker/SKILL.md
  const here = fileURLToPath(import.meta.url);
  return resolve(dirname(here), "..", "skills", "issue-worker", "SKILL.md");
}

export type SkillState = "missing" | "matches-bundled" | "differs-from-bundled";

export function compareSkill(): SkillState {
  if (!existsSync(SKILL_DST)) return "missing";
  const src = bundledSkillPath();
  if (!existsSync(src)) return "matches-bundled"; // can't compare; don't alarm
  return readFileSync(SKILL_DST).equals(readFileSync(src))
    ? "matches-bundled"
    : "differs-from-bundled";
}
