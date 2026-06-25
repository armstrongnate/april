import { findConfigPath, parseConfigFile } from "../config.js";
import { listActiveWork, type WorkItem } from "../work.js";
import { daemonStatus } from "../daemon.js";

const USAGE = `april ps [--json]

  List active work — issues in flight and investigations — derived from
  worktrees and live sessions. Works whether or not the daemon is running.`;

function fmtUptime(seconds: number): string {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h${m}m`;
  if (m > 0) return `${m}m${s % 60}s`;
  return `${s}s`;
}

function renderTable(items: WorkItem[]): void {
  const header = ["KIND", "ISSUE", "SESSION", "REPO", "SLUG"];
  const rows = items.map((it) => [
    it.kind === "investigation" ? "investigate" : "issue",
    it.issueNumber ? `#${it.issueNumber}` : "-",
    it.sessionAlive ? "live" : "stale",
    it.repo ?? "-",
    it.slug,
  ]);

  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length))
  );
  const fmt = (cols: string[]) => cols.map((c, i) => c.padEnd(widths[i])).join("  ").trimEnd();

  console.log(fmt(header));
  for (const r of rows) console.log(fmt(r));
}

export async function run(args: string[]): Promise<number> {
  const wantJson = args.includes("--json");
  for (const a of args) {
    if (a !== "--json") {
      console.error(`Unknown option: ${a}\n\n${USAGE}`);
      return 2;
    }
  }

  let config;
  try {
    config = parseConfigFile(findConfigPath());
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  const items = await listActiveWork(config);
  const status = await daemonStatus(config.port);

  if (wantJson) {
    console.log(JSON.stringify({ daemon: status, work: items }, null, 2));
    return 0;
  }

  if (status) {
    const fw = status.forwarders;
    const liveFw = fw.filter((f) => f.alive).length;
    console.log(
      `daemon: up (${fmtUptime(status.uptime)}), ${liveFw}/${fw.length} forwarder${fw.length === 1 ? "" : "s"} live`
    );
  } else {
    console.log(`daemon: not reachable on :${config.port}`);
  }
  console.log("");

  if (items.length === 0) {
    console.log("No active work.");
    return 0;
  }
  renderTable(items);
  return 0;
}
