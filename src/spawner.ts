import { execSync, execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "./logger.js";
import { makeSlug } from "./slug.js";
import { getAgent } from "./agents.js";
import { getSessionBackend } from "./session/index.js";
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
 * Check if an issue is already active by looking at the filesystem and the
 * session backend. Matches any worktree dir or session starting with
 * `gh-{issueNumber}-`.
 */
export async function isIssueActive(repo: RepoConfig, issueNumber: number, config: Config): Promise<boolean> {
  const prefix = `gh-${issueNumber}-`;

  // Check worktrees on disk
  const worktreesDir = join(repo.path, ".worktrees");
  if (existsSync(worktreesDir)) {
    const dirs = readdirSync(worktreesDir);
    const match = dirs.find((d) => d.startsWith(prefix));
    if (match) {
      log.info(`Skipping issue #${issueNumber}: existing worktree found (${match})`);
      return true;
    }
  }

  // Check active sessions
  const sessions = await getSessionBackend(config).listSessions();
  const match = sessions.find((s) => s.startsWith(prefix));
  if (match) {
    log.info(`Skipping issue #${issueNumber}: existing session found (${match})`);
    return true;
  }

  return false;
}

/**
 * Count active worktrees and sessions across all configured repos.
 */
export async function getActiveCounts(config: Config): Promise<{ worktrees: number; sessions: number }> {
  let worktrees = 0;

  for (const repo of config.repos) {
    const dir = join(repo.path, ".worktrees");
    if (existsSync(dir)) {
      worktrees += readdirSync(dir).filter((d) => d.startsWith("gh-")).length;
    }
  }

  const sessionNames = await getSessionBackend(config).listSessions();
  const sessions = sessionNames.filter((s) => s.startsWith("gh-")).length;

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

export async function spawnAgent(
  config: Config,
  repo: RepoConfig,
  issue: IssueInfo,
  worktreePath: string,
  sessionName: string
): Promise<void> {
  const backend = getSessionBackend(config);

  const agent = getAgent(config.llm);
  const slackPart = repo.slackChannel ? ` Post the PR to Slack channel #${repo.slackChannel}.` : "";
  const promptBody = `Read GitHub issue #${issue.number} on ${repo.owner}/${repo.name} using the gh CLI. Implement it and open a PR.${slackPart}`;
  const prompt = agent.buildPrompt(config.skill, promptBody);
  log.debug(`Prompt: ${prompt}`);

  const agentCommand = agent.buildCommand(config);
  log.info(`Spawning session "${sessionName}" with ${agent.kind}`);

  // The backend is responsible for the dedupe check, launching the agent in the
  // worktree, and injecting the prompt once it's ready.
  await backend.spawn({ name: sessionName, cwd: worktreePath, command: agentCommand, prompt });

  log.info(`Session "${sessionName}" started`);
}

export async function handleNewIssue(
  repo: RepoConfig,
  issue: IssueInfo,
  config: Config
): Promise<void> {
  // Check if already active via filesystem/session backend
  if (await isIssueActive(repo, issue.number, config)) {
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

  // Spawn session + agent
  try {
    await spawnAgent(config, repo, issue, worktreePath, slug);
  } catch (err) {
    log.error(`Failed to spawn ${config.llm} for #${issue.number}: ${err instanceof Error ? err.message : String(err)}`);
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

export async function handlePrClosed(repo: RepoConfig, branch: string, config: Config): Promise<void> {
  log.info(`Cleaning up worktree for branch ${branch} (${repo.owner}/${repo.name})`);

  try {
    execFileSync("wt", ["remove", branch, "-f", "-D"], {
      cwd: repo.path,
      timeout: 60_000,
      stdio: "pipe",
    });
    log.info(`Removed worktree ${branch}`);
  } catch (err) {
    log.warn(`wt remove ${branch} failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  await getSessionBackend(config).kill(branch);

  log.info(`Cleanup complete for ${branch}`);
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
