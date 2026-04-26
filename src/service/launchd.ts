import { writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { homedir, userInfo } from "node:os";
import {
  daemonEntryPath,
  nodeBinaryPath,
  launchdPlistPath,
  launchdLogPath,
  launchdLogDir,
  LAUNCHD_LABEL,
} from "./paths.js";
import { parseEnvFile, ensureEnvFile } from "./envfile.js";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function plistContents(): string {
  const node = nodeBinaryPath();
  const entry = daemonEntryPath();
  const path = process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin";
  const log = launchdLogPath();

  // Built-ins always set; user file overrides on conflict.
  const env: Record<string, string> = {
    PATH: path,
    NODE_ENV: "production",
    HOME: homedir(),
    ...parseEnvFile(),
  };

  const envEntries = Object.entries(env)
    .map(
      ([k, v]) =>
        `        <key>${escapeXml(k)}</key>\n        <string>${escapeXml(v)}</string>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${escapeXml(LAUNCHD_LABEL)}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${escapeXml(node)}</string>
        <string>${escapeXml(entry)}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
        <key>Crashed</key>
        <true/>
    </dict>
    <key>WorkingDirectory</key>
    <string>${escapeXml(homedir())}</string>
    <key>EnvironmentVariables</key>
    <dict>
${envEntries}
    </dict>
    <key>StandardOutPath</key>
    <string>${escapeXml(log)}</string>
    <key>StandardErrorPath</key>
    <string>${escapeXml(log)}</string>
    <key>ProcessType</key>
    <string>Background</string>
    <!-- launchd's equivalent of systemd's KillMode=process: when the daemon
         exits, don't kill children that share its process group. Keeps tmux
         sessions and any in-flight Claude work alive across restarts. -->
    <key>AbandonProcessGroup</key>
    <true/>
</dict>
</plist>
`;
}

function ensureLaunchctl(): void {
  try {
    execFileSync("launchctl", ["help"], { stdio: "ignore" });
  } catch {
    throw new Error("launchctl not found. april service install requires macOS launchd.");
  }
}

function uid(): number {
  return userInfo().uid;
}

function domain(): string {
  return `gui/${uid()}`;
}

function serviceTarget(): string {
  return `${domain()}/${LAUNCHD_LABEL}`;
}

export function install(): void {
  ensureLaunchctl();

  // Seed env file so it's discoverable; values are parsed and inlined into the plist below.
  ensureEnvFile();

  mkdirSync(launchdLogDir(), { recursive: true });
  const path = launchdPlistPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, plistContents(), "utf-8");

  // bootout (ignore failure if not loaded), then bootstrap.
  spawnSync("launchctl", ["bootout", serviceTarget()], { stdio: "ignore" });
  const res = spawnSync("launchctl", ["bootstrap", domain(), path], { encoding: "utf-8" });
  if ((res.status ?? 1) !== 0) {
    throw new Error(`launchctl bootstrap failed: ${res.stderr ?? ""}`);
  }

  spawnSync("launchctl", ["enable", serviceTarget()], { stdio: "ignore" });
  spawnSync("launchctl", ["kickstart", "-k", serviceTarget()], { stdio: "ignore" });

  console.log(`✓ Installed ${path}`);
  console.log(`✓ Service loaded and started`);
  console.log(`  Logs: ${launchdLogPath()}`);
}

export function uninstall(): void {
  ensureLaunchctl();

  const path = launchdPlistPath();
  spawnSync("launchctl", ["bootout", serviceTarget()], { stdio: "ignore" });

  if (existsSync(path)) {
    unlinkSync(path);
    console.log(`✓ Removed ${path}`);
  }
  console.log(`✓ Service uninstalled`);
}

export function start(): void {
  const res = spawnSync("launchctl", ["kickstart", serviceTarget()], { encoding: "utf-8" });
  if ((res.status ?? 1) !== 0) throw new Error(`launchctl kickstart failed: ${res.stderr ?? ""}`);
}

export function stop(): void {
  // `kill` sends a signal to the running instance without unloading.
  const res = spawnSync("launchctl", ["kill", "SIGTERM", serviceTarget()], { encoding: "utf-8" });
  if ((res.status ?? 1) !== 0) throw new Error(`launchctl kill failed: ${res.stderr ?? ""}`);
}

export function restart(): void {
  const res = spawnSync("launchctl", ["kickstart", "-k", serviceTarget()], { encoding: "utf-8" });
  if ((res.status ?? 1) !== 0) throw new Error(`launchctl kickstart -k failed: ${res.stderr ?? ""}`);
}

export function status(): number {
  const res = spawnSync("launchctl", ["print", serviceTarget()], { stdio: "inherit" });
  return res.status ?? 1;
}

export function logs(follow: boolean, lines: number): number {
  const log = launchdLogPath();
  if (!existsSync(log)) {
    console.log(`(no log file at ${log} yet — service may not have started)`);
    return 0;
  }
  const args = ["-n", String(lines)];
  if (follow) args.push("-f");
  args.push(log);
  const res = spawnSync("tail", args, { stdio: "inherit" });
  return res.status ?? 1;
}
