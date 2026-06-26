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
 *
 * Hardening (see injectPrompt): rather than fire-and-hope, we read the pane back
 * and use herdr's own agent_status to verify each step, because two misfires
 * recur in practice:
 *   1. Empty input box. A Claude startup screen (new-model / "what's new"
 *      notice, trust prompt) is up when we type, so the send_text burst is
 *      swallowed and the prompt never lands. We detect this by reading the pane
 *      back; if our text isn't there, an Enter dismisses the screen and we
 *      retype.
 *   2. Prompt typed but never sent. The submitting Enter is absorbed into the
 *      paste burst as a literal newline. We detect this via agent_status (it
 *      stays `idle`) and resend Enter without retyping.
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
const INJECT_ATTEMPTS = 4;

/** Read a pane's current agent status (undefined if unavailable). */
async function paneStatus(paneId: string): Promise<AgentStatus | undefined> {
  const res = await herdrRequest<{ pane?: { agent_status?: AgentStatus } }>("pane.get", { pane_id: paneId });
  return res.pane?.agent_status;
}

/** A status that means the agent left the input box and picked up the prompt. */
function isAccepted(status: AgentStatus | undefined): boolean {
  return status !== undefined && status !== "idle" && status !== "unknown";
}

const normalizeWhitespace = (text: string): string => text.replace(/\s+/g, " ");

/**
 * A short, wrap-safe slice of the prompt to look for in the pane's input box.
 * Kept brief (and whitespace-normalized) so terminal wrapping or the `❯ `
 * prefix don't break the substring match against what pane.read returns.
 */
function promptSignature(prompt: string): string {
  return normalizeWhitespace(prompt).trim().slice(0, 24);
}

/** Visible (on-screen) text of a pane; "" if it can't be read. */
async function readVisible(paneId: string): Promise<string> {
  try {
    const res = await herdrRequest<{ read?: { text?: string } }>("pane.read", {
      pane_id: paneId,
      source: "visible",
    });
    return res.read?.text ?? "";
  } catch {
    // transient; treat as "can't confirm"
    return "";
  }
}

/** Whether our prompt text currently appears in the pane (i.e. the input box). */
async function promptIsVisible(paneId: string, signature: string): Promise<boolean> {
  if (!signature) return true;
  return normalizeWhitespace(await readVisible(paneId)).includes(signature);
}

/**
 * Wait for the agent to leave `idle` — confirmation that the Enter submitted
 * and the agent picked up the prompt. `working`/`blocked`/`done` all mean the
 * prompt was accepted; staying `idle` means it's still sitting in the input box.
 */
async function confirmSubmitted(paneId: string, attempts = 6, intervalMs = 500): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    try {
      if (isAccepted(await paneStatus(paneId))) return true;
    } catch {
      // transient; keep polling
    }
    await delay(intervalMs);
  }
  return false;
}

/**
 * Inject the prompt and verify the agent actually picked it up, retrying around
 * the two misfires documented in the header. Returns the agent status when we
 * stop so the caller can log the outcome.
 *
 * The loop is self-correcting: each pass first checks whether the agent is
 * already working (a prior Enter landed even if its confirm timed out — never
 * retype into a running agent), then ensures the text is in the box (typing it
 * only if absent, so retries can't duplicate it), then submits and confirms.
 *
 * Once we have submitted (sent Enter on text we confirmed was in the box), the
 * prompt must never be re-typed. A slow agent can still read as `idle` when a
 * retry begins while having already consumed the input — so the box reads empty
 * not because the prompt was lost, but because the agent took it. Re-typing
 * there delivers the prompt twice; the `submitted` flag below prevents it.
 */
async function injectPrompt(paneId: string, prompt: string): Promise<AgentStatus | undefined> {
  const signature = promptSignature(prompt);
  let submitted = false;

  for (let attempt = 1; attempt <= INJECT_ATTEMPTS; attempt++) {
    const status = await paneStatus(paneId).catch(() => undefined);
    if (isAccepted(status)) {
      if (attempt > 1) log.info(`Agent in pane ${paneId} accepted the prompt (status: ${status})`);
      return status;
    }

    const visible = await promptIsVisible(paneId, signature);

    // We already submitted and the prompt has since left the input box → the
    // agent consumed it; its status simply hasn't flipped off `idle` yet. Never
    // re-type into an agent that already took the prompt. Give the status one
    // more window to catch up, then report whatever we see.
    if (submitted && !visible) {
      log.info(`Prompt left the input box in pane ${paneId} after submit (attempt ${attempt}/${INJECT_ATTEMPTS}); agent consumed it, waiting for status to catch up`);
      await confirmSubmitted(paneId);
      return paneStatus(paneId).catch(() => undefined);
    }

    // 1. Ensure our text is in the input box — type it only if it isn't there,
    //    so a retry after a failed submit doesn't append a second copy.
    if (!visible) {
      await herdrRequest("pane.send_text", { pane_id: paneId, text: prompt });
      await delay(SUBMIT_SETTLE_MS);

      // 2. Still not there → a Claude startup screen ate the burst. Dismiss it
      //    with Enter and loop to retype. (That Enter may instead have submitted
      //    real text on a flaky read, so re-check status before retrying.)
      if (!(await promptIsVisible(paneId, signature))) {
        log.warn(`Prompt text not visible in pane ${paneId} input (attempt ${attempt}/${INJECT_ATTEMPTS}); dismissing startup screen and retrying`);
        await herdrRequest("pane.send_keys", { pane_id: paneId, keys: ["Enter"] });
        await delay(SUBMIT_SETTLE_MS);
        const dismissed = await paneStatus(paneId).catch(() => undefined);
        if (isAccepted(dismissed)) return dismissed;
        continue;
      }
    }

    // 3. Text is in the box — submit it and confirm via agent_status. From here
    //    on the prompt is committed: mark it submitted so no later pass retypes.
    await herdrRequest("pane.send_keys", { pane_id: paneId, keys: ["Enter"] });
    submitted = true;
    if (await confirmSubmitted(paneId)) {
      const accepted = await paneStatus(paneId).catch(() => undefined);
      log.info(`Prompt submitted to pane ${paneId} on attempt ${attempt} (status: ${accepted ?? "unknown"})`);
      return accepted;
    }
    log.warn(`Agent in pane ${paneId} still idle after Enter (attempt ${attempt}/${INJECT_ATTEMPTS}); will retry`);
  }

  return paneStatus(paneId).catch(() => undefined);
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

    // Wait until the agent is up, then inject the prompt and verify it landed.
    await waitForAgentReady(paneId);
    const status = await injectPrompt(paneId, prompt);
    if (isAccepted(status)) {
      log.info(`Prompt delivered to herdr workspace "${name}" — agent is ${status} (pane ${paneId})`);
    } else {
      log.error(
        `Prompt may NOT have been accepted in herdr workspace "${name}" — agent status "${status ?? "unavailable"}" after ${INJECT_ATTEMPTS} attempts (pane ${paneId}). The session likely needs manual attention.`
      );
    }
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
