import { describe, expect, test } from "bun:test";
import { keysToChoose, parseMenu, parseMode } from "./screen";

const PERMISSION = `
● Running the tests now.

╭──────────────────────────────────────────────────────╮
│ Bash command                                          │
│                                                       │
│   bun test                                            │
│   Run the unit tests                                  │
│                                                       │
│ Do you want to proceed?                               │
│ ❯ 1. Yes                                              │
│   2. Yes, and don't ask again for bun test commands   │
│   3. No, and tell Claude what to do differently (esc) │
╰──────────────────────────────────────────────────────╯
`;

const ASK = `
────────────────────────────────────────
 ☐ 연결 화면

첫 화면의 Tailscale 연결은 어떻게 할까요?

  1. 웹앱 + Tailscale 앱 열기 (Recommended)
     홈 화면에 설치한 웹앱이 연결 상태를 보여준다
❯ 2. Tailscale 내장 안드로이드 앱
     앱 안에서 로그인까지
  3. Type something.

Enter to select · ↑/↓ to navigate · Esc to cancel
`;

// AskUserQuestion as Claude Code 2.1 draws it: the last option sits under a rule, and a rule cut at the
// pane's width ends in a replacement character.
const ASK_WITH_CHAT = [
  "● Two rows are ready.",
  "─".repeat(46) + "\uFFFD",
  " ☐ Next unit",
  "",
  "Which row should open next?",
  "",
  "❯ 1. Measure the skill text (Recommended)",
  "     Checks whether the expanded skill reaches the guard model as an instruction. It costs a run.",
  "  2. Import dialog spec fails",
  "     The spec fails in all eight cases.",
  "  3. Type something.",
  "─".repeat(46) + "\uFFFD",
  "  4. Chat about this",
  "",
  "Enter to select · ↑/↓ to navigate · Esc to cancel",
].join("\n");

describe("parseMenu", () => {
  test("reads a permission prompt inside a box", () => {
    const m = parseMenu(PERMISSION)!;
    expect(m.choices.map((c) => c.label)).toEqual([
      "Yes",
      "Yes, and don't ask again for bun test commands",
      "No, and tell Claude what to do differently (esc)",
    ]);
    expect(m.cursor).toBe(0);
    expect(m.context).toEqual(["Bash command", "", "bun test", "Run the unit tests", "", "Do you want to proceed?"]);
  });

  test("reads an AskUserQuestion menu with details and the cursor below the top", () => {
    const m = parseMenu(ASK)!;
    expect(m.choices.map((c) => c.n)).toEqual([1, 2, 3]);
    expect(m.choices[0]!.detail).toEqual(["홈 화면에 설치한 웹앱이 연결 상태를 보여준다"]);
    expect(m.choices[1]!.detail).toEqual(["앱 안에서 로그인까지"]);
    expect(m.cursor).toBe(1);
    expect(m.context.at(-1)).toBe("첫 화면의 Tailscale 연결은 어떻게 할까요?");
    expect(m.context).not.toContain("Enter to select · ↑/↓ to navigate · Esc to cancel");
  });

  test("keeps the option under AskUserQuestion's rule, and a rule cut mid-character still ends the context", () => {
    const m = parseMenu(ASK_WITH_CHAT)!;
    expect(m.choices.map((c) => `${c.n} ${c.label}`)).toEqual([
      "1 Measure the skill text (Recommended)",
      "2 Import dialog spec fails",
      "3 Type something.",
      "4 Chat about this",
    ]);
    expect(m.cursor).toBe(0);
    expect(m.context).toEqual(["☐ Next unit", "", "Which row should open next?"]);
  });

  test("reads the folder trust dialog, which numbers nothing", () => {
    const screen = [
      " /tmp/new-project",
      " Quick safety check: Is this a project you created or one you trust?",
      " Claude Code'll be able to read, edit, and execute files here.",
      " Security guide",
      " ❯ No, exit",
      "   Yes, I trust this folder",
      " Enter to confirm · Esc to cancel",
    ].join("\n");
    const m = parseMenu(screen)!;
    expect(m.choices.map((c) => c.label)).toEqual(["No, exit", "Yes, I trust this folder"]);
    expect(m.cursor).toBe(0);
    expect(keysToChoose(m, 2)).toEqual(["down", "enter"]);
  });

  test("the prompt line's ❯ with no hint under it is not a menu", () => {
    expect(parseMenu("● Done.\n❯ \n  ⏵⏵ accept edits on (shift+tab to cycle)\n")).toBeNull();
  });

  test("reads ticked and unticked boxes of a multi-select menu", () => {
    const m = parseMenu("Pick some\n❯ 1. [✔] Alpha\n  2. [ ] Beta\n")!;
    expect(m.choices.map((c) => [c.label, c.checked])).toEqual([
      ["Alpha", true],
      ["Beta", false],
    ]);
  });

  test("a numbered list without a cursor is output, not a menu", () => {
    expect(parseMenu("Plan:\n  1. Read the code\n  2. Write tests\n  3. Ship\n")).toBeNull();
  });

  test("a lone line that looks like an option is not a menu", () => {
    expect(parseMenu("❯ 1. typed into the prompt box\n")).toBeNull();
  });

  test("numbering with a gap is not a menu", () => {
    expect(parseMenu("❯ 1. One\n  3. Three\n")).toBeNull();
  });

  test("a menu with more output under it was answered earlier", () => {
    const later = Array.from({ length: 8 }, (_, i) => `● step ${i}`).join("\n");
    expect(parseMenu(`Proceed?\n❯ 1. Yes\n  2. No\n${later}\n`)).toBeNull();
    expect(parseMenu("Proceed?\n❯ 1. Yes\n  2. No\n\nEnter to select · Esc to cancel\n")).not.toBeNull();
  });

  test("an earlier numbered list in the output does not merge into the menu", () => {
    const screen = "Steps:\n  1. Read\n  2. Write\n\nProceed?\n❯ 1. Yes\n  2. No\n";
    const m = parseMenu(screen)!;
    expect(m.choices.map((c) => c.label)).toEqual(["Yes", "No"]);
  });
});

describe("keysToChoose", () => {
  test("moves down from the cursor and confirms", () => {
    expect(keysToChoose(parseMenu(PERMISSION)!, 3)).toEqual(["down", "down", "enter"]);
  });
  test("moves up when the target is above the cursor", () => {
    expect(keysToChoose(parseMenu(ASK)!, 1)).toEqual(["up", "enter"]);
  });
  test("only confirms when the cursor is already there", () => {
    expect(keysToChoose(parseMenu(PERMISSION)!, 1)).toEqual(["enter"]);
  });
  test("refuses an option the menu does not have", () => {
    expect(keysToChoose(parseMenu(PERMISSION)!, 7)).toBeNull();
  });
});

describe("parseMode", () => {
  test("names the mode the footer shows, and none for the default", () => {
    expect(parseMode("❯ \n  ⏵⏵ bypass permissions on · 1 shell · ← for agents")).toBe("bypassPermissions");
    expect(parseMode("  ⏵⏵ accept edits on (shift+tab to cycle)")).toBe("acceptEdits");
    expect(parseMode("  ⏸ plan mode on (shift+tab to cycle)")).toBe("plan");
    expect(parseMode("  ? for shortcuts")).toBeNull();
  });
});
