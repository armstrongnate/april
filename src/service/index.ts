import * as systemd from "./systemd.js";
import * as launchd from "./launchd.js";

export interface ServiceBackend {
  install: () => void;
  uninstall: () => void;
  start: () => void;
  stop: () => void;
  restart: () => void;
  status: () => number;
  logs: (follow: boolean, lines: number) => number;
  serviceFile: () => string;
}

const systemdBackend: ServiceBackend = { ...systemd, serviceFile: systemd.unitContents };
const launchdBackend: ServiceBackend = { ...launchd, serviceFile: launchd.plistContents };

export function backend(): ServiceBackend {
  if (process.platform === "linux") return systemdBackend;
  if (process.platform === "darwin") return launchdBackend;
  throw new Error(
    `Unsupported platform: ${process.platform}. april service supports linux (systemd) and macOS (launchd) only.`
  );
}
