# april

She does all the work so you don't have to, and with about the same level of enthusiasm.

april watches for GitHub issues assigned to you with a specific label, then spins up a Claude Code session in a tmux window to work the issue end-to-end — from reading the issue to opening a PR.

## Prerequisites

- [Node.js](https://nodejs.org/) >= 22
- [pnpm](https://pnpm.io/)
- [gh](https://cli.github.com/) (authenticated)
- [tmux](https://github.com/tmux/tmux)
- [Claude Code](https://claude.ai/claude-code) CLI

## Setup

```bash
pnpm install
cp config.example.yaml config.yaml
```

Edit `config.yaml` with your GitHub username, repos, and preferences. See `config.example.yaml` for all available options.

Install the `issue-worker` Claude skill:

```bash
mkdir -p ~/.claude/skills/issue-worker
cp skills/issue-worker/SKILL.md ~/.claude/skills/issue-worker/SKILL.md
```

## Usage

```bash
pnpm dev
```

Then label a GitHub issue with `agent:todo` and assign it to yourself. april will:

1. Create a git worktree for the issue
2. Run any configured post-worktree hooks (e.g. `pnpm i`)
3. Spawn a tmux session with Claude Code
4. Claude reads the issue, implements a fix, and opens a PR
5. Issue labels transition: `agent:todo` → `agent:wip` → `agent:review`

Attach to a running session anytime with `tmux attach -t <session-name>`.
