import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { compareSkill, SKILL_DST } from "./init.js";

const PACKAGE = "@armstrongnate/april";

type PackageManager = "npm" | "pnpm" | "yarn";

function detectPackageManager(): PackageManager {
  // Where this script lives reveals which global install dir it's in.
  const here = fileURLToPath(import.meta.url);
  if (/[\\/]\.?pnpm[\\/]|[\\/]Library[\\/]pnpm[\\/]/.test(here)) return "pnpm";
  if (/[\\/]\.config[\\/]yarn[\\/]|[\\/]\.yarn[\\/]/.test(here)) return "yarn";
  return "npm";
}

function pmInstallArgs(pm: PackageManager, ref: string): string[] {
  switch (pm) {
    case "pnpm":
      return ["add", "-g", ref];
    case "yarn":
      return ["global", "add", ref];
    case "npm":
      return ["install", "-g", ref];
  }
}

function step(name: string, cmd: string, args: string[]): void {
  console.log(`\n→ ${name}`);
  console.log(`  $ ${cmd} ${args.join(" ")}`);
  const res = spawnSync(cmd, args, { stdio: "inherit" });
  if ((res.status ?? 1) !== 0) {
    throw new Error(`${name} failed (exit ${res.status})`);
  }
}

export function run(args: string[]): number {
  let pm: PackageManager = detectPackageManager();

  // --with <pm> override
  const withIdx = args.indexOf("--with");
  if (withIdx >= 0) {
    const v = args[withIdx + 1];
    if (v !== "npm" && v !== "pnpm" && v !== "yarn") {
      console.error(`--with must be one of: npm, pnpm, yarn`);
      return 2;
    }
    pm = v;
  }

  let ref = `${PACKAGE}@latest`;
  // Allow `april upgrade <version>` to pin
  const positional = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--with");
  if (positional[0]) ref = `${PACKAGE}@${positional[0]}`;

  console.log(`april upgrade — using ${pm}, target ${ref}`);

  step(`Installing ${ref}`, pm, pmInstallArgs(pm, ref));

  // From here on, `april` resolves to the freshly installed binary on PATH.
  step("Regenerating service unit (april install)", "april", ["install"]);
  step("Restarting service (april restart)", "april", ["restart"]);

  console.log("\n✓ Upgrade complete. Tail logs with: april logs -f");

  // Skill notice — never auto-overwrite, but tell the user where they stand.
  const state = compareSkill();
  if (state === "missing") {
    console.log(`\nNote: issue-worker skill not found at ${SKILL_DST}. Run \`april init\` to install it.`);
  } else if (state === "differs-from-bundled") {
    console.log(
      `\nNote: bundled issue-worker skill differs from the one at ${SKILL_DST}.\n` +
        `      This may be the upgrade's new version or your own customization.\n` +
        `      To overwrite with the bundled version: april init --force`
    );
  }

  return 0;
}
