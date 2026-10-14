import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { userText } from "./transcript";

/**
 * Past conversations a new session can pick up with `claude --resume`: Claude Code keeps each one as
 * ~/.claude/projects/<the folder, with every non-alphanumeric as "-">/<session id>.jsonl.
 */

export interface PastSession {
  id: string;
  title: string;
  /** Last written, epoch milliseconds. */
  at: number;
}

export const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function projectDir(root: string, cwd: string): string {
  return join(root, cwd.replace(/[^a-zA-Z0-9]/g, "-"));
}

function readSlice(path: string, from: number, length: number): string {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(length);
    const n = readSync(fd, buf, 0, length, from);
    return buf.subarray(0, n).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

/** The title Claude Code gave the conversation (its last ai-title entry), else its first typed message. */
export function titleOf(path: string): string {
  const size = statSync(path).size;
  const tail = readSlice(path, Math.max(0, size - 512 * 1024), Math.min(size, 512 * 1024));
  const titles = [...tail.matchAll(/"type":"ai-title","aiTitle":"((?:[^"\\]|\\.)*)"/g)];
  if (titles.length) {
    try {
      return JSON.parse(`"${titles[titles.length - 1]![1]}"`);
    } catch {
      /* fall through to the first message */
    }
  }
  for (const line of readSlice(path, 0, Math.min(size, 256 * 1024)).split("\n")) {
    try {
      const e = JSON.parse(line);
      if (e.type !== "user" || e.isMeta || typeof e.message?.content !== "string") continue;
      const said = userText(e.message.content);
      if (said?.kind === "user") return said.text.split("\n")[0]!.slice(0, 120);
    } catch {
      /* a cut line at the end of the slice */
    }
  }
  return "";
}

export function pastSessions(roots: string[], cwd: string, open: Set<string>, limit = 20): PastSession[] {
  const found: PastSession[] = [];
  for (const root of roots) {
    const dir = projectDir(root, cwd);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      const id = file.replace(/\.jsonl$/, "");
      if (!file.endsWith(".jsonl") || !SESSION_ID.test(id) || open.has(id)) continue;
      const path = join(dir, file);
      found.push({ id, title: "", at: statSync(path).mtimeMs });
    }
  }
  found.sort((a, b) => b.at - a.at);
  const recent = found.slice(0, limit);
  for (const s of recent) {
    for (const root of roots) {
      const path = join(projectDir(root, cwd), `${s.id}.jsonl`);
      if (existsSync(path)) {
        s.title = titleOf(path);
        break;
      }
    }
  }
  return recent;
}
