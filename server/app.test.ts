import { describe, expect, test } from "bun:test";
import { createApp, type Backend } from "./app";
import type { Agent, Snapshot } from "./herdr";
import type { PushSubscriptionRecord } from "./push";
import type { Shortcut } from "./shortcuts";
import type { DisplaySpec } from "./spec";

const agent: Agent = {
  pane: "w1:p1",
  space: "w1",
  tab: "w1:t1",
  tabNumber: 1,
  tabLabel: "build",
  title: "",
  conversation: "",
  status: "blocked",
  kind: "claude",
  tokens: {},
  sessionId: null,
  cwd: "/tmp",
};
const MENU = "Do you want to proceed?\n❯ 1. Yes\n  2. No\n";

function setup() {
  const keys: string[][] = [];
  const saved: PushSubscriptionRecord[] = [];
  let shortcuts: Shortcut[] = [];
  const savedDisplays: DisplaySpec[] = [];
  const snapshot: Snapshot = {
    version: "0.9.3",
    spaces: [{ id: "w1", number: 1, label: "s", status: "blocked", tokens: {} }],
    agents: [agent],
  };
  const backend: Backend = {
    snapshot: async () => snapshot,
    subscribe: () => () => {},
    readScreen: async () => MENU,
    prompt: async () => {},
    sendInput: async () => {},
    sendKeys: async (_pane, k) => void keys.push(k),
    transcript: () => null,
    complete: () => [],
    pastSessions: () => [],
    startSession: async () => "w1:p9",
    closePane: async () => {},
  };
  const handle = createApp({
    backend,
    machine: "box",
    distDir: "/nonexistent",
    display: () => ({
      spec: { agent: {}, space: {}, commands: [{ name: "start-status", detail: "preview the band" }] },
      origin: "file",
      errors: [],
    }),
    gate: (req) =>
      req.headers.get("x-test-login") ? { ok: true, login: "me@example.com" } : { ok: false, status: 403, reason: "no identity" },
    push: {
      publicKey: "BPub",
      get: (endpoint) => saved.find((s) => s.endpoint === endpoint) ?? null,
      save: (s) => void saved.push(s),
      remove: () => {},
      test: async () => {},
    },
    shortcuts: { list: () => shortcuts, save: (list) => void (shortcuts = list) },
    saveDisplay: (spec) => void savedDisplays.push(spec),
  });
  const call = (path: string, init: RequestInit = {}) =>
    handle(
      new Request(`http://box${path}`, { ...init, headers: { "x-test-login": "1", ...(init.headers ?? {}) } }),
      "127.0.0.1",
      () => {},
    );
  const post = (path: string, body: unknown) => call(path, { method: "POST", body: JSON.stringify(body) });
  return { call, post, keys, saved, savedDisplays, handle };
}

describe("routes", () => {
  test("the gate runs before any route", async () => {
    const { handle } = setup();
    const res = await handle(new Request("http://box/api/health"), "127.0.0.1", () => {});
    expect(res.status).toBe(403);
  });

  test("health names the machine and herdr", async () => {
    const res = await setup().call("/api/health");
    expect(await res.json()).toEqual({
      machine: "box",
      herdr: "0.9.3",
      login: "me@example.com",
      spaces: 1,
      agents: 1,
      build: "",
    });
  });

  test("an unknown pane is 404 and a malformed one 400", async () => {
    const { call } = setup();
    expect((await call("/api/agents/w9:p9/screen")).status).toBe(404);
    expect((await call("/api/agents/..%2Fx/screen")).status).toBe(400);
  });

  test("keys outside the allowed set are refused before anything is sent", async () => {
    const { post, keys } = setup();
    expect((await post("/api/agents/w1:p1/keys", { keys: ["ctrl+c"] })).status).toBe(400);
    expect((await post("/api/agents/w1:p1/keys", { keys: ["esc"] })).status).toBe(200);
    expect(keys).toEqual([["esc"]]);
  });

  test("choosing re-reads the menu and refuses a label that is no longer there", async () => {
    const { post, keys } = setup();
    expect((await post("/api/agents/w1:p1/choose", { n: 2, label: "Maybe" })).status).toBe(409);
    expect((await post("/api/agents/w1:p1/choose", { n: 2, label: "No" })).status).toBe(200);
    expect(keys).toEqual([["down", "enter"]]);
  });

  test("a push subscription must point at a browser push service", async () => {
    const { post, saved } = setup();
    const keys = {
      p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
      auth: "tBHItJI5svbpez7KI4CCXg",
    };
    expect((await post("/api/push", { endpoint: "https://example.com/hook", keys })).status).toBe(400);
    expect(
      (await post("/api/push", { endpoint: "https://fcm.googleapis.com/fcm/send/x", keys: { p256dh: "<script>", auth: "a" } }))
        .status,
    ).toBe(400);
    expect((await post("/api/push", { endpoint: "https://fcm.googleapis.com/fcm/send/x", keys, lang: "xx" })).status).toBe(200);
    expect(saved).toEqual([
      { endpoint: "https://fcm.googleapis.com/fcm/send/x", keys, lang: "en", blocked: true, done: false, custom: true },
    ]);
  });

  test("shortcuts are saved only whole and valid, and read back as saved", async () => {
    const { call, post } = setup();
    expect((await post("/api/shortcuts", { shortcuts: [{ text: "" }] })).status).toBe(400);
    expect(await (await call("/api/shortcuts")).json()).toEqual({ shortcuts: [] });
    const res = await post("/api/shortcuts", { shortcuts: [{ text: "/compact", send: true }] });
    expect(res.status).toBe(200);
    expect(await (await call("/api/shortcuts")).json()).toEqual({ shortcuts: [{ text: "/compact", label: "", send: true }] });
  });

  test("a display spec from the editor is saved only when every part of it can be used", async () => {
    const { post, savedDisplays } = setup();
    const bad = await post("/api/display", { spec: { agent: {}, band: [{ left: [{ from: "token:x", as: "sparkle" }] }] } });
    expect(bad.status).toBe(400);
    expect((await bad.json()).message).toContain("band[0].left[0].as");
    expect(savedDisplays).toEqual([]);
    const ok = await post("/api/display", { spec: { agent: {}, band: [{ left: [{ from: "token:x", as: "chip" }] }] } });
    expect(ok.status).toBe(200);
    expect(savedDisplays[0]!.band).toEqual([{ left: [{ from: "token:x", as: "chip" }], right: undefined }]);
  });
});
