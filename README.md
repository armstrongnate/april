# april

She does all the work so you don't have to, and with about the same level of enthusiasm.

april watches for GitHub issues assigned to you with a specific label, then spins up a Claude Code session in a tmux window to work the issue end-to-end — from reading the issue to opening a PR.

## Prerequisites

- [Node.js](https://nodejs.org/) >= 22
- [pnpm](https://pnpm.io/)
- [gh](https://cli.github.com/) (authenticated)
- The [gh webhook extension](https://github.com/cli/gh-webhook):
  ```bash
  gh extension install cli/gh-webhook
  ```
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

## Running on a server (optional)

If you want april to run on an always-on Linux server instead of your laptop, install all the prerequisites above and:

### Authenticate `gh` without a browser

Either set a Personal Access Token in the environment:

```bash
export GH_TOKEN=ghp_...
```

Or log in non-interactively:

```bash
echo "ghp_..." | gh auth login --with-token
```

### Build april

```bash
pnpm install
pnpm build
```

### Install a systemd user service

Create `~/.config/systemd/user/april.service`:

```ini
[Unit]
Description=april - GitHub issue worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=%h/april
Environment=PATH=%h/.local/bin:/usr/local/bin:/usr/bin:/bin
# Uncomment if using token-based gh auth:
# Environment=GH_TOKEN=ghp_...
ExecStart=/usr/bin/node %h/april/dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

Then enable and start it:

```bash
systemctl --user daemon-reload
systemctl --user enable --now april
loginctl enable-linger "$USER"   # so the service runs at boot without an active login
```

### Operating it

```bash
journalctl --user -u april -f       # tail logs
systemctl --user restart april      # restart
systemctl --user stop april         # stop
systemctl --user status april       # check status
```
