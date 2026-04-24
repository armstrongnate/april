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

Run `/ultrareview` to review your own changes. Fix any issues it identifies before committing.

## 5. Commit, push, and open a PR

```
gh pr create --title "..." --body "..."
```

## 6. Post to Slack (if instructed)

If the prompt specifies a Slack channel, use the Slack MCP tool to post a message with a link to the PR. Format: `<pr_url|PR> repo-name: title of the pr`

## 7. Monitor CI and review feedback

After creating the PR, monitor it until all checks pass and all review feedback is addressed.

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
