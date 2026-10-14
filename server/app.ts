import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Verdict } from "./access";
import { filterSlash, type Suggestion } from "./complete";
import { SESSION_ID, type PastSession } from "./sessions";
import { cleanSpec, type DisplaySpec, type LoadedDisplay } from "./spec";
import { contentTypeOf, MAX_UPLOAD_BYTES, saveUpload, uploadPath } from "./uploads";
import { readPreview } from "./files";
import { cleanShortcuts, type Shortcut } from "./shortcuts";
import { validEndpoint, type PushSubscriptionRecord } from "./push";
import { HerdrError, type Agent, type Snapshot } from "./herdr";
import { keysToChoose, parseMenu, parseMode } from "./screen";
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
  /** Conversations in cwd that `claude --resume` can open, newest first, leaving out the ones open now. */
  pastSessions(cwd: string, open: Set<string>): PastSession[];
  /** A new tab in the space with Claude Code started in cwd (resuming a conversation if named); answers its pane. */
  startSession(space: string, cwd: string, label: string | null, resume: string | null): Promise<string>;
  closePane(pane: string): Promise<void>;
}

export interface AppOptions {
  backend: Backend;
  machine: string;
  distDir: string;
  /** Decides who may come in, before any route runs. */
  gate: (req: Request, remote: string | null) => Verdict;
  /** Web Push, when this server sends notifications; without it the push routes answer 404. */
  push?: PushApi;
  /** What to show besides the conversation, and from which values (docs/mods.md). */
  display: () => LoadedDisplay;
  /** Keeps a spec made in the display editor; without it the editor can only look. */
  saveDisplay?: (spec: DisplaySpec) => void;
  /** Where files a person adds are kept (server/uploads.ts); without it uploads answer 404. */
  uploadsRoot?: string;
  /** The commands kept at hand (server/shortcuts.ts); without it the list is empty and cannot change. */
  shortcuts?: { list(): Shortcut[]; save(list: Shortcut[]): void };
}

export interface PushApi {
  publicKey: string;
  get(endpoint: string): PushSubscriptionRecord | null;
  save(sub: PushSubscriptionRecord): void;
  remove(endpoint: string): void;
  test(sub: PushSubscriptionRecord): Promise<void>;
}

const LANGS = new Set(["en", "ko", "ja", "zh"]);
const PUSH_KEY = /^[A-Za-z0-9_-]{8,200}={0,2}$/;

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
  // Ctrl+X Ctrl+S: send the queued messages now.
  "ctrl+x",
  "ctrl+s",
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

export function createApp({ backend, machine, distDir, gate, push, display, saveDisplay, uploadsRoot, shortcuts }: AppOptions) {
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

  async function pushRoute(req: Request, url: URL, path: string): Promise<Response> {
    if (!push) throw new HttpError(404, "no_push", "this server does not send notifications");
    if (path === "/api/push" && req.method === "GET") {
      const sub = push.get(url.searchParams.get("endpoint") ?? "");
      return json(200, {
        publicKey: push.publicKey,
        subscription: sub && { lang: sub.lang, blocked: sub.blocked, done: sub.done, custom: sub.custom ?? true },
      });
    }
    if (req.method !== "POST") throw new HttpError(405, "method", "method not allowed");
    const b = await body(req);
    const endpoint = typeof b.endpoint === "string" ? b.endpoint : "";
    if (endpoint.length > 1000 || !validEndpoint(endpoint))
      throw new HttpError(400, "bad_endpoint", "not a browser push service endpoint");

    if (path === "/api/push") {
      const keys = (b.keys ?? {}) as Record<string, unknown>;
      const p256dh = typeof keys.p256dh === "string" ? keys.p256dh : "";
      const auth = typeof keys.auth === "string" ? keys.auth : "";
      if (!PUSH_KEY.test(p256dh) || !PUSH_KEY.test(auth)) throw new HttpError(400, "bad_keys", "malformed subscription keys");
      const lang = typeof b.lang === "string" && LANGS.has(b.lang) ? b.lang : "en";
      push.save({
        endpoint,
        keys: { p256dh, auth },
        lang,
        blocked: b.blocked !== false,
        done: b.done === true,
        custom: b.custom !== false,
      });
      return json(200, { ok: true });
    }
    if (path === "/api/push/remove") {
      push.remove(endpoint);
      return json(200, { ok: true });
    }
    if (path === "/api/push/test") {
      const sub = push.get(endpoint);
      if (!sub) throw new HttpError(404, "not_subscribed", "this device has no subscription");
      await push.test(sub);
      return json(200, { ok: true });
    }
    throw new HttpError(404, "not_found", "no such route");
  }

  async function agentFor(pane: string): Promise<Agent> {
    const agent = (await backend.snapshot()).agents.find((a) => a.pane === pane);
    if (!agent) throw new HttpError(404, "no_agent", `no agent in pane ${pane}`);
    return agent;
  }

  async function api(req: Request, url: URL, login: string, keepOpen: (req: Request) => void): Promise<Response> {
    const path = url.pathname;

    if (path === "/api/health" && req.method === "GET") {
      const snap = await backend.snapshot();
      // The build this server serves, so an open page can tell it is out of date.
      let build = "";
      try {
        build = (await Bun.file(join(distDir, "version.txt")).text()).trim();
      } catch {
        /* not built */
      }
      return json(200, { machine, herdr: snap.version, login, spaces: snap.spaces.length, agents: snap.agents.length, build });
    }
    if (path === "/api/events" && req.method === "GET") return events(req);
    if (path === "/api/push" || path.startsWith("/api/push/")) return pushRoute(req, url, path);
    if (path === "/api/display" && req.method === "GET") return json(200, display());
    if (path === "/api/display" && req.method === "POST") {
      if (!saveDisplay) throw new HttpError(404, "no_display_file", "this server keeps no display file");
      // Saved only whole: a part the checker would drop is refused with its reason instead.
      const { spec, errors } = cleanSpec((await body(req)).spec);
      if (errors.length > 0) throw new HttpError(400, "bad_display", errors.join("; "));
      saveDisplay(spec);
      return json(200, display());
    }
    if (path === "/api/shortcuts" && req.method === "GET") return json(200, { shortcuts: shortcuts?.list() ?? [] });
    if (path === "/api/shortcuts" && req.method === "POST") {
      if (!shortcuts) throw new HttpError(404, "no_shortcuts", "this server keeps no shortcuts");
      const got = cleanShortcuts((await body(req)).shortcuts);
      if ("error" in got) throw new HttpError(400, "bad_shortcuts", got.error);
      shortcuts.save(got.list);
      return json(200, { shortcuts: got.list });
    }
    if (path === "/api/sessions/past" && req.method === "GET") {
      const cwd = url.searchParams.get("cwd") ?? "";
      if (!cwd.startsWith("/") || cwd.length > 1000) throw new HttpError(400, "bad_cwd", "cwd must be an absolute path");
      const open = new Set((await backend.snapshot()).agents.flatMap((a) => (a.sessionId ? [a.sessionId] : [])));
      return json(200, { sessions: backend.pastSessions(cwd, open) });
    }
    if (path === "/api/sessions" && req.method === "POST") {
      keepOpen(req);
      const b = await body(req);
      const snap = await backend.snapshot();
      const space = typeof b.space === "string" ? b.space : "";
      if (!snap.spaces.some((s) => s.id === space)) throw new HttpError(404, "no_space", "no such space");
      const cwd = typeof b.cwd === "string" ? b.cwd : "";
      if (!cwd.startsWith("/") || cwd.length > 1000) throw new HttpError(400, "bad_cwd", "cwd must be an absolute path");
      const label = typeof b.label === "string" && b.label.trim() ? b.label.trim().slice(0, 80) : null;
      const resume = typeof b.resume === "string" && b.resume ? b.resume : null;
      if (resume && !SESSION_ID.test(resume)) throw new HttpError(400, "bad_resume", "not a session id");
      const pane = await backend.startSession(space, cwd, label, resume);
      // A first message goes in once Claude Code takes input; a dialog it opens first (folder trust) waits for the person.
      let sent = false;
      if (typeof b.prompt === "string" && b.prompt.trim()) {
        try {
          await backend.prompt(pane, b.prompt.slice(0, MAX_TEXT));
          sent = true;
        } catch {
          /* the person sends it from the chat once the dialog is answered */
        }
      }
      return json(200, { pane, sent });
    }
    const upload = /^\/api\/uploads\/([^/]+)\/([^/]+)$/.exec(path);
    if (upload && req.method === "GET") {
      const file = uploadsRoot ? uploadPath(uploadsRoot, upload[1]!, upload[2]!) : null;
      if (!file) throw new HttpError(404, "not_found", "no such upload");
      return new Response(Bun.file(file), {
        headers: {
          ...SECURITY_HEADERS,
          "content-type": contentTypeOf(file) ?? "application/octet-stream",
          "cache-control": "private, max-age=86400",
        },
      });
    }

    const m = /^\/api\/agents\/([^/]+)\/(chat|screen|complete|send|type|keys|choose|upload|close|file)$/.exec(path);
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
      const kind = url.searchParams.get("kind") === "file" ? "file" : "slash";
      const found = backend.complete(agent, kind, q);
      if (kind === "file") return json(200, { items: found });
      // Commands a mod registers live in its code, not on disk; the display spec can name them.
      const fromMods = filterSlash(
        (display().spec.commands ?? []).map((c): Suggestion => ({ value: `/${c.name}`, detail: c.detail ?? "", kind: "mod" })),
        q,
      );
      return json(200, { items: [...fromMods, ...found.filter((s) => !fromMods.some((m) => m.value === s.value))] });
    }

    if (action === "file" && req.method === "GET") {
      try {
        return json(200, readPreview(url.searchParams.get("path") ?? "", process.env.HOME ?? "/root"));
      } catch (e) {
        const code = (e as { code?: string }).code ?? "internal";
        const status = code === "not_found" ? 404 : code === "secret" ? 403 : code === "internal" ? 500 : 400;
        throw new HttpError(status, code, (e as Error).message);
      }
    }

    if (action === "screen" && req.method === "GET") {
      const text = await backend.readScreen(pane);
      return json(200, { text: trimScreen(text), menu: parseMenu(text), mode: parseMode(text) });
    }

    if (action === "upload" && req.method === "POST") {
      if (!uploadsRoot) throw new HttpError(404, "no_uploads", "this server takes no files");
      const declared = Number(req.headers.get("content-length") ?? "0");
      if (declared > MAX_UPLOAD_BYTES) throw new HttpError(413, "too_large", "the file is larger than 15 MB");
      const bytes = new Uint8Array(await req.arrayBuffer());
      if (bytes.length === 0) throw new HttpError(400, "empty", "the file is empty");
      if (bytes.length > MAX_UPLOAD_BYTES) throw new HttpError(413, "too_large", "the file is larger than 15 MB");
      let name = "";
      try {
        name = decodeURIComponent(req.headers.get("x-file-name") ?? "");
      } catch {
        /* a name is only a hint */
      }
      try {
        return json(200, saveUpload(uploadsRoot, bytes, name, req.headers.get("content-type") ?? ""));
      } catch (e) {
        const why = (e as Error).message;
        console.warn(
          `upload refused (${why}): ${name || "(no name)"}, ${req.headers.get("content-type")}, ${bytes.length} bytes`,
        );
        if (why === "unsupported") throw new HttpError(415, "unsupported", "images, PDF and text files only");
        if (why === "mismatch") throw new HttpError(415, "mismatch", "the file's content is not what its name says");
        throw e;
      }
    }

    if (req.method !== "POST") throw new HttpError(405, "method", "method not allowed");
    const b = await body(req);

    if (action === "close") {
      await backend.closePane(pane);
      return json(200, { ok: true });
    }

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
      if (agent.status === "working") throw new HttpError(409, "no_menu", "the agent is working, not waiting for an answer");
      const menu = parseMenu(await backend.readScreen(pane));
      if (!menu) throw new HttpError(409, "no_menu", "the agent is no longer showing a menu");
      const choice = menu.choices.find((c) => c.n === n);
      if (!choice || choice.label !== label) throw new HttpError(409, "changed", "the menu changed; look again before choosing");
      await backend.sendKeys(pane, keysToChoose(menu, n)!);
      await sleep(300);
      const text = await backend.readScreen(pane);
      return json(200, { text: trimScreen(text), menu: parseMenu(text), mode: parseMode(text) });
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
        return await api(req, url, verdict.login, keepOpen);
      }
      if (req.method !== "GET" && req.method !== "HEAD") return json(405, { code: "method", message: "method not allowed" });
      return await staticFile(url);
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { code: e.code, message: e.message });
      if (e instanceof HerdrError) {
        const status =
          e.code === "agent_blocked" ? 409 : e.code === "pane_not_found" ? 404 : e.code.startsWith("bad_") ? 400 : 502;
        return json(status, { code: e.code, message: e.message });
      }
      console.error(e);
      return json(500, { code: "internal", message: "internal error" });
    }
  };
}
