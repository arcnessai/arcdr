import { isLoopback, type Config } from "./config";

export interface RequestFacts {
  method: string;
  /** Peer address of the TCP connection. */
  remote: string | null;
  headers: Headers;
}

export type Verdict = { ok: true; login: string } | { ok: false; status: number; reason: string };

const SAFE_METHODS = new Set(["GET", "HEAD"]);

/**
 * Every request must come from `tailscale serve` on this machine (a loopback peer carrying the
 * Tailscale-User-Login header serve sets) and name an owner. Whoever passes can type into the agents'
 * terminals, which run as this machine's user, so there is no weaker tier.
 */
export function judge(facts: RequestFacts, cfg: Pick<Config, "owners" | "publicHosts">): Verdict {
  if (!facts.remote || !isLoopback(facts.remote)) return deny(403, "only tailscale serve on this machine may connect");

  const login = (facts.headers.get("tailscale-user-login") ?? "").trim().toLowerCase();
  if (!login) return deny(403, "no Tailscale identity: open this through the tailnet address");
  if (!cfg.owners.includes(login)) return deny(403, `${login} is not allowed here`);

  const host = (facts.headers.get("host") ?? "").toLowerCase();
  if (cfg.publicHosts.length > 0 && !cfg.publicHosts.includes(host)) return deny(421, `unexpected host ${host || "(none)"}`);

  if (!SAFE_METHODS.has(facts.method)) {
    const origin = facts.headers.get("origin");
    if (!origin || !sameOrigin(origin, host, cfg.publicHosts)) return deny(403, "write from another origin");
    const site = facts.headers.get("sec-fetch-site");
    if (site && site !== "same-origin") return deny(403, "write from another site");
  }
  return { ok: true, login };
}

function sameOrigin(origin: string, host: string, publicHosts: string[]): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const originHost = url.host.toLowerCase();
  return publicHosts.length > 0 ? publicHosts.includes(originHost) : originHost === host;
}

function deny(status: number, reason: string): Verdict {
  return { ok: false, status, reason };
}
