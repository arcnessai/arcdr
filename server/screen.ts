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

  const context: string[] = [];
  for (let i = first - 1; i >= 0 && context.length < 10; i--) {
    const line = lines[i]!;
    if (isRule(line)) break;
    if (line.trim() === "" && context.length > 0 && context[0] === "") continue;
    context.unshift(line.trim() === "" ? "" : line.trim().slice(0, 240));
  }
  while (context[0] === "") context.shift();
  while (context[context.length - 1] === "") context.pop();

  return { context, choices, cursor };
}

/** Keys that move the cursor from where the menu shows it to option n and confirm it. */
export function keysToChoose(menu: Menu, n: number): string[] | null {
  const target = menu.choices.findIndex((c) => c.n === n);
  if (target < 0) return null;
  const delta = target - menu.cursor;
  return [...Array<string>(Math.abs(delta)).fill(delta > 0 ? "down" : "up"), "enter"];
}
