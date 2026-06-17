import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { parse as parseYaml } from "yaml";
import { createLogger } from "./logger.js";
import { isGhWebhookExtensionInstalled, GH_EXTENSION_INSTALL_CMD } from "./precheck.js";
import { AGENT_KINDS, getAgent } from "./agents.js";
import type { AgentKind, ClaudeConfig, CodexConfig, Config, RepoConfig, SessionManagerKind } from "./types.js";

const log = createLogger("config");

function findConfigPath(): string {
  const envPath = process.env.APRIL_CONFIG;
  if (envPath) {
    if (!existsSync(envPath)) {
      throw new Error(`Config file from APRIL_CONFIG not found: ${envPath}`);
    }
    return resolve(envPath);
  }

  const xdgPath = join(homedir(), ".config", "april", "config.yaml");
  if (existsSync(xdgPath)) {
    return xdgPath;
  }

  const localPath = resolve("config.yaml");
  if (existsSync(localPath)) {
    return localPath;
  }

  throw new Error(
    "No config file found. Searched:\n" +
      `  - APRIL_CONFIG env var (not set)\n` +
      `  - ${xdgPath}\n` +
      `  - ${localPath}\n` +
      "Create a config.yaml (see config.example.yaml)."
  );
}

function validateTools(agentCli: string, sessionManager: SessionManagerKind): void {
  const tools = ["gh", "git", agentCli, sessionManager === "herdr" ? "herdr" : "tmux"];
  for (const tool of tools) {
    try {
      execSync(`which ${tool}`, { stdio: "pipe" });
    } catch {
      throw new Error(
        `Required tool "${tool}" not found on PATH. Install it before running april.`
      );
    }
  }

  if (!isGhWebhookExtensionInstalled()) {
    throw new Error(
      `Required gh extension not installed: cli/gh-webhook.\n` +
        `Install it with:\n  ${GH_EXTENSION_INSTALL_CMD}`
    );
  }
}

function validateString(obj: Record<string, unknown>, key: string, context: string): string {
  const val = obj[key];
  if (typeof val !== "string" || val.trim().length === 0) {
    throw new Error(`${context}: "${key}" is required and must be a non-empty string`);
  }
  return val.trim();
}

function optionalObject(obj: Record<string, unknown>, key: string, context: string): Record<string, unknown> | undefined {
  const val = obj[key];
  if (val === undefined || val === null) return undefined;
  if (typeof val !== "object" || Array.isArray(val)) {
    throw new Error(`${context}: "${key}" must be an object when provided`);
  }
  return val as Record<string, unknown>;
}

function optionalString(obj: Record<string, unknown>, key: string): string | undefined {
  const val = obj[key];
  return typeof val === "string" && val.trim().length > 0 ? val.trim() : undefined;
}

function parseLlm(parsed: Record<string, unknown>): AgentKind {
  const llmRaw = parsed.llm;
  if (typeof llmRaw !== "string" || !AGENT_KINDS.includes(llmRaw as AgentKind)) {
    throw new Error(`config: "llm" is required and must be one of ${AGENT_KINDS.join(", ")}`);
  }
  return llmRaw as AgentKind;
}

function parseSessionManager(parsed: Record<string, unknown>): SessionManagerKind {
  const val = parsed.sessionManager;
  if (val === undefined || val === null) return "tmux";
  if (val !== "tmux" && val !== "herdr") {
    throw new Error(`config: "sessionManager" must be "tmux" or "herdr" when provided`);
  }
  return val;
}

function parseClaudeConfig(parsed: Record<string, unknown>): ClaudeConfig | undefined {
  const raw = optionalObject(parsed, "claude", "config");
  if (!raw) return undefined;
  return {
    model: optionalString(raw, "model"),
    permissionMode: optionalString(raw, "permissionMode"),
  };
}

function parseCodexConfig(parsed: Record<string, unknown>): CodexConfig | undefined {
  const raw = optionalObject(parsed, "codex", "config");
  if (!raw) return undefined;
  return {
    model: optionalString(raw, "model"),
    askForApproval: optionalString(raw, "askForApproval"),
  };
}

export function parseConfigFile(path: string): Config {
  const raw = readFileSync(path, "utf-8");
  const parsed = parseYaml(raw);

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Config file is empty or not a valid YAML object");
  }

  const assignee = validateString(parsed, "assignee", "config");
  const label = validateString(parsed, "label", "config");
  const root = parsed as Record<string, unknown>;
  const llm = parseLlm(root);
  const sessionManager = parseSessionManager(root);
  const skill = validateString(root, "skill", "config");
  const claude = parseClaudeConfig(root);
  const codex = parseCodexConfig(root);

  const port = Number(parsed.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`config: "port" must be an integer between 1024 and 65535, got: ${parsed.port}`);
  }

  if (!Array.isArray(parsed.repos) || parsed.repos.length === 0) {
    throw new Error("config: \"repos\" must be a non-empty array");
  }

  const repos: RepoConfig[] = parsed.repos.map((r: unknown, i: number) => {
    if (!r || typeof r !== "object") {
      throw new Error(`config.repos[${i}]: must be an object`);
    }
    const repo = r as Record<string, unknown>;
    const owner = validateString(repo, "owner", `config.repos[${i}]`);
    const name = validateString(repo, "name", `config.repos[${i}]`);
    const path = validateString(repo, "path", `config.repos[${i}]`);
    const resolvedPath = resolve(path.startsWith("~") ? path.replace("~", homedir()) : path);

    if (!existsSync(resolvedPath)) {
      throw new Error(`config.repos[${i}]: path does not exist: ${resolvedPath}`);
    }

    const defaultBranch =
      typeof repo.defaultBranch === "string" && repo.defaultBranch.trim().length > 0
        ? repo.defaultBranch.trim()
        : "main";

    const slackChannel =
      typeof repo.slackChannel === "string" && repo.slackChannel.trim().length > 0
        ? repo.slackChannel.trim()
        : undefined;

    const postWorktreeHook =
      typeof repo.postWorktreeHook === "string" && repo.postWorktreeHook.trim().length > 0
        ? repo.postWorktreeHook.trim()
        : undefined;

    return { owner, name, path: resolvedPath, defaultBranch, slackChannel, postWorktreeHook };
  });

  const config: Config = { assignee, label, llm, sessionManager, skill, claude, codex, port, repos };

  return config;
}

/**
 * Best-effort lookup of the configured LLM kind, for commands that touch
 * agent-specific paths (e.g. install-skill) but should still work before the
 * user has written a config. Returns "claude" as a fallback.
 */
export function configuredLlmKind(): AgentKind {
  try {
    const path = findConfigPath();
    const raw = readFileSync(path, "utf-8");
    const parsed = parseYaml(raw);
    if (!parsed || typeof parsed !== "object") return "claude";
    const llm = (parsed as Record<string, unknown>).llm;
    return typeof llm === "string" && AGENT_KINDS.includes(llm as AgentKind)
      ? (llm as AgentKind)
      : "claude";
  } catch {
    return "claude";
  }
}

export function loadConfig(): Config {
  const configPath = findConfigPath();
  log.info(`Loading config from ${configPath}`);

  const config = parseConfigFile(configPath);

  validateTools(getAgent(config.llm).cli, config.sessionManager ?? "tmux");

  log.info(
    `Config loaded: assignee=${config.assignee}, label=${config.label}, llm=${config.llm}, ` +
      `repos=${config.repos.map((r) => `${r.owner}/${r.name}`).join(", ")}`
  );

  return config;
}
