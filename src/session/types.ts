/**
 * Session backend abstraction.
 *
 * april needs only four primitives from whatever runs its agent sessions.
 * Today those map to tmux; this interface lets a herdr (or any other) backend
 * drop in behind the same contract.
 *
 *   listSessions  -> tmux `list-sessions`        / herdr `workspace.list`
 *   hasSession    -> tmux `has-session`          / herdr `workspace.list` + filter
 *   spawn         -> tmux `new-session` + send   / herdr `workspace.create` + `pane.send_*`
 *   kill          -> tmux `kill-session`         / herdr `workspace.close`
 *
 * "name" is the stable identity april assigns — the branch slug, e.g.
 * `gh-123-fix-foo`. tmux uses it directly as the session name. herdr assigns
 * its own ids, so the backend stores the slug as the workspace `label` and
 * resolves label -> id on demand.
 */

export interface SpawnOptions {
  /** Branch slug; stable identity for dedupe and teardown. */
  name: string;
  /** Working directory for the session (the worktree path). */
  cwd: string;
  /** Agent CLI command line to launch (e.g. `claude --model opus ...`). */
  command: string;
  /** Prompt to inject once the agent is ready. */
  prompt: string;
}

export interface SessionBackend {
  /** Names (slugs) of every april-managed session currently alive. */
  listSessions(): Promise<string[]>;
  /** Whether a session with this name exists. */
  hasSession(name: string): Promise<boolean>;
  /**
   * Create a detached session running `command` in `cwd`, then inject
   * `prompt` + Enter once the agent is ready. No-op if it already exists.
   */
  spawn(opts: SpawnOptions): Promise<void>;
  /** Tear down the session by name. Idempotent — silent if already gone. */
  kill(name: string): Promise<void>;
}
