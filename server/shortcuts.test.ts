import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanShortcuts, MAX_SHORTCUTS, ShortcutStore } from "./shortcuts";

const dir = mkdtempSync(join(tmpdir(), "arcdr-shortcuts-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("shortcuts", () => {
  test("a list is trimmed and filled in", () => {
    expect(
      cleanShortcuts([
        { text: " /compact ", send: true },
        { text: "/start", label: " unit " },
      ]),
    ).toEqual({
      list: [
        { text: "/compact", label: "", send: true },
        { text: "/start", label: "unit", send: false },
      ],
    });
  });

  test("what cannot be kept is refused with the reason, not dropped", () => {
    expect(cleanShortcuts({ text: "/x" })).toEqual({ error: "shortcuts must be a list" });
    expect(cleanShortcuts([{ text: "  " }])).toEqual({ error: "shortcut 1 has no text" });
    expect(cleanShortcuts([{ text: "/x", run: "rm" }])).toEqual({ error: "shortcut 1 has unknown fields: run" });
    expect("error" in cleanShortcuts(Array.from({ length: MAX_SHORTCUTS + 1 }, () => ({ text: "/x" })))).toBe(true);
  });

  test("the store keeps the list private and reads a broken file as empty", () => {
    const store = new ShortcutStore(join(dir, "a", "shortcuts.json"));
    expect(store.list()).toEqual([]);
    store.save([{ text: "/compact", label: "", send: true }]);
    expect(store.list()).toEqual([{ text: "/compact", label: "", send: true }]);
    expect(statSync(join(dir, "a", "shortcuts.json")).mode & 0o777).toBe(0o600);
    writeFileSync(join(dir, "a", "shortcuts.json"), "{not json");
    expect(store.list()).toEqual([]);
  });
});
