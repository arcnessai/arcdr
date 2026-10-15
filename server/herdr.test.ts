import { describe, expect, test } from "bun:test";
import { normalizeSnapshot } from "./herdr";

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
