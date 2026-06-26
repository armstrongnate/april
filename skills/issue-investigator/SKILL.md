---
name: issue-investigator
description: Research a free-text problem across one or more repos, then file a well-scoped GitHub issue that an implementation agent can pick up.
---

# issue-investigator

You have been given a **problem to investigate**, not an issue to implement. Your
job is to research it thoroughly and end by **creating one or more GitHub issues**
that are well-scoped enough for an implementation agent (or person) to start
without repeating your investigation. Most investigations produce a single issue;
when the work genuinely spans repos, file one issue per repo (see step 2).

Do not implement a fix. Do not open a PR. The deliverable is the issue(s).

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
- Decide **where the work lives**. A problem can relate to several repos in two
  different ways, and they lead to different outcomes:
  - **One repo owns the fix.** The change belongs in a single repo; the others
    are only context (they consume the behavior, or you ruled them out). File
    **one** issue in the owning repo and note the cross-repo impact in it.
  - **Multiple repos each need their own change.** The fix can't land as one diff
    in one repo — e.g. a new `athena-api` endpoint *and* the `athena-poc` UI that
    consumes it, or matching changes in `athena-poc` and `athena-ios`. april picks
    up work per-repo, from an issue **in that repo**, so each repo with real
    implementation work needs its **own issue**. Plan one issue per such repo and
    note the dependency/ordering between them (e.g. the API + SDK bump must land
    before the UI can use it).

  When unsure, prefer a single issue in the owning repo with cross-repo notes.
  Only split when each repo genuinely has implementation work of its own — don't
  file an issue in a repo that just needs to be mentioned.
- Gather concrete references: `path/to/file.ts:123`, function names, relevant
  existing patterns, related/duplicate issues (`gh issue list --search ...`).
- Determine root cause and scope. Distinguish the core fix from nice-to-haves.

Do not modify any files. This is discovery only.

## 3. Draft the issue(s)

Write **one issue per repo that has work** — usually one, more when you decided in
step 2 that the work spans repos. Each issue must stand on its own: an
implementation agent sees only its own repo's issue, so scope every section to
that repo and don't make it depend on the reader also opening a sibling issue.

Each issue follows the workspace conventions:

- **Title:** concise and specific.
- **Summary:** the problem in 2-4 sentences — observed vs. expected behavior.
- **Technical context:** the root cause and the relevant code references you found
  (`file:line`), scoped to *this* repo.
- **Proposed approach:** the shape of *this repo's* part of the fix, if clear.
  Keep it brief.
- **Acceptance criteria:** a short checklist of what "done" means *for this repo*.
  Prefer clear criteria over long prose.
- **Out of scope:** anything you deliberately excluded — including the parts that
  belong to the sibling repos.

When you split work across repos, also give each issue:

- a short **Related work** section naming the sibling repo(s) and what each
  covers, so the relationship is explicit. You'll paste the real sibling issue
  URLs in after creating them (step 4).
- the **ordering/dependency**, if any (e.g. "depends on the athena-api endpoint +
  SDK bump landing first"). Scope each issue to what its repo can do on its own;
  don't ask the frontend issue to also build the backend.

## 4. Create the issue(s)

Create one issue per repo you scoped in step 3, each assigned to the configured
assignee:

```
gh issue create \
  --repo {owner}/{name} \
  --title "..." \
  --body "..." \
  --assignee {assignee}
```

`gh issue create` prints the new issue's URL. When you filed more than one,
**cross-link them** once all are created: edit each issue so its "Related work"
section points at its siblings' real URLs, so an agent in one repo knows about
the others.

```
gh issue edit {url-or-number} --repo {owner}/{name} --body "...body with sibling URLs filled in..."
```

Then honor the mode from your prompt, for each issue:

- **deferred** (default): do **not** add the trigger label. The issues are for
  human review — print each URL and say it's ready to review and label.
- **auto**: also pass `--label {trigger_label}` so april picks the work up and
  starts implementation immediately. Two caveats when splitting across repos:
  - Only label repos april **watches**. The candidate list marks a repo as
    `investigate-only` when april won't run work there on this machine; file
    those issues without the label and say pickup happens elsewhere.
  - If issues have an ordering dependency, label only the **upstream** issue
    (e.g. the API + SDK change). Leave the dependent issue(s) unlabeled with a
    note that they're ready to label once the upstream lands — otherwise april
    starts an agent on work it can't finish yet.

## 5. Report

List **every** issue you created — each URL with a one-line summary of what it
covers and in which repo — and call out any ordering dependency between them so
the reader sees the full picture. If you concluded no issue should be filed (e.g.
not reproducible, or already covered by an existing issue), say so clearly and
link the existing issue(s) instead of creating a duplicate.
