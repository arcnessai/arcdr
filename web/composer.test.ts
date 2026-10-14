import { describe, expect, test } from "bun:test";

import { tokenAt } from "./token";

describe("tokenAt", () => {
  test("a slash command only at the very start", () => {
    expect(tokenAt("/com", 4)).toEqual({ kind: "slash", start: 0, end: 4, query: "com" });
    expect(tokenAt("see /com", 8)).toBeNull();
    expect(tokenAt("/compact now", 12)).toBeNull();
  });

  test("an @path wherever the caret is", () => {
    expect(tokenAt("look at @web/ch", 15)).toEqual({ kind: "file", start: 8, end: 15, query: "web/ch" });
    expect(tokenAt("@", 1)).toEqual({ kind: "file", start: 0, end: 1, query: "" });
    expect(tokenAt("mail me@example.com", 19)).toBeNull();
  });

  test("the caret decides: text after it does not count", () => {
    expect(tokenAt("@web and more", 4)).toEqual({ kind: "file", start: 0, end: 4, query: "web" });
  });
});
