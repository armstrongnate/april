import { writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { homedir } from "node:os";
import {
  daemonEntryPath,
  nodeBinaryPath,
  systemdUnitPath,
  SERVICE_NAME,
} from "./paths.js";
import { envFilePath, ensureEnvFile } from "./envfile.js";

function runSystemctl(args: string[]): { status: number; stdout: string; stderr: string } {
  const res = spawnSync("systemctl", ["--user", ...args], { encoding: "utf-8" });
  return {
    status: res.status ?? 1,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

export function unitContents(): string {
  const node = nodeBinaryPath();
  const entry = daemonEntryPath();
  // Capture caller's PATH so child has access to gh, tmux, git, claude.
  const path = process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin";

  return `[Unit]
Description=april — issue worker
After=network.target

[Service]
Type=simple
ExecStart=${node} ${entry}
Restart=on-failure
RestartSec=5s
WorkingDirectory=${homedir()}
Environment=PATH=${path}
Environment=NODE_ENV=production
EnvironmentFile=-${envFilePath()}
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
`;
}

function ensureSystemctlPresent(): void {
  try {
    execFileSync("systemctl", ["--version"], { stdio: "ignore" });
  } catch {
    throw new Error("systemctl not found on PATH. april service install requires systemd.");
  }
}

function lingerEnabled(): boolean {
  try {
    const out = execFileSync("loginctl", ["show-user", process.env.USER ?? ""], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return /Linger=yes/i.test(out);
  } catch {
    return false;
  }
}

export function install(): void {
  ensureSystemctlPresent();

  // Seed env file so EnvironmentFile=- has something to find on first install.
  ensureEnvFile();

  const path = systemdUnitPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, unitContents(), "utf-8");

  let res = runSystemctl(["daemon-reload"]);
  if (res.status !== 0) throw new Error(`systemctl daemon-reload failed: ${res.stderr}`);

  res = runSystemctl(["enable", "--now", SERVICE_NAME]);
  if (res.status !== 0) throw new Error(`systemctl enable --now ${SERVICE_NAME} failed: ${res.stderr}`);

  console.log(`✓ Installed ${path}`);
  console.log(`✓ Service enabled and started`);

  if (!lingerEnabled()) {
    console.log("");
    console.log("⚠  Linger is not enabled for your user. Without it, april will stop when");
    console.log("   you log out (e.g., end your SSH session). To keep it running:");
    console.log("");
    console.log(`     sudo loginctl enable-linger ${process.env.USER ?? "$USER"}`);
    console.log("");
  }
}

export function uninstall(): void {
  ensureSystemctlPresent();

  runSystemctl(["disable", "--now", SERVICE_NAME]);

  const path = systemdUnitPath();
  if (existsSync(path)) {
    unlinkSync(path);
    console.log(`✓ Removed ${path}`);
  }

  runSystemctl(["daemon-reload"]);
  console.log(`✓ Service uninstalled`);
}

export function start(): void {
  const res = runSystemctl(["start", SERVICE_NAME]);
  if (res.status !== 0) throw new Error(`systemctl start failed: ${res.stderr}`);
}

export function stop(): void {
  const res = runSystemctl(["stop", SERVICE_NAME]);
  if (res.status !== 0) throw new Error(`systemctl stop failed: ${res.stderr}`);
}

export function restart(): void {
  const res = runSystemctl(["restart", SERVICE_NAME]);
  if (res.status !== 0) throw new Error(`systemctl restart failed: ${res.stderr}`);
}

export function status(): number {
  // Inherit stdio so the user sees colored systemctl output directly.
  const res = spawnSync("systemctl", ["--user", "status", SERVICE_NAME], { stdio: "inherit" });
  return res.status ?? 1;
}

export function logs(follow: boolean, lines: number): number {
  const args = ["--user", "-u", SERVICE_NAME, "-n", String(lines)];
  if (follow) args.push("-f");
  const res = spawnSync("journalctl", args, { stdio: "inherit" });
  return res.status ?? 1;
}
