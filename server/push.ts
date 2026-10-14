import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import webpush from "web-push";
import type { Agent, AgentStatus, Snapshot } from "./herdr";

/**
 * Web Push: a phone that turned notifications on hears when an agent starts waiting for an answer
 * or finishes its work. The payload is encrypted for the browser (RFC 8291), so the push service
 * that carries it cannot read it.
 */

export type PushEvent = "blocked" | "done";

export interface PushSubscriptionRecord {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  lang: string;
  blocked: boolean;
  done: boolean;
}

/**
 * Where browsers' push services live. Anything else is refused: the server POSTs to the endpoint it is
 * given, and an open list would let a client make this machine send requests anywhere.
 */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^(.+\.)?push\.services\.mozilla\.com$/,
  /^(.+\.)?notify\.windows\.com$/,
  /^(.+\.)?push\.apple\.com$/,
];

export function validEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  return url.protocol === "https:" && url.port === "" && PUSH_HOSTS.some((h) => h.test(url.hostname));
}

function writePrivate(file: string, data: string) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data, { mode: 0o600 });
  chmodSync(file, 0o600);
}

/** The server's VAPID key pair, made on first use and kept next to the config. */
export function loadVapid(file: string): { publicKey: string; privateKey: string } {
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  const keys = webpush.generateVAPIDKeys();
  writePrivate(file, JSON.stringify(keys));
  return keys;
}

export class PushStore {
  private subs: PushSubscriptionRecord[];

  constructor(private file: string) {
    this.subs = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
  }

  list(): PushSubscriptionRecord[] {
    return [...this.subs];
  }

  get(endpoint: string): PushSubscriptionRecord | null {
    return this.subs.find((s) => s.endpoint === endpoint) ?? null;
  }

  save(sub: PushSubscriptionRecord) {
    this.subs = [...this.subs.filter((s) => s.endpoint !== sub.endpoint), sub];
    writePrivate(this.file, JSON.stringify(this.subs, null, 2));
  }

  remove(endpoint: string) {
    this.subs = this.subs.filter((s) => s.endpoint !== endpoint);
    writePrivate(this.file, JSON.stringify(this.subs, null, 2));
  }
}

const TEXT: Record<string, Record<PushEvent | "test", string>> = {
  en: { blocked: "Needs your answer", done: "Finished", test: "Notifications are on" },
  ko: { blocked: "답이 필요합니다", done: "일을 끝냈습니다", test: "알림이 켜졌습니다" },
  ja: { blocked: "回答が必要です", done: "作業が終わりました", test: "通知がオンになりました" },
  zh: { blocked: "需要你回答", done: "已完成工作", test: "通知已开启" },
};

export function notification(
  agent: Pick<Agent, "pane" | "tabLabel" | "title" | "kind" | "tokens">,
  event: PushEvent | "test",
  lang: string,
) {
  const name = agent.tabLabel || agent.title || agent.kind;
  return {
    title: [agent.tokens.tree, name].filter(Boolean).join(" "),
    body: (TEXT[lang] ?? TEXT.en!)[event],
    tag: `${agent.pane}:${event}`,
    url: `/#/a/${encodeURIComponent(agent.pane)}`,
  };
}

/** Which change of status is worth a notification: starting to wait for the person, or a turn of work ending. */
export function eventFor(prev: AgentStatus, next: AgentStatus): PushEvent | null {
  if (next === "blocked" && prev !== "blocked") return "blocked";
  if (prev === "working" && (next === "done" || next === "idle")) return "done";
  return null;
}

export type Deliver = (sub: PushSubscriptionRecord, payload: string, urgent: boolean) => Promise<void>;

export class Notifier {
  private last = new Map<string, AgentStatus>();
  private primed = false;
  private sentAt = new Map<string, number>();

  constructor(
    private store: PushStore,
    private deliver: Deliver,
    private quietMs = 20_000,
  ) {}

  /** Called with every new snapshot. The first one only records where each agent stands. */
  observe(snap: Snapshot) {
    for (const a of snap.agents) {
      const prev = this.last.get(a.pane);
      this.last.set(a.pane, a.status);
      if (!this.primed || prev === undefined) continue;
      const event = eventFor(prev, a.status);
      if (event) void this.notify(a, event);
    }
    this.primed = true;
  }

  async notify(agent: Agent, event: PushEvent) {
    const key = `${agent.pane}:${event}`;
    const now = Date.now();
    // A status that flaps (blocked, working, blocked) inside the quiet window rings once.
    if (now - (this.sentAt.get(key) ?? 0) < this.quietMs) return;
    this.sentAt.set(key, now);
    for (const sub of this.store.list()) {
      if (!sub[event]) continue;
      await this.send(sub, JSON.stringify(notification(agent, event, sub.lang)), event === "blocked");
    }
  }

  async send(sub: PushSubscriptionRecord, payload: string, urgent: boolean) {
    try {
      await this.deliver(sub, payload, urgent);
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      // 404 / 410: the browser dropped this subscription; it will never deliver again.
      if (status === 404 || status === 410) this.store.remove(sub.endpoint);
      else console.warn(`push to ${new URL(sub.endpoint).hostname} failed: ${status ?? (e as Error).message}`);
    }
  }
}

export function webPushDeliver(vapid: { publicKey: string; privateKey: string }, subject: string): Deliver {
  webpush.setVapidDetails(subject, vapid.publicKey, vapid.privateKey);
  return async (sub, payload, urgent) => {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload, {
      TTL: 3600,
      urgency: urgent ? "high" : "normal",
    });
  };
}
