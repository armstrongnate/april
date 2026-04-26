# april

She does all the work so you don't have to, and with about the same level of enthusiasm.

april watches for GitHub issues assigned to you with a specific label, then spins up a Claude Code session in a tmux window to work the issue end-to-end — from reading the issue to opening a PR.

## Prerequisites

- [Node.js](https://nodejs.org/) >= 22
- [gh](https://cli.github.com/) (authenticated)
- The [`gh-webhook` extension](https://github.com/cli/gh-webhook): `gh extension install cli/gh-webhook`
- [tmux](https://github.com/tmux/tmux)
- [Claude Code](https://claude.ai/claude-code) CLI

## Quick install

```bash
npm i -g @armstrongnate/april
april init                         # writes ~/.config/april/config.yaml + skill + env file; checks prereqs
$EDITOR ~/.config/april/config.yaml
april install                      # registers the user service and starts it
april logs -f
```

`april init` and the daemon both verify that the `cli/gh-webhook` extension is installed and refuse to proceed without it.

## Server install (full playbook)

The minimal flow above leaves out auth setup and a few server-specific gotchas. This is the end-to-end recipe for a fresh Linux server.

### 1. System prerequisites

```bash
# Install node 22+, tmux, gh, claude code via your usual route, then:
gh extension install cli/gh-webhook
```

### 2. Create a Personal Access Token

The systemd user service runs in a stripped-down environment — no shell config, no keyring/DBus, no credential helpers. Whatever clever auth you have set up in your interactive shell almost certainly will not be available to the daemon. **You need an explicit token in the env file.**

Generate one on your GitHub host's web UI: Settings → Developer settings → Personal access tokens.

**Classic PAT scopes:**
- `repo` — issue read/write, label updates, PR creation, code access (no smaller scope works for private repo issues)
- `admin:repo_hook` — needed for `gh webhook forward` to register and clean up its temporary `cli` webhook
- `workflow` — only if Claude might modify `.github/workflows/*` files

**Fine-grained PAT** (GHES 3.10+):
- Repository access: select the repos
- Permissions: Issues R/W, Pull requests R/W, Contents R/W, Webhooks R/W, Metadata R, Workflows R/W (last one optional)

The daemon's own needs are smaller (Issues R/W + Webhooks R/W + Metadata R), but Claude inherits the same env when it runs inside tmux, so the token has to cover both — see [Token inheritance](#token-inheritance) below.

### 3. Install the package

```bash
npm i -g @armstrongnate/april
april init
$EDITOR ~/.config/april/config.yaml
```

### 4. Configure auth in the env file

```bash
$EDITOR ~/.config/april/env
```

For a **GitHub Enterprise Server** host:

```
GH_HOST=your.ghes.host
GH_ENTERPRISE_TOKEN=ghp_...
```

For **github.com**:

```
GH_TOKEN=ghp_...
```

`gh` is host-aware about which env var it reads: `GH_TOKEN` is github.com-only; `GH_ENTERPRISE_TOKEN` covers any other host (used together with `GH_HOST`). Setting `GH_TOKEN` while `GH_HOST` points elsewhere will silently fail.

### 5. Install and start the service

```bash
april install
```

This writes `~/.config/systemd/user/april.service`, enables it, and starts it. The unit references the env file via `EnvironmentFile=-~/.config/april/env`, so anything you put there flows through on each restart.

### 6. Enable linger (Linux servers)

systemd user services stop when you log out unless linger is enabled. On any server you SSH out of:

```bash
sudo loginctl enable-linger $USER
```

`april install` warns you if it sees this is off.

### 7. Verify

```bash
april status
april logs -f
```

Healthy logs include `Starting webhook forwarder for <repo>` and no immediate errors. Then label an issue with `agent:todo` and watch it kick off.

## Commands

| Command | What it does |
| --- | --- |
| `april init` | Copies the bundled `config.example.yaml` to `~/.config/april/config.yaml` and the `issue-worker` skill to `~/.claude/skills/`. Won't overwrite without `--force`. |
| `april install` | Installs and starts the user service. Pass `--print` to see the unit/plist without writing it. |
| `april uninstall` | Stops and removes the service. |
| `april start` / `stop` / `restart` | Lifecycle. |
| `april status` | Shows service status. |
| `april logs -f [-n N]` | Streams logs. `-n` sets line count (default 100). |
| `april daemon` | Runs the worker in the foreground (for debugging; the service uses `dist/index.js` directly). |

## Environment variables

The daemon reads extra env vars from `~/.config/april/env`. One `KEY=VALUE` per line, `#` for comments, optional double-quotes around values:

```sh
# ~/.config/april/env
GH_HOST=your.ghes.host
GH_ENTERPRISE_TOKEN=ghp_...
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
APRIL_DEBUG=1
```

This file is seeded by `april install` (and `april init`) and is **never overwritten by reinstalls** — safe to put long-lived secrets here.

After editing:
- **Linux:** `april restart`. The systemd unit re-reads the env file on each start.
- **macOS:** `april install && april restart`. launchd has no `EnvironmentFile=` equivalent, so values are inlined into the plist at install time; you have to regenerate it after editing.

### Token inheritance

`spawner.ts` runs Claude inside tmux with `tmux new-session -d <claudeCommand>` — no login shell. So Claude inherits the daemon's env directly, including any `GH_TOKEN` / `GH_ENTERPRISE_TOKEN` you set in the env file. Practical implication: the PAT you provide has to cover what *both* april and Claude need, not just april. If you want Claude to fall back to your shell's auth (a credential helper, network-level auth, etc.), you'd need to wrap the tmux command in a login shell — not currently supported.

## Service backend

- **Linux** uses systemd user services at `~/.config/systemd/user/april.service`. Logs go to the journal (`journalctl --user -u april`).
- **macOS** uses launchd LaunchAgents at `~/Library/LaunchAgents/dev.april.daemon.plist`. Logs go to `~/Library/Logs/april/april.log`.

### Node version managers

`april install` captures the absolute path of the `node` binary it was invoked with (e.g. `~/.nvm/versions/node/v22.x.x/bin/node`) and bakes it into the unit/plist. If you later remove or change that node version, the service will fail to start — re-run `april install` after switching.

## GitHub Enterprise Server caveat

`gh webhook forward` relies on GitHub's hosted webhook-relay infrastructure. **That relay is github.com-only — it is not part of GHES.** If your repos live on a GHES instance, you will see this in the logs after the daemon authenticates fine:

```
Error: you do not have access to this feature
```

The webhook extension itself works against GHES (it can authenticate, list extensions, etc.), but the actual `forward` subcommand has no relay to talk to.

Workarounds (none currently shipped — file an issue if you need them wired up):

1. **Direct webhook delivery.** Expose april's port publicly (reverse proxy + TLS, or a tunnel like cloudflared / tailscale funnel / ngrok), and configure a webhook on the GHES repo pointing at `https://your-server/webhook/github`. Skip `gh webhook forward` entirely.
2. **Polling.** Replace the forwarder with a periodic poll of open issues. april already has reconciliation-on-startup; turning it into a timer is small.
3. **Third-party relay** like smee.io.

## Upgrading

```bash
april upgrade
```

This runs the package install, regenerates the unit/plist, and restarts the service in one go. Pass a specific version (`april upgrade 0.0.5`) to pin, or `--with pnpm|yarn` if `april upgrade` picks the wrong package manager.

Manual equivalent if you want to do it yourself:

```bash
npm i -g @armstrongnate/april@latest
april install        # regenerates the unit/plist with any template changes (also runs daemon-reload on Linux)
april restart
```

**If you skip `april install` after upgrading, new template features (`EnvironmentFile=`, env-var changes, etc.) will not appear in your existing unit file** — `npm` only updates the package, not anything systemd has on disk.

`april upgrade` does **not** overwrite the issue-worker skill at `~/.claude/skills/issue-worker/SKILL.md` (you might have customized it). After upgrade, it prints a notice if the bundled skill differs from yours; refresh with `april init --force` if you want the new bundled version.

## Troubleshooting

### `Required gh extension not installed: cli/gh-webhook`

Install it as the same user that runs the service:

```bash
gh extension install cli/gh-webhook
```

### `gh auth token not found for host "..."`

`gh-webhook` shells out to `gh auth token` to extract a Bearer token, and your gh setup doesn't have an extractable one (you might be relying on a credential helper, network-level auth like Cloudflare Access, or a wrapper script). Add an explicit `GH_TOKEN` / `GH_ENTERPRISE_TOKEN` to `~/.config/april/env`, then `april restart`.

### `you do not have access to this feature` on `gh webhook forward`

Your host (likely GHES) doesn't expose the webhook-forwarding relay. See [GitHub Enterprise Server caveat](#github-enterprise-server-caveat).

### Service starts but env vars in `~/.config/april/env` aren't applied

You're running a unit that was generated before `EnvironmentFile=` support landed (anything from before v0.0.2). Confirm:

```bash
systemctl --user cat april | grep -i environment
```

If you don't see `EnvironmentFile=`, regenerate:

```bash
april install
systemctl --user daemon-reload
april restart
```

### `Token:` is empty in `gh auth status` but `gh` commands work

Means your auth is provided by something other than a stored token (credential helper, network auth, wrapper). The webhook extension still needs an actual token — it doesn't matter how `gh` does its other API calls. Add `GH_TOKEN` / `GH_ENTERPRISE_TOKEN` to the env file.

### Service can't find `gh` / `tmux` / `claude` even though they're on your shell PATH

`april install` captures `$PATH` at install time and bakes it into the unit. If you installed any of those tools after running `april install`, re-run `april install` to recapture PATH.

## Usage

Once installed, label a GitHub issue with `agent:todo` and assign it to yourself. april will:

1. Create a git worktree for the issue
2. Run any configured post-worktree hooks (e.g. `pnpm i`)
3. Spawn a tmux session with Claude Code
4. Claude reads the issue, implements a fix, and opens a PR
5. Issue labels transition: `agent:todo` → `agent:wip` → `agent:review`

Attach to a running session anytime with `tmux attach -t <session-name>`.

## Development

```bash
pnpm install
cp config.example.yaml config.yaml
pnpm dev
```

`pnpm dev` runs the daemon in the foreground from the source tree. Config is loaded from `~/.config/april/config.yaml` if it exists, otherwise `./config.yaml`.
