---
name: issue-worker
description: Autonomously work a GitHub issue end-to-end — read, implement, and open a PR with no human input required.
---

# issue-worker

You have been assigned a GitHub issue. Work it to completion autonomously. Do not stop to ask for approval or confirmation — go straight from reading the issue to opening a PR.

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

## 4. Commit, push, and open a PR

```
gh pr create --title "..." --body "..."
```

Then update the issue labels:

```
gh issue edit {issue_number} --repo {owner}/{repo} --add-label agent:review --remove-label agent:wip
```

## 5. Post to Slack (if instructed)

If the prompt specifies a Slack channel, use the Slack MCP tool to post a message with a link to the PR. Format: `<pr_url|PR> title of the pr`
