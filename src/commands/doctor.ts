import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { findConfigPath, parseConfigFile, checkTool, requiredTools } from "../config.js";
import { getAgent } from "../agents.js";
import { isGhWebhookExtensionInstalled, GH_EXTENSION_INSTALL_CMD } from "../precheck.js";
import { systemdUnitPath, launchdPlistPath } from "../service/paths.js";
import { lingerEnabled } from "../service/systemd.js";
import { daemonReachable } from "../daemon.js";
import type { Config } from "../types.js";

type Level = "ok" | "warn" | "fail";
const GLYPH: Record<Level, string> = { ok: "✓", warn: "⚠", fail: "✗" };

class Report {
  private rows: { level: Level; label: string; detail?: string }[] = [];
  add(level: Level, label: string, detail?: string): void {
    this.rows.push({ level, label, detail });
  }
  print(): void {
    for (const r of this.rows) {
      console.log(`  ${GLYPH[r.level]} ${r.label}${r.detail ? ` — ${r.detail}` : ""}`);
    }
  }
  get failed(): boolean {
    return this.rows.some((r) => r.level === "fail");
  }
}

function isGitRepo(path: string): boolean {
  try {
    execFileSync("git", ["-C", path, "rev-parse", "--git-dir"], { stdio: "pipe", timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

function ghAuthOk(): boolean {
  try {
    const out = execFileSync("gh", ["auth", "token"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
    });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

export async function run(_args: string[]): Promise<number> {
  const report = new Report();

  // 1. Config
  let config: Config | undefined;
  try {
    const path = findConfigPath();
    config = parseConfigFile(path);
    report.add("ok", "config", `valid (${path})`);
  } catch (err) {
    report.add("fail", "config", err instanceof Error ? err.message : String(err));
  }

  // 2. Required tools
  const tools = config
    ? requiredTools(getAgent(config.llm).cli, config.sessionManager ?? "tmux")
    : ["gh", "git"];
  for (const tool of tools) {
    if (checkTool(tool)) report.add("ok", `tool: ${tool}`, "on PATH");
    else report.add("fail", `tool: ${tool}`, "not found on PATH");
  }

  // 3. gh-webhook extension
  if (isGhWebhookExtensionInstalled()) report.add("ok", "gh extension cli/gh-webhook", "installed");
  else report.add("fail", "gh extension cli/gh-webhook", `missing — ${GH_EXTENSION_INSTALL_CMD}`);

  // 4. gh auth
  if (ghAuthOk()) report.add("ok", "gh auth", "token available");
  else
    report.add(
      "warn",
      "gh auth",
      "no extractable token — set GH_TOKEN/GH_ENTERPRISE_TOKEN in ~/.config/april/env"
    );

  // 5. Repo paths
  if (config) {
    for (const repo of config.repos) {
      const key = `${repo.owner}/${repo.name}`;
      if (!existsSync(repo.path)) report.add("fail", `repo: ${key}`, `path missing: ${repo.path}`);
      else if (!isGitRepo(repo.path)) report.add("fail", `repo: ${key}`, `not a git repo: ${repo.path}`);
      else report.add("ok", `repo: ${key}`, repo.path);
    }
  }

  // 6. Service installed
  const unitPath = process.platform === "darwin" ? launchdPlistPath() : systemdUnitPath();
  if (existsSync(unitPath)) report.add("ok", "service unit", unitPath);
  else report.add("warn", "service unit", `not installed — run \`april install\``);

  // 7. Daemon reachable
  if (config) {
    if (await daemonReachable(config.port))
      report.add("ok", "daemon", `responding on :${config.port}`);
    else report.add("warn", "daemon", `not reachable on :${config.port} (not running?)`);
  }

  // 8. Linger (Linux only)
  if (process.platform === "linux") {
    if (lingerEnabled()) report.add("ok", "linger", "enabled");
    else
      report.add(
        "warn",
        "linger",
        `disabled — april stops at logout. sudo loginctl enable-linger ${process.env.USER ?? "$USER"}`
      );
  }

  console.log("april doctor\n");
  report.print();
  console.log("");
  if (report.failed) {
    console.log("✗ One or more required checks failed.");
    return 1;
  }
  console.log("✓ All required checks passed.");
  return 0;
}
