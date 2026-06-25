/**
 * Tiny client for the running daemon's HTTP endpoints. Used by `ps`/`doctor`
 * to enrich their output when the daemon is up; every caller treats `null`
 * (daemon down/unreachable) as a normal, non-error condition.
 */

export interface DaemonStatus {
  uptime: number;
  assignee: string;
  label: string;
  sessionManager: string;
  repos: string[];
  active: { worktrees: number; sessions: number };
  forwarders: { repoKey: string; alive: boolean; consecutiveFailures: number }[];
}

async function getJson<T>(url: string, timeoutMs = 1500): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function daemonStatus(port: number): Promise<DaemonStatus | null> {
  return getJson<DaemonStatus>(`http://127.0.0.1:${port}/status`);
}

export async function daemonReachable(port: number): Promise<boolean> {
  return (await getJson<{ status: string }>(`http://127.0.0.1:${port}/health`)) !== null;
}
