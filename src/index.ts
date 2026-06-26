import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { createLogger } from "./logger.js";
import { loadConfig } from "./config.js";
import { handleNewIssue, fetchOpenIssues, isIssueActive, getActiveCounts } from "./spawner.js";
import { watchedRepos } from "./work.js";
import { startServer } from "./server.js";
import { startWebhookForwarders, shutdownForwarders } from "./processes.js";
import type { ChildProcess } from "node:child_process";
import type { FastifyInstance } from "fastify";

const log = createLogger("main");

const PID_PATH = join(homedir(), ".config", "april", "april.pid");

function readVersion(): string {
  try {
    // dist/index.js -> package root
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    return JSON.parse(readFileSync(join(root, "package.json"), "utf-8")).version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function checkPidFile(): void {
  if (!existsSync(PID_PATH)) return;

  try {
    const pid = parseInt(readFileSync(PID_PATH, "utf-8").trim(), 10);
    if (Number.isNaN(pid)) return;

    try {
      process.kill(pid, 0);
      log.warn(`Another april instance may be running (pid=${pid}). Proceeding anyway.`);
    } catch {
      log.debug("Stale PID file found, removing");
    }
  } catch {
    // Can't read PID file, ignore
  }
}

function writePidFile(): void {
  const dir = dirname(PID_PATH);
  mkdirSync(dir, { recursive: true });
  writeFileSync(PID_PATH, String(process.pid), "utf-8");
}

function removePidFile(): void {
  try {
    unlinkSync(PID_PATH);
  } catch {
    // Ignore
  }
}

async function main(): Promise<void> {
  console.log("");
  console.log(`  april v${readVersion()}`);
  console.log("");

  // 1. Load config
  const config = loadConfig();

  // 2. PID file check
  checkPidFile();
  writePidFile();

  // 3. Reconcile missed issues
  for (const repo of watchedRepos(config)) {
    log.info(`Checking for missed issues in ${repo.owner}/${repo.name}...`);
    const openIssues = fetchOpenIssues(repo, config);

    for (const issue of openIssues) {
      if (!(await isIssueActive(repo, issue.number, config))) {
        log.info(`Found missed issue: #${issue.number} — "${issue.title}"`);
        await handleNewIssue(repo, issue, config);
      }
    }
  }

  // 4. Start HTTP server
  const onNewIssue = async (result: { repo: typeof config.repos[number]; issue: { number: number; title: string } }) => {
    await handleNewIssue(result.repo, result.issue, config);
  };

  let server: FastifyInstance;
  try {
    server = await startServer(config, onNewIssue);
  } catch (err) {
    log.error(`Failed to start server: ${err instanceof Error ? err.message : String(err)}`);
    removePidFile();
    process.exit(1);
  }

  // 5. Start webhook forwarders
  const children: ChildProcess[] = startWebhookForwarders(config);

  // Print startup banner
  const { worktrees, sessions } = await getActiveCounts(config);
  const repoList = watchedRepos(config).map((r) => `${r.owner}/${r.name}`).join(", ");
  const investigateOnly = config.repos.filter((r) => !r.watch);

  console.log(`  Assignee: ${config.assignee}`);
  console.log(`  Label: ${config.label}`);
  console.log(`  Repos: ${repoList}`);
  if (investigateOnly.length > 0) {
    console.log(`  Investigate-only: ${investigateOnly.map((r) => `${r.owner}/${r.name}`).join(", ")}`);
  }
  console.log(`  Session manager: ${config.sessionManager ?? "tmux"}`);
  console.log(`  Active: ${worktrees} worktree${worktrees === 1 ? "" : "s"}, ${sessions} session${sessions === 1 ? "" : "s"}`);
  console.log(`  Server: http://localhost:${config.port}`);
  console.log(`  Forwarders: ${children.length} active`);
  console.log("");

  // 6. Graceful shutdown
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`Received ${signal}, shutting down...`);

    shutdownForwarders(children);

    try {
      await server.close();
      log.info("Server closed");
    } catch {
      // Ignore
    }

    removePidFile();
    log.info("Goodbye");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  removePidFile();
  process.exit(1);
});
