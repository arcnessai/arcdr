import { describe, expect, test } from "bun:test";
import { beside, close, EMPTY, layoutOf, parseSplit, prune, show } from "./split";

describe("the desktop's panes", () => {
  test("a plain click focuses an agent already open, or puts it in the focused pane", () => {
    const s = { panes: ["a", "b"], focus: "a" };
    expect(show(s, "b")).toEqual({ panes: ["a", "b"], focus: "b" });
    expect(show(s, "c")).toEqual({ panes: ["c", "b"], focus: "c" });
    expect(show(EMPTY, "a")).toEqual({ panes: ["a"], focus: "a" });
  });

  test("opening beside adds a pane up to four, then takes the focused one's place", () => {
    let s = show(EMPTY, "a");
    for (const p of ["b", "c", "d"]) s = beside(s, p);
    expect(s).toEqual({ panes: ["a", "b", "c", "d"], focus: "d" });
    expect(beside({ ...s, focus: "b" }, "e")).toEqual({ panes: ["a", "e", "c", "d"], focus: "e" });
    expect(beside(s, "a")).toEqual({ ...s, focus: "a" });
  });

  test("closing the focused pane hands the focus to the one that slides into its place", () => {
    const s = { panes: ["a", "b", "c"], focus: "b" };
    expect(close(s, "b")).toEqual({ panes: ["a", "c"], focus: "c" });
    expect(close({ ...s, focus: "c" }, "c")).toEqual({ panes: ["a", "b"], focus: "b" });
    expect(close(s, "a")).toEqual({ panes: ["b", "c"], focus: "b" });
    expect(close({ panes: ["a"], focus: "a" }, "a")).toEqual(EMPTY);
  });

  test("a closed session's pane goes", () => {
    expect(prune({ panes: ["a", "b", "c"], focus: "b" }, new Set(["a", "c"]))).toEqual({ panes: ["a", "c"], focus: "c" });
  });

  test("the layout follows the count, and storage that makes no sense reads as nothing", () => {
    expect([1, 2, 3, 4].map(layoutOf)).toEqual(["one", "two", "three", "four"]);
    expect(parseSplit('{"panes":["a","b",3],"focus":"z"}')).toEqual({ panes: ["a", "b"], focus: "a" });
    expect(parseSplit("not json")).toEqual(EMPTY);
  });
});
