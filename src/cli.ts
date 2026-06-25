#!/usr/bin/env node
import { backend } from "./service/index.js";
import { run as runInit } from "./commands/init.js";
import { run as runUpgrade } from "./commands/upgrade.js";
import { run as runInstallSkill } from "./commands/install-skill.js";
import { run as runConfig } from "./commands/config.js";
import { run as runDoctor } from "./commands/doctor.js";
import { run as runPs } from "./commands/ps.js";
import { run as runRunIssue } from "./commands/run-issue.js";
import { run as runCancel } from "./commands/cancel.js";
import { run as runKill } from "./commands/kill.js";
import { run as runClean } from "./commands/clean.js";
import { run as runInvestigate } from "./commands/investigate.js";

const HELP = `april — issue worker

Usage:
  april <command> [options]

Setup:
  init              Copy bundled config, skills, and env file if missing.
  install [--print] Install and start the user service. --print emits the unit/plist to stdout instead.
  install-skill [-y] Install or refresh the bundled skills. Prompts before overwriting a changed
                    one; --yes (-y) skips the prompt.
  upgrade [VER]     Upgrade the npm package, regenerate the unit, restart, and reconcile the skills.
                    VER defaults to "latest". --with npm|pnpm|yarn overrides the package manager.
  uninstall         Stop and remove the user service

Service lifecycle:
  start             Start the service
  stop              Stop the service
  restart           Restart the service
  status            Show service status
  logs [-f] [-n N]  Show service logs (-f to follow, -n lines, default 100)
  daemon            Run april in the foreground (used by the service; rarely invoked directly)

Runtime:
  ps [--json]       List active work (issues in flight + investigations).
  config [--path|--validate|--json]
                    Print/validate the resolved config.
  doctor            Check prereqs and health (config, tools, gh auth, repos, service, daemon).

Work:
  run <issue>       Manually start work on an issue (123 or owner/name#123). --repo to disambiguate.
  cancel <issue>    Stop an issue's work (kill session + remove worktree). --requeue re-adds agent:todo.
  kill <slug|issue> Kill one session (incl. investigations). --worktree also removes the worktree.
  clean [--force]   Prune orphaned worktrees (closed issue, no open PR). Dry run unless --force.
  investigate, inv "<problem>" [--repo O/N] [--auto]
                    Dispatch a research agent in the current dir to investigate a problem and file
                    a GitHub issue. Deferred (review) by default; --auto labels it for pickup.

Meta:
  help              Show this help
  version           Show version

Notes:
  Nothing is ever overwritten silently. To reset config, delete ~/.config/april/config.yaml
  and re-run init. To refresh skills, use install-skill (it prompts before overwriting).
`;

function parseLogsArgs(args: string[]): { follow: boolean; lines: number } {
  let follow = false;
  let lines = 100;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-f" || a === "--follow") {
      follow = true;
    } else if (a === "-n" || a === "--lines") {
      const v = args[i + 1];
      if (!v) throw new Error(`${a} requires a value`);
      const n = parseInt(v, 10);
      if (Number.isNaN(n) || n < 0) throw new Error(`${a} value must be a non-negative integer`);
      lines = n;
      i++;
    } else if (/^-n\d+$/.test(a)) {
      lines = parseInt(a.slice(2), 10);
    } else {
      throw new Error(`unknown option: ${a}`);
    }
  }
  return { follow, lines };
}

async function readVersion(): Promise<string> {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, resolve } = await import("node:path");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf-8"));
  return pkg.version;
}

async function main(): Promise<number> {
  const [, , cmd, ...rest] = process.argv;

  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    console.log(HELP);
    return 0;
  }

  if (cmd === "version" || cmd === "--version" || cmd === "-v") {
    console.log(await readVersion());
    return 0;
  }

  if (cmd === "init") {
    return runInit(rest);
  }

  if (cmd === "upgrade") {
    return runUpgrade(rest);
  }

  if (cmd === "install-skill") {
    return await runInstallSkill(rest);
  }

  if (cmd === "config") {
    return runConfig(rest);
  }

  if (cmd === "doctor") {
    return await runDoctor(rest);
  }

  if (cmd === "ps") {
    return await runPs(rest);
  }

  if (cmd === "run") {
    return await runRunIssue(rest);
  }

  if (cmd === "cancel") {
    return await runCancel(rest);
  }

  if (cmd === "kill") {
    return await runKill(rest);
  }

  if (cmd === "clean") {
    return await runClean(rest);
  }

  if (cmd === "investigate" || cmd === "inv") {
    return await runInvestigate(rest);
  }

  if (cmd === "daemon") {
    // Run the long-running process inline. Importing index.js triggers main();
    // we then hang forever and let its SIGINT/SIGTERM handlers terminate the process.
    await import("./index.js");
    await new Promise<void>(() => {});
    return 0; // unreachable
  }

  // Service commands
  const svc = backend();

  switch (cmd) {
    case "install":
      if (rest.includes("--print")) {
        process.stdout.write(svc.serviceFile());
        return 0;
      }
      svc.install();
      return 0;
    case "uninstall":
      svc.uninstall();
      return 0;
    case "start":
      svc.start();
      console.log("✓ Started");
      return 0;
    case "stop":
      svc.stop();
      console.log("✓ Stopped");
      return 0;
    case "restart":
      svc.restart();
      console.log("✓ Restarted");
      return 0;
    case "status":
      return svc.status();
    case "logs": {
      const { follow, lines } = parseLogsArgs(rest);
      return svc.logs(follow, lines);
    }
    default:
      console.error(`Unknown command: ${cmd}`);
      console.error(HELP);
      return 2;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
