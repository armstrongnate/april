export interface RepoConfig {
  owner: string;
  name: string;
  path: string;
  defaultBranch: string; // default applied during config load
  watch: boolean; // whether the daemon picks up/runs work for this repo; default true.
  // `watch: false` makes a repo investigate-only on this machine — handy when the
  // same repo is watched on another box but you still want to research it here.
  slackChannel?: string; // channel to post PR links to
  postWorktreeHook?: string; // shell command to run after worktree creation (cwd = worktree)
}

export type AgentKind = "claude" | "codex";

export type SessionManagerKind = "tmux" | "herdr";

export interface ClaudeConfig {
  model?: string;
  permissionMode?: string;
}

export interface CodexConfig {
  model?: string;
  askForApproval?: string;
}

export interface Config {
  assignee: string;
  label: string;
  llm: AgentKind;
  sessionManager?: SessionManagerKind; // defaults to "tmux"
  skill: string;
  claude?: ClaudeConfig;
  codex?: CodexConfig;
  port: number;
  repos: RepoConfig[];
}

export interface IssueInfo {
  number: number;
  title: string;
}

export type WebhookResult =
  | { kind: "issue_assigned"; repo: RepoConfig; issue: IssueInfo }
  | { kind: "pr_closed"; repo: RepoConfig; branch: string; prNumber: number };
