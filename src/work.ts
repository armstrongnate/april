import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "./logger.js";
import { getSessionBackend } from "./session/index.js";
import type { Config, RepoConfig, IssueInfo } from "./types.js";

const log = createLogger("work");

/** Session/worktree name prefix for daemon-driven issue work. */
export const ISSUE_PREFIX = "gh-";
/** Session name prefix for `april investigate` research sessions. */
export const INVESTIGATE_PREFIX = "inv-";

export interface IssueRef {
  /** "owner/name" if the ref carried one (e.g. `o/n#12`), else undefined. */
  repoRef?: string;
  number: number;
}

/**
 * Parse an issue reference accepted by `run` / `cancel` / `kill`.
 * Forms: `123`, `#123`, `owner/name#123`.
 */
export function parseIssueRef(ref: string): IssueRef {
  const hash = ref.indexOf("#");
  if (hash !== -1) {
    const repoRef = ref.slice(0, hash).trim() || undefined;
    const number = parseInt(ref.slice(hash + 1).trim(), 10);
    if (Number.isNaN(number)) throw new Error(`Invalid issue reference: ${ref}`);
    return { repoRef, number };
  }
  const number = parseInt(ref.replace(/^#/, "").trim(), 10);
  if (Number.isNaN(number)) throw new Error(`Invalid issue reference: ${ref}`);
  return { number };
}

/**
 * Pick the RepoConfig a command should act on. `ref` is an explicit
 * "owner/name" (from `--repo` or an `owner/name#n` issue ref). When absent,
 * defaults to the sole configured repo, else errors with the candidate list.
 */
export function resolveRepo(config: Config, ref?: string): RepoConfig {
  if (ref) {
    const norm = ref.trim();
    const match = config.repos.find((r) => `${r.owner}/${r.name}` === norm || r.name === norm);
    if (!match) {
      const list = config.repos.map((r) => `${r.owner}/${r.name}`).join(", ");
      throw new Error(`Repo "${ref}" is not configured. Known repos: ${list}`);
    }
    return match;
  }
  if (config.repos.length === 1) return config.repos[0];
  const list = config.repos.map((r) => `${r.owner}/${r.name}`).join(", ");
  throw new Error(
    `Multiple repos configured — specify which with --repo or owner/name#issue. Known repos: ${list}`
  );
}

/** Fetch a single issue's number+title via gh. Throws if it can't be read. */
export function fetchIssue(repo: RepoConfig, number: number): IssueInfo {
  let output: string;
  try {
    output = execFileSync(
      "gh",
      [
        "issue", "view", String(number),
        "--repo", `${repo.owner}/${repo.name}`,
        "--json", "number,title",
      ],
      { encoding: "utf-8", timeout: 30_000, stdio: ["pipe", "pipe", "pipe"] }
    );
  } catch (err) {
    throw new Error(
      `Could not fetch issue #${number} from ${repo.owner}/${repo.name}: ` +
        `${err instanceof Error ? err.message : String(err)}`
    );
  }
  const parsed = JSON.parse(output) as { number: number; title: string };
  return { number: parsed.number, title: parsed.title };
}

/** Parse the issue number out of a `gh-<n>-...` slug, if present. */
export function issueNumberFromSlug(slug: string): number | undefined {
  const m = /^gh-(\d+)-/.exec(slug);
  return m ? parseInt(m[1], 10) : undefined;
}

/** Worktree directory names under a repo's `.worktrees` that look like april work. */
function listWorktreeSlugs(repo: RepoConfig): string[] {
  const dir = join(repo.path, ".worktrees");
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith(ISSUE_PREFIX))
      .map((d) => d.name);
  } catch {
    return [];
  }
}

/**
 * Find the active slug for an issue by scanning this repo's worktrees and the
 * session backend for a `gh-<n>-` match. Returns undefined if nothing is active.
 */
export async function resolveActiveSlug(
  repo: RepoConfig,
  issueNumber: number,
  config: Config
): Promise<string | undefined> {
  const prefix = `${ISSUE_PREFIX}${issueNumber}-`;
  const wt = listWorktreeSlugs(repo).find((s) => s.startsWith(prefix));
  if (wt) return wt;
  const sessions = await getSessionBackend(config).listSessions();
  return sessions.find((s) => s.startsWith(prefix));
}

export interface WorkItem {
  kind: "issue" | "investigation";
  slug: string;
  issueNumber?: number;
  /** "owner/name" — known only when a worktree pins it to a repo. */
  repo?: string;
  repoPath?: string;
  worktreePath?: string;
  sessionAlive: boolean;
}

/**
 * Enumerate everything april is working on, derived purely from disk
 * (`.worktrees/gh-*`) and the session backend — so it works whether or not the
 * daemon is running. Correlates worktrees and sessions by slug.
 */
export async function listActiveWork(config: Config): Promise<WorkItem[]> {
  const bySlug = new Map<string, WorkItem>();

  // Worktrees pin a slug to a specific repo + path.
  for (const repo of config.repos) {
    for (const slug of listWorktreeSlugs(repo)) {
      bySlug.set(slug, {
        kind: "issue",
        slug,
        issueNumber: issueNumberFromSlug(slug),
        repo: `${repo.owner}/${repo.name}`,
        repoPath: repo.path,
        worktreePath: join(repo.path, ".worktrees", slug),
        sessionAlive: false,
      });
    }
  }

  // Sessions mark slugs alive, and surface session-only work (notably `inv-`).
  let sessions: string[] = [];
  try {
    sessions = await getSessionBackend(config).listSessions();
  } catch (err) {
    log.warn(`Could not list sessions: ${err instanceof Error ? err.message : String(err)}`);
  }
  for (const name of sessions) {
    const existing = bySlug.get(name);
    if (existing) {
      existing.sessionAlive = true;
    } else if (name.startsWith(INVESTIGATE_PREFIX)) {
      bySlug.set(name, { kind: "investigation", slug: name, sessionAlive: true });
    } else if (name.startsWith(ISSUE_PREFIX)) {
      bySlug.set(name, {
        kind: "issue",
        slug: name,
        issueNumber: issueNumberFromSlug(name),
        sessionAlive: true,
      });
    }
  }

  return [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}
