import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import webpush from "web-push";
import type { Agent, AgentStatus, Snapshot } from "./herdr";
import { matches, NOTIFY_TOKEN, valueOf, type Alert } from "./spec";

/**
 * Web Push: a phone that turned notifications on hears when an agent starts waiting for an answer
 * or finishes its work. The payload is encrypted for the browser (RFC 8291), so the push service
 * that carries it cannot read it.
 */

export type PushEvent = "blocked" | "done" | "custom";

export interface PushSubscriptionRecord {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  lang: string;
  blocked: boolean;
  done: boolean;
  /** Alerts the display spec defines on values mods report. */
  custom: boolean;
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

const TEXT: Record<string, Record<Exclude<PushEvent, "custom"> | "test", string>> = {
  en: { blocked: "Needs your answer", done: "Finished", test: "Notifications are on" },
  ko: { blocked: "답이 필요합니다", done: "일을 끝냈습니다", test: "알림이 켜졌습니다" },
  ja: { blocked: "回答が必要です", done: "作業が終わりました", test: "通知がオンになりました" },
  zh: { blocked: "需要你回答", done: "已完成工作", test: "通知已开启" },
};

export function notification(
  agent: Pick<Agent, "pane" | "tabLabel" | "title" | "kind" | "tokens">,
  event: Exclude<PushEvent, "custom"> | "test" | { body: string },
  lang: string,
) {
  const name = agent.tabLabel || agent.title || agent.kind;
  return {
    title: [agent.tokens.tree, name].filter(Boolean).join(" "),
    body: typeof event === "string" ? (TEXT[lang] ?? TEXT.en!)[event] : event.body,
    tag: `${agent.pane}:${typeof event === "string" ? event : "custom"}`,
    url: `/#/a/${encodeURIComponent(agent.pane)}`,
  };
}

/** An alert's text with {value} and {name} filled in. */
export function alertBody(alert: Alert, value: string, name: string): string {
  return alert.body.replaceAll("{value}", value).replaceAll("{name}", name);
}

/** Which change of status is worth a notification: starting to wait for the person, or a turn of work ending. */
export function eventFor(prev: AgentStatus, next: AgentStatus): Exclude<PushEvent, "custom"> | null {
  if (next === "blocked" && prev !== "blocked") return "blocked";
  if (prev === "working" && (next === "done" || next === "idle")) return "done";
  return null;
}

/** Messages a mod sends on purpose are each worth hearing; the window only stops a loop from flooding the phone. */
const NOTIFY_QUIET_MS = 5_000;
/** The same words from other panes inside this long are the same news (a mod polls on its own clock, ≤ 30 s apart here). */
const SAME_WORDS_MS = 90_000;

export type Deliver = (sub: PushSubscriptionRecord, payload: string, urgent: boolean) => Promise<void>;

export class Notifier {
  private last = new Map<string, Agent>();
  private primed = false;
  private sentAt = new Map<string, number>();

  constructor(
    private store: PushStore,
    private deliver: Deliver,
    private alerts: () => Alert[] = () => [],
    private quietMs = 20_000,
  ) {}

  /** Called with every new snapshot. The first one only records where each agent stands. */
  observe(snap: Snapshot) {
    const alerts = this.alerts();
    for (const a of snap.agents) {
      const prev = this.last.get(a.pane);
      this.last.set(a.pane, a);
      if (!this.primed || prev === undefined) continue;
      const event = eventFor(prev.status, a.status);
      if (event) void this.notify(a, event, `${a.pane}:${event}`);
      // A mod or a hook asking for the phone in so many words: each new value is one notification.
      const said = a.tokens[NOTIFY_TOKEN]?.trim();
      if (said && said !== prev.tokens[NOTIFY_TOKEN]?.trim()) {
        const body = said.slice(0, 200);
        // Several sessions can say the same words — a mod that watches something they share, each reporting
        // to its own pane a little apart: the phone hears them once.
        if (this.isFresh(`said:${body}`, SAME_WORDS_MS)) void this.notify(a, { body }, `${a.pane}:notify`, NOTIFY_QUIET_MS);
      }
      // A mod's value starting to meet an alert's conditions rings — the change, not the value standing still.
      alerts.forEach((alert, i) => {
        const now = valueOf(alert.from, a);
        const before = valueOf(alert.from, prev);
        if (now !== null && matches(alert, now) && !(before !== null && matches(alert, before))) {
          void this.notify(a, { body: alertBody(alert, now, a.tabLabel || a.title || a.kind) }, `${a.pane}:alert${i}`);
        }
      });
    }
    this.primed = true;
  }

  /** Whether `key` was not seen within `ms`; it counts as seen from now. */
  private isFresh(key: string, ms: number): boolean {
    const now = Date.now();
    if (now - (this.sentAt.get(key) ?? 0) < ms) return false;
    this.sentAt.set(key, now);
    return true;
  }

  async notify(agent: Agent, event: Exclude<PushEvent, "custom"> | { body: string }, key: string, quietMs = this.quietMs) {
    const now = Date.now();
    // A value that flaps (blocked, working, blocked) inside the quiet window rings once.
    if (now - (this.sentAt.get(key) ?? 0) < quietMs) return;
    this.sentAt.set(key, now);
    const pref: PushEvent = typeof event === "string" ? event : "custom";
    for (const sub of this.store.list()) {
      // Subscriptions saved before alerts existed have no `custom`; they hear alerts until they say otherwise.
      if (!(sub[pref] ?? true)) continue;
      await this.send(sub, JSON.stringify(notification(agent, event, sub.lang)), pref === "blocked");
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
