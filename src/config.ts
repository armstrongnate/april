import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { parse as parseYaml } from "yaml";
import { createLogger } from "./logger.js";
import { isGhWebhookExtensionInstalled, GH_EXTENSION_INSTALL_CMD } from "./precheck.js";
import type { Config, RepoConfig } from "./types.js";

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

function validateTools(): void {
  const tools = ["gh", "tmux", "git", "claude"];
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

export function loadConfig(): Config {
  validateTools();

  const configPath = findConfigPath();
  log.info(`Loading config from ${configPath}`);

  const raw = readFileSync(configPath, "utf-8");
  const parsed = parseYaml(raw);

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Config file is empty or not a valid YAML object");
  }

  const assignee = validateString(parsed, "assignee", "config");
  const label = validateString(parsed, "label", "config");
  const claudeSkill = validateString(parsed, "claudeSkill", "config");
  const claudeModel = typeof parsed.claudeModel === "string" ? parsed.claudeModel.trim() : undefined;
  const claudePermissionMode = typeof parsed.claudePermissionMode === "string" ? parsed.claudePermissionMode.trim() : undefined;

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

  const config: Config = { assignee, label, claudeSkill, claudeModel, claudePermissionMode, port, repos };

  log.info(`Config loaded: assignee=${assignee}, label=${label}, repos=${repos.map((r) => `${r.owner}/${r.name}`).join(", ")}`);

  return config;
}
