import { hostname } from "node:os";
import { join } from "node:path";

export interface Config {
  /** Loopback address the server binds. 127.0.0.2 by default: WSL forwards 127.0.0.1 listeners to Windows, not 127.0.0.2. */
  host: string;
  port: number;
  /** Tailscale logins let in, lower-cased. */
  owners: string[];
  /** Host names (with :port when not 443) the page is served under; empty accepts any Host. */
  publicHosts: string[];
  socketPath: string;
  transcriptRoots: string[];
  machine: string;
  distDir: string;
}

const LOOPBACK = /^(127\.\d{1,3}\.\d{1,3}\.\d{1,3}|::1)$/;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const home = env.HOME ?? "/root";
  const host = env.HR_HOST ?? "127.0.0.2";
  // Identity comes from the Tailscale-User-Login header, which only `tailscale serve` on this machine sets.
  // Anything that can reach a non-loopback bind could forge it.
  if (!LOOPBACK.test(host)) throw new Error(`HR_HOST must be a loopback address, got ${host}`);
  const port = Number(env.HR_PORT ?? 7420);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`HR_PORT is not a port: ${env.HR_PORT}`);
  const owners = list(env.HR_OWNERS).map((o) => o.toLowerCase());
  if (owners.length === 0) throw new Error("HR_OWNERS is empty: name the Tailscale logins allowed in, comma-separated");
  return {
    host,
    port,
    owners,
    publicHosts: list(env.HR_PUBLIC_HOSTS).map((h) => h.toLowerCase()),
    socketPath: env.HERDR_SOCKET_PATH ?? join(home, ".config/herdr/herdr.sock"),
    transcriptRoots: list(env.HR_TRANSCRIPT_ROOTS ?? join(home, ".claude/projects")),
    machine: env.HR_MACHINE ?? hostname(),
    distDir: env.HR_DIST ?? join(import.meta.dir, "..", "dist"),
  };
}

function list(value: string | undefined): string[] {
  return (value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export function isLoopback(address: string): boolean {
  return address === "::1" || address.startsWith("127.") || address.startsWith("::ffff:127.");
}
