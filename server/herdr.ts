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
  // A tab keeps its number when it moves; its place in the list is the order herdr's sidebar shows.
  const tabs = new Map<string, { number: number; label: string; at: number }>();
  for (const [at, t] of (snap.tabs ?? []).entries())
    tabs.set(t.tab_id, { number: Number(t.number) || 0, label: String(t.label ?? ""), at });

  const spaces: Space[] = (snap.workspaces ?? []).map((w: any) => ({
    id: String(w.workspace_id),
    number: Number(w.number) || 0,
    label: String(w.label ?? w.workspace_id),
    status: status(w.agent_status),
    tokens: tokens(w.tokens),
  }));
  spaces.sort((a, b) => a.number - b.number);

  const order = new Map<string, number>();
  const agents: Agent[] = (snap.agents ?? []).map((a: any) => {
    const tab = tabs.get(a.tab_id) ?? { number: 0, label: "", at: Number.MAX_SAFE_INTEGER };
    order.set(String(a.pane_id), tab.at);
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
  agents.sort((a, b) => order.get(a.pane)! - order.get(b.pane)! || a.pane.localeCompare(b.pane));

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
/** Pieces small enough that Claude Code takes them as typing, not as one burst it would mark as pasted. */
const TYPE_CHUNK = 80;
const TYPE_GAP_MS = 12;

/**
 * What typing `text` means for a terminal prompt: lines, each in small pieces, joined by Ctrl+J (a new line
 * that does not send). A tab would open completion, so it becomes spaces; a message ending in an @path
 * gets a space, or Enter would pick the completion instead of sending.
 */
export function typingPlan(text: string): { lines: string[][] } {
  let body = text.replace(/\r\n?/g, "\n").replace(/\t/g, "  ");
  if (/(^|\s)@\S*$/.test(body)) body += " ";
  const lines = body.split("\n").map((line) => {
    const chars = Array.from(line);
    const pieces: string[] = [];
    for (let i = 0; i < chars.length; i += TYPE_CHUNK) pieces.push(chars.slice(i, i + TYPE_CHUNK).join(""));
    return pieces;
  });
  return { lines };
}

/**
 * Sends a message by typing it and pressing Enter. agent.prompt pastes it instead, and Claude Code keeps a
 * long or many-line paste as pasted content — text the model weighs as material the person brought, not
 * as what they asked. Typed, it is the person's own message.
 */
export async function typeMessage(socketPath: string, pane: string, text: string): Promise<void> {
  const { lines } = typingPlan(text);
  for (const [i, pieces] of lines.entries()) {
    if (i > 0) await call(socketPath, "pane.send_keys", { pane_id: pane, keys: ["ctrl+j"] });
    for (const piece of pieces) {
      await call(socketPath, "pane.send_text", { pane_id: pane, text: piece });
      await new Promise((r) => setTimeout(r, TYPE_GAP_MS));
    }
  }
  await new Promise((r) => setTimeout(r, 150));
  await call(socketPath, "pane.send_keys", { pane_id: pane, keys: ["enter"] });
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

/**
 * Moves a tab before another one in its space (before null: to the end). herdr takes the place in the list
 * as it is now, the moving tab still in it: "before the tab at index i".
 */
export async function moveTab(socketPath: string, tab: string, before: string | null): Promise<void> {
  const space = tab.slice(0, tab.indexOf(":"));
  const list = await call<{ tabs?: { tab_id: string }[] }>(socketPath, "tab.list", { workspace_id: space });
  const ids = (list.tabs ?? []).map((t) => t.tab_id);
  if (!ids.includes(tab)) throw new HerdrError("tab_not_found", `no tab ${tab}`);
  const at = before === null ? ids.length : ids.indexOf(before);
  if (at < 0) throw new HerdrError("tab_not_found", `no tab ${before} in ${space}`);
  await call(socketPath, "tab.move", { tab_id: tab, insert_index: at });
}

export async function closePane(socketPath: string, pane: string): Promise<void> {
  await call(socketPath, "pane.close", { pane_id: pane });
}
