import { stdout } from "node:process";

type LogLevel = "info" | "warn" | "error" | "debug";

const isTTY = stdout.isTTY ?? false;
const isDebug = process.env.APRIL_DEBUG === "1";

const COLORS: Record<LogLevel, string> = {
  info: "\x1b[36m",   // cyan
  warn: "\x1b[33m",   // yellow
  error: "\x1b[31m",  // red
  debug: "\x1b[90m",  // gray
};
const RESET = "\x1b[0m";

function format(level: LogLevel, component: string, message: string): string {
  const ts = new Date().toISOString();
  const tag = `[${level}] [${component}]`;
  if (isTTY) {
    return `${COLORS[level]}${ts} ${tag}${RESET} ${message}`;
  }
  return `${ts} ${tag} ${message}`;
}

export interface Logger {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
  debug: (message: string) => void;
}

export function createLogger(component: string): Logger {
  return {
    info(message: string) {
      console.log(format("info", component, message));
    },
    warn(message: string) {
      console.warn(format("warn", component, message));
    },
    error(message: string) {
      console.error(format("error", component, message));
    },
    debug(message: string) {
      if (isDebug) {
        console.log(format("debug", component, message));
      }
    },
  };
}
