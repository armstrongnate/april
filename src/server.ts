import Fastify, { type FastifyInstance } from "fastify";
import { createLogger } from "./logger.js";
import { parseWebhookEvent } from "./webhook.js";
import { isIssueActive, handlePrClosed, getActiveCounts } from "./spawner.js";
import { getForwarderStatus } from "./processes.js";
import type { Config, WebhookResult } from "./types.js";

const log = createLogger("server");

type IssueAssignedResult = Extract<WebhookResult, { kind: "issue_assigned" }>;
type OnNewIssue = (result: IssueAssignedResult) => Promise<void>;

export async function startServer(
  config: Config,
  onNewIssue: OnNewIssue
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // Debounce: track recently processed issue keys with 10s TTL
  const recentlyProcessed = new Map<string, number>();

  function isRecentlyProcessed(key: string): boolean {
    const ts = recentlyProcessed.get(key);
    if (ts && Date.now() - ts < 10_000) {
      return true;
    }
    return false;
  }

  function markProcessed(key: string): void {
    recentlyProcessed.set(key, Date.now());

    // Cleanup old entries
    for (const [k, ts] of recentlyProcessed) {
      if (Date.now() - ts >= 10_000) {
        recentlyProcessed.delete(k);
      }
    }
  }

  app.post("/webhook/github", async (request, reply) => {
    try {
      const headers = request.headers as Record<string, string>;
      const body = request.body as Record<string, unknown>;

      const result = parseWebhookEvent(headers, body, config);

      if (result?.kind === "issue_assigned") {
        const key = `issue:${result.repo.owner}/${result.repo.name}#${result.issue.number}`;

        if (await isIssueActive(result.repo, result.issue.number, config)) {
          log.debug(`Issue ${key} already active, ignoring webhook`);
        } else if (isRecentlyProcessed(key)) {
          log.debug(`Issue ${key} recently processed, debouncing`);
        } else {
          markProcessed(key);
          log.info(`Processing webhook for ${key}`);
          onNewIssue(result).catch((err) => {
            log.error(`Error handling new issue: ${err instanceof Error ? err.message : String(err)}`);
          });
        }
      } else if (result?.kind === "pr_closed") {
        const key = `pr:${result.repo.owner}/${result.repo.name}#${result.prNumber}`;

        if (isRecentlyProcessed(key)) {
          log.debug(`PR close ${key} recently processed, debouncing`);
        } else {
          markProcessed(key);
          log.info(`Processing webhook for ${key}`);
          try {
            await handlePrClosed(result.repo, result.branch, config);
          } catch (err) {
            log.error(`Error handling PR close: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
    } catch (err) {
      log.error(`Error processing webhook: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Always return 200
    return reply.code(200).send({ ok: true });
  });

  app.get("/health", async () => ({ status: "ok" }));

  // Live daemon state for `april ps` / `april doctor`. Everything here is also
  // derivable from disk, so the CLI degrades gracefully when the daemon is down.
  app.get("/status", async () => ({
    uptime: process.uptime(),
    assignee: config.assignee,
    label: config.label,
    sessionManager: config.sessionManager ?? "tmux",
    repos: config.repos.map((r) => `${r.owner}/${r.name}`),
    active: await getActiveCounts(config),
    forwarders: getForwarderStatus(),
  }));

  await app.listen({ port: config.port, host: "127.0.0.1" });
  log.info(`Server listening on http://127.0.0.1:${config.port}`);

  return app;
}
