---
name: issue-worker
description: Autonomously work a GitHub issue end-to-end — read, implement, open a PR, and monitor CI/review feedback.
---

# issue-worker

You have been assigned a GitHub issue. Work it to completion autonomously. Do not stop to ask for approval or confirmation — go straight from reading the issue to opening a PR, then monitor and respond to CI failures and review feedback.

## 1. Read the issue

```
gh issue view {issue_number} --repo {owner}/{repo} --comments
```

## 2. Understand the context

- Read CLAUDE.md for project conventions
- Identify relevant files and existing patterns
- Check for existing tests covering the affected code

## 3. Implement

- Make the changes
- Write or update tests as appropriate
- Ensure the code builds/lints/passes tests

## 4. Review

Run `/simplify` to review your changes for reuse, quality, and efficiency, and fix anything it surfaces.

Then do a quick manual pass on things `/simplify` won't catch:

- **Correctness:** Does the change fully address the issue? Any missing edge cases?
- **Tests:** Are the tests meaningful, or are they just asserting on mocks?
- **Cleanup:** Any leftover debug code, TODOs, or commented-out lines?

Fix anything you find before moving on.

## 5. Commit, push, and open a PR

```
gh pr create --title "..." --body "..."
```

## 6. Post to Slack (if instructed) — exactly once

If the prompt specifies a Slack channel, post a single message linking the PR.
Format: `<pr_url|PR> repo-name: title of the pr`

**Post the link exactly once per issue, even when multiple agents are working it.**
If you dispatch sub-agents to round out the work, do NOT give them the Slack
instruction — posting is the orchestrator's job and happens here, one time.

Guard against duplicates with an atomic marker in the git dir. Only the agent that
*creates* the marker may post; everyone else skips:

```bash
marker="$(git rev-parse --git-dir)/april-slack-posted"
if mkdir "$marker" 2>/dev/null; then
  echo "won the lock — post to Slack now"
else
  echo "already posted — skip"
fi
```

`mkdir` is atomic, so this is race-safe even if two agents reach it at the same
moment. Run it immediately before the Slack MCP call; if it prints "skip", do not
post. The marker lives in the git dir (never committed) and persists for the life
of the worktree, so the monitor loop in step 7 will not re-post on later passes.

## 7. Monitor CI and review feedback

After creating the PR, monitor it until all checks pass and all review feedback is addressed.

Note: the "claude review" CI check turns green as soon as Claude *posts* a review — it does
not indicate the review was clean. Always read the actual review comments before deciding
the PR is done.

Loop:
1. Sleep for 3 minutes (`sleep 180`)
2. Check CI status: `gh pr checks {pr_number} --repo {owner}/{repo}`
3. If any checks failed, read the failure logs, fix the issue, commit, and push
4. Check for review comments: `gh pr view {pr_number} --repo {owner}/{repo} --comments`
5. If there are new or unresolved comments, address them, commit, and push
6. Repeat from step 1

Stop when:
- All CI checks pass AND
- No unresolved review comments remain

Once everything is green, update the issue labels:

```
gh issue edit {issue_number} --repo {owner}/{repo} --add-label agent:review --remove-label agent:wip
```
