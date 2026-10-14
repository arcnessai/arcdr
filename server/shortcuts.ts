import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Commands a person keeps at hand: a skill with its usual arguments, a slash command, a sentence they
 * send often. One list for the machine, so the phone and the laptop show the same buttons.
 */
export interface Shortcut {
  /** What goes into the message box. */
  text: string;
  /** The button's name; the text itself when empty. */
  label: string;
  /** Send at once instead of putting the text in the box for more words. */
  send: boolean;
}

// Small enough that the whole list, in Hangul, fits in one request body (64 KB).
export const MAX_SHORTCUTS = 30;
const MAX_SHORTCUT_TEXT = 600;
const MAX_LABEL = 40;

/** The list as given, or the reason it cannot be kept. */
export function cleanShortcuts(input: unknown): { list: Shortcut[] } | { error: string } {
  if (!Array.isArray(input)) return { error: "shortcuts must be a list" };
  if (input.length > MAX_SHORTCUTS) return { error: `at most ${MAX_SHORTCUTS} shortcuts` };
  const list: Shortcut[] = [];
  for (const [i, raw] of input.entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: `shortcut ${i + 1} is not an object` };
    const r = raw as Record<string, unknown>;
    const text = typeof r.text === "string" ? r.text.trim() : "";
    if (!text) return { error: `shortcut ${i + 1} has no text` };
    if (text.length > MAX_SHORTCUT_TEXT) return { error: `shortcut ${i + 1} is longer than ${MAX_SHORTCUT_TEXT} characters` };
    const label = typeof r.label === "string" ? r.label.trim() : "";
    if (label.length > MAX_LABEL) return { error: `shortcut ${i + 1}'s name is longer than ${MAX_LABEL} characters` };
    const unknown = Object.keys(r).filter((k) => k !== "text" && k !== "label" && k !== "send");
    if (unknown.length > 0) return { error: `shortcut ${i + 1} has unknown fields: ${unknown.join(", ")}` };
    list.push({ text, label, send: r.send === true });
  }
  return { list };
}

export class ShortcutStore {
  constructor(private file: string) {}

  list(): Shortcut[] {
    if (!existsSync(this.file)) return [];
    try {
      const got = cleanShortcuts(JSON.parse(readFileSync(this.file, "utf8")));
      return "list" in got ? got.list : [];
    } catch {
      return [];
    }
  }

  save(list: Shortcut[]) {
    mkdirSync(dirname(this.file), { recursive: true });
    // Written beside and moved over, so a reader never sees half a list.
    const next = `${this.file}.next`;
    writeFileSync(next, JSON.stringify(list, null, 2), { mode: 0o600 });
    chmodSync(next, 0o600);
    renameSync(next, this.file);
  }
}
