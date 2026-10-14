import { describe, expect, test } from "bun:test";
import { parseBlocks } from "./markdown";

describe("parseBlocks", () => {
  test("splits fences, headings, lists, tables and paragraphs", () => {
    const blocks = parseBlocks(
      ["## 결과", "", "둘 다 됩니다.", "줄을 바꿔도 같은 문단", "", "- 하나", "- 둘", "", "| a | b |", "|---|---|", "| 1 | 2 |", "", "```ts", "const x = 1;", "```"].join("\n"),
    );
    expect(blocks.map((b) => b.t)).toEqual(["h", "p", "list", "table", "code"]);
    expect(blocks[1]).toEqual({ t: "p", text: "둘 다 됩니다.\n줄을 바꿔도 같은 문단" });
    expect(blocks[3]).toEqual({ t: "table", head: ["a", "b"], rows: [["1", "2"]] });
    expect(blocks[4]).toEqual({ t: "code", lang: "ts", text: "const x = 1;" });
  });

  test("keeps an ordered list's own numbers and nests indented items", () => {
    const [list] = parseBlocks("3. 셋\n4. 넷\n   - 넷의 하위");
    expect(list).toEqual({
      t: "list",
      ordered: true,
      items: [
        { depth: 0, text: "셋", n: "3." },
        { depth: 0, text: "넷", n: "4." },
        { depth: 1, text: "넷의 하위", n: "-" },
      ],
    });
  });

  test("an unclosed fence runs to the end instead of swallowing nothing", () => {
    expect(parseBlocks("```\nopen")).toEqual([{ t: "code", lang: "", text: "open" }]);
  });

  test("HTML in the text stays text", () => {
    expect(parseBlocks("<img src=x onerror=alert(1)>")).toEqual([{ t: "p", text: "<img src=x onerror=alert(1)>" }]);
  });
});
