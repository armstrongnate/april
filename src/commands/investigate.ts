import { loadConfig } from "../config.js";
import { getAgent } from "../agents.js";
import { getSessionBackend } from "../session/index.js";
import { slugify } from "../slug.js";
import { resolveRepo, INVESTIGATE_PREFIX } from "../work.js";
import { INVESTIGATE_SKILL } from "../skill.js";

const USAGE = `april investigate "<problem>" [--repo OWNER/NAME] [--auto]

  Dispatch a research agent in the CURRENT directory to investigate a problem
  and file a GitHub issue. The session may span repos; it is not tied to a
  worktree.

  "<problem>"  free-text description of what to investigate
  --repo       suggest the owning repo (the agent still decides where it belongs)
  --auto       create the issue already labeled so april picks it up immediately
  --review     explicit deferred mode (the default): file for human review, no label
  --dry-run    print the session name and the prompt that would be dispatched, then exit`;

export async function run(args: string[]): Promise<number> {
  let repoFlag: string | undefined;
  let auto = false;
  let dryRun = false;
  const words: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--repo") {
      repoFlag = args[++i];
      if (!repoFlag) throw new Error("--repo requires a value");
    } else if (a === "--auto") {
      auto = true;
    } else if (a === "--review") {
      auto = false;
    } else if (a === "--dry-run") {
      dryRun = true;
    } else if (a.startsWith("--")) {
      console.error(`Unknown option: ${a}\n\n${USAGE}`);
      return 2;
    } else {
      words.push(a);
    }
  }

  const problem = words.join(" ").trim();
  if (!problem) {
    console.error(`Missing problem description.\n\n${USAGE}`);
    return 2;
  }

  const config = loadConfig();
  // Validate the hint early so a typo'd --repo fails before spawning a session.
  const suggested = repoFlag ? resolveRepo(config, repoFlag) : undefined;

  const mode = auto ? "auto" : "deferred";
  const cwd = process.cwd();
  const shortId = Date.now().toString(36).slice(-4);
  const slug = `${INVESTIGATE_PREFIX}${shortId}-${slugify(problem, 30, "investigation")}`;

  const repoList = config.repos
    .map(
      (r) =>
        `  - ${r.owner}/${r.name} — ${r.path}${r.watch ? "" : " (investigate-only — april won't run work here on this machine)"}`
    )
    .join("\n");

  const modeLine =
    mode === "auto"
      ? `create the issue assigned to ${config.assignee} AND apply the "${config.label}" label so april picks it up immediately.`
      : `create the issue assigned to ${config.assignee} WITHOUT the "${config.label}" label, then print the URL for review.`;

  const body = [
    problem,
    "",
    "Context for filing the issue:",
    `- Assignee: ${config.assignee}`,
    `- Trigger label: ${config.label}`,
    `- Mode: ${mode}`,
    ...(suggested ? [`- Suggested owning repo: ${suggested.owner}/${suggested.name}`] : []),
    "- Candidate repos:",
    repoList,
    "",
    `Investigate the problem above, then ${modeLine}`,
  ].join("\n");

  const agent = getAgent(config.llm);
  const prompt = agent.buildPrompt(INVESTIGATE_SKILL, body);
  const command = agent.buildCommand(config);

  if (dryRun) {
    console.log(`session: ${slug}`);
    console.log(`cwd:     ${cwd}`);
    console.log(`mode:    ${mode}`);
    console.log(`command: ${command}`);
    console.log(`\nprompt:\n${prompt}`);
    return 0;
  }

  console.log(`Starting investigation "${slug}" in ${cwd} (${mode} mode)…`);
  await getSessionBackend(config).spawn({ name: slug, cwd, command, prompt });
  console.log(`Done. Track it with \`april ps\`; attach to the session "${slug}".`);
  return 0;
}
