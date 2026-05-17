import { createLogger } from "./logger.js";
import type { Config, RepoConfig, WebhookResult } from "./types.js";

const log = createLogger("webhook");

const APRIL_BRANCH_RE = /^gh-\d+-/;

function matchRepo(body: Record<string, unknown>, config: Config): RepoConfig | null {
  const repository = body.repository as Record<string, unknown> | undefined;
  if (!repository) {
    log.debug("No repository payload found");
    return null;
  }

  const repoOwner = (repository.owner as Record<string, unknown>)?.login as string | undefined;
  const repoName = repository.name as string | undefined;

  if (!repoOwner || !repoName) {
    log.debug("Could not extract repo owner/name from payload");
    return null;
  }

  const repo = config.repos.find(
    (r) => r.owner.toLowerCase() === repoOwner.toLowerCase() && r.name.toLowerCase() === repoName.toLowerCase()
  );

  if (!repo) {
    log.debug(`Repo ${repoOwner}/${repoName} not in config`);
    return null;
  }

  return repo;
}

function parseIssuesEvent(
  body: Record<string, unknown>,
  config: Config
): WebhookResult | null {
  const action = body.action as string | undefined;
  if (action !== "assigned" && action !== "labeled") {
    log.debug(`Ignoring issues action: ${action}`);
    return null;
  }

  const issue = body.issue as Record<string, unknown> | undefined;
  if (!issue) {
    log.debug("No issue payload found");
    return null;
  }

  const assignees = issue.assignees as Array<Record<string, unknown>> | undefined;
  if (!assignees || !assignees.some((a) => a.login === config.assignee)) {
    log.debug(`Issue not assigned to ${config.assignee}`);
    return null;
  }

  const labels = issue.labels as Array<Record<string, unknown>> | undefined;
  if (!labels || !labels.some((l) => l.name === config.label)) {
    log.debug(`Issue does not have label "${config.label}"`);
    return null;
  }

  const repo = matchRepo(body, config);
  if (!repo) return null;

  const number = issue.number as number;
  const title = issue.title as string;

  log.info(`Matched webhook event: ${repo.owner}/${repo.name}#${number} (${action})`);

  return { kind: "issue_assigned", repo, issue: { number, title } };
}

function parsePullRequestEvent(
  body: Record<string, unknown>,
  config: Config
): WebhookResult | null {
  const action = body.action as string | undefined;
  if (action !== "closed") {
    log.debug(`Ignoring pull_request action: ${action}`);
    return null;
  }

  const pr = body.pull_request as Record<string, unknown> | undefined;
  if (!pr) {
    log.debug("No pull_request payload found");
    return null;
  }

  const head = pr.head as Record<string, unknown> | undefined;
  const branch = head?.ref as string | undefined;
  const prNumber = pr.number as number | undefined;

  if (!branch || typeof prNumber !== "number") {
    log.debug("pull_request missing head.ref or number");
    return null;
  }

  if (!APRIL_BRANCH_RE.test(branch)) {
    log.debug(`Ignoring pull_request close: not an april branch (${branch})`);
    return null;
  }

  const repo = matchRepo(body, config);
  if (!repo) return null;

  log.info(`Matched webhook event: ${repo.owner}/${repo.name}#${prNumber} PR closed (${branch})`);

  return { kind: "pr_closed", repo, branch, prNumber };
}

export function parseWebhookEvent(
  headers: Record<string, string>,
  body: Record<string, unknown>,
  config: Config
): WebhookResult | null {
  const event = headers["x-github-event"];
  if (event === "issues") return parseIssuesEvent(body, config);
  if (event === "pull_request") return parsePullRequestEvent(body, config);

  log.debug(`Ignoring event: ${event}`);
  return null;
}
