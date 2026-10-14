import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

/**
 * What the composer offers after "/" and "@": the slash commands and skills the agent's session can run,
 * and the files under its working directory.
 */

export interface Suggestion {
  /** What goes into the text: "/name" for a command, the path for a file. */
  value: string;
  /** One line about it; empty for files. */
  detail: string;
  kind: "builtin" | "skill" | "command" | "dir" | "file";
}

/**
 * Claude Code's own commands. /exit, /quit and /logout are left out on purpose: one mistap on a phone
 * would end the session or sign it out, with no way back from here.
 */
const BUILTINS: [string, string][] = [
  ["add-dir", "Add a working directory"],
  ["agents", "Manage subagents"],
  ["btw", "Ask a side question without interrupting"],
  ["clear", "Start a new conversation"],
  ["compact", "Summarise the conversation to free context"],
  ["config", "Open settings"],
  ["context", "Show what fills the context window"],
  ["cost", "Show this session's cost"],
  ["doctor", "Check the installation"],
  ["export", "Export the conversation"],
  ["help", "List commands"],
  ["hooks", "Manage hooks"],
  ["init", "Write a CLAUDE.md for this project"],
  ["mcp", "Manage MCP servers"],
  ["memory", "Edit memory files"],
  ["model", "Switch the model"],
  ["permissions", "Manage tool permissions"],
  ["plugin", "Manage plugins"],
  ["resume", "Resume an earlier conversation"],
  ["review", "Review a pull request"],
  ["rewind", "Go back to an earlier point"],
  ["status", "Show version, model and account"],
  ["todos", "Show the todo list"],
  ["usage", "Show plan usage"],
];

function frontmatter(text: string): Record<string, string> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const out: Record<string, string> = {};
  if (!m) return out;
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]!] = kv[2]!.replace(/^["']|["']$/g, "").trim();
  }
  return out;
}

function oneLine(text: string, max = 120): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? line.slice(0, max - 1) + "…" : line;
}

function safeList(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function readHead(path: string): string {
  try {
    return readFileSync(path, "utf8").slice(0, 4000);
  } catch {
    return "";
  }
}

/** `.claude/skills/<name>/SKILL.md` and `.claude/commands/**.md` under one `.claude` directory. */
function fromClaudeDir(claudeDir: string, into: Map<string, Suggestion>) {
  const skills = join(claudeDir, "skills");
  for (const name of safeList(skills)) {
    const file = join(skills, name, "SKILL.md");
    if (!existsSync(file)) continue;
    const fm = frontmatter(readHead(file));
    const value = `/${fm.name || name}`;
    if (!into.has(value)) into.set(value, { value, detail: oneLine(fm.description ?? ""), kind: "skill" });
  }
  const commands = join(claudeDir, "commands");
  const walk = (dir: string, prefix: string) => {
    for (const entry of safeList(dir)) {
      const path = join(dir, entry);
      let isDir = false;
      try {
        isDir = statSync(path).isDirectory();
      } catch {
        continue;
      }
      if (isDir && !prefix) walk(path, `${entry}:`);
      else if (entry.endsWith(".md")) {
        const head = readHead(path);
        const fm = frontmatter(head);
        const body = head.replace(/^---[\s\S]*?---\s*/, "");
        const value = `/${prefix}${entry.slice(0, -3)}`;
        if (!into.has(value)) into.set(value, { value, detail: oneLine(fm.description || body.split("\n")[0] || ""), kind: "command" });
      }
    }
  };
  walk(commands, "");
}

const cache = new Map<string, { at: number; list: Suggestion[] }>();

/** Commands and skills for a session working in cwd: the project's (cwd and its parents), then the user's, then the built-ins. */
export function slashCommands(cwd: string, home: string, maxAgeMs = 30_000): Suggestion[] {
  const hit = cache.get(cwd);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.list;
  const found = new Map<string, Suggestion>();
  let dir = resolve(cwd);
  for (let i = 0; i < 12; i++) {
    fromClaudeDir(join(dir, ".claude"), found);
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  fromClaudeDir(join(home, ".claude"), found);
  for (const [name, detail] of BUILTINS) {
    const value = `/${name}`;
    if (!found.has(value)) found.set(value, { value, detail, kind: "builtin" });
  }
  const list = [...found.values()];
  cache.set(cwd, { at: Date.now(), list });
  return list;
}

/** Ranks by where the query appears: at the start of the name first, then anywhere in it. */
export function filterSlash(list: Suggestion[], query: string, limit = 40): Suggestion[] {
  const q = query.toLowerCase();
  const name = (s: Suggestion) => s.value.slice(1).toLowerCase();
  const starts = list.filter((s) => name(s).startsWith(q));
  const contains = list.filter((s) => !name(s).startsWith(q) && name(s).includes(q));
  const byName = (a: Suggestion, b: Suggestion) => a.value.localeCompare(b.value);
  return [...starts.sort(byName), ...contains.sort(byName)].slice(0, limit);
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "__pycache__", ".venv"]);

/**
 * Entries of the directory the partial path names, under cwd only. "src/ch" lists src/ for names starting
 * with "ch"; a path that climbs out of cwd (.., absolute, a symlink pointing out) lists nothing.
 */
export function completeFile(cwd: string, partial: string, limit = 60): Suggestion[] {
  if (partial.startsWith("/") || partial.split("/").includes("..")) return [];
  let root: string;
  try {
    root = realpathSync(cwd);
  } catch {
    return [];
  }
  const slash = partial.lastIndexOf("/");
  const dirPart = slash >= 0 ? partial.slice(0, slash + 1) : "";
  const namePart = (slash >= 0 ? partial.slice(slash + 1) : partial).toLowerCase();
  let dir: string;
  try {
    dir = realpathSync(join(root, dirPart));
  } catch {
    return [];
  }
  if (dir !== root && !dir.startsWith(root + sep)) return [];

  const out: Suggestion[] = [];
  for (const entry of safeList(dir).sort()) {
    if (entry.startsWith(".") && !namePart.startsWith(".")) continue;
    if (SKIP_DIRS.has(entry) && !namePart) continue;
    if (!entry.toLowerCase().startsWith(namePart)) continue;
    let isDir = false;
    try {
      isDir = statSync(join(dir, entry)).isDirectory();
    } catch {
      continue;
    }
    const rel = relative(root, join(dir, entry)).split(sep).join("/");
    out.push({ value: isDir ? `${rel}/` : rel, detail: "", kind: isDir ? "dir" : "file" });
    if (out.length >= limit) break;
  }
  // Directories first, so the next step down is near the top.
  return out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "dir" ? -1 : 1));
}

