import { readFileSync } from "node:fs";
import { join } from "node:path";
import { call, type Snapshot } from "./herdr";

/** The pids of a pane's foreground Claude Code processes, as herdr's pane.process_info sees them. */
export function herdrProcesses(socketPath: string) {
  return async (pane: string): Promise<number[]> => {
    const info = await call<{ process_info?: { foreground_processes?: { pid?: number; name?: string }[] } }>(
      socketPath,
      "pane.process_info",
      { pane_id: pane },
    );
    return (info.process_info?.foreground_processes ?? [])
      .filter((p) => p.name === "claude" && Number.isInteger(p.pid))
      .map((p) => p.pid!);
  };
}

/**
 * Which conversation each pane's own Claude Code is in, read from the process itself rather than from what
 * herdr was last told.
 *
 * herdr learns a pane's session from a SessionStart hook, and that hook runs in every Claude Code the pane's
 * environment reaches — an unattended `claude -p` job started from the pane carries its HERDR_PANE_ID and
 * reports its own session there, so the pane would show the job's conversation instead of the person's
 * (measured 2026-10-17: eight auto-mode jobs, all reporting to the pane that started the plan). The pane's
 * foreground process is the person's Claude Code, and Claude Code keeps ~/.claude/sessions/<pid>.json with
 * the session it is in now — rewritten by /clear — and whether it is interactive.
 */
export class LiveSessions {
  private pids = new Map<string, { at: number; pids: number[] }>();

  constructor(
    private processes: (pane: string) => Promise<number[]>,
    private sessionsDir: string,
    private pidTtlMs = 10_000,
  ) {}

  /** The snapshot with each Claude pane's session taken from its foreground process, where one can be read. */
  async apply(snap: Snapshot): Promise<Snapshot> {
    const agents = await Promise.all(
      snap.agents.map(async (a) => {
        if (a.kind !== "claude") return a;
        const live = await this.sessionOf(a.pane).catch(() => null);
        return live && live !== a.sessionId ? { ...a, sessionId: live } : a;
      }),
    );
    return { ...snap, agents };
  }

  private async sessionOf(pane: string): Promise<string | null> {
    const now = Date.now();
    let hit = this.pids.get(pane);
    if (!hit || now - hit.at > this.pidTtlMs) {
      hit = { at: now, pids: await this.processes(pane) };
      this.pids.set(pane, hit);
    }
    // The file is read each time (it is small): /clear changes the session without changing the process.
    for (const pid of hit.pids) {
      const session = readSessionFile(join(this.sessionsDir, `${pid}.json`));
      if (session) return session;
    }
    return null;
  }
}

/** The session an interactive Claude Code process is in, from its ~/.claude/sessions/<pid>.json. */
export function readSessionFile(path: string): string | null {
  try {
    const v = JSON.parse(readFileSync(path, "utf8")) as { sessionId?: unknown; kind?: unknown };
    if (v.kind !== "interactive" || typeof v.sessionId !== "string") return null;
    return /^[0-9a-f-]{36}$/.test(v.sessionId) ? v.sessionId : null;
  } catch {
    return null;
  }
}
