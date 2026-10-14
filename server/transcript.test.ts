import { afterAll, describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { askAnswers, findTranscript, parseEntries, readFrom, readTail, userText } from "./transcript";

const line = (o: unknown) => JSON.stringify(o);

describe("userText", () => {
  test("a slash command reads as the command and its arguments", () => {
    expect(userText("<command-message>start</command-message>\n<command-name>/start</command-name>\n<command-args>unit 3</command-args>")).toEqual({
      kind: "user",
      text: "/start unit 3",
    });
  });
  test("system reminders are taken out of what the person typed", () => {
    expect(userText("고쳐줘<system-reminder>internal</system-reminder>")).toEqual({ kind: "user", text: "고쳐줘" });
  });
  test("task notifications are not messages", () => {
    expect(userText("<task-notification><summary>done</summary></task-notification>")).toBeNull();
  });
  test("command output becomes a note", () => {
    expect(userText("<local-command-stdout>Set model to opus</local-command-stdout>")).toEqual({ kind: "note", text: "Set model to opus" });
  });
});

describe("askAnswers", () => {
  test("pulls the answers out of AskUserQuestion's result", () => {
    expect(askAnswers('User has answered your questions: "어떻게 갈까요?"="2,3 다 해보자", "연결?"="웹앱". You can now continue.')).toBe("2,3 다 해보자\n웹앱");
  });
  test("ignores other tool results", () => {
    expect(askAnswers("file written")).toBeNull();
  });
});

describe("parseEntries", () => {
  const entries = [
    line({ type: "user", uuid: "u1", message: { role: "user", content: "안녕" } }),
    line({ type: "user", uuid: "u2", isMeta: true, message: { role: "user", content: "skill body" } }),
    line({
      type: "assistant",
      uuid: "a1",
      message: {
        content: [
          { type: "thinking", thinking: "hidden" },
          { type: "text", text: "보겠습니다." },
          { type: "tool_use", id: "t1", name: "Bash", input: { command: "ls -la\npwd", description: "List files" } },
          { type: "tool_use", id: "t2", name: "Read", input: { file_path: "/root/a/b/c.ts" } },
        ],
      },
    }),
    line({ type: "user", uuid: "u3", message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: "boom" }] } }),
    line({ type: "assistant", uuid: "a2", isSidechain: true, message: { content: [{ type: "text", text: "subagent" }] } }),
    line({ type: "attachment", uuid: "q1", attachment: { type: "queued_command", prompt: "중간에 보낸 말", humanTurn: true } }),
    line({
      type: "assistant",
      uuid: "a3",
      message: { content: [{ type: "tool_use", id: "t3", name: "AskUserQuestion", input: { questions: [{ question: "어느 쪽?", options: [{ label: "A" }, { label: "B" }], multiSelect: false }] } }] },
    }),
    line({ type: "system", uuid: "s1", subtype: "compact_boundary" }),
    "{not json",
  ];

  const items = parseEntries(entries);

  test("keeps what people and the agent said, drops meta, thinking and sidechains", () => {
    expect(items.map((i) => i.kind)).toEqual(["user", "assistant", "tool", "tool", "tool-error", "user", "ask", "note"]);
  });

  test("summarises tool calls by what they did", () => {
    const tools = items.filter((i) => i.kind === "tool");
    expect(tools[0]).toMatchObject({ id: "t1", name: "Bash", summary: "List files", detail: "ls -la\npwd" });
    expect(tools[1]).toMatchObject({ id: "t2", name: "Read", summary: "b/c.ts" });
  });

  test("marks the failed tool by its id", () => {
    expect(items.find((i) => i.kind === "tool-error")).toMatchObject({ target: "t1" });
  });

  test("shows a question's options", () => {
    expect(items.find((i) => i.kind === "ask")).toMatchObject({ questions: [{ question: "어느 쪽?", options: ["A", "B"], multi: false }] });
  });
});

describe("reading the file", () => {
  const dir = mkdtempSync(join(tmpdir(), "arcdr-transcript-"));
  const project = join(dir, "-root-proj");
  const id = "0123abcd-0000-4000-8000-000000000000";
  const file = join(project, `${id}.jsonl`);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("finds a session's file under any project directory", () => {
    mkdirSync(project);
    writeFileSync(file, "");
    expect(findTranscript([dir], id)).toBe(file);
    expect(findTranscript([dir], "../../etc/passwd")).toBeNull();
  });

  test("leaves a line still being written for the next read", () => {
    writeFileSync(file, line({ type: "user", uuid: "u1", message: { content: "one" } }) + "\n" + '{"type":"user","uuid":"u2"');
    const first = readTail(file);
    expect(first.items.map((i) => (i as { text: string }).text)).toEqual(["one"]);

    appendFileSync(file, ',"message":{"content":"two"}}\n');
    const next = readFrom(file, first.offset);
    expect(next.items.map((i) => (i as { text: string }).text)).toEqual(["two"]);
    expect(readFrom(file, next.offset).items).toEqual([]);
  });

  test("a file shorter than the offset starts over", () => {
    writeFileSync(file, line({ type: "user", uuid: "u9", message: { content: "fresh" } }) + "\n");
    const chunk = readFrom(file, 10_000);
    expect(chunk.reset).toBe(true);
    expect(chunk.items).toHaveLength(1);
  });

  test("a tail read that starts mid-file drops the partial first line", () => {
    const big = Array.from({ length: 50 }, (_, i) => line({ type: "user", uuid: `u${i}`, message: { content: `m${i}` } })).join("\n") + "\n";
    writeFileSync(file, big);
    const chunk = readTail(file, { window: 300, maxWindow: 300 });
    expect(chunk.clipped).toBe(true);
    expect(chunk.items.length).toBeGreaterThan(0);
    expect((chunk.items.at(-1) as { text: string }).text).toBe("m49");
  });
});

describe("readTail widening", () => {
  const dir = mkdtempSync(join(tmpdir(), "arcdr-tail-"));
  const file = join(dir, "s.jsonl");
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("reads further back when the end of the file is all bookkeeping", () => {
    const talk = Array.from({ length: 5 }, (_, i) => line({ type: "user", uuid: `u${i}`, message: { content: `m${i}` } }));
    const filler = Array.from({ length: 40 }, (_, i) => line({ type: "attachment", uuid: `f${i}`, attachment: { type: "prompt_snapshot", text: "x".repeat(200) } }));
    writeFileSync(file, [...talk, ...filler].join("\n") + "\n");
    expect(readTail(file, { window: 500, minTalk: 5 }).items).toHaveLength(5);
    expect(readTail(file, { window: 500, minTalk: 5, maxWindow: 500 }).items).toHaveLength(0);
  });
});

describe("queue operations", () => {
  const q = (operation: string, content?: string) => line({ type: "queue-operation", operation, timestamp: `t-${operation}-${content ?? ""}`, ...(content === undefined ? {} : { content }) });
  const items = parseEntries([
    q("enqueue", "이것도 봐줘"),
    q("enqueue", "<task-notification><summary>done</summary></task-notification>"),
    q("remove", "이것도 봐줘"),
    q("dequeue"),
  ]);

  test("a message sent while the agent works is added, then removed or taken", () => {
    expect(items.map((i) => (i.kind === "queue" ? [i.op, i.text, i.hidden] : i.kind))).toEqual([
      ["add", "이것도 봐줘", false],
      ["add", "<task-notification><summary>done</summary></task-notification>", true],
      ["remove", "이것도 봐줘", false],
      ["take", "", false],
    ]);
  });
});
