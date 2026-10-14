/**
 * Reads a selection menu off an agent's visible screen: Claude Code's permission prompts,
 * AskUserQuestion and plan approval all draw numbered options with a cursor (❯) on one of them.
 * A numbered list without a cursor is ordinary output, not a menu.
 */

export interface Choice {
  n: number;
  label: string;
  detail: string[];
  /** For multi-select menus: whether the box is ticked. */
  checked: boolean | null;
}

export interface Menu {
  context: string[];
  choices: Choice[];
  /** Index into choices of the option the cursor is on. */
  cursor: number;
}

const OPTION = /^(\s*)(?:([❯›▶➤>])\s*)?(\d{1,2})[.)]\s+(\S.*)$/;
/**
 * A drawn separator. The terminal cuts a line at the pane's width and can split the last wide character,
 * leaving a replacement character (U+FFFD) at the end, so that is allowed too.
 */
function isRule(line: string): boolean {
  const t = line.trim();
  return t.length >= 3 && /^[─━═╭╮╰╯┌┐└┘-]+\uFFFD?$/.test(t);
}
const CHECKBOX = /^(\[[ xX✔✓]\]|[☐☑☒])\s*/;
const MAX_LINES_BELOW = 6;

function clean(line: string): string {
  return line
    .replace(/^\s*│ ?/, "")
    .replace(/ ?│\s*$/, "")
    .replace(/\s+$/, "");
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** Columns a line takes in the terminal: Hangul, CJK, full-width forms and emoji take two. */
export function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    const wide =
      (c >= 0x1100 && c <= 0x115f) ||
      (c >= 0x2e80 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe4f) ||
      (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6) ||
      (c >= 0x1f300 && c <= 0x1faff);
    width += wide ? 2 : 1;
  }
  return width;
}

/**
 * How far short of the right edge a line can end and still have been wrapped there: a dialog's border and
 * padding, and the next word, which did not fit.
 */
const WRAP_SLACK = 16;

/**
 * The lines above a menu, back to a rule or ten lines, with every line the terminal wrapped joined to the
 * one it continues — a question two lines long is one question, not its last half.
 */
function contextAbove(lines: string[], first: number): string[] {
  const width = Math.max(0, ...lines.map((l) => displayWidth(l)));
  const raw: string[] = [];
  for (let i = first - 1; i >= 0 && raw.length < 24; i--) {
    if (isRule(lines[i]!)) break;
    raw.unshift(lines[i]!);
  }
  const context: string[] = [];
  let before: string | null = null;
  for (const line of raw) {
    if (line.trim() === "") {
      if (context.length > 0 && context.at(-1) !== "") context.push("");
      before = null;
      continue;
    }
    const wrapped = before !== null && indentOf(line) === indentOf(before) && displayWidth(before) >= width - WRAP_SLACK;
    if (wrapped) context[context.length - 1] += ` ${line.trim()}`;
    else context.push(line.trim());
    before = line;
  }
  while (context[0] === "") context.shift();
  while (context.at(-1) === "") context.pop();
  return context.slice(-10).map((l) => l.slice(0, 600));
}

interface OptionLine {
  index: number;
  numberCol: number;
  n: number;
  label: string;
  cursor: boolean;
}

function asOption(line: string, index: number): OptionLine | null {
  const m = OPTION.exec(line);
  if (!m) return null;
  return {
    index,
    numberCol: line.indexOf(m[3]!, (m[1] ?? "").length),
    n: Number(m[3]),
    label: m[4]!.trim(),
    cursor: Boolean(m[2]),
  };
}

export function parseMenu(screen: string): Menu | null {
  const numbered = parseNumbered(screen);
  return numbered ?? parseUnnumbered(screen);
}

const HINT = /^\s*(Enter to (confirm|select|continue)|↑\/↓|Esc to (cancel|go back))/;

/**
 * A menu without numbers, like the folder trust dialog at a new session's start ("❯ No, exit / Yes, I trust
 * this folder", then "Enter to confirm · Esc to cancel"). The cursor line and its siblings share one indent,
 * and a hint line follows them — the prompt line, which also starts with ❯, has no such hint under it.
 */
function parseUnnumbered(screen: string): Menu | null {
  const lines = screen.split("\n").map(clean);
  const hintAt = lines.findLastIndex((l) => HINT.test(l));
  if (hintAt < 0) return null;
  let end = hintAt - 1;
  while (end >= 0 && lines[end]!.trim() === "") end--;
  const options: { label: string; cursor: boolean }[] = [];
  let indent = -1;
  for (let i = end; i >= 0; i--) {
    const m = /^(\s*)(?:([❯›▶➤>])\s+)?(\S.*)$/.exec(lines[i]!);
    if (!m) break;
    const marker = Boolean(m[2]);
    // The cursor's marker stands where its siblings have spaces, so compare where the label starts.
    const at = lines[i]!.indexOf(m[3]!);
    if (indent < 0) indent = at;
    if (at !== indent) break;
    options.unshift({ label: m[3]!.trim(), cursor: marker });
  }
  const cursor = options.findIndex((o) => o.cursor);
  if (options.length < 2 || options.length > 9 || cursor < 0 || options.filter((o) => o.cursor).length !== 1) return null;
  const first = end - options.length + 1;
  const context = contextAbove(lines, first);
  return { context, choices: options.map((o, i) => ({ n: i + 1, label: o.label, detail: [], checked: null })), cursor };
}

function parseNumbered(screen: string): Menu | null {
  const lines = screen.split("\n").map(clean);

  let last = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (asOption(lines[i]!, i)) {
      last = i;
      break;
    }
  }
  if (last < 0) return null;

  // Walk up from the last option while lines are options, their indented details, or blank lines
  // that sit between such lines.
  let first = last;
  const lowestNumberCol = asOption(lines[last]!, last)!.numberCol;
  for (let i = last - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (asOption(line, i)) {
      first = i;
      continue;
    }
    // Blank lines, and the rule AskUserQuestion draws before its last option ("Chat about this"),
    // belong to the menu when an option or an option's detail line sits above them.
    if (line.trim() === "" || isRule(line)) {
      let j = i - 1;
      while (j >= 0 && (lines[j]!.trim() === "" || isRule(lines[j]!))) j--;
      if (j >= 0 && (asOption(lines[j]!, j) || indentOf(lines[j]!) > lowestNumberCol)) continue;
      break;
    }
    if (indentOf(line) > lowestNumberCol) continue;
    break;
  }

  const choices: Choice[] = [];
  const options: OptionLine[] = [];
  let end = last;
  for (let i = last + 1; i < lines.length && lines[i]!.trim() !== "" && indentOf(lines[i]!) > lowestNumberCol; i++) end = i;
  for (let i = first; i <= end; i++) {
    const line = lines[i]!;
    const opt = asOption(line, i);
    if (opt) {
      options.push(opt);
      const box = CHECKBOX.exec(opt.label);
      choices.push({
        n: opt.n,
        label: box ? opt.label.slice(box[0].length) : opt.label,
        detail: [],
        checked: box ? !/[ ☐]/.test(box[1]!) : null,
      });
    } else if (line.trim() !== "" && choices.length > 0) {
      choices[choices.length - 1]!.detail.push(line.trim());
    }
  }

  if (choices.length < 2) return null;
  for (let i = 0; i < choices.length; i++) if (choices[i]!.n !== choices[0]!.n + i) return null;
  // A live menu is the last thing drawn; below it there is room only for a hint line and the status line.
  // A menu with more output under it was answered earlier and is still on screen.
  const below = lines.slice(end + 1).filter((l) => l.trim() !== "" && !isRule(l)).length;
  if (below > MAX_LINES_BELOW) return null;
  const cursor = options.findIndex((o) => o.cursor);
  if (cursor < 0) return null;

  const context = contextAbove(lines, first);

  return { context, choices, cursor };
}

/** Keys that move the cursor from where the menu shows it to option n and confirm it. Unnumbered menus count from 1. */
export function keysToChoose(menu: Menu, n: number): string[] | null {
  const target = menu.choices.findIndex((c) => c.n === n);
  if (target < 0) return null;
  const delta = target - menu.cursor;
  return [...Array<string>(Math.abs(delta)).fill(delta > 0 ? "down" : "up"), "enter"];
}

/**
 * The permission mode Claude Code's footer names ("⏵⏵ accept edits on", "⏸ plan mode on"); null when the
 * footer names none, which is the default mode (or the footer is not on screen).
 */
export function parseMode(screen: string): string | null {
  const m = /(?:⏵⏵|⏸)\s+([a-z][a-z ]+?)\s+on\b/i.exec(screen.split("\n").slice(-12).join("\n"));
  if (!m) return null;
  const words = m[1]!.toLowerCase();
  if (words.startsWith("accept edits")) return "acceptEdits";
  if (words.startsWith("plan")) return "plan";
  if (words.startsWith("bypass")) return "bypassPermissions";
  if (words.startsWith("auto")) return "auto";
  return words;
}
