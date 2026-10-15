import { describe, expect, test } from "bun:test";
import { normalizeSnapshot, typingPlan } from "./herdr";

describe("normalizeSnapshot", () => {
  test("agents follow the tabs' order in the list, not their numbers: a moved tab keeps its number", () => {
    const snap = normalizeSnapshot({
      snapshot: {
        workspaces: [{ workspace_id: "w1", number: 1, label: "s" }],
        tabs: [
          { tab_id: "w1:t3", number: 3, label: "C" },
          { tab_id: "w1:t1", number: 1, label: "A" },
          { tab_id: "w1:t2", number: 2, label: "B" },
        ],
        agents: [
          { pane_id: "w1:p1", workspace_id: "w1", tab_id: "w1:t1", agent: "claude" },
          { pane_id: "w1:p2", workspace_id: "w1", tab_id: "w1:t2", agent: "claude" },
          { pane_id: "w1:p3", workspace_id: "w1", tab_id: "w1:t3", agent: "claude" },
        ],
      },
    });
    expect(snap.agents.map((a) => a.tabLabel)).toEqual(["C", "A", "B"]);
  });
});

describe("typing a message", () => {
  test("lines become separate runs of small pieces, so nothing reads as one pasted burst", () => {
    const { lines } = typingPlan("첫 줄\r\n" + "가".repeat(200) + "\n\n끝");
    expect(lines.map((l) => l.length)).toEqual([1, 3, 0, 1]);
    expect(lines[1]!.join("")).toBe("가".repeat(200));
    expect(Math.max(...lines.flat().map((p) => Array.from(p).length))).toBeLessThanOrEqual(80);
  });
  test("a tab would open completion and a trailing @path would take the Enter: both are defused", () => {
    expect(typingPlan("a\tb").lines).toEqual([["a  b"]]);
    expect(typingPlan("look at @/tmp/x.png").lines).toEqual([["look at @/tmp/x.png "]]);
    expect(typingPlan("mail me@example.com please").lines).toEqual([["mail me@example.com please"]]);
  });
  test("a character outside the basic plane is never split", () => {
    const pieces = typingPlan("😀".repeat(100)).lines[0]!;
    expect(pieces.join("")).toBe("😀".repeat(100));
    expect(pieces.every((p) => !/[\uD800-\uDBFF]$/.test(p))).toBe(true);
  });
});
