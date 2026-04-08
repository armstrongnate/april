import { createLogger } from "./logger.js";
import type { Config, WebhookResult } from "./types.js";

const log = createLogger("webhook");

export function parseWebhookEvent(
  headers: Record<string, string>,
  body: Record<string, unknown>,
  config: Config
): WebhookResult | null {
  const event = headers["x-github-event"];
  if (event !== "issues") {
    log.debug(`Ignoring non-issues event: ${event}`);
    return null;
  }

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

  // Check assignees
  const assignees = issue.assignees as Array<Record<string, unknown>> | undefined;
  if (!assignees || !assignees.some((a) => a.login === config.assignee)) {
    log.debug(`Issue not assigned to ${config.assignee}`);
    return null;
  }

  // Check labels
  const labels = issue.labels as Array<Record<string, unknown>> | undefined;
  if (!labels || !labels.some((l) => l.name === config.label)) {
    log.debug(`Issue does not have label "${config.label}"`);
    return null;
  }

  // Match repo
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

  const number = issue.number as number;
  const title = issue.title as string;

  log.info(`Matched webhook event: ${repo.owner}/${repo.name}#${number} (${action})`);

  return { repo, issue: { number, title } };
}
