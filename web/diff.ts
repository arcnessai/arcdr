/** Line diffs for the change view: what an edit removed and added, with unchanged lines folded. */

export interface DiffLine {
  op: " " | "-" | "+";
  text: string;
}

export type Hunk = { kind: "lines"; lines: DiffLine[] } | { kind: "skip"; count: number };

const lines = (s: string) => (s === "" ? [] : s.replace(/\r\n/g, "\n").split("\n"));

/** Longest-common-subsequence diff over the changed middle; above ~250k cells it shows removal then addition. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = lines(before);
  const b = lines(after);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let endA = a.length;
  let endB = b.length;
  while (endA > head && endB > head && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(head, endA);
  const midB = b.slice(head, endB);
  const same = (t: string): DiffLine => ({ op: " ", text: t });

  let mid: DiffLine[];
  if (midA.length * midB.length > 250_000) {
    mid = [...midA.map((t): DiffLine => ({ op: "-", text: t })), ...midB.map((t): DiffLine => ({ op: "+", text: t }))];
  } else {
    const n = midA.length;
    const m = midB.length;
    const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        lcs[i]![j] = midA[i] === midB[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    mid = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        mid.push(same(midA[i]!));
        i++;
        j++;
      } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) mid.push({ op: "-", text: midA[i++]! });
      else mid.push({ op: "+", text: midB[j++]! });
    }
    while (i < n) mid.push({ op: "-", text: midA[i++]! });
    while (j < m) mid.push({ op: "+", text: midB[j++]! });
  }
  return [...a.slice(0, head).map(same), ...mid, ...a.slice(endA).map(same)];
}

/** Keeps `context` unchanged lines around each change and folds longer unchanged runs into a count. */
export function hunks(diff: DiffLine[], context = 3): Hunk[] {
  const keep = diff.map(() => false);
  diff.forEach((l, i) => {
    if (l.op === " ") return;
    for (let k = Math.max(0, i - context); k <= Math.min(diff.length - 1, i + context); k++) keep[k] = true;
  });
  const out: Hunk[] = [];
  let skipped = 0;
  diff.forEach((l, i) => {
    if (keep[i]) {
      if (skipped) out.push({ kind: "skip", count: skipped });
      skipped = 0;
      const last = out[out.length - 1];
      if (last?.kind === "lines") last.lines.push(l);
      else out.push({ kind: "lines", lines: [l] });
    } else skipped++;
  });
  if (skipped) out.push({ kind: "skip", count: skipped });
  return out;
}

export function countChanges(diff: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const l of diff) {
    if (l.op === "+") added++;
    else if (l.op === "-") removed++;
  }
  return { added, removed };
}
