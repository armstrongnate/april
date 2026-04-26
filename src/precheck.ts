import { execFileSync } from "node:child_process";

export const REQUIRED_GH_EXTENSION = "cli/gh-webhook";
export const GH_EXTENSION_INSTALL_CMD = `gh extension install ${REQUIRED_GH_EXTENSION}`;

export function isGhWebhookExtensionInstalled(): boolean {
  try {
    const out = execFileSync("gh", ["extension", "list"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
    });
    // `gh extension list` output includes the extension repo (e.g. cli/gh-webhook)
    // somewhere in each row; substring match is sufficient.
    return out.includes(REQUIRED_GH_EXTENSION);
  } catch {
    return false;
  }
}
