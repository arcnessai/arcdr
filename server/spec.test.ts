import { describe, expect, test } from "bun:test";
import { fromHerdrConfig } from "./display";
import { cleanSpec, matches, valueOf } from "./spec";

const HERDR = `
[ui]
[ui.sidebar.agents.rows_by_agent]
claude = [
  [{ token = "$tree", fg = "#8be9fd", bold = true }, "state_icon", "machine", "tab"],
  [{ token = "$stage", fg = "#bd93f9", rules = [
    { starts_with = "◐", fg = "#f1fa8c" },
    { starts_with = "✓", fg = "#50fa7b", bold = true },
    { starts_with = "○", dim = true },
  ] }],
]
[ui.sidebar.spaces]
rows = [["label"], [{ token = "$agents", fg = "#6272a4" }]]
`;

describe("fromHerdrConfig", () => {
  const spec = fromHerdrConfig(HERDR)!;
  test("a token before the tab name becomes the badge", () => {
    expect(spec.agent.badge).toEqual({ from: "token:tree", color: "cyan", bold: true });
  });
  test("later rows become the line under the name, with their rules and herdr's colours named", () => {
    expect(spec.agent.line?.[0]).toEqual({
      from: "token:stage",
      color: "purple",
      rules: [
        { startsWith: "◐", color: "yellow" },
        { startsWith: "✓", color: "green", bold: true },
        { startsWith: "○", dim: true },
      ],
    });
    expect(spec.agent.line?.at(-1)?.from).toBe("field:conversation");
  });
  test("space rows become the space line", () => {
    expect(spec.space.line).toEqual([{ from: "token:agents", color: "dim" }]);
  });
  test("no sidebar rows, no spec", () => {
    expect(fromHerdrConfig("[ui]\ntheme = 'dracula'")).toBeNull();
    expect(fromHerdrConfig("not toml [[[")).toBeNull();
  });
});

describe("cleanSpec", () => {
  test("keeps what is valid and names what is not", () => {
    const { spec, errors } = cleanSpec({
      agent: { badge: { from: "token:tree" }, line: [{ from: "token:stage", as: "sparkles" }, { from: "nope" }] },
      band: [
        {
          left: [{ from: "token:progress", as: "dots" }],
          right: [{ from: "token:context", as: "meter", rules: [{ above: 80, color: "red" }] }],
        },
      ],
      alerts: [{ from: "token:stage", startsWith: "◇", body: "{name}: {value}" }, { from: "token:x" }],
      commands: [{ name: "start-status", detail: "preview" }, { name: "bad name!" }],
    });
    expect(spec.agent.badge).toEqual({ from: "token:tree" });
    expect(spec.agent.line).toEqual([{ from: "token:stage" }]);
    expect(spec.band?.[0]?.right?.[0]).toEqual({ from: "token:context", as: "meter", rules: [{ above: 80, color: "red" }] });
    expect(spec.alerts).toEqual([{ from: "token:stage", startsWith: "◇", body: "{name}: {value}" }]);
    expect(spec.commands).toEqual([{ name: "start-status", detail: "preview" }]);
    expect(errors).toEqual([
      "agent.line[0].as must be one of text, chip, badge, dots, meter, ago",
      "agent.line[1].from must be token:<name>, field:<name>, text:<words> or tokens:rest",
      "alerts[1] needs from and body",
    ]);
  });
  test("a broken regular expression is dropped, not thrown", () => {
    const { errors } = cleanSpec({ agent: { line: [{ from: "token:a", rules: [{ matches: "(" }] }] } });
    expect(errors).toEqual(["agent.line[0].rules[0].matches is not a regular expression"]);
  });
});

describe("valueOf and matches", () => {
  const agent = {
    tokens: { stage: "◇ 입력 대기", context: "83" },
    tabLabel: "빌드",
    title: "",
    conversation: " ",
    kind: "claude",
    status: "blocked",
  };
  test("reads tokens, fields and literals; empty is null", () => {
    expect(valueOf("token:stage", agent)).toBe("◇ 입력 대기");
    expect(valueOf("field:tab", agent)).toBe("빌드");
    expect(valueOf("field:conversation", agent)).toBeNull();
    expect(valueOf("token:missing", agent)).toBeNull();
    expect(valueOf("text:start", agent)).toBe("start");
  });
  test("every condition given must hold", () => {
    expect(matches({ startsWith: "◇" }, "◇ 입력 대기")).toBe(true);
    expect(matches({ above: 80 }, "83")).toBe(true);
    expect(matches({ above: 80, below: 82 }, "83")).toBe(false);
    expect(matches({ matches: "^\\d+$" }, "83")).toBe(true);
    expect(matches({ contains: "x" }, "83")).toBe(false);
  });
});
