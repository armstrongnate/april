import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createLogger } from "./logger.js";
import type { Config } from "./types.js";

const log = createLogger("forwarder");

/**
 * Delete any stale `cli` webhooks on a repo left behind by a previous
 * gh webhook forward process that didn't shut down cleanly.
 */
function cleanupStaleWebhooks(repoKey: string): void {
  try {
    const output = execFileSync("gh", [
      "api", `repos/${repoKey}/hooks`, "--jq", '.[] | select(.name == "cli") | .id',
    ], { encoding: "utf-8", timeout: 15_000, stdio: ["pipe", "pipe", "pipe"] });

    const ids = output.trim().split("\n").filter(Boolean);
    for (const id of ids) {
      log.info(`Cleaning up stale webhook ${id} on ${repoKey}`);
      try {
        execFileSync("gh", ["api", "-X", "DELETE", `repos/${repoKey}/hooks/${id}`], {
          timeout: 15_000, stdio: "pipe",
        });
      } catch (err) {
        log.warn(`Failed to delete webhook ${id} on ${repoKey}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch {
    // No hooks or API error — not critical, gh webhook forward will report the real error
  }
}

interface ForwarderState {
  child: ChildProcess;
  repoKey: string;
  consecutiveFailures: number;
  lastStartTime: number;
  backoffMs: number;
  stopped: boolean;
}

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;
const UPTIME_RESET_MS = 60_000;

const forwarders: ForwarderState[] = [];

function spawnForwarder(config: Config, repoKey: string, url: string): ForwarderState {
  const state: ForwarderState = {
    child: null!,
    repoKey,
    consecutiveFailures: 0,
    lastStartTime: 0,
    backoffMs: INITIAL_BACKOFF_MS,
    stopped: false,
  };

  function start(): void {
    if (state.stopped) return;

    state.lastStartTime = Date.now();
    log.info(`Starting webhook forwarder for ${repoKey}`);

    const child = spawn("gh", [
      "webhook", "forward",
      `--repo=${repoKey}`,
      "--events=issues",
      `--url=${url}`,
    ], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    state.child = child;

    child.stdout?.on("data", (data: Buffer) => {
      const lines = data.toString("utf-8").trim().split("\n");
      for (const line of lines) {
        if (line.trim()) log.debug(`[${repoKey}] ${line}`);
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      const lines = data.toString("utf-8").trim().split("\n");
      for (const line of lines) {
        if (line.trim()) log.warn(`[${repoKey}] ${line}`);
      }
    });

    child.on("exit", (code, signal) => {
      if (state.stopped) return;

      const uptime = Date.now() - state.lastStartTime;

      if (uptime >= UPTIME_RESET_MS) {
        // Was running long enough, reset backoff
        state.consecutiveFailures = 0;
        state.backoffMs = INITIAL_BACKOFF_MS;
      } else {
        state.consecutiveFailures++;
        state.backoffMs = Math.min(state.backoffMs * 2, MAX_BACKOFF_MS);
      }

      log.warn(
        `Forwarder for ${repoKey} exited (code=${code}, signal=${signal}), ` +
          `restarting in ${state.backoffMs}ms (consecutive failures: ${state.consecutiveFailures})`
      );

      setTimeout(() => start(), state.backoffMs);
    });
  }

  start();
  return state;
}

export function startWebhookForwarders(config: Config): ChildProcess[] {
  const url = `http://localhost:${config.port}/webhook/github`;

  for (const repo of config.repos) {
    const repoKey = `${repo.owner}/${repo.name}`;
    cleanupStaleWebhooks(repoKey);
    const state = spawnForwarder(config, repoKey, url);
    forwarders.push(state);
  }

  return forwarders.map((f) => f.child);
}

export function shutdownForwarders(children: ChildProcess[]): void {
  log.info("Shutting down webhook forwarders...");

  // Mark all as stopped to prevent restarts
  for (const f of forwarders) {
    f.stopped = true;
  }

  // Send SIGTERM to all
  for (const child of children) {
    if (child && !child.killed) {
      try {
        child.kill("SIGTERM");
      } catch {
        // Already dead
      }
    }
  }

  // Force kill after 5s
  setTimeout(() => {
    for (const child of children) {
      if (child && !child.killed) {
        try {
          log.warn(`Force killing forwarder (pid=${child.pid})`);
          child.kill("SIGKILL");
        } catch {
          // Already dead
        }
      }
    }
  }, 5000);
}
