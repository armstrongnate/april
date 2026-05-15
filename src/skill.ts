import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { configuredLlmKind } from "./config.js";
import { getAgent } from "./agents.js";
import type { AgentKind } from "./types.js";

const SKILL_NAME = "issue-worker";

export function bundledSkillPath(): string {
  // dist/skill.js -> dist/.. -> package root, then skills/issue-worker/SKILL.md
  const here = fileURLToPath(import.meta.url);
  return resolve(dirname(here), "..", "skills", SKILL_NAME, "SKILL.md");
}

export function skillDestPath(kind: AgentKind = configuredLlmKind()): string {
  return getAgent(kind).skillFile(SKILL_NAME);
}

export type SkillState = "missing" | "matches-bundled" | "differs-from-bundled";

export function compareSkill(kind: AgentKind = configuredLlmKind()): SkillState {
  const dst = skillDestPath(kind);
  if (!existsSync(dst)) return "missing";
  const src = bundledSkillPath();
  if (!existsSync(src)) return "matches-bundled"; // can't compare; don't alarm
  return readFileSync(dst).equals(readFileSync(src))
    ? "matches-bundled"
    : "differs-from-bundled";
}
