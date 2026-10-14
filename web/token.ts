/** The "/command" at the very start, or the "@path" the caret is in — what the suggestion list completes. */
export interface Token {
  kind: "slash" | "file";
  start: number;
  end: number;
  query: string;
}

export function tokenAt(text: string, caret: number): Token | null {
  const before = text.slice(0, caret);
  const slash = /^\/([\w:.-]*)$/.exec(before);
  if (slash) return { kind: "slash", start: 0, end: caret, query: slash[1]! };
  const at = /(?:^|\s)@([^\s@]*)$/.exec(before);
  if (at) return { kind: "file", start: caret - at[1]!.length - 1, end: caret, query: at[1]! };
  return null;
}
