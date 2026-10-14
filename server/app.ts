import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Verdict } from "./access";
import type { Suggestion } from "./complete";
import { HerdrError, type Agent, type Snapshot } from "./herdr";
import { keysToChoose, parseMenu } from "./screen";
import type { Chunk } from "./transcript";

/**
 * Everything the routes need from the machine. main.ts backs it with herdr's socket and the transcript
 * files; the demo backs it with made-up agents, so the screens can be shown and tried without herdr.
 */
export interface Backend {
  snapshot(): Promise<Snapshot>;
  subscribe(fn: (event: "snapshot" | "down", data: string) => void): () => void;
  readScreen(pane: string): Promise<string>;
  /** Submit text plus Enter as herdr does for agents; throws HerdrError when herdr refuses. */
  prompt(pane: string, text: string): Promise<void>;
  sendInput(pane: string, text: string, keys: string[]): Promise<void>;
  sendKeys(pane: string, keys: string[]): Promise<void>;
  /** The transcript from offset when `file` still names the agent's session, else its tail; null when there is none. */
  transcript(agent: Agent, offset: number, file: string | null): Chunk | null;
  complete(agent: Agent, kind: "slash" | "file", query: string): Suggestion[];
}

export interface AppOptions {
  backend: Backend;
  machine: string;
  distDir: string;
  /** Decides who may come in, before any route runs. */
  gate: (req: Request, remote: string | null) => Verdict;
}

const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; " +
    "manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

const STATIC_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

/** Keys the key bar may send. Ctrl+C is left out on purpose: twice in a row exits Claude Code. */
const ALLOWED_KEYS = new Set([
  "esc",
  "enter",
  "up",
  "down",
  "left",
  "right",
  "tab",
  "shift+tab",
  "space",
  "backspace",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
]);

/** agent.prompt errors after which nothing was sent, so typing the text instead cannot send it twice. */
const PROMPT_FALLBACK = new Set(["agent_not_ready", "agent_not_found"]);

const MAX_BODY = 64 * 1024;
const MAX_TEXT = 20_000;

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...SECURITY_HEADERS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function body(req: Request): Promise<Record<string, unknown>> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY) throw new HttpError(413, "too_large", "request body is too large");
  const text = await req.text();
  if (text.length > MAX_BODY) throw new HttpError(413, "too_large", "request body is too large");
  try {
    const parsed = JSON.parse(text || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    /* fall through */
  }
  throw new HttpError(400, "bad_json", "request body is not a JSON object");
}

function textField(b: Record<string, unknown>, name: string): string {
  const v = b[name];
  if (typeof v !== "string" || v.length === 0) throw new HttpError(400, "bad_field", `${name} must be a non-empty string`);
  if (v.length > MAX_TEXT) throw new HttpError(400, "bad_field", `${name} is longer than ${MAX_TEXT} characters`);
  return v;
}

function trimScreen(text: string): string {
  return text.replace(/\s+$/, "");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createApp({ backend, machine, distDir, gate }: AppOptions) {
  function events(req: Request): Response {
    let close = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        const enc = new TextEncoder();
        const send = (chunk: string) => {
          try {
            ctrl.enqueue(enc.encode(chunk));
          } catch {
            close();
          }
        };
        const unsubscribe = backend.subscribe((event, data) => send(`event: ${event}\ndata: ${data}\n\n`));
        const ping = setInterval(() => send(": ping\n\n"), 15_000);
        close = () => {
          clearInterval(ping);
          unsubscribe();
        };
        req.signal.addEventListener("abort", close);
      },
      cancel() {
        close();
      },
    });
    return new Response(stream, {
      headers: {
        ...SECURITY_HEADERS,
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        "x-accel-buffering": "no",
      },
    });
  }

  async function agentFor(pane: string): Promise<Agent> {
    const agent = (await backend.snapshot()).agents.find((a) => a.pane === pane);
    if (!agent) throw new HttpError(404, "no_agent", `no agent in pane ${pane}`);
    return agent;
  }

  async function api(req: Request, url: URL, login: string): Promise<Response> {
    const path = url.pathname;

    if (path === "/api/health" && req.method === "GET") {
      const snap = await backend.snapshot();
      return json(200, { machine, herdr: snap.version, login, spaces: snap.spaces.length, agents: snap.agents.length });
    }
    if (path === "/api/events" && req.method === "GET") return events(req);

    const m = /^\/api\/agents\/([^/]+)\/(chat|screen|complete|send|type|keys|choose)$/.exec(path);
    if (!m) throw new HttpError(404, "not_found", "no such route");
    const pane = decodeURIComponent(m[1]!);
    if (!/^[\w-]+:[\w-]+$/.test(pane)) throw new HttpError(400, "bad_pane", "malformed pane id");
    const action = m[2]!;
    const agent = await agentFor(pane);

    if (action === "chat" && req.method === "GET") {
      const offset = Number(url.searchParams.get("offset"));
      const chunk = backend.transcript(
        agent,
        Number.isSafeInteger(offset) && offset > 0 ? offset : 0,
        url.searchParams.get("file") || null,
      );
      return json(200, chunk ?? { items: [], offset: 0, file: null, reset: true, clipped: false });
    }

    if (action === "complete" && req.method === "GET") {
      const q = (url.searchParams.get("q") ?? "").slice(0, 300);
      return json(200, { items: backend.complete(agent, url.searchParams.get("kind") === "file" ? "file" : "slash", q) });
    }

    if (action === "screen" && req.method === "GET") {
      const text = await backend.readScreen(pane);
      return json(200, { text: trimScreen(text), menu: parseMenu(text) });
    }

    if (req.method !== "POST") throw new HttpError(405, "method", "method not allowed");
    const b = await body(req);

    if (action === "send") {
      const text = textField(b, "text");
      try {
        await backend.prompt(pane, text);
      } catch (e) {
        // agent.prompt refuses when herdr no longer sees the agent as the pane's foreground process;
        // typing the text the way `pane run` does still reaches whatever is reading the terminal.
        if (!(e instanceof HerdrError) || !PROMPT_FALLBACK.has(e.code)) throw e;
        await backend.sendInput(pane, text, ["enter"]);
      }
      return json(200, { ok: true });
    }

    if (action === "type") {
      await backend.sendInput(pane, textField(b, "text"), b.enter === true ? ["enter"] : []);
      return json(200, { ok: true });
    }

    if (action === "keys") {
      const keys = b.keys;
      if (
        !Array.isArray(keys) ||
        keys.length === 0 ||
        keys.length > 20 ||
        !keys.every((k) => typeof k === "string" && ALLOWED_KEYS.has(k))
      ) {
        throw new HttpError(400, "bad_keys", "keys must be 1–20 of the allowed key names");
      }
      await backend.sendKeys(pane, keys as string[]);
      return json(200, { ok: true });
    }

    if (action === "choose") {
      const n = b.n;
      const label = b.label;
      if (typeof n !== "number" || !Number.isInteger(n) || typeof label !== "string") {
        throw new HttpError(400, "bad_field", "n must be an integer and label a string");
      }
      // Read the screen again right before acting: the button was drawn from an earlier read,
      // and moving the cursor on a menu that has since changed would pick something else.
      if (agent.status !== "blocked") throw new HttpError(409, "no_menu", "the agent is not waiting for an answer");
      const menu = parseMenu(await backend.readScreen(pane));
      if (!menu) throw new HttpError(409, "no_menu", "the agent is no longer showing a menu");
      const choice = menu.choices.find((c) => c.n === n);
      if (!choice || choice.label !== label) throw new HttpError(409, "changed", "the menu changed; look again before choosing");
      await backend.sendKeys(pane, keysToChoose(menu, n)!);
      await sleep(300);
      const text = await backend.readScreen(pane);
      return json(200, { text: trimScreen(text), menu: parseMenu(text) });
    }

    throw new HttpError(405, "method", "method not allowed");
  }

  async function staticFile(url: URL): Promise<Response> {
    const name = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    if (!/^[\w.-]+$/.test(name)) return new Response("not found", { status: 404, headers: SECURITY_HEADERS });
    const path = join(distDir, name);
    if (!existsSync(path)) return new Response("not found", { status: 404, headers: SECURITY_HEADERS });
    const ext = name.slice(name.lastIndexOf("."));
    return new Response(Bun.file(path), {
      headers: {
        ...SECURITY_HEADERS,
        "content-type": STATIC_TYPES[ext] ?? "application/octet-stream",
        "cache-control": "no-cache",
      },
    });
  }

  /** The whole request path: who may come in, then the API or a file of the built page. */
  return async function handle(req: Request, remote: string | null, keepOpen: (req: Request) => void): Promise<Response> {
    const url = new URL(req.url);
    const verdict = gate(req, remote);
    if (!verdict.ok) {
      console.warn(`denied ${req.method} ${url.pathname}: ${verdict.reason}`);
      return json(verdict.status, { code: "denied", message: verdict.reason });
    }
    try {
      if (url.pathname.startsWith("/api/")) {
        if (url.pathname === "/api/events") keepOpen(req);
        return await api(req, url, verdict.login);
      }
      if (req.method !== "GET" && req.method !== "HEAD") return json(405, { code: "method", message: "method not allowed" });
      return await staticFile(url);
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { code: e.code, message: e.message });
      if (e instanceof HerdrError) {
        const status = e.code === "agent_blocked" ? 409 : e.code === "pane_not_found" ? 404 : 502;
        return json(status, { code: e.code, message: e.message });
      }
      console.error(e);
      return json(500, { code: "internal", message: "internal error" });
    }
  };
}
