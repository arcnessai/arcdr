import { createConnection } from "node:net";

export type AgentStatus = "working" | "blocked" | "done" | "idle" | "unknown";

export class HerdrError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

let seq = 0;

/** herdr's socket answers one newline-terminated JSON line per connection, then closes it. */
export function call<T = unknown>(
  socketPath: string,
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 5000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const sock = createConnection(socketPath);
    let buf = "";
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.destroy();
      fn();
    };
    const timer = setTimeout(
      () => finish(() => reject(new HerdrError("timeout", `${method}: no answer in ${timeoutMs} ms`))),
      timeoutMs,
    );
    const settle = (line: string) => {
      let msg: { result?: T; error?: { code?: string; message?: string } };
      try {
        msg = JSON.parse(line);
      } catch {
        return reject(new HerdrError("bad_reply", `${method}: unreadable reply`));
      }
      if (msg.error) return reject(new HerdrError(msg.error.code ?? "error", msg.error.message ?? method));
      resolve(msg.result as T);
    };
    sock.setEncoding("utf8");
    sock.on("connect", () => sock.write(JSON.stringify({ id: `arcdr-${++seq}`, method, params }) + "\n"));
    sock.on("data", (chunk: string) => {
      buf += chunk;
      const nl = buf.indexOf("\n");
      if (nl >= 0) finish(() => settle(buf.slice(0, nl)));
    });
    sock.on("end", () =>
      finish(() =>
        buf.trim() ? settle(buf) : reject(new HerdrError("closed", `${method}: herdr closed the socket without an answer`)),
      ),
    );
    sock.on("error", (e) => finish(() => reject(new HerdrError("unreachable", `herdr socket: ${e.message}`))));
  });
}

export interface Space {
  id: string;
  number: number;
  label: string;
  status: AgentStatus;
  tokens: Record<string, string>;
}

export interface Agent {
  pane: string;
  space: string;
  tab: string;
  tabNumber: number;
  tabLabel: string;
  /** What the pane reported with `report-metadata --title`, else the agent's name. */
  title: string;
  /** The agent's own terminal title — for Claude Code, its name for the conversation. */
  conversation: string;
  status: AgentStatus;
  kind: string;
  tokens: Record<string, string>;
  sessionId: string | null;
  /** Where the agent's process runs; slash commands and @-paths are looked up from here. */
  cwd: string;
}

export interface Snapshot {
  version: string;
  spaces: Space[];
  agents: Agent[];
}

const STATUSES = new Set<AgentStatus>(["working", "blocked", "done", "idle", "unknown"]);

function status(value: unknown): AgentStatus {
  return STATUSES.has(value as AgentStatus) ? (value as AgentStatus) : "unknown";
}

function tokens(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) if (typeof v === "string") out[k] = v;
  }
  return out;
}

export function normalizeSnapshot(raw: any): Snapshot {
  const snap = raw?.snapshot ?? raw ?? {};
  const tabs = new Map<string, { number: number; label: string }>();
  for (const t of snap.tabs ?? []) tabs.set(t.tab_id, { number: Number(t.number) || 0, label: String(t.label ?? "") });

  const spaces: Space[] = (snap.workspaces ?? []).map((w: any) => ({
    id: String(w.workspace_id),
    number: Number(w.number) || 0,
    label: String(w.label ?? w.workspace_id),
    status: status(w.agent_status),
    tokens: tokens(w.tokens),
  }));
  spaces.sort((a, b) => a.number - b.number);

  const agents: Agent[] = (snap.agents ?? []).map((a: any) => {
    const tab = tabs.get(a.tab_id) ?? { number: 0, label: "" };
    const session = a.agent_session;
    return {
      pane: String(a.pane_id),
      space: String(a.workspace_id),
      tab: String(a.tab_id),
      tabNumber: tab.number,
      tabLabel: tab.label,
      title: String(a.title ?? a.agent ?? ""),
      conversation: String(a.terminal_title_stripped ?? ""),
      status: status(a.agent_status),
      kind: String(a.agent ?? "agent"),
      tokens: tokens(a.tokens),
      sessionId: session?.kind === "id" && typeof session.value === "string" ? session.value : null,
      cwd: String(a.foreground_cwd ?? a.cwd ?? ""),
    };
  });
  agents.sort((a, b) => a.tabNumber - b.tabNumber || a.pane.localeCompare(b.pane));

  return { version: String(snap.version ?? ""), spaces, agents };
}

export async function snapshot(socketPath: string): Promise<Snapshot> {
  return normalizeSnapshot(await call(socketPath, "session.snapshot"));
}

export async function readScreen(socketPath: string, pane: string): Promise<string> {
  const r = await call<{ read?: { text?: string } }>(socketPath, "pane.read", {
    pane_id: pane,
    source: "visible",
    format: "text",
  });
  return r.read?.text ?? "";
}

/** Submits text plus Enter the way herdr does for agents (bracketed paste when the terminal wants it). */
export async function prompt(socketPath: string, pane: string, text: string): Promise<void> {
  await call(socketPath, "agent.prompt", { target: pane, text });
}

export async function sendKeys(socketPath: string, pane: string, keys: string[]): Promise<void> {
  await call(socketPath, "pane.send_keys", { pane_id: pane, keys });
}

/** Text then keys in one request, honouring the terminal's bracketed-paste mode (what `herdr pane run` uses). */
export async function sendInput(socketPath: string, pane: string, text: string, keys: string[]): Promise<void> {
  await call(socketPath, "pane.send_input", { pane_id: pane, text, keys });
}

/** A new tab in a space, its shell started in cwd; answers the tab's pane. */
export async function createTab(socketPath: string, space: string, cwd: string, label: string | null): Promise<string> {
  const r = await call<{ root_pane?: { pane_id?: string }; tab?: { root_pane_id?: string; tab_id?: string } }>(
    socketPath,
    "tab.create",
    { workspace_id: space, cwd, label, focus: false },
  );
  const pane = r.root_pane?.pane_id ?? r.tab?.root_pane_id;
  if (!pane) throw new HerdrError("bad_reply", "tab.create answered no pane");
  return pane;
}

/** Starts Claude Code at the pane's shell prompt and waits until herdr sees it ready for input. */
export async function startClaude(socketPath: string, pane: string, args: string[]): Promise<void> {
  await call(
    socketPath,
    "agent.start",
    { name: `arcdr-${Date.now().toString(36)}`, kind: "claude", pane_id: pane, args, timeout_ms: 90_000 },
    95_000,
  );
}

export async function closePane(socketPath: string, pane: string): Promise<void> {
  await call(socketPath, "pane.close", { pane_id: pane });
}
