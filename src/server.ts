import Fastify, { type FastifyInstance } from "fastify";
import { createLogger } from "./logger.js";
import { parseWebhookEvent } from "./webhook.js";
import { isIssueActive } from "./spawner.js";
import type { Config, WebhookResult } from "./types.js";

const log = createLogger("server");

type OnNewIssue = (result: WebhookResult) => Promise<void>;

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

      if (result) {
        const key = `${result.repo.owner}/${result.repo.name}#${result.issue.number}`;

        if (isIssueActive(result.repo, result.issue.number)) {
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
      }
    } catch (err) {
      log.error(`Error processing webhook: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Always return 200
    return reply.code(200).send({ ok: true });
  });

  app.get("/health", async () => ({ status: "ok" }));

  await app.listen({ port: config.port, host: "127.0.0.1" });
  log.info(`Server listening on http://127.0.0.1:${config.port}`);

  return app;
}
