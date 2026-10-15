import { describe, expect, test } from "bun:test";
import { applyMove, isSamePlace } from "./reorder";

const list = ["a", "b", "c", "d"].map((pane) => ({ pane }));
const panes = (l: { pane: string }[]) => l.map((x) => x.pane).join("");

describe("moving an agent in the list", () => {
  test("before another, forwards or backwards, or to the end", () => {
    expect(panes(applyMove(list, "a", "c"))).toBe("bacd");
    expect(panes(applyMove(list, "d", "a"))).toBe("dabc");
    expect(panes(applyMove(list, "b", null))).toBe("acdb");
  });
  test("a move that names nothing known changes nothing", () => {
    expect(applyMove(list, "z", "a")).toBe(list);
    expect(applyMove(list, "a", "z")).toBe(list);
    expect(applyMove(list, "a", "a")).toBe(list);
  });
  test("dropping a row where it already is, is no move", () => {
    const order = ["a", "b", "c"];
    expect(isSamePlace(order, "a", "b")).toBe(true);
    expect(isSamePlace(order, "c", null)).toBe(true);
    expect(isSamePlace(order, "a", "c")).toBe(false);
  });
});
