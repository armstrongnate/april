export interface RepoConfig {
  owner: string;
  name: string;
  path: string;
  defaultBranch: string; // default applied during config load
  slackChannel?: string; // channel to post PR links to
  postWorktreeHook?: string; // shell command to run after worktree creation (cwd = worktree)
}

export interface Config {
  assignee: string;
  label: string;
  claudeSkill: string;
  claudeModel?: string;
  claudeAllowedTools?: string[];
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
