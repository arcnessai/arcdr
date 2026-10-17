import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent, Snapshot } from "./herdr";
import { eventFor, Notifier, PushStore, validEndpoint, type PushSubscriptionRecord } from "./push";

const dir = mkdtempSync(join(tmpdir(), "arcdr-push-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const agent = (pane: string, status: Agent["status"]): Agent => ({
  pane,
  space: "w1",
  tab: "w1:t1",
  tabNumber: 1,
  tabLabel: "build",
  title: "",
  conversation: "",
  status,
  kind: "claude",
  tokens: { tree: "7" },
  sessionId: null,
  cwd: "/tmp",
});
const snap = (...agents: Agent[]): Snapshot => ({ version: "0.9.3", spaces: [], agents });
const sub = (endpoint: string, prefs: Partial<PushSubscriptionRecord> = {}): PushSubscriptionRecord => ({
  endpoint,
  keys: { p256dh: "BNcR", auth: "tBH" },
  lang: "ko",
  blocked: true,
  done: false,
  custom: true,
  ...prefs,
});

describe("validEndpoint", () => {
  test("accepts the browsers' push services", () => {
    expect(validEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(validEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(true);
    expect(validEndpoint("https://web.push.apple.com/QGuQ")).toBe(true);
    expect(validEndpoint("https://wns2-par02p.notify.windows.com/w/?token=x")).toBe(true);
  });
  test("refuses anything else, so the server cannot be made to post elsewhere", () => {
    expect(validEndpoint("https://example.com/push")).toBe(false);
    expect(validEndpoint("http://fcm.googleapis.com/fcm/send/abc")).toBe(false);
    expect(validEndpoint("https://fcm.googleapis.com:8443/x")).toBe(false);
    expect(validEndpoint("https://fcm.googleapis.com.evil.example/x")).toBe(false);
    expect(validEndpoint("https://127.0.0.1/")).toBe(false);
    expect(validEndpoint("not a url")).toBe(false);
  });
});

describe("eventFor", () => {
  test("starting to wait for the person, and a turn of work ending", () => {
    expect(eventFor("working", "blocked")).toBe("blocked");
    expect(eventFor("idle", "blocked")).toBe("blocked");
    expect(eventFor("working", "done")).toBe("done");
    expect(eventFor("working", "idle")).toBe("done");
  });
  test("nothing for other changes", () => {
    expect(eventFor("blocked", "blocked")).toBeNull();
    expect(eventFor("blocked", "working")).toBeNull();
    expect(eventFor("done", "idle")).toBeNull();
    expect(eventFor("idle", "working")).toBeNull();
  });
});

describe("Notifier", () => {
  test("rings each subscriber that asked for the event, once per quiet window, never for the first snapshot", async () => {
    const store = new PushStore(join(dir, "a.json"));
    store.save(sub("https://fcm.googleapis.com/fcm/send/blocked-only"));
    store.save(sub("https://fcm.googleapis.com/fcm/send/both", { done: true, lang: "en" }));
    const sent: { endpoint: string; body: string; title: string }[] = [];
    const n = new Notifier(store, async (s, payload) => {
      const p = JSON.parse(payload);
      sent.push({ endpoint: s.endpoint.split("/").pop()!, body: p.body, title: p.title });
    });

    n.observe(snap(agent("w1:p1", "blocked")));
    await Bun.sleep(0);
    expect(sent).toEqual([]);

    n.observe(snap(agent("w1:p1", "working")));
    n.observe(snap(agent("w1:p1", "done")));
    n.observe(snap(agent("w1:p1", "blocked")));
    n.observe(snap(agent("w1:p1", "working")));
    n.observe(snap(agent("w1:p1", "blocked")));
    await Bun.sleep(0);
    expect(sent).toEqual([
      { endpoint: "both", body: "Finished", title: "7 build" },
      { endpoint: "blocked-only", body: "답이 필요합니다", title: "7 build" },
      { endpoint: "both", body: "Needs your answer", title: "7 build" },
    ]);
  });

  test("forgets a subscription the push service says is gone, and keeps one that failed for another reason", async () => {
    const store = new PushStore(join(dir, "b.json"));
    store.save(sub("https://fcm.googleapis.com/fcm/send/gone"));
    store.save(sub("https://fcm.googleapis.com/fcm/send/flaky"));
    const n = new Notifier(store, async (s) => {
      throw Object.assign(new Error("push failed"), { statusCode: s.endpoint.endsWith("gone") ? 410 : 503 });
    });
    n.observe(snap(agent("w1:p1", "working")));
    n.observe(snap(agent("w1:p1", "blocked")));
    await Bun.sleep(0);
    expect(store.list().map((s) => s.endpoint.split("/").pop())).toEqual(["flaky"]);
    expect(statSync(join(dir, "b.json")).mode & 0o777).toBe(0o600);
  });
});

describe("alerts from mod values", () => {
  test("ring when a value starts to match, not while it keeps matching, and only for subscribers who want them", async () => {
    const store = new PushStore(join(dir, "c.json"));
    store.save(sub("https://fcm.googleapis.com/fcm/send/yes"));
    store.save(sub("https://fcm.googleapis.com/fcm/send/no", { custom: false }));
    const bodies: string[] = [];
    const n = new Notifier(
      store,
      async (s, payload) => void bodies.push(`${s.endpoint.split("/").pop()}: ${JSON.parse(payload).body}`),
      () => [{ from: "token:stage", startsWith: "◇", body: "{name} — {value}" }],
    );
    const withStage = (stage: string) => ({ ...agent("w1:p1", "working"), tokens: { stage } });
    n.observe(snap(withStage("● 작업 중")));
    n.observe(snap(withStage("◇ 입력 대기")));
    n.observe(snap(withStage("◇ 입력 대기 · 2분")));
    await Bun.sleep(0);
    expect(bodies).toEqual(["yes: build — ◇ 입력 대기"]);
  });
});

describe("notify from a mod", () => {
  test("each new value of the notify token is one notification; the same value standing still is not", async () => {
    const store = new PushStore(join(dir, "d.json"));
    store.save(sub("https://fcm.googleapis.com/fcm/send/yes"));
    store.save(sub("https://fcm.googleapis.com/fcm/send/no", { custom: false }));
    const bodies: string[] = [];
    const n = new Notifier(
      store,
      async (s, payload) => void bodies.push(`${s.endpoint.split("/").pop()}: ${JSON.parse(payload).body}`),
    );
    const saying = (notify?: string) => ({
      ...agent("w1:p1", "working"),
      tokens: notify ? { notify } : ({} as Record<string, string>),
    });
    n.observe(snap(saying("left over from before")));
    n.observe(snap(saying("Tests failed: 3")));
    n.observe(snap(saying("Tests failed: 3")));
    n.observe(snap(saying()));
    await Bun.sleep(0);
    expect(bodies).toEqual(["yes: Tests failed: 3"]);
  });
});

describe("the same words from several panes", () => {
  test("ring once; other words still ring", async () => {
    const store = new PushStore(join(dir, "e.json"));
    store.save(sub("https://fcm.googleapis.com/fcm/send/yes"));
    const bodies: string[] = [];
    const n = new Notifier(store, async (_s, payload) => void bodies.push(JSON.parse(payload).body));
    const pane = (id: string, notify?: string) => ({
      ...agent(id, "working"),
      tokens: notify ? { notify } : ({} as Record<string, string>),
    });
    n.observe(snap(pane("w1:p1"), pane("w1:p2"), pane("w1:p3")));
    n.observe(snap(pane("w1:p1", "auto-mode — plan: ROW-B 넘김"), pane("w1:p2"), pane("w1:p3")));
    n.observe(snap(pane("w1:p1", "auto-mode — plan: ROW-B 넘김"), pane("w1:p2", "auto-mode — plan: ROW-B 넘김"), pane("w1:p3")));
    n.observe(
      snap(
        pane("w1:p1", "auto-mode — plan: ROW-B 넘김"),
        pane("w1:p2", "auto-mode — plan: ROW-B 넘김"),
        pane("w1:p3", "build done"),
      ),
    );
    await Bun.sleep(0);
    expect(bodies).toEqual(["auto-mode — plan: ROW-B 넘김", "build done"]);
  });
});
