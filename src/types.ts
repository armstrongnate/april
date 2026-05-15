export interface RepoConfig {
  owner: string;
  name: string;
  path: string;
  defaultBranch: string; // default applied during config load
  slackChannel?: string; // channel to post PR links to
  postWorktreeHook?: string; // shell command to run after worktree creation (cwd = worktree)
}

export type AgentKind = "claude" | "codex";

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

export interface WebhookResult {
  repo: RepoConfig;
  issue: IssueInfo;
}
