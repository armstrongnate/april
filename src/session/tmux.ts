import { execSync } from "node:child_process";
import { createLogger } from "../logger.js";
import type { SessionBackend, SpawnOptions } from "./types.js";

const log = createLogger("session:tmux");

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * tmux backend. This is april's current behavior, lifted verbatim out of
 * spawner.ts and behind the SessionBackend contract. Default backend, so
 * existing installs are unaffected.
 */
export const tmuxBackend: SessionBackend = {
  async listSessions(): Promise<string[]> {
    try {
      const output = execSync("tmux list-sessions -F '#{session_name}'", {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      return output.trim().split("\n").filter(Boolean);
    } catch {
      // tmux not running or no sessions
      return [];
    }
  },

  async hasSession(name: string): Promise<boolean> {
    try {
      execSync(`tmux has-session -t ${JSON.stringify(name)}`, { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  },

  async spawn({ name, cwd, command, prompt }: SpawnOptions): Promise<void> {
    if (await this.hasSession(name)) {
      log.info(`tmux session "${name}" already exists, skipping`);
      return;
    }

    execSync(
      `tmux new-session -d -s ${JSON.stringify(name)} -c ${JSON.stringify(cwd)} ${JSON.stringify(command)}`
    );

    // Send text first, then Enter after a short delay so the agent's input is ready.
    const escapedPrompt = prompt.replace(/'/g, "'\\''");
    const session = JSON.stringify(name);
    await delay(3000);
    execSync(`tmux send-keys -t ${session} '${escapedPrompt}'`, { stdio: "pipe" });
    await delay(1000);
    execSync(`tmux send-keys -t ${session} C-m`, { stdio: "pipe" });
    log.info(`Prompt sent to tmux session "${name}"`);
  },

  async kill(name: string): Promise<void> {
    try {
      execSync(`tmux kill-session -t ${JSON.stringify(name)}`, { stdio: "pipe" });
      log.info(`Killed tmux session ${name}`);
    } catch {
      // Session already gone — fine
    }
  },
};
