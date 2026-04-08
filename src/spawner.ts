import { execSync, execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "./logger.js";
import { makeSlug } from "./slug.js";
import type { Config, RepoConfig, IssueInfo } from "./types.js";

const log = createLogger("spawner");

function checkWorktreesIgnored(repoPath: string): void {
  const gitignorePath = join(repoPath, ".gitignore");
  if (!existsSync(gitignorePath)) {
    log.warn(`${repoPath}: no .gitignore found. Consider adding ".worktrees" to it.`);
    return;
  }
  try {
    const content = readFileSync(gitignorePath, "utf-8");
    const lines = content.split("\n").map((l) => l.trim());
    if (!lines.some((l) => l === ".worktrees" || l === ".worktrees/" || l === "/.worktrees" || l === "/.worktrees/")) {
      log.warn(`${repoPath}/.gitignore does not contain ".worktrees". Consider adding it to avoid committing worktrees.`);
    }
  } catch {
    // Non-critical, just skip
  }
}

/**
 * Check if an issue is already active by looking at the filesystem and tmux.
 * Matches any worktree dir or tmux session starting with `gh-{issueNumber}-`.
 */
export function isIssueActive(repo: RepoConfig, issueNumber: number): boolean {
  const prefix = `gh-${issueNumber}-`;

  // Check worktrees on disk
  const worktreesDir = join(repo.path, ".worktrees");
  if (existsSync(worktreesDir)) {
    const dirs = readdirSync(worktreesDir);
    if (dirs.some((d) => d.startsWith(prefix))) {
      return true;
    }
  }

  // Check tmux sessions
  try {
    const output = execSync("tmux list-sessions -F '#{session_name}'", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (output.trim().split("\n").some((s) => s.startsWith(prefix))) {
      return true;
    }
  } catch {
    // tmux not running or no sessions
  }

  return false;
}

/**
 * Count active worktrees and tmux sessions across all configured repos.
 */
export function getActiveCounts(config: Config): { worktrees: number; sessions: number } {
  let worktrees = 0;

  for (const repo of config.repos) {
    const dir = join(repo.path, ".worktrees");
    if (existsSync(dir)) {
      worktrees += readdirSync(dir).filter((d) => d.startsWith("gh-")).length;
    }
  }

  let sessions = 0;
  try {
    const output = execSync("tmux list-sessions -F '#{session_name}'", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    sessions = output.trim().split("\n").filter((s) => s.startsWith("gh-")).length;
  } catch {
    // tmux not running
  }

  return { worktrees, sessions };
}

export async function createWorktree(repo: RepoConfig, branch: string): Promise<string> {
  const worktreesDir = join(repo.path, ".worktrees");
  const worktreePath = join(worktreesDir, branch);

  if (existsSync(worktreePath)) {
    log.info(`Worktree already exists: ${worktreePath}`);
    return worktreePath;
  }

  checkWorktreesIgnored(repo.path);

  // Ensure .worktrees directory exists
  execSync(`mkdir -p ${JSON.stringify(worktreesDir)}`);

  // Fetch origin defaultBranch
  log.info(`Fetching origin/${repo.defaultBranch} for ${repo.owner}/${repo.name}`);
  try {
    execFileSync("git", ["-C", repo.path, "fetch", "origin", repo.defaultBranch], {
      timeout: 60_000,
      stdio: "pipe",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to fetch origin/${repo.defaultBranch} in ${repo.path}: ${msg}`);
  }

  // Create worktree with new branch
  log.info(`Creating worktree: ${worktreePath} (branch: ${branch})`);
  try {
    execFileSync(
      "git",
      ["-C", repo.path, "worktree", "add", worktreePath, "-b", branch, `origin/${repo.defaultBranch}`],
      { timeout: 30_000, stdio: "pipe" }
    );
  } catch {
    // Branch may already exist — try without -b
    log.debug(`Branch "${branch}" may already exist, retrying without -b`);
    try {
      execFileSync("git", ["-C", repo.path, "worktree", "add", worktreePath, branch], {
        timeout: 30_000,
        stdio: "pipe",
      });
    } catch (err2) {
      const msg = err2 instanceof Error ? err2.message : String(err2);
      throw new Error(`Failed to create worktree for branch "${branch}": ${msg}`);
    }
  }

  log.info(`Worktree created at ${worktreePath}`);

  // Run post-worktree hook if configured
  if (repo.postWorktreeHook) {
    log.info(`Running post-worktree hook: ${repo.postWorktreeHook}`);
    try {
      execSync(repo.postWorktreeHook, {
        cwd: worktreePath,
        timeout: 300_000, // 5 min — installs can be slow
        stdio: "pipe",
      });
      log.info("Post-worktree hook completed");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`Post-worktree hook failed: ${msg}`);
    }
  }

  return worktreePath;
}

export function spawnClaude(
  config: Config,
  repo: RepoConfig,
  issue: IssueInfo,
  worktreePath: string,
  sessionName: string
): void {
  // Check if session already exists
  try {
    execSync(`tmux has-session -t ${JSON.stringify(sessionName)}`, { stdio: "pipe" });
    log.info(`tmux session "${sessionName}" already exists, skipping`);
    return;
  } catch {
    // Session does not exist, proceed
  }

  const model = config.claudeModel || "opus";
  const allowedTools = [
    ...(config.claudeAllowedTools ?? ["Edit", "Write", "Bash(*)"]),
    ...(repo.slackChannel ? ["mcp__plugin_slack_slack__*"] : []),
  ];
  const slackPart = repo.slackChannel ? ` Post the PR to Slack channel #${repo.slackChannel}.` : "";
  const prompt = `/${config.claudeSkill} Read GitHub issue #${issue.number} on ${repo.owner}/${repo.name} using the gh CLI. Implement it and open a PR.${slackPart}`;
  log.debug(`Prompt: ${prompt}`);

  const allowedToolsArgs = allowedTools.map((t) => `--allowedTools '${t}'`).join(" ");
  const claudeCommand = `claude --model ${model} ${allowedToolsArgs}`;
  const tmuxCommand = `cd ${JSON.stringify(worktreePath)} && ${claudeCommand}`;

  log.info(`Spawning tmux session "${sessionName}" with claude`);
  execSync(`tmux new-session -d -s ${JSON.stringify(sessionName)} ${JSON.stringify(tmuxCommand)}`);

  // Send the prompt via send-keys after Claude starts
  const escapedPrompt = prompt.replace(/'/g, "'\\''");
  setTimeout(() => {
    try {
      execSync(`tmux send-keys -t ${JSON.stringify(sessionName)} '${escapedPrompt}' Enter`, { stdio: "pipe" });
      log.info(`Prompt sent to tmux session "${sessionName}"`);
    } catch (err) {
      log.warn(`Failed to send prompt to session "${sessionName}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }, 3000);

  log.info(`tmux session "${sessionName}" started`);
}

export async function handleNewIssue(
  repo: RepoConfig,
  issue: IssueInfo,
  config: Config
): Promise<void> {
  // Check if already active via filesystem/tmux
  if (isIssueActive(repo, issue.number)) {
    log.info(`Issue #${issue.number} already active in ${repo.owner}/${repo.name}, skipping`);
    return;
  }

  const slug = makeSlug(issue.number, issue.title);

  // Create worktree
  let worktreePath: string;
  try {
    worktreePath = await createWorktree(repo, slug);
  } catch (err) {
    log.error(`Failed to create worktree for #${issue.number}: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  // Spawn tmux + claude
  try {
    spawnClaude(config, repo, issue, worktreePath, slug);
  } catch (err) {
    log.error(`Failed to spawn claude for #${issue.number}: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  // Apply label transition
  try {
    execFileSync("gh", [
      "issue", "edit", String(issue.number),
      "--repo", `${repo.owner}/${repo.name}`,
      "--add-label", "agent:wip",
      "--remove-label", "agent:todo",
    ], { timeout: 15_000, stdio: "pipe" });
    log.info(`Labels updated for #${issue.number}: agent:todo -> agent:wip`);
  } catch (err) {
    log.warn(`Failed to update labels for #${issue.number}: ${err instanceof Error ? err.message : String(err)}`);
  }

  log.info(`Issue #${issue.number} (${repo.owner}/${repo.name}) is now active`);
}

export function fetchOpenIssues(repo: RepoConfig, config: Config): IssueInfo[] {
  try {
    const output = execFileSync("gh", [
      "issue", "list",
      "--repo", `${repo.owner}/${repo.name}`,
      "--assignee", config.assignee,
      "--label", config.label,
      "--json", "number,title",
      "--state", "open",
    ], { timeout: 30_000, stdio: ["pipe", "pipe", "pipe"] });

    const parsed = JSON.parse(output.toString("utf-8")) as Array<{ number: number; title: string }>;
    return parsed.map((i) => ({ number: i.number, title: i.title }));
  } catch (err) {
    log.error(`Failed to fetch issues for ${repo.owner}/${repo.name}: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}
