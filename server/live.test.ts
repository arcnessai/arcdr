import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent, Snapshot } from "./herdr";
import { LiveSessions, readSessionFile } from "./live";

const dir = mkdtempSync(join(tmpdir(), "arcdr-live-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const PERSON = "e57d7b55-bd46-4cb5-80cd-9aaca562b765";
const JOB = "bbb7e3ed-0000-4000-8000-000000000000";
const agent = (pane: string, sessionId: string | null, kind = "claude"): Agent => ({
  pane,
  space: "w3",
  tab: `${pane}t`,
  tabNumber: 1,
  tabLabel: "",
  title: "",
  conversation: "",
  status: "working",
  kind,
  tokens: {},
  sessionId,
  cwd: "/root",
});
const snap = (...agents: Agent[]): Snapshot => ({ version: "0.9.3", spaces: [], agents });

describe("a pane's live session", () => {
  test("is the one its own interactive Claude Code is in, even when a job reported another to herdr", async () => {
    writeFileSync(join(dir, "4020995.json"), JSON.stringify({ sessionId: PERSON, kind: "interactive", cwd: "/root" }));
    const live = new LiveSessions(async (pane) => (pane === "w3:p0" ? [4020995] : []), dir);
    const out = await live.apply(snap(agent("w3:p0", JOB), agent("w3:p1", JOB), agent("w3:p2", null, "codex")));
    expect(out.agents.map((a) => a.sessionId)).toEqual([PERSON, JOB, null]);
  });

  test("follows /clear without asking herdr again, and asks for the process again only after a while", async () => {
    let asked = 0;
    const file = join(dir, "77.json");
    writeFileSync(file, JSON.stringify({ sessionId: PERSON, kind: "interactive" }));
    const live = new LiveSessions(async () => (asked++, [77]), dir, 60_000);
    await live.apply(snap(agent("w1:p1", null)));
    writeFileSync(file, JSON.stringify({ sessionId: JOB, kind: "interactive" }));
    const out = await live.apply(snap(agent("w1:p1", null)));
    expect(out.agents[0]!.sessionId).toBe(JOB);
    expect(asked).toBe(1);
  });

  test("a file that is not an interactive session's says nothing", () => {
    writeFileSync(join(dir, "1.json"), JSON.stringify({ sessionId: PERSON, kind: "print" }));
    writeFileSync(join(dir, "2.json"), "{not json");
    expect(readSessionFile(join(dir, "1.json"))).toBeNull();
    expect(readSessionFile(join(dir, "2.json"))).toBeNull();
    expect(readSessionFile(join(dir, "none.json"))).toBeNull();
  });
});
