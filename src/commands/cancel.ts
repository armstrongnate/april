import { execFileSync } from "node:child_process";
import { findConfigPath, parseConfigFile } from "../config.js";
import { handlePrClosed } from "../spawner.js";
import { parseIssueRef, resolveRepo, resolveActiveSlug } from "../work.js";
import type { RepoConfig } from "../types.js";

const USAGE = `april cancel <issue> [--repo OWNER/NAME] [--requeue]

  Stop work on an issue: kill its session and remove its worktree.
  Removes the agent:wip label so it won't look in-flight.

  <issue>      123, #123, or owner/name#123
  --repo       Repo to act on when <issue> is a bare number and multiple are configured.
  --requeue    Re-add agent:todo so the daemon picks it up again.`;

function editLabels(repo: RepoConfig, issueNumber: number, requeue: boolean): void {
  const args = [
    "issue", "edit", String(issueNumber),
    "--repo", `${repo.owner}/${repo.name}`,
    "--remove-label", "agent:wip",
  ];
  if (requeue) args.push("--add-label", "agent:todo");
  try {
    execFileSync("gh", args, { timeout: 15_000, stdio: "pipe" });
    console.log(`Labels updated: removed agent:wip${requeue ? ", added agent:todo" : ""}`);
  } catch (err) {
    console.warn(`Could not update labels: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function run(args: string[]): Promise<number> {
  let ref: string | undefined;
  let repoFlag: string | undefined;
  let requeue = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--repo") {
      repoFlag = args[++i];
      if (!repoFlag) throw new Error("--repo requires a value");
    } else if (a === "--requeue") {
      requeue = true;
    } else if (a.startsWith("--")) {
      console.error(`Unknown option: ${a}\n\n${USAGE}`);
      return 2;
    } else if (!ref) {
      ref = a;
    } else {
      console.error(`Unexpected argument: ${a}\n\n${USAGE}`);
      return 2;
    }
  }

  if (!ref) {
    console.error(`Missing issue reference.\n\n${USAGE}`);
    return 2;
  }

  const config = parseConfigFile(findConfigPath());
  const { repoRef, number } = parseIssueRef(ref);
  const repo = resolveRepo(config, repoFlag ?? repoRef);

  const slug = await resolveActiveSlug(repo, number, config);
  if (!slug) {
    console.log(`Nothing active for ${repo.owner}/${repo.name}#${number}.`);
    return 0;
  }

  console.log(`Cancelling ${repo.owner}/${repo.name}#${number} (${slug})…`);
  await handlePrClosed(repo, slug, config);
  editLabels(repo, number, requeue);
  console.log("Done.");
  return 0;
}
