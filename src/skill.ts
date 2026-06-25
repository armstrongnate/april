import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { configuredLlmKind } from "./config.js";
import { getAgent } from "./agents.js";
import type { AgentKind } from "./types.js";

/** Skill that works a labeled issue end-to-end (the daemon's worker). */
export const ISSUE_WORKER_SKILL = "issue-worker";
/** Skill that researches a free-text problem and files a GitHub issue. */
export const INVESTIGATE_SKILL = "issue-investigator";
/** Every skill april bundles and keeps installed for the configured agent. */
export const ALL_BUNDLED_SKILLS = [ISSUE_WORKER_SKILL, INVESTIGATE_SKILL];

export function bundledSkillPath(skill: string): string {
  // dist/skill.js -> dist/.. -> package root, then skills/<skill>/SKILL.md
  const here = fileURLToPath(import.meta.url);
  return resolve(dirname(here), "..", "skills", skill, "SKILL.md");
}

export function skillDestPath(skill: string, kind: AgentKind = configuredLlmKind()): string {
  return getAgent(kind).skillFile(skill);
}

export type SkillState = "missing" | "matches-bundled" | "differs-from-bundled";

export function compareSkill(skill: string, kind: AgentKind = configuredLlmKind()): SkillState {
  const dst = skillDestPath(skill, kind);
  if (!existsSync(dst)) return "missing";
  const src = bundledSkillPath(skill);
  if (!existsSync(src)) return "matches-bundled"; // can't compare; don't alarm
  return readFileSync(dst).equals(readFileSync(src))
    ? "matches-bundled"
    : "differs-from-bundled";
}
