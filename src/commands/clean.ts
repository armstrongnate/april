import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { findConfigPath, parseConfigFile } from "../config.js";
import { getSessionBackend } from "../session/index.js";
import { listActiveWork, type WorkItem } from "../work.js";
import type { Config } from "../types.js";

const execFileP = promisify(execFile);

const USAGE = `april clean [--repo OWNER/NAME] [--force]

  Prune orphaned worktrees — stale (no live session) work whose issue is closed
  on GitHub and has no open PR. Conservative by design: anything in progress,
  still open, or in review (open PR) is kept.

  --repo     Limit to one repo.
  --force    Actually remove. Without it, clean only reports (dry run).`;

type Disposition =
  | { action: "remove"; reason: string }
  | { action: "keep"; reason: string };

async function gh(repoKey: string, args: string[]): Promise<string> {
  const { stdout } = await execFileP("gh", ["--repo", repoKey, ...args], { timeout: 30_000 });
  return stdout;
}

async function classify(item: WorkItem): Promise<Disposition> {
  if (item.kind === "investigation") return { action: "keep", reason: "investigation (running)" };
  if (item.sessionAlive) return { action: "keep", reason: "session live" };
  if (!item.worktreePath || !item.repo) return { action: "keep", reason: "no worktree" };
  if (!item.issueNumber) return { action: "keep", reason: "no issue number" };

  // Stale worktree — cross-reference GitHub before declaring it an orphan.
  const [stateOut, prOut] = await Promise.allSettled([
    gh(item.repo, ["issue", "view", String(item.issueNumber), "--json", "state"]),
    gh(item.repo, ["pr", "list", "--head", item.slug, "--state", "open", "--json", "number"]),
  ]);

  if (stateOut.status !== "fulfilled") return { action: "keep", reason: "issue state unknown" };
  const state = (JSON.parse(stateOut.value) as { state?: string }).state?.toLowerCase();
  if (state !== "closed") return { action: "keep", reason: `issue ${state ?? "?"}` };

  if (prOut.status !== "fulfilled") return { action: "keep", reason: "PR state unknown" };
  if ((JSON.parse(prOut.value) as unknown[]).length > 0) return { action: "keep", reason: "open PR" };

  return { action: "remove", reason: "issue closed, no open PR" };
}

function removeWorktree(config: Config, item: WorkItem): boolean {
  try {
    execFileSync("wt", ["remove", item.slug, "-f", "-D"], {
      cwd: item.repoPath,
      timeout: 60_000,
      stdio: "pipe",
    });
    return true;
  } catch (err) {
    console.warn(`  wt remove ${item.slug} failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

export async function run(args: string[]): Promise<number> {
  let repoFlag: string | undefined;
  let force = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--repo") {
      repoFlag = args[++i];
      if (!repoFlag) throw new Error("--repo requires a value");
    } else if (a === "--force") {
      force = true;
    } else {
      console.error(`Unknown option: ${a}\n\n${USAGE}`);
      return 2;
    }
  }

  const config = parseConfigFile(findConfigPath());
  let items = await listActiveWork(config);
  if (repoFlag) items = items.filter((it) => it.repo === repoFlag || it.repo?.endsWith(`/${repoFlag}`));

  if (items.length === 0) {
    console.log("Nothing to clean.");
    return 0;
  }

  console.log(`april clean ${force ? "(--force)" : "(dry run)"} — checking ${items.length} item(s) against GitHub…\n`);

  const dispositions = await Promise.all(items.map(classify));
  const removable: WorkItem[] = [];

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const d = dispositions[i];
    if (d.action === "remove") {
      removable.push(it);
      console.log(`  REMOVE  ${it.slug}  (${d.reason})`);
    } else {
      console.log(`  keep    ${it.slug}  (${d.reason})`);
    }
  }

  console.log("");
  if (removable.length === 0) {
    console.log("No orphans to remove.");
    return 0;
  }

  if (!force) {
    console.log(`${removable.length} orphaned worktree(s) eligible for removal. Re-run with --force to remove them.`);
    return 0;
  }

  const backend = getSessionBackend(config);
  let removed = 0;
  for (const it of removable) {
    await backend.kill(it.slug); // no-op if no session
    if (removeWorktree(config, it)) {
      removed++;
      console.log(`  removed ${it.slug}`);
    }
  }
  console.log(`\nRemoved ${removed}/${removable.length} orphan(s).`);
  return 0;
}
