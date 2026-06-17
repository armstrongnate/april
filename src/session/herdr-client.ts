import { connect } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Minimal client for the herdr socket API.
 *
 * Transport: newline-delimited JSON over a Unix domain socket. Each request is
 * `{ id, method, params }` on one line; the matching response is `{ id, result }`
 * or `{ id, error: { code, message } }`. The server may also emit unrelated
 * event lines (different/absent id), which we skip.
 *
 * Socket resolution mirrors herdr's own order:
 *   HERDR_SOCKET_PATH -> HERDR_SESSION (named) -> default.
 *
 * We open a fresh connection per request. april's call volume is low (a handful
 * of calls per issue), so this trades a negligible amount of overhead for not
 * having to manage a long-lived multiplexed connection or reconnect logic.
 */

function socketPath(): string {
  const explicit = process.env.HERDR_SOCKET_PATH;
  if (explicit) return explicit;

  const sessionName = process.env.HERDR_SESSION;
  if (sessionName) {
    return join(homedir(), ".config", "herdr", "sessions", sessionName, "herdr.sock");
  }

  return join(homedir(), ".config", "herdr", "herdr.sock");
}

interface HerdrResponse {
  id?: string;
  result?: unknown;
  error?: { code: string; message: string };
}

let reqCounter = 0;

export function herdrRequest<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 10_000
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = `april_${++reqCounter}`;
    const sock = connect(socketPath());
    let buf = "";
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.end();
      fn();
    };

    const timer = setTimeout(() => {
      finish(() => reject(new Error(`herdr request "${method}" timed out after ${timeoutMs}ms`)));
    }, timeoutMs);

    sock.on("connect", () => {
      sock.write(JSON.stringify({ id, method, params }) + "\n");
    });

    sock.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf-8");
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;

        let msg: HerdrResponse;
        try {
          msg = JSON.parse(line) as HerdrResponse;
        } catch {
          continue; // not a complete/valid JSON line; ignore
        }

        if (msg.id !== id) continue; // unrelated event or response

        if (msg.error) {
          finish(() => reject(new Error(`herdr ${method}: ${msg.error!.code} — ${msg.error!.message}`)));
        } else {
          finish(() => resolve(msg.result as T));
        }
        return;
      }
    });

    sock.on("error", (err: Error) => {
      finish(() => reject(new Error(`herdr socket error on "${method}": ${err.message}`)));
    });

    sock.on("close", () => {
      finish(() => reject(new Error(`herdr connection closed before "${method}" responded`)));
    });
  });
}
