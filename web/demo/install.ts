/**
 * Runs before the app: puts the real server (server/app.ts) and the made-up machine of
 * scripts/demo-backend.ts inside the page, so the static demo needs no server. Requests to /api/* go to
 * that in-page server instead of the network, the live stream is fed straight from the made-up backend,
 * and there is no service worker, so a visitor never keeps a stale copy of the demo.
 */
import { createApp } from "../../server/app";
import { createDemo } from "../../scripts/demo-backend";
import { lang } from "../i18n";

const REPO = "https://github.com/arcnessai/arcdr";

const TEXT: Record<string, { banner: string; short: string; link: string; close: string; notHere: string }> = {
  en: {
    banner: "A demo with made-up agents — nothing here runs on a real machine.",
    short: "Demo · made-up agents",
    link: "Get arcdr on GitHub",
    close: "Close",
    notHere: "Not in the demo: this needs arcdr running on your own computer.",
  },
  ko: {
    banner: "가짜 에이전트로 꾸민 데모예요. 실제 컴퓨터와는 연결되어 있지 않아요.",
    short: "데모 · 가짜 에이전트",
    link: "GitHub에서 arcdr 받기",
    close: "닫기",
    notHere: "데모에서는 쓸 수 없어요. 내 컴퓨터에 설치하면 쓸 수 있어요.",
  },
  ja: {
    banner: "架空のエージェントによるデモです。実際のマシンでは何も動いていません。",
    short: "デモ · 架空のエージェント",
    link: "GitHub で arcdr を入手",
    close: "閉じる",
    notHere: "デモでは使えません。自分のコンピューターで arcdr を動かすと使えます。",
  },
  zh: {
    banner: "这是用虚构代理做的演示，并没有在真实机器上运行。",
    short: "演示 · 虚构代理",
    link: "在 GitHub 获取 arcdr",
    close: "关闭",
    notHere: "演示中不可用：需要在你自己的电脑上运行 arcdr。",
  },
};
const text = TEXT[lang] ?? TEXT.en!;

const demo = createDemo();
const handle = createApp({
  ...demo,
  machine: "demo-laptop",
  distDir: "/demo",
  gate: () => ({ ok: true, login: "demo@example.com" }),
});

// What only a real machine can do: answered plainly instead of with an internal error.
const NEEDS_A_MACHINE = [/^\/api\/agents\/[^/]+\/(upload|file)$/, /^\/api\/uploads\//, /^\/api\/push(\/|$)/];

const realFetch = window.fetch.bind(window);
// Typed as the global: Bun's types add members (preconnect) a browser's fetch does not have.
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const req = new Request(input, init);
  const url = new URL(req.url);
  if (url.origin !== location.origin || !url.pathname.startsWith("/api/")) return realFetch(input, init);
  if (NEEDS_A_MACHINE.some((re) => re.test(url.pathname))) {
    return new Response(JSON.stringify({ code: "demo", message: text.notHere }), {
      status: 501,
      headers: { "content-type": "application/json" },
    });
  }
  return handle(req, "127.0.0.1", () => {});
}) as typeof fetch;

// The app's live stream (/api/events), fed by the made-up backend; any other address is a real EventSource.
const RealEventSource = window.EventSource;
class DemoEventSource extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  readonly url: string;
  readonly withCredentials = false;
  readyState = 0;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  private stop: (() => void) | null = null;

  constructor(url: string | URL, init?: EventSourceInit) {
    super();
    this.url = new URL(url, location.href).href;
    if (new URL(this.url).pathname !== "/api/events") return new RealEventSource(url, init) as unknown as DemoEventSource;
    queueMicrotask(() => {
      if (this.readyState === 2) return;
      this.readyState = 1;
      this.onopen?.(new Event("open"));
      this.stop = demo.backend.subscribe((event, data) => this.dispatchEvent(new MessageEvent(event, { data })));
    });
  }

  close() {
    this.readyState = 2;
    this.stop?.();
    this.stop = null;
  }
}
window.EventSource = DemoEventSource as unknown as typeof EventSource;

// No service worker: without one the app also says, truthfully, that this page cannot take notifications.
try {
  delete (Navigator.prototype as { serviceWorker?: unknown }).serviceWorker;
} catch {
  /* the browser keeps it; the app's registration then fails quietly, as it does on plain http */
}

// Straight to the agents: the connect screen is about a machine this demo does not have.
if (
  !/^#\/(s|a|spaces|settings|display|new)\//.test(location.hash) &&
  location.hash !== "#/spaces" &&
  location.hash !== "#/settings"
) {
  history.replaceState(null, "", matchMedia("(min-width: 900px)").matches ? "#/a/w1%3Ap1" : "#/s/w1");
}

// A slim bar above the app, until the visitor closes it.
function banner() {
  let closed = false;
  try {
    closed = sessionStorage.getItem("demo-banner") === "closed";
  } catch {
    /* storage blocked: show it */
  }
  if (closed) return;
  const style = document.createElement("style");
  style.textContent = `
    :root { --demo-bar: 38px; }
    .demo-bar { height: var(--demo-bar); display: flex; align-items: center; justify-content: center; gap: 12px;
      padding: 0 44px 0 14px; position: relative; background: var(--accent); color: var(--accent-ink);
      font-size: 13px; line-height: 1.25; text-align: center; }
    .demo-bar a { color: inherit; font-weight: 700; white-space: nowrap; }
    .demo-bar button { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); width: 32px; height: 32px;
      border: 0; border-radius: 8px; background: transparent; color: inherit; font-size: 18px; cursor: pointer; }
    body.demo-on #app, body.demo-on .shell, body.demo-on .screen-wrap { height: calc(100dvh - var(--demo-bar)); }
    .demo-bar .demo-short { display: none; }
    @media (max-width: 640px) { .demo-bar .demo-long { display: none; } .demo-bar .demo-short { display: inline; } }
  `;
  const bar = document.createElement("div");
  bar.className = "demo-bar";
  bar.setAttribute("role", "note");
  const words = document.createElement("span");
  words.className = "demo-long";
  words.textContent = text.banner;
  const short = document.createElement("span");
  short.className = "demo-short";
  short.textContent = text.short;
  const link = document.createElement("a");
  link.href = REPO;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = `${text.link} ↗`;
  const close = document.createElement("button");
  close.type = "button";
  close.setAttribute("aria-label", text.close);
  close.textContent = "×";
  close.addEventListener("click", () => {
    bar.remove();
    style.remove();
    document.body.classList.remove("demo-on");
    try {
      sessionStorage.setItem("demo-banner", "closed");
    } catch {
      /* closes for this page only */
    }
  });
  bar.append(words, short, link, close);
  document.head.append(style);
  document.body.prepend(bar);
  document.body.classList.add("demo-on");
}
if (document.body) banner();
else addEventListener("DOMContentLoaded", banner);
