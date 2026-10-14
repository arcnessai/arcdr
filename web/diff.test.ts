import { describe, expect, test } from "bun:test";
import { countChanges, diffLines, hunks } from "./diff";

describe("diffLines", () => {
  test("marks the changed lines between unchanged ones", () => {
    expect(diffLines("a\nb\nc", "a\nB\nc")).toEqual([
      { op: " ", text: "a" },
      { op: "-", text: "b" },
      { op: "+", text: "B" },
      { op: " ", text: "c" },
    ]);
  });
  test("a new file is all additions", () => {
    expect(countChanges(diffLines("", "x\ny"))).toEqual({ added: 2, removed: 0 });
  });
  test("keeps lines both sides share inside the change", () => {
    const d = diffLines("1\n2\n3\n4", "1\nx\n3\ny");
    expect(d.filter((l) => l.op === " ").map((l) => l.text)).toEqual(["1", "3"]);
    expect(countChanges(d)).toEqual({ added: 2, removed: 2 });
  });
});

describe("hunks", () => {
  test("folds long unchanged runs and keeps three lines of context", () => {
    const before = Array.from({ length: 20 }, (_, i) => `l${i}`).join("\n");
    const after = before.replace("l10", "L10");
    const h = hunks(diffLines(before, after));
    expect(h.map((x) => (x.kind === "skip" ? `skip ${x.count}` : `${x.lines.length} lines`))).toEqual([
      "skip 7",
      "8 lines",
      "skip 6",
    ]);
  });
});

import { commonDir } from "./paths";

describe("commonDir", () => {
  test("the directory all paths share", () => {
    expect(commonDir(["/r/wt/a/x.ts", "/r/wt/a/b/y.ts", "/r/wt/c.ts"])).toBe("/r/wt/");
    expect(commonDir(["/r/wt/a/x.ts"])).toBe("/r/wt/a/");
    expect(commonDir(["a.ts", "b.ts"])).toBe("");
  });
});
