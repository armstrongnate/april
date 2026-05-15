import { join } from "node:path";
import { homedir } from "node:os";
import type { AgentKind, Config } from "./types.js";

export interface Agent {
  kind: AgentKind;
  cli: string;
  buildCommand(config: Config): string;
  buildPrompt(skill: string, body: string): string;
  skillDir(skill: string): string;
  skillFile(skill: string): string;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

const claude: Agent = {
  kind: "claude",
  cli: "claude",
  buildCommand(config) {
    const cfg = config.claude ?? {};
    const model = cfg.model || "opus";
    const permissionMode = cfg.permissionMode || "auto";
    return `claude --model ${shellQuote(model)} --permission-mode ${shellQuote(permissionMode)}`;
  },
  buildPrompt(skill, body) {
    return `/${skill} ${body}`;
  },
  skillDir(skill) {
    return join(homedir(), ".claude", "skills", skill);
  },
  skillFile(skill) {
    return join(this.skillDir(skill), "SKILL.md");
  },
};

const codex: Agent = {
  kind: "codex",
  cli: "codex",
  buildCommand(config) {
    const cfg = config.codex ?? {};
    const parts = ["codex"];
    if (cfg.model) parts.push("--model", shellQuote(cfg.model));
    parts.push("--ask-for-approval", shellQuote(cfg.askForApproval || "never"));
    return parts.join(" ");
  },
  buildPrompt(skill, body) {
    return `$${skill} ${body}`;
  },
  skillDir(skill) {
    return join(homedir(), ".agents", "skills", skill);
  },
  skillFile(skill) {
    return join(this.skillDir(skill), "SKILL.md");
  },
};

const AGENTS: Record<AgentKind, Agent> = { claude, codex };

export function getAgent(kind: AgentKind): Agent {
  return AGENTS[kind];
}

export const AGENT_KINDS: AgentKind[] = ["claude", "codex"];
