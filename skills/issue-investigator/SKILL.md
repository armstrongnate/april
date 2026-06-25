---
name: issue-investigator
description: Research a free-text problem across one or more repos, then file a well-scoped GitHub issue that an implementation agent can pick up.
---

# issue-investigator

You have been given a **problem to investigate**, not an issue to implement. Your
job is to research it thoroughly and end by **creating a GitHub issue** that is
well-scoped enough for an implementation agent (or person) to start without
repeating your investigation.

Do not implement a fix. Do not open a PR. The deliverable is the issue.

Your launch prompt includes the specifics for this run:

- the **problem statement** to investigate,
- the **assignee** to put on the issue,
- the **trigger label** april uses to pick work up,
- the **candidate repos** (each as `owner/name` plus a local checkout path),
- the **mode**: `deferred` (default) or `auto`.

## 1. Understand the problem

- Read the problem statement carefully. Note what is observed, what is expected,
  and anything still unknown.
- You are running in whatever directory april was invoked from — possibly not a
  repo at all. Use the candidate repo paths from the prompt to read code, and the
  `gh` CLI to inspect issues, PRs, and code history across repos.

## 2. Investigate (read-only)

**First, make sure each repo you investigate is current.** The local checkouts
are not guaranteed to be up to date, and they are usually not pulled manually —
investigating stale code leads to wrong conclusions and duplicate/already-fixed
issues. For each candidate repo, before reading its code:

- Check the branch and working tree: `git -C <path> status`.
- If it's on a clean `main`/`master`, pull the latest: `git -C <path> pull --ff-only`.
- If the checkout is dirty or on another branch, do **not** overwrite local work.
  Instead `git -C <path> fetch origin` and base your reading on the remote default
  branch (e.g. `git -C <path> log origin/main`, `git -C <path> show origin/main:path/to/file`).
- Never discard local changes. If a repo can't be brought current safely, note
  that in the issue so the staleness is visible.

This git sync is expected; it's distinct from the "do not modify any files" rule
below, which is about not editing source as part of discovery.

- Reproduce the reasoning: trace the relevant code paths in the candidate repos.
- Identify the **owning repo** — where the change actually belongs. The problem
  may touch several repos; pick the one that owns the fix and note cross-repo
  impact in the issue.
- Gather concrete references: `path/to/file.ts:123`, function names, relevant
  existing patterns, related/duplicate issues (`gh issue list --search ...`).
- Determine root cause and scope. Distinguish the core fix from nice-to-haves.

Do not modify any files. This is discovery only.

## 3. Draft the issue

Write an issue that follows the workspace conventions:

- **Title:** concise and specific.
- **Summary:** the problem in 2-4 sentences — observed vs. expected behavior.
- **Technical context:** the root cause and the relevant code references you found
  (`file:line`), plus any cross-repo impact.
- **Proposed approach:** the shape of the fix, if clear. Keep it brief.
- **Acceptance criteria:** a short checklist of what "done" means. Prefer clear
  criteria over long prose.
- **Out of scope:** anything you deliberately excluded.

## 4. Create the issue

Create it in the **owning repo** and assign the configured assignee:

```
gh issue create \
  --repo {owner}/{name} \
  --title "..." \
  --body "..." \
  --assignee {assignee}
```

Then honor the mode from your prompt:

- **deferred** (default): do **not** add the trigger label. The issue is for human
  review — print the issue URL and say it's ready to review and label.
- **auto**: also pass `--label {trigger_label}` so april picks it up and starts
  implementation immediately.

## 5. Report

Print the created issue's URL and a one-line summary of what you filed and in
which repo. If you concluded no issue should be filed (e.g. not reproducible, or
already covered by an existing issue), say so clearly and link the existing issue
instead of creating a duplicate.
