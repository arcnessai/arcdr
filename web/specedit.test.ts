import { describe, expect, test } from "bun:test";
import { CONVERSATION_PART, type DisplaySpec } from "../server/spec";
import { findToken, guessFormat, placeToken, removeToken, reported } from "./specedit";

const spec: DisplaySpec = {
  agent: { badge: { from: "token:tree", bold: true }, line: [{ from: "token:stage" }, CONVERSATION_PART] },
  space: {},
  band: [
    { left: [{ from: "token:skill", as: "chip" }], right: [{ from: "token:context", as: "meter" }] },
    { left: [{ from: "tokens:rest", as: "chip" }] },
  ],
  footer: { left: [{ from: "token:account", dim: true }] },
};

describe("the display editor's changes", () => {
  test("a token is found where it is shown first", () => {
    expect(findToken(spec, "tree").place).toEqual({ at: "badge" });
    expect(findToken(spec, "context").place).toEqual({ at: "band", row: 0, side: "right" });
    expect(findToken(spec, "account").place).toEqual({ at: "footer", side: "left" });
    expect(findToken(spec, "branch")).toEqual({ place: { at: "none" }, part: null });
  });

  test("moving a token takes it from its old place, keeps its other settings, and drops a row it emptied", () => {
    const moved = placeToken(spec, "skill", { at: "footer", side: "right" }, findToken(spec, "skill").part!);
    expect(moved.footer?.right).toEqual([{ from: "token:skill", as: "chip" }]);
    expect(moved.band![0]).toEqual({ left: [], right: [{ from: "token:context", as: "meter" }] });
    const gone = removeToken(removeToken(spec, "skill"), "context");
    expect(gone.band).toEqual([{ left: [{ from: "tokens:rest", as: "chip" }], right: undefined }]);
  });

  test("a new token on the line goes before the conversation title; a row past the end is a new row", () => {
    const line = placeToken(spec, "branch", { at: "line" }, { from: "", as: "chip" });
    expect(line.agent.line?.map((p) => p.from)).toEqual(["token:stage", "token:branch", "field:conversation"]);
    const row = placeToken(spec, "branch", { at: "band", row: 9, side: "left" }, { from: "" });
    expect(row.band).toHaveLength(3);
    expect(row.band![2]).toEqual({ left: [{ from: "token:branch" }] });
  });

  test("a new badge replaces the old one", () => {
    expect(placeToken(spec, "stage", { at: "badge" }, { from: "" }).agent.badge).toEqual({ from: "token:stage" });
  });

  test("the values offered: what agents report now, most common first, then what is placed but quiet", () => {
    const agents: { tokens: Record<string, string> }[] = [
      { tokens: { tree: "7", branch: "main", notify: "hi" } },
      { tokens: { tree: "9", context: "" } },
    ];
    expect(reported(agents, spec)).toEqual([
      { name: "tree", sample: "7", agents: 2 },
      { name: "branch", sample: "main", agents: 1 },
      { name: "stage", sample: "", agents: 0 },
      { name: "skill", sample: "", agents: 0 },
      { name: "context", sample: "", agents: 0 },
      { name: "account", sample: "", agents: 0 },
    ]);
  });

  test("a format is guessed from the value", () => {
    expect(guessFormat("3/7")).toBe("dots");
    expect(guessFormat("61")).toBe("meter");
    expect(guessFormat("1760450400000")).toBe("ago");
    expect(guessFormat("2026-10-14T15:20:00Z")).toBe("ago");
    expect(guessFormat("main")).toBe("chip");
    expect(guessFormat("Writing the ranking tests for ties")).toBe("text");
  });
});
