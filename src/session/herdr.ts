import { createLogger } from "../logger.js";
import { herdrRequest } from "./herdr-client.js";
import type { SessionBackend, SpawnOptions } from "./types.js";

const log = createLogger("session:herdr");

/*
 * Response shapes verified against herdr 0.6.10 (protocol 13). Notes:
 *   - We launch the agent with agent.start + argv ["sh","-c","exec <cmd>"]: a
 *     NON-interactive shell, so the agent runs as the pane's own process (like
 *     tmux new-session <cmd>). This is deliberate — typing the launch command
 *     into an interactive shell let oh-my-zsh's update prompt eat the first
 *     keystroke ("claude" -> "laude") and the agent never started.
 *   - agent.start places into the focused workspace unless given workspace_id,
 *     so we workspace.create a dedicated labeled workspace first and pass its id.
 *     That create also spawns a root shell pane; we close it so the workspace
 *     holds only the agent. Closing it RENUMBERS the agent pane, so we
 *     re-resolve via pane.list afterward.
 *   - pane.send_keys wants `keys` as an ARRAY (["Enter"]); a bare "Enter"
 *     string is silently dropped (connection closes, nothing submitted).
 *   - The Enter that submits must lag the prompt text by a settle delay.
 *     send_text delivers the prompt as one fast burst; Claude's TUI treats a
 *     burst as a paste, so an Enter arriving inside it is absorbed as a literal
 *     newline instead of submitting. The pause lets the paste close. (Same
 *     reason april's tmux path waits between `send-keys <text>` and C-m.)
 *   - agent-pane content shows under pane.read source "visible", not "recent".
 */
type AgentStatus = "working" | "blocked" | "done" | "idle" | "unknown";

interface Workspace {
  workspace_id: string;
  label?: string;
  agent_status?: AgentStatus;
}
interface PaneRef {
  pane_id: string;
}
interface WorkspaceCreated {
  workspace: Workspace;
  root_pane?: PaneRef;
}
interface AgentInfo {
  pane_id: string;
  workspace_id: string;
  agent_status?: AgentStatus;
}
interface AgentStarted {
  agent: AgentInfo;
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function listWorkspaces(): Promise<Workspace[]> {
  const res = await herdrRequest<{ workspaces?: Workspace[] }>("workspace.list");
  return res.workspaces ?? [];
}

async function findByLabel(name: string): Promise<Workspace | undefined> {
  return (await listWorkspaces()).find((w) => w.label === name);
}

async function listPaneIds(workspaceId: string): Promise<string[]> {
  const res = await herdrRequest<{ panes?: PaneRef[] }>("pane.list", { workspace_id: workspaceId });
  return (res.panes ?? []).map((p) => p.pane_id);
}

/**
 * Best-effort wait until the freshly launched agent is accepting input.
 *
 * This is the herdr-native replacement for april's blind `setTimeout` dance:
 * we poll the pane's agent_status and proceed as soon as it's recognized,
 * falling back to a fixed wait if detection never settles.
 */
async function waitForAgentReady(paneId: string, attempts = 10, intervalMs = 1000): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      const status = await paneStatus(paneId);
      if (status && status !== "unknown") return;
    } catch {
      // transient; keep polling
    }
    await delay(intervalMs);
  }
  log.warn(`Agent in pane ${paneId} never reported a known status; proceeding anyway`);
}

const SUBMIT_SETTLE_MS = 1000;

/** Read a pane's current agent status (undefined if unavailable). */
async function paneStatus(paneId: string): Promise<AgentStatus | undefined> {
  const res = await herdrRequest<{ pane?: { agent_status?: AgentStatus } }>("pane.get", { pane_id: paneId });
  return res.pane?.agent_status;
}

/**
 * Wait for the agent to leave `idle` — confirmation that the Enter submitted
 * and the agent picked up the prompt. `working`/`blocked`/`done` all mean the
 * prompt was accepted; staying `idle` means it's still sitting in the input box.
 */
async function confirmSubmitted(paneId: string, attempts = 6, intervalMs = 500): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    try {
      const status = await paneStatus(paneId);
      if (status && status !== "idle" && status !== "unknown") return true;
    } catch {
      // transient; keep polling
    }
    await delay(intervalMs);
  }
  return false;
}

async function submit(paneId: string, text: string): Promise<void> {
  // send_text writes the raw text; send_keys ["Enter"] submits it as a real
  // key event. The settle delay between them is load-bearing — see the header
  // note: without it the Enter is swallowed by Claude's paste burst and the
  // prompt just sits in the input box (mirrors april's tmux text-then-C-m wait).
  await herdrRequest("pane.send_text", { pane_id: paneId, text });
  await delay(SUBMIT_SETTLE_MS);
  await herdrRequest("pane.send_keys", { pane_id: paneId, keys: ["Enter"] });

  // Confirm via herdr's own agent_status that the prompt was accepted. If the
  // agent is still idle, the Enter didn't take — resend it once. Resending
  // Enter on an already-submitted (empty) input box is a harmless no-op.
  if (await confirmSubmitted(paneId)) return;
  log.warn(`Agent in pane ${paneId} still idle after submit; resending Enter`);
  await herdrRequest("pane.send_keys", { pane_id: paneId, keys: ["Enter"] });
}

export const herdrBackend: SessionBackend = {
  async listSessions(): Promise<string[]> {
    return (await listWorkspaces())
      .map((w) => w.label)
      .filter((l): l is string => typeof l === "string" && l.length > 0);
  },

  async hasSession(name: string): Promise<boolean> {
    return (await findByLabel(name)) !== undefined;
  },

  async spawn({ name, cwd, command, prompt }: SpawnOptions): Promise<void> {
    if (await this.hasSession(name)) {
      log.info(`herdr workspace "${name}" already exists, skipping`);
      return;
    }

    // Create a dedicated labeled workspace for this issue (the slug is our
    // identity key for list/dedupe/kill). It also spawns a root shell pane.
    const created = await herdrRequest<WorkspaceCreated>("workspace.create", { cwd, label: name });
    const workspaceId = created.workspace?.workspace_id;
    if (!workspaceId) {
      throw new Error(`herdr workspace.create for "${name}" returned no workspace id`);
    }

    // Launch the agent as the pane's own process via a non-interactive shell,
    // placed explicitly in our workspace.
    const started = await herdrRequest<AgentStarted>("agent.start", {
      name,
      cwd,
      argv: ["sh", "-c", `exec ${command}`],
      workspace_id: workspaceId,
    });
    let paneId = started.agent?.pane_id;
    if (!paneId) {
      throw new Error(`herdr agent.start for "${name}" returned no pane id`);
    }

    // Drop the idle root shell pane so the workspace holds only the agent.
    // Closing it renumbers the remaining pane, so re-resolve the agent's pane.
    const rootPaneId = created.root_pane?.pane_id;
    if (rootPaneId) {
      try {
        await herdrRequest("pane.close", { pane_id: rootPaneId });
        await delay(300);
        const panes = await listPaneIds(workspaceId);
        if (panes.length === 1) {
          paneId = panes[0];
        } else {
          log.warn(`Expected 1 pane after closing root shell in "${name}", found ${panes.length}; keeping ${paneId}`);
        }
      } catch (err) {
        log.warn(`Could not close root shell pane in "${name}": ${err instanceof Error ? err.message : String(err)}; leaving it`);
      }
    }
    log.info(`Started agent in herdr workspace "${name}" (pane ${paneId})`);

    // Wait until the agent is up, then inject the prompt.
    await waitForAgentReady(paneId);
    await submit(paneId, prompt);
    log.info(`Prompt sent to herdr workspace "${name}"`);
  },

  async kill(name: string): Promise<void> {
    const ws = await findByLabel(name);
    if (!ws) {
      log.debug(`No herdr workspace labeled "${name}"; nothing to kill`);
      return;
    }
    await herdrRequest("workspace.close", { workspace_id: ws.workspace_id });
    log.info(`Closed herdr workspace "${name}"`);
  },
};
