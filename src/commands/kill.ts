import { execFileSync } from "node:child_process";
import { findConfigPath, parseConfigFile } from "../config.js";
import { getSessionBackend } from "../session/index.js";
import { listActiveWork, type WorkItem } from "../work.js";

const USAGE = `april kill <slug|issue> [--repo OWNER/NAME] [--worktree]

  Kill a single session by slug or issue number. Works for investigations
  (inv-…) too. With --worktree, also remove the backing worktree.

  <slug|issue>  a session slug (gh-123-…, inv-…) or an issue number (123)
  --repo        disambiguate when an issue number matches more than one repo
  --worktree    also remove the worktree (only applies to issue work)`;

export async function run(args: string[]): Promise<number> {
  let target: string | undefined;
  let repoFlag: string | undefined;
  let withWorktree = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--repo") {
      repoFlag = args[++i];
      if (!repoFlag) throw new Error("--repo requires a value");
    } else if (a === "--worktree") {
      withWorktree = true;
    } else if (a.startsWith("--")) {
      console.error(`Unknown option: ${a}\n\n${USAGE}`);
      return 2;
    } else if (!target) {
      target = a;
    } else {
      console.error(`Unexpected argument: ${a}\n\n${USAGE}`);
      return 2;
    }
  }

  if (!target) {
    console.error(`Missing slug or issue number.\n\n${USAGE}`);
    return 2;
  }

  const config = parseConfigFile(findConfigPath());
  const items = await listActiveWork(config);

  let slug: string;
  let item: WorkItem | undefined;

  if (/^#?\d+$/.test(target)) {
    const n = parseInt(target.replace(/^#/, ""), 10);
    let matches = items.filter((it) => it.issueNumber === n);
    if (repoFlag) matches = matches.filter((it) => it.repo === repoFlag || it.repo?.endsWith(`/${repoFlag}`));
    if (matches.length === 0) {
      console.log(`No active session or worktree for issue #${n}.`);
      return 0;
    }
    if (matches.length > 1) {
      console.error(`#${n} matches multiple repos — pass --repo OWNER/NAME:`);
      for (const m of matches) console.error(`  ${m.repo} (${m.slug})`);
      return 2;
    }
    item = matches[0];
    slug = item.slug;
  } else {
    slug = target;
    item = items.find((it) => it.slug === target);
  }

  console.log(`Killing session "${slug}"…`);
  await getSessionBackend(config).kill(slug);

  if (withWorktree) {
    if (item?.repoPath && item.worktreePath) {
      try {
        execFileSync("wt", ["remove", slug, "-f", "-D"], {
          cwd: item.repoPath,
          timeout: 60_000,
          stdio: "pipe",
        });
        console.log(`Removed worktree ${item.worktreePath}`);
      } catch (err) {
        console.warn(`wt remove ${slug} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      console.log("No worktree associated with this session — nothing to remove.");
    }
  }

  console.log("Done.");
  return 0;
}
