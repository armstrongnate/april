import { loadConfig } from "../config.js";
import { handleNewIssue } from "../spawner.js";
import { parseIssueRef, resolveRepo, fetchIssue } from "../work.js";

const USAGE = `april run <issue> [--repo OWNER/NAME]

  Manually start work on an issue — the same path the daemon takes on a
  labeled+assigned webhook, minus the label requirement. Creates the worktree,
  spawns the agent session, and flips labels to agent:wip.

  <issue>   123, #123, or owner/name#123
  --repo    Repo to act on when <issue> is a bare number and multiple are configured.`;

export async function run(args: string[]): Promise<number> {
  let ref: string | undefined;
  let repoFlag: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--repo") {
      repoFlag = args[++i];
      if (!repoFlag) throw new Error("--repo requires a value");
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

  const config = loadConfig();
  const { repoRef, number } = parseIssueRef(ref);
  const repo = resolveRepo(config, repoFlag ?? repoRef);
  const issue = fetchIssue(repo, number);

  console.log(`Starting work on ${repo.owner}/${repo.name}#${issue.number} — "${issue.title}"`);
  await handleNewIssue(repo, issue, config);
  console.log(`Done. Track it with \`april ps\`.`);
  return 0;
}
