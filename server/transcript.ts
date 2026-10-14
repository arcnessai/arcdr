import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { basename, join } from "node:path";

/**
 * Turns a Claude Code transcript (one JSON entry per line under ~/.claude/projects/<dir>/<session>.jsonl)
 * into the items a chat view draws. Thinking, sidechains (subagents), meta entries and hook output are left out.
 */

export type ChatItem =
  | { id: string; kind: "user"; text: string; at: string | null }
  | { id: string; kind: "assistant"; text: string; at: string | null }
  | { id: string; kind: "tool"; name: string; summary: string; detail: string; at: string | null }
  | { id: string; kind: "ask"; questions: AskQuestion[]; at: string | null }
  /** code names a note the screen words itself, in its own language. */
  | { id: string; kind: "note"; text: string; code?: "compacted"; at: string | null }
  /** Marks an earlier tool item as failed; tool results arrive on a later line than their call. */
  | { id: string; kind: "tool-error"; target: string }
  /**
   * Claude Code's input queue: a message sent while the agent works is added, and leaves when the agent
   * reads it — removed by content mid-turn, or taken from the front at the end of a turn. Notifications
   * queue the same way, so they are kept (hidden) to keep the order of takes right.
   */
  | { id: string; kind: "queue"; op: "add" | "remove" | "take"; text: string; hidden: boolean };

export interface AskQuestion {
  question: string;
  options: string[];
  multi: boolean;
}

type Json = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

function firstLine(text: string): string {
  return text.trim().split("\n")[0] ?? "";
}

function shortPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.length <= 2 ? path : parts.slice(-2).join("/");
}

export function toolSummary(name: string, input: Json): { label: string; summary: string; detail: string } {
  const label = name.startsWith("mcp__") ? (name.split("__").pop() ?? name) : name;
  const s = (k: string) => str(input[k]);
  let summary = "";
  let detail = "";
  switch (name) {
    case "Bash":
      summary = s("description") || firstLine(s("command"));
      detail = s("command");
      break;
    case "Read":
    case "Write":
    case "Edit":
    case "NotebookEdit":
      summary = shortPath(s("file_path") || s("notebook_path"));
      detail = s("file_path") || s("notebook_path");
      break;
    case "Grep":
    case "Glob":
      summary = s("pattern");
      detail = [s("pattern"), s("path")].filter(Boolean).join("  in  ");
      break;
    case "WebFetch":
      summary = s("url");
      break;
    case "WebSearch":
      summary = s("query");
      break;
    case "Agent":
    case "Task":
      summary = s("description");
      detail = clip(s("prompt"), 2000);
      break;
    case "Skill":
      summary = s("skill");
      break;
    default:
      summary = s("description") || s("title") || s("query") || "";
      detail = clip(JSON.stringify(input, null, 2), 1500);
  }
  return { label, summary: clip(firstLine(summary), 160), detail: clip(detail, 4000) };
}

const DROP_USER = /^<(task-notification|system-reminder|local-command-caveat)>/;

/** What a person typed, with the harness's wrappers taken off; null when the entry is not a typed message. */
export function userText(raw: string): { kind: "user" | "note"; text: string } | null {
  let text = raw.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
  if (!text) return null;
  const command = /<command-name>([^<]*)<\/command-name>/.exec(text);
  if (command) {
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1]?.trim() ?? "";
    return { kind: "user", text: [command[1]!.trim(), args].filter(Boolean).join(" ") };
  }
  const bash = /<bash-input>([\s\S]*?)<\/bash-input>/.exec(text);
  if (bash) return { kind: "user", text: `! ${bash[1]!.trim()}` };
  const stdout = /<(local-command-stdout|bash-stdout)>([\s\S]*?)<\/\1>/.exec(text);
  if (stdout) {
    const out = stdout[2]!.trim();
    return out ? { kind: "note", text: clip(out, 600) } : null;
  }
  if (DROP_USER.test(text) || /^<bash-stderr>/.test(text)) return null;
  text = text.replace(/^\[Request interrupted by user[^\]]*\]$/, "").trim();
  return text ? { kind: "user", text } : null;
}

/** AskUserQuestion's result reads `User has answered your questions: "Q"="A", …`; the answers are what the person said. */
export function askAnswers(result: string): string | null {
  if (!result.startsWith("User has answered your questions")) return null;
  const answers = [...result.matchAll(/"((?:[^"\\]|\\.)*)"="((?:[^"\\]|\\.)*)"/g)].map((m) => m[2]!);
  return answers.length > 0 ? answers.join("\n") : null;
}

function promptText(content: unknown): string {
  if (typeof content === "string") return content;
  return arr(content)
    .map((b) => {
      const block = obj(b);
      if (block.type === "text") return str(block.text);
      if (block.type === "image") return "[image]";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function parseEntries(lines: string[]): ChatItem[] {
  const items: ChatItem[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    let e: Json;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.isSidechain === true) continue;
    const id = str(e.uuid) || `line-${items.length}`;
    const at = str(e.timestamp) || null;
    const message = obj(e.message);

    if (e.type === "user") {
      if (e.isMeta === true) continue;
      const content = message.content;
      if (typeof content === "string") {
        const t = userText(content);
        if (t) items.push({ id, kind: t.kind, text: t.text, at });
        continue;
      }
      const blocks = arr(content).map(obj);
      blocks.forEach((b, i) => {
        if (b.type !== "tool_result") return;
        if (b.is_error === true && str(b.tool_use_id)) {
          items.push({ id: `${id}:${i}`, kind: "tool-error", target: str(b.tool_use_id) });
          return;
        }
        const answers = askAnswers(promptText(b.content));
        if (answers) items.push({ id: `${id}:${i}`, kind: "user", text: answers, at });
      });
      const typed = promptText(blocks.filter((b) => b.type === "text" || b.type === "image"));
      const t = typed ? userText(typed) : null;
      if (t) items.push({ id, kind: t.kind, text: t.text, at });
      continue;
    }

    if (e.type === "attachment") {
      const a = obj(e.attachment);
      if (a.type === "queued_command" && a.humanTurn !== false) {
        const t = userText(promptText(a.prompt));
        if (t) items.push({ id, kind: t.kind, text: t.text, at });
      }
      continue;
    }

    if (e.type === "queue-operation") {
      const op = e.operation === "enqueue" ? "add" : e.operation === "remove" ? "remove" : e.operation === "dequeue" ? "take" : null;
      if (op) {
        const said = userText(str(e.content));
        items.push({
          id: `queue:${str(e.timestamp)}:${op}:${items.length}`,
          kind: "queue",
          op,
          text: said?.text ?? str(e.content),
          hidden: op !== "take" && said?.kind !== "user",
        });
      }
      continue;
    }

    if (e.type === "system") {
      if (e.subtype === "compact_boundary") items.push({ id, kind: "note", text: "", code: "compacted", at });
      continue;
    }

    if (e.type === "assistant") {
      arr(message.content)
        .map(obj)
        .forEach((b, i) => {
          if (b.type === "text" && str(b.text).trim()) {
            items.push({ id: `${id}:${i}`, kind: "assistant", text: str(b.text).trim(), at });
          } else if (b.type === "tool_use") {
            const name = str(b.name);
            const input = obj(b.input);
            const toolId = str(b.id) || `${id}:${i}`;
            if (name === "AskUserQuestion") {
              const questions = arr(input.questions).map((q) => {
                const qo = obj(q);
                return {
                  question: str(qo.question),
                  options: arr(qo.options).map((o) => str(obj(o).label)),
                  multi: qo.multiSelect === true,
                };
              });
              items.push({ id: toolId, kind: "ask", questions, at });
            } else if (name === "ExitPlanMode" && str(input.plan)) {
              items.push({ id: toolId, kind: "assistant", text: str(input.plan), at });
            } else {
              const t = toolSummary(name, input);
              items.push({ id: toolId, kind: "tool", name: t.label, summary: t.summary, detail: t.detail, at });
            }
          }
        });
    }
  }
  return items;
}

const SESSION_ID = /^[A-Za-z0-9-]{8,64}$/;
const found = new Map<string, string>();

export function findTranscript(roots: string[], sessionId: string): string | null {
  if (!SESSION_ID.test(sessionId)) return null;
  const cached = found.get(sessionId);
  if (cached && existsSync(cached)) return cached;
  for (const root of roots) {
    let dirs: string[];
    try {
      dirs = readdirSync(root);
    } catch {
      continue;
    }
    for (const dir of dirs) {
      const path = join(root, dir, `${sessionId}.jsonl`);
      if (existsSync(path)) {
        found.set(sessionId, path);
        return path;
      }
    }
  }
  return null;
}

export interface Chunk {
  items: ChatItem[];
  /** Byte offset just past the last complete line read; pass it back to read what follows. */
  offset: number;
  /** True when the file was shorter than the offset asked for (rewritten), so the caller should start over. */
  reset: boolean;
  /** True when older lines were skipped to keep the first read small. */
  clipped: boolean;
  file: string;
}

function readRange(path: string, start: number, end: number): Buffer {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(end - start);
    let got = 0;
    while (got < buf.length) {
      const n = readSync(fd, buf, got, buf.length - got, start + got);
      if (n === 0) break;
      got += n;
    }
    return buf.subarray(0, got);
  } finally {
    closeSync(fd);
  }
}

/** Splits at newlines; a trailing line without one is still being written and is left for the next read. */
function completeLines(buf: Buffer, skipFirst: boolean): { lines: string[]; used: number } {
  let from = 0;
  if (skipFirst) {
    const nl = buf.indexOf(0x0a);
    if (nl < 0) return { lines: [], used: 0 };
    from = nl + 1;
  }
  const lastNl = buf.lastIndexOf(0x0a);
  if (lastNl < from) return { lines: [], used: from };
  return { lines: buf.subarray(from, lastNl).toString("utf8").split("\n"), used: lastNl + 1 };
}

export interface TailOptions {
  /** Bytes read from the end on the first try. */
  window?: number;
  /** The window doubles until this many messages (said by a person or the agent) are in it… */
  minTalk?: number;
  /** …or it reaches this size. Claude Code writes large bookkeeping entries, so 1.5 MB can hold only a handful. */
  maxWindow?: number;
  maxItems?: number;
}

export function readTail(path: string, opts: TailOptions = {}): Chunk {
  const { window: first = 1_500_000, minTalk = 40, maxWindow = 32_000_000, maxItems = 300 } = opts;
  const size = statSync(path).size;
  for (let window = first; ; window *= 2) {
    const start = Math.max(0, size - window);
    const { lines, used } = completeLines(readRange(path, start, size), start > 0);
    const items = parseEntries(lines);
    const talk = items.filter((i) => i.kind === "user" || i.kind === "assistant").length;
    if (start === 0 || talk >= minTalk || window >= maxWindow) {
      return {
        items: items.slice(-maxItems),
        offset: start + used,
        reset: false,
        clipped: start > 0 || items.length > maxItems,
        file: basename(path),
      };
    }
  }
}

export function readFrom(path: string, offset: number, maxBytes = 4_000_000): Chunk {
  const size = statSync(path).size;
  if (size < offset) return { ...readTail(path), reset: true };
  const end = Math.min(size, offset + maxBytes);
  const { lines, used } = completeLines(readRange(path, offset, end), false);
  return { items: parseEntries(lines), offset: offset + used, reset: false, clipped: false, file: basename(path) };
}
