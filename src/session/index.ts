import type { Config } from "../types.js";
import type { SessionBackend } from "./types.js";
import { tmuxBackend } from "./tmux.js";
import { herdrBackend } from "./herdr.js";

/**
 * Pick the session backend for this install. Defaults to tmux so existing
 * configs keep working unchanged.
 */
export function getSessionBackend(config: Config): SessionBackend {
  switch (config.sessionManager) {
    case "herdr":
      return herdrBackend;
    case "tmux":
    default:
      return tmuxBackend;
  }
}

export type { SessionBackend, SpawnOptions } from "./types.js";
export type { SessionManagerKind } from "../types.js";
