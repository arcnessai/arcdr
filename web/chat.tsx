import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { api, ApiError, type Agent, type ChatItem, type Menu, type Shortcut, type Suggestion } from "./api";
import { STATUS_LABEL } from "./format";
import * as I from "./icons";
import { AgentLine, Badge, StatusDot } from "./lists";
import { nameOf, PartRow, useDisplay } from "./parts";
import { ChangeDiff, ChangesTab, changeStats, Stats } from "./changes";
import { FileOpener, useFileOpener } from "./fileopener";
import { FileView } from "./fileview";
import { Linked } from "./linkify";
import { UserText } from "./usertext";
import { Markdown } from "./markdown";
import { tokenAt, type Token } from "./token";
import { Tray } from "./shortcuts";
import { t } from "./i18n";

type Shown = Exclude<ChatItem, { kind: "tool-error" } | { kind: "queue" } | { kind: "meta" } | { kind: "todos" }>;
type Todos = Extract<ChatItem, { kind: "todos" }>["items"];
type QueueOp = Extract<ChatItem, { kind: "queue" }>;
type Tool = Extract<ChatItem, { kind: "tool" }>;
type Row = { kind: "item"; item: Shown } | { kind: "tools"; id: string; tools: Tool[] };

/**
 * A message sent from here, until the transcript shows it: sending (the request is out), typed (herdr put it
 * into the terminal), unconfirmed (typed, but neither the queue nor the conversation shows it after a while —
 * it may be sitting in the input box). Once Claude Code queues it, the queue shows it; once read, the conversation.
 */
interface Pending {
  id: number;
  text: string;
  at: number;
  state: "sending" | "typed" | "unconfirmed";
}

const UNCONFIRMED_AFTER_MS = 30_000;

/** The same message as the transcript records it: line endings and surrounding space may differ. */
export function same(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

const COARSE = matchMedia("(pointer: coarse)").matches;
const LONG_TEXT = 2400;

function useVisible(): boolean {
  const [visible, setVisible] = useState(document.visibilityState === "visible");
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return visible;
}

function stored(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function store(key: string, value: string) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* private mode */
  }
}

/** The transcript: the tail first, then whatever lines the file grows by. */
function useChat(pane: string, polling: boolean) {
  const [items, setItems] = useState<Shown[]>([]);
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [state, setState] = useState<"loading" | "ready" | "none" | "error">("loading");
  const [clipped, setClipped] = useState(false);
  const [queue, setQueue] = useState<string[]>([]);
  const [meta, setMeta] = useState<{ permissionMode?: string; model?: string }>({});
  const [todos, setTodos] = useState<Todos | null>(null);
  const cursor = useRef<{ offset: number; file: string | null }>({ offset: 0, file: null });
  const queueRef = useRef<{ text: string; hidden: boolean }[]>([]);

  const absorb = useCallback((incoming: ChatItem[], replace: boolean) => {
    const errors = incoming.filter((i) => i.kind === "tool-error").map((i) => (i as { target: string }).target);
    if (errors.length) setFailed((f) => new Set([...(replace ? [] : f), ...errors]));
    else if (replace) setFailed(new Set());

    if (replace) queueRef.current = [];
    for (const op of incoming.filter((i): i is QueueOp => i.kind === "queue")) {
      const q = queueRef.current;
      if (op.op === "add") q.push({ text: op.text, hidden: op.hidden });
      else if (op.op === "take") q.shift();
      else {
        const at = q.findIndex((x) => x.text === op.text);
        if (at >= 0) q.splice(at, 1);
      }
    }
    setQueue(queueRef.current.filter((x) => !x.hidden).map((x) => x.text));

    if (replace) {
      setMeta({});
      setTodos(null);
    }
    for (const i of incoming) {
      if (i.kind === "meta")
        setMeta((m) => ({
          ...m,
          ...(i.permissionMode && { permissionMode: i.permissionMode }),
          ...(i.model && { model: i.model }),
        }));
      if (i.kind === "todos") setTodos(i.items);
    }
    const shown = incoming.filter(
      (i): i is Shown => i.kind !== "tool-error" && i.kind !== "queue" && i.kind !== "meta" && i.kind !== "todos",
    );
    setItems((prev) => {
      if (replace) return shown;
      if (shown.length === 0) return prev;
      const seen = new Set(prev.map((i) => i.id));
      return [...prev, ...shown.filter((i) => !seen.has(i.id))];
    });
  }, []);

  const pull = useCallback(async () => {
    const { offset, file } = cursor.current;
    const chunk = await api.chat(pane, offset, file);
    cursor.current = { offset: chunk.offset, file: chunk.file };
    if (!chunk.file) {
      setState("none");
      absorb([], true);
      return;
    }
    if (chunk.reset) setClipped(chunk.clipped);
    absorb(chunk.items, chunk.reset);
    setState("ready");
  }, [pane, absorb]);

  useEffect(() => {
    cursor.current = { offset: 0, file: null };
    queueRef.current = [];
    setQueue([]);
    setItems([]);
    setFailed(new Set());
    setState("loading");
    pull().catch(() => setState("error"));
  }, [pull]);

  useEffect(() => {
    if (!polling) return;
    const timer = setInterval(() => pull().catch(() => {}), 1500);
    return () => clearInterval(timer);
  }, [pull, polling]);

  return { items, failed, state, clipped, queue, meta, todos };
}

/** The visible terminal and any menu on it. */
function useScreen(pane: string, intervalMs: number | null) {
  const [text, setText] = useState("");
  const [menu, setMenu] = useState<Menu | null>(null);
  const [mode, setMode] = useState<string | null | undefined>(undefined);
  const apply = useCallback((r: { text: string; menu: Menu | null; mode?: string | null }) => {
    setText(r.text);
    setMenu(r.menu);
    setMode(r.mode);
  }, []);
  const refresh = useCallback(
    () =>
      api
        .screen(pane)
        .then(apply)
        .catch(() => {}),
    [pane, apply],
  );
  useEffect(() => {
    setText("");
    setMenu(null);
  }, [pane]);
  useEffect(() => {
    if (intervalMs === null) return;
    void refresh();
    const t = setInterval(refresh, intervalMs);
    return () => clearInterval(t);
  }, [refresh, intervalMs]);
  return { text, menu, mode, refresh, apply };
}

function toRows(items: Shown[]): Row[] {
  const rows: Row[] = [];
  for (const item of items) {
    const last = rows[rows.length - 1];
    if (item.kind === "tool") {
      if (last?.kind === "tools") last.tools.push(item);
      else rows.push({ kind: "tools", id: item.id, tools: [item] });
    } else rows.push({ kind: "item", item });
  }
  return rows;
}

function LongText({ text, latest }: { text: string; latest: boolean }) {
  const [open, setOpen] = useState(false);
  if (latest || text.length <= LONG_TEXT || open) return <Markdown text={text} />;
  return (
    <>
      <Markdown text={text.slice(0, 1600) + "…"} />
      <button class="link-btn" onClick={() => setOpen(true)}>
        {t.more}
      </button>
    </>
  );
}

/** The file a tool call read or changed, for the preview. */
function fileOf(x: Tool): string | null {
  if (x.change) return x.change.path;
  return x.name === "Read" && x.detail.startsWith("/") ? x.detail : null;
}

function ToolGroup({ tools, failed }: { tools: Tool[]; failed: Set<string> }) {
  const openFile = useFileOpener();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const errors = tools.filter((x) => failed.has(x.id)).length;
  const last = tools[tools.length - 1]!;
  const stats = useMemo(() => {
    const changed = tools.filter((x) => x.change);
    if (changed.length === 0) return null;
    return changed
      .map((x) => changeStats(x.change!))
      .reduce((a, b) => ({ added: a.added + b.added, removed: a.removed + b.removed }));
  }, [tools]);
  return (
    <div class={`tools${open ? " open" : ""}`}>
      <button class="tools-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <I.Wrench size={14} />
        <span class="tools-count">{t.tools(tools.length)}</span>
        {errors > 0 && <span class="tools-err">{t.failed(errors)}</span>}
        {stats && <Stats {...stats} />}
        {!open && (
          <span class="tools-last">
            <b>{last.name}</b> {last.summary}
          </span>
        )}
      </button>
      {open && (
        <ul class="tools-list">
          {tools.map((x) => (
            <li key={x.id} class={failed.has(x.id) ? "err" : ""}>
              <button class="tool-line" onClick={() => setDetail(detail === x.id ? null : x.id)} aria-expanded={detail === x.id}>
                <b>{x.name}</b> <span>{x.summary}</span>
                {x.change && <Stats {...changeStats(x.change)} />}
              </button>
              {fileOf(x) && openFile && (
                <button class="tool-file" onClick={() => openFile(fileOf(x)!)}>
                  {t.openFile}
                </button>
              )}
              {detail === x.id &&
                (x.change ? (
                  <ChangeDiff change={x.change} />
                ) : (
                  x.detail && (
                    <pre class="tool-detail">
                      <Linked text={x.detail} />
                    </pre>
                  )
                ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Message({
  item,
  latest,
  mine,
  answering,
}: {
  item: Shown;
  latest: boolean;
  mine: boolean;
  answering: Answering | null;
}) {
  switch (item.kind) {
    case "user":
      return (
        <div class="msg msg-user">
          <div class="bubble">
            <UserText text={item.text} />
          </div>
          {mine && <span class="pending-state is-received">✓ {t.received}</span>}
        </div>
      );
    case "assistant":
      return (
        <div class="msg msg-assistant">
          <LongText text={item.text} latest={latest} />
        </div>
      );
    case "ask":
      return (
        <div class="msg ask-card">
          {item.questions.map((q, i) => (
            <div key={i} class="ask-q">
              <p class="ask-title">
                <Linked text={q.question} />
              </p>
              <ol class="ask-options">
                {q.options.map((o, j) => {
                  // The question still open on screen: its options answer it from here.
                  const choice = answering && choiceFor(answering.menu, o);
                  return (
                    <li key={j}>
                      {choice ? (
                        <button
                          class={`ask-choice${answering.busy === choice.n ? " is-busy" : ""}`}
                          disabled={answering.busy !== null}
                          onClick={() => answering.choose(choice.n, choice.label)}
                        >
                          {o}
                        </button>
                      ) : (
                        <Linked text={o} />
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </div>
      );
    case "note":
      return <div class="msg msg-note">{item.code === "compacted" ? t.compacted : <Linked text={item.text} />}</div>;
    case "tool":
      return null;
  }
}

function Messages(props: {
  rows: Row[];
  failed: Set<string>;
  pending: Pending[];
  queue: string[];
  mine: Set<string>;
  state: string;
  clipped: boolean;
  answering: Answering | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [behind, setBehind] = useState(false);

  const onScroll = () => {
    const el = box.current!;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (atBottom.current) setBehind(false);
  };

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    if (atBottom.current) el.scrollTop = el.scrollHeight;
    else setBehind(true);
  }, [props.rows.length, props.pending.length, props.queue.length, props.rows[props.rows.length - 1]]);

  // The newest answer is what the person came to read, so it is never folded.
  let lastAssistant: string | null = null;
  let lastAsk: string | null = null;
  for (const r of props.rows) {
    if (r.kind === "item" && r.item.kind === "assistant") lastAssistant = r.item.id;
    if (r.kind === "item" && r.item.kind === "ask") lastAsk = r.item.id;
  }

  const toBottom = () => {
    const el = box.current!;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setBehind(false);
  };

  return (
    <div class="messages" ref={box} onScroll={onScroll}>
      <div class="messages-inner">
        {props.clipped && <p class="msg msg-note">{t.clipped}</p>}
        {props.state === "loading" && <p class="msg msg-note">{t.loadingChat}</p>}
        {props.state === "none" && <p class="msg msg-note">{t.noTranscript}</p>}
        {props.state === "error" && <p class="msg msg-note">{t.chatError}</p>}
        {props.rows.map((r) =>
          r.kind === "tools" ? (
            <ToolGroup key={r.id} tools={r.tools} failed={props.failed} />
          ) : (
            <Message
              key={r.item.id}
              item={r.item}
              latest={r.item.id === lastAssistant}
              mine={r.item.kind === "user" && props.mine.has(same(r.item.text))}
              answering={r.item.id === lastAsk ? props.answering : null}
            />
          ),
        )}
        {props.queue.map((text, i) => (
          <div key={`q${i}`} class="msg msg-user pending is-queued">
            <div class="bubble">
              <UserText text={text} />
            </div>
            <span class="pending-state">{t.queued}</span>
          </div>
        ))}
        {props.pending.map((p) => (
          <div key={p.id} class={`msg msg-user pending is-${p.state}`}>
            <div class="bubble">
              <UserText text={p.text} />
            </div>
            <span class="pending-state">{t.pending[p.state]}</span>
          </div>
        ))}
      </div>
      {behind && (
        <button class="to-bottom" onClick={toBottom}>
          <I.Down size={16} /> {t.newMessages}
        </button>
      )}
    </div>
  );
}

/** What answering a menu needs: the menu as last read, which option is being sent, and how to send one. */
interface Answering {
  menu: Menu;
  busy: number | null;
  choose: (n: number, label: string) => void;
}

/** The menu option an AskUserQuestion option names; the screen may show it cut, or with "(Recommended)" after it. */
export function choiceFor(menu: Menu, label: string) {
  const bare = (s: string) => s.replace(/…$/, "").trim();
  return (
    menu.choices.find((c) => c.label === label) ??
    menu.choices.find((c) => c.label.startsWith(label) || label.startsWith(bare(c.label)))
  );
}

function MenuPanel(props: Answering) {
  const { busy, choose } = props;
  const { menu } = props;
  // The line right above the options is the question itself; what comes before it (the command,
  // the file) is detail, shown scrolled to its end.
  const question = menu.context.at(-1) ?? "";
  const detail = menu.context.slice(0, -1).join("\n").trimEnd();
  const detailBox = useRef<HTMLPreElement>(null);
  useLayoutEffect(() => {
    if (detailBox.current) detailBox.current.scrollTop = detailBox.current.scrollHeight;
  }, [detail]);
  return (
    <section class="menu-panel" aria-label={t.choices}>
      <p class="menu-head">
        <span class="menu-badge">{t.needsAnswer}</span>
      </p>
      {detail && (
        <pre class="menu-context" ref={detailBox}>
          <Linked text={detail} />
        </pre>
      )}
      {question && <p class="menu-question">{question}</p>}
      <div class="menu-choices">
        {menu.choices.map((c, i) => (
          <button
            key={c.n}
            class={`choice${i === menu.cursor ? " at-cursor" : ""}`}
            disabled={busy !== null}
            onClick={() => choose(c.n, c.label)}
          >
            <span class="choice-n">{busy === c.n ? "…" : c.n}</span>
            <span class="choice-body">
              <span class="choice-label">
                {c.checked !== null && <span class="choice-box">{c.checked ? "☑" : "☐"}</span>}
                {c.label}
              </span>
              {c.detail.length > 0 && <span class="choice-detail">{c.detail.join(" ")}</span>}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

const KEYS: { key: string; label: string; wide?: boolean }[] = [
  { key: "esc", label: "Esc" },
  { key: "up", label: "↑" },
  { key: "down", label: "↓" },
  { key: "left", label: "←" },
  { key: "right", label: "→" },
  { key: "tab", label: "Tab" },
  { key: "shift+tab", label: "⇧Tab" },
  { key: "enter", label: "Enter", wide: true },
];

function KeyBar({ pane, onError }: { pane: string; onError: (m: string) => void }) {
  const press = (key: string) => {
    navigator.vibrate?.(8);
    api.keys(pane, [key]).catch((e) => onError(e instanceof ApiError ? e.message : String(e)));
  };
  return (
    <div class="keybar" role="toolbar" aria-label={t.keys}>
      {KEYS.map((k) => (
        <button key={k.key} class={`key${k.wide ? " key-wide" : ""}`} onClick={() => press(k.key)}>
          {k.label}
        </button>
      ))}
    </div>
  );
}

function useSuggestions(pane: string, token: Token | null): Suggestion[] {
  const [items, setItems] = useState<Suggestion[]>([]);
  const key = token ? `${token.kind}:${token.query}` : "";
  useEffect(() => {
    if (!token) {
      setItems([]);
      return;
    }
    let live = true;
    const timer = setTimeout(
      () =>
        api
          .complete(pane, token.kind, token.query)
          .then((r) => live && setItems(r.items))
          .catch(() => live && setItems([])),
      token.kind === "file" ? 120 : 40,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // The token object is new on every keystroke; its kind and query are what matter.
  }, [pane, key]);
  return items;
}

function Composer(props: {
  agent: Agent;
  onSend: (text: string) => Promise<boolean>;
  keysOpen: boolean;
  onKeys: () => void;
  onError: (message: string) => void;
}) {
  const draftKey = `draft:${props.agent.pane}`;
  const [text, setText] = useState(() => stored(draftKey));
  const [caret, setCaret] = useState(0);
  const [sending, setSending] = useState(false);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const photos = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const [trayOpen, setTrayOpen] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(false);

  const token = tokenAt(text, caret);
  const tokenKey = token ? `${token.kind}:${token.start}:${token.query}` : null;
  const suggestions = useSuggestions(props.agent.pane, tokenKey !== null && tokenKey !== dismissed ? token : null);
  const open = token !== null && tokenKey !== dismissed && suggestions.length > 0;

  useEffect(() => setText(stored(draftKey)), [draftKey]);
  useEffect(() => store(draftKey, text), [draftKey, text]);
  useEffect(() => setActive(0), [tokenKey]);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    // scrollHeight leaves out the border, and the box is border-box: without adding it back the box is
    // two pixels short and grows a scrollbar — the thin vertical line at its right edge.
    el.style.height = "auto";
    const cs = getComputedStyle(el);
    const want = el.scrollHeight + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    const max = Math.round(window.innerHeight * 0.35);
    el.style.height = `${Math.min(want, max)}px`;
    el.style.overflowY = want > max ? "auto" : "hidden";
  }, [text]);

  const syncCaret = () => setCaret(area.current?.selectionStart ?? 0);

  /** Puts `insert` at the caret (or the end) and moves the caret after it. */
  const insertAtCaret = (insert: string) => {
    const el = area.current;
    setText((current) => {
      const at = el && document.activeElement === el ? el.selectionStart : current.length;
      const before = current.slice(0, at);
      const pad = before && !/\s$/.test(before) ? " " : "";
      const next = before + pad + insert + current.slice(at);
      const pos = at + pad.length + insert.length;
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(pos, pos);
        setCaret(pos);
      });
      return next;
    });
  };

  /** Uploads files one by one; each lands in the message as @path, the way Claude Code takes a file. */
  const addFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setUploading((n) => n + files.length);
    for (const f of files) {
      try {
        const { path } = await api.upload(props.agent.pane, f, f.name || "pasted");
        insertAtCaret(`@${path} `);
      } catch (e) {
        props.onError(`${t.uploadFailed}: ${e instanceof ApiError ? e.message : String(e)}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  const takeFiles = (e: Event) => {
    const input = e.target as HTMLInputElement;
    void addFiles([...(input.files ?? [])]);
    input.value = "";
  };

  /** A kept command: sent as it is, or put in the box for the rest of the words. */
  const applyShortcut = (s: Shortcut) => {
    setTrayOpen(false);
    navigator.vibrate?.(8);
    if (s.send) {
      void props.onSend(s.text);
      return;
    }
    const insert = s.text.startsWith("/") && !/\s$/.test(s.text) ? `${s.text} ` : s.text;
    if (text.trim()) return insertAtCaret(insert);
    setText(insert);
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(insert.length, insert.length);
      setCaret(insert.length);
    });
  };

  const accept = (s: Suggestion) => {
    if (!token) return;
    // A directory keeps the list open for the next level; anything else ends with a space.
    const insert = token.kind === "slash" ? `${s.value} ` : `@${s.value}${s.kind === "dir" ? "" : " "}`;
    const next = text.slice(0, token.start) + insert + text.slice(token.end);
    const pos = token.start + insert.length;
    setText(next);
    setCaret(pos);
    requestAnimationFrame(() => {
      const el = area.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  const submit = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setTrayOpen(false);
    setSending(true);
    const ok = await props.onSend(body);
    setSending(false);
    if (ok) {
      setText("");
      setCaret(0);
    }
  };

  const blocked = props.agent.status === "blocked";
  return (
    <>
      {trayOpen && (
        <Tray
          pane={props.agent.pane}
          keysOpen={props.keysOpen}
          draft={text}
          onKeys={() => {
            props.onKeys();
            setTrayOpen(false);
          }}
          onPhotos={() => {
            photos.current?.click();
            setTrayOpen(false);
          }}
          onFiles={() => {
            picker.current?.click();
            setTrayOpen(false);
          }}
          onCamera={
            COARSE
              ? () => {
                  camera.current?.click();
                  setTrayOpen(false);
                }
              : null
          }
          onUse={applyShortcut}
          onError={props.onError}
        />
      )}
      <form
        class={`composer${dragging ? " is-dragging" : ""}`}
        onDragOver={(e) => {
          if (![...(e.dataTransfer?.types ?? [])].includes("Files")) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          setDragging(false);
          const files = [...(e.dataTransfer?.files ?? [])];
          if (files.length === 0) return;
          e.preventDefault();
          void addFiles(files);
        }}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {uploading > 0 && <p class="uploading">{t.uploading(uploading)}</p>}
        {open && (
          <ul class="suggest" role="listbox" aria-label={t.suggestions} ref={list}>
            {suggestions.map((s, i) => (
              <li key={s.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  // Keep the focus (and the phone keyboard) in the text box.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => accept(s)}
                >
                  <span class={`sg-value sg-${s.kind}`}>{s.value}</span>
                  {s.detail && <span class="sg-detail">{s.detail}</span>}
                  {s.kind !== "file" && s.kind !== "dir" && <span class="sg-kind">{t.kind[s.kind]}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          class="icon-btn plus-btn"
          aria-expanded={trayOpen}
          aria-label={t.extras}
          title={t.extras}
          onClick={() => setTrayOpen(!trayOpen)}
        >
          <I.Plus size={22} />
        </button>
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          accept="image/*,application/pdf,text/plain,text/markdown,text/csv,application/json,.md,.log,.csv,.json,.txt"
          onChange={takeFiles}
        />
        {/* Images alone: Android then opens its photo picker (the gallery) instead of asking which app to use. */}
        <input ref={photos} type="file" multiple hidden accept="image/*" onChange={takeFiles} />
        {COARSE && <input ref={camera} type="file" hidden accept="image/*" capture="environment" onChange={takeFiles} />}
        <textarea
          ref={area}
          rows={1}
          value={text}
          enterkeyhint={COARSE ? "enter" : "send"}
          placeholder={blocked ? t.typeRaw : t.message}
          aria-autocomplete="list"
          aria-expanded={open}
          onInput={(e) => {
            setText((e.target as HTMLTextAreaElement).value);
            syncCaret();
          }}
          onClick={syncCaret}
          onPaste={(e) => {
            // A copied screenshot arrives as a file; text pastes go on as usual.
            const files = [...(e.clipboardData?.files ?? [])];
            if (files.length === 0) return;
            e.preventDefault();
            void addFiles(files);
          }}
          onKeyUp={(e) => {
            if (!["ArrowUp", "ArrowDown", "Tab", "Enter", "Escape"].includes(e.key)) syncCaret();
          }}
          onKeyDown={(e) => {
            const composing = e.isComposing || e.keyCode === 229;
            if (open && !composing) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const step = e.key === "ArrowDown" ? 1 : -1;
                setActive((a) => (a + step + suggestions.length) % suggestions.length);
                return;
              }
              if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                e.preventDefault();
                accept(suggestions[active]!);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setDismissed(tokenKey);
                return;
              }
            }
            // Desktop: Enter sends, Shift+Enter breaks the line. A phone keeps Enter for new lines.
            // isComposing / 229: the Enter that commits a Hangul syllable must not send.
            if (e.key === "Enter" && !e.shiftKey && !COARSE && !composing) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <button type="submit" class="send-btn" disabled={!text.trim() || sending} aria-label={t.send}>
          <I.Send />
        </button>
      </form>
    </>
  );
}

export function ChatView(props: {
  agent: Agent;
  wide: boolean;
  /** In one of several desktop panes: closes this one. */
  onClose?: () => void;
  /** A pane half the screen high: less room for the frame, more for the conversation. */
  compact?: boolean;
}) {
  const { agent, wide } = props;
  const [tab, setTab] = useState<"chat" | "changes" | "screen">("chat");
  const [keysOpen, setKeysOpen] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [filePath, setFilePath] = useState<string | null>(null);
  const visible = useVisible();
  const pane = agent.pane;

  const chat = useChat(pane, visible);
  const screenEvery = !visible ? null : tab === "screen" || agent.status !== "working" ? 1000 : 2500;
  const screen = useScreen(pane, screenEvery);
  const rows = useMemo(() => toRows(chat.items), [chat.items]);
  const changedFiles = useMemo(
    () => new Set(chat.items.flatMap((i) => (i.kind === "tool" && i.change ? [i.change.path] : []))).size,
    [chat.items],
  );

  useEffect(() => {
    setPending([]);
    setMine(new Set());
    setTab("chat");
  }, [pane]);

  // Texts sent from this view: their bubbles get a "received" mark once the conversation shows them.
  const [mine, setMine] = useState<Set<string>>(new Set());

  // A sent message stops being pending once the queue or the conversation shows it.
  useEffect(() => {
    const said = new Set(chat.items.filter((i) => i.kind === "user").map((i) => same((i as { text: string }).text)));
    const queued = new Set(chat.queue.map(same));
    setPending((ps) => ps.filter((p) => p.state === "sending" || (!said.has(p.text) && !queued.has(p.text))));
  }, [chat.items, chat.queue]);

  // Typed but nowhere to be seen after a while: say so instead of claiming it went through.
  useEffect(() => {
    if (!pending.some((p) => p.state === "typed")) return;
    const timer = setInterval(() => {
      setPending((ps) =>
        ps.map((p) => (p.state === "typed" && Date.now() - p.at > UNCONFIRMED_AFTER_MS ? { ...p, state: "unconfirmed" } : p)),
      );
    }, 2000);
    return () => clearInterval(timer);
  }, [pending]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const send = async (text: string): Promise<boolean> => {
    const p: Pending = { id: Date.now(), text: same(text), at: Date.now(), state: "sending" };
    setPending((ps) => [...ps, p]);
    setMine((m) => new Set(m).add(p.text));
    try {
      if (agent.status === "blocked") await api.type(pane, text, true);
      else await api.send(pane, text);
      setPending((ps) => ps.map((x) => (x.id === p.id ? { ...x, state: "typed", at: Date.now() } : x)));
      setTimeout(() => void screen.refresh(), 400);
      return true;
    } catch (e) {
      setPending((ps) => ps.filter((x) => x.id !== p.id));
      setToast(
        e instanceof ApiError && e.code === "agent_blocked" ? t.answerFirst : e instanceof ApiError ? e.message : String(e),
      );
      return false;
    }
  };

  const spec = useDisplay();
  // A menu-shaped screen while the agent works is output scrolling by, not a question. herdr marks an
  // approval or question UI blocked, but a dialog it does not know (folder trust) leaves the status unknown.
  const showMenu = screen.menu !== null && agent.status !== "working";
  const [busy, setBusy] = useState<number | null>(null);
  const choose = async (n: number, label: string) => {
    setBusy(n);
    navigator.vibrate?.(10);
    try {
      screen.apply(await api.choose(pane, n, label));
    } catch (e) {
      setToast(e instanceof ApiError && e.code === "changed" ? t.menuChanged : e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const answering: Answering | null = showMenu ? { menu: screen.menu!, busy, choose } : null;

  return (
    <FileOpener.Provider value={setFilePath}>
      <section class={`chat st-${agent.status}${props.compact ? " is-compact" : ""}`}>
        <header class="chat-head">
          {!wide && (
            <a class="icon-btn" href={`#/s/${encodeURIComponent(agent.space)}`} aria-label={t.toList}>
              <I.Back />
            </a>
          )}
          <div class="chat-title">
            <p class="chat-name">
              <Badge agent={agent} />
              <span class="ellipsis">{nameOf(spec, agent)}</span>
            </p>
            <AgentLine agent={agent} class="chat-sub" />
          </div>
          <ActionsMenu agent={agent} queued={chat.queue.length} onError={setToast} />
          <span class={`status-pill st-${agent.status}`}>
            <StatusDot status={agent.status} />
            {STATUS_LABEL[agent.status]}
          </span>
          {props.onClose && (
            <button class="icon-btn small" aria-label={t.closePane} title={t.closePane} onClick={props.onClose}>
              <I.X size={16} />
            </button>
          )}
        </header>

        <div class="seg" role="tablist">
          <button role="tab" aria-selected={tab === "chat"} onClick={() => setTab("chat")}>
            {t.tabChat}
          </button>
          <button role="tab" aria-selected={tab === "changes"} onClick={() => setTab("changes")}>
            {t.tabChanges}
            {changedFiles > 0 && <span class="seg-count">{changedFiles}</span>}
          </button>
          <button role="tab" aria-selected={tab === "screen"} onClick={() => setTab("screen")}>
            {t.tabScreen}
          </button>
        </div>

        {tab === "chat" ? (
          <Messages
            rows={rows}
            failed={chat.failed}
            pending={pending}
            queue={chat.queue}
            mine={mine}
            state={chat.state}
            clipped={chat.clipped}
            answering={answering}
          />
        ) : tab === "changes" ? (
          <div class="messages">
            <ChangesTab items={chat.items} cwd={agent.cwd} />
          </div>
        ) : (
          <ScreenPane text={screen.text} />
        )}

        <div class="dock">
          {toast && (
            <p class="toast" role="status">
              {toast}
            </p>
          )}
          <SessionChips
            agent={agent}
            mode={screen.mode ?? chat.meta.permissionMode ?? "default"}
            model={chat.meta.model ?? null}
            todos={chat.todos}
            onRefresh={() => void screen.refresh()}
            onError={setToast}
          />
          {spec.band?.map((row, i) => (
            <PartRow key={i} row={row} of={agent} />
          ))}
          {answering && <MenuPanel {...answering} />}
          {(keysOpen || tab === "screen") && <KeyBar pane={pane} onError={setToast} />}
          <Composer agent={agent} onSend={send} keysOpen={keysOpen} onKeys={() => setKeysOpen(!keysOpen)} onError={setToast} />
          {spec.footer && <PartRow row={spec.footer} of={agent} />}
        </div>
        {filePath && <FileView pane={pane} path={filePath} onClose={() => setFilePath(null)} />}
      </section>
    </FileOpener.Provider>
  );
}

/** What the terminal offers besides typing — keys and commands with a name, and closing the session. */
function ActionsMenu({ agent, queued, onError }: { agent: Agent; queued: number; onError: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const pane = agent.pane;
  const run = async (work: () => Promise<unknown>) => {
    setOpen(false);
    navigator.vibrate?.(8);
    try {
      await work();
    } catch (e) {
      onError(e instanceof ApiError ? e.message : String(e));
    }
  };
  const keys = (k: string[]) => run(() => api.keys(pane, k));
  const say = (text: string) => run(() => api.send(pane, text));
  const items: { label: string; act: () => void; danger?: boolean; show?: boolean }[] = [
    { label: t.interrupt, act: () => keys(["esc"]), show: agent.status === "working" },
    { label: t.sendQueued, act: () => keys(["ctrl+x", "ctrl+s"]), show: queued > 0 },
    { label: t.cycleMode, act: () => keys(["shift+tab"]) },
    { label: t.compact, act: () => say("/compact") },
    { label: t.showContext, act: () => say("/context") },
    { label: t.showUsage, act: () => say("/usage") },
    { label: t.pickModel, act: () => say("/model") },
    { label: t.rewind, act: () => keys(["esc", "esc"]) },
    { label: t.clearChat, act: () => confirm(t.confirmClear) && say("/clear") },
    {
      label: t.closeSession,
      danger: true,
      act: () =>
        confirm(t.confirmClose) &&
        run(async () => {
          await api.close(pane);
          location.hash = `#/s/${encodeURIComponent(agent.space)}`;
        }),
    },
  ];
  return (
    <div class="actions">
      <button class="icon-btn" aria-label={t.actions} aria-expanded={open} onClick={() => setOpen(!open)}>
        <I.More />
      </button>
      {open && (
        <>
          <div class="actions-scrim" onClick={() => setOpen(false)} />
          <ul class="actions-menu" role="menu">
            {items
              .filter((i) => i.show !== false)
              .map((i) => (
                <li key={i.label}>
                  <button role="menuitem" class={i.danger ? "danger" : ""} onClick={i.act}>
                    {i.label}
                  </button>
                </li>
              ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** "claude-opus-5-5" → "Opus 5.5"; anything else as it is. */
export function modelName(id: string): string {
  const m = /^claude-([a-z]+)-(\d+)-(\d+)/.exec(id);
  return m ? `${m[1]![0]!.toUpperCase()}${m[1]!.slice(1)} ${m[2]}.${m[3]}` : id;
}

/** Permission mode, model and checklist — the session's settings as chips, each one a tap from changing. */
function SessionChips(props: {
  agent: Agent;
  mode: string;
  model: string | null;
  todos: Todos | null;
  onRefresh: () => void;
  onError: (m: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const pane = props.agent.pane;
  const act = (work: () => Promise<unknown>) =>
    work()
      .then(() => setTimeout(props.onRefresh, 350))
      .catch((e) => props.onError(e instanceof ApiError ? e.message : String(e)));
  const done = props.todos?.filter((x) => x.status === "completed").length ?? 0;
  return (
    <div class="session-chips">
      <button
        class={`session-chip mode-${props.mode}`}
        onClick={() => act(() => api.keys(pane, ["shift+tab"]))}
        title={t.cycleMode}
      >
        {t.modes[props.mode as keyof typeof t.modes] ?? props.mode}
      </button>
      {props.model && (
        <button class="session-chip" onClick={() => act(() => api.send(pane, "/model"))} title={t.pickModel}>
          {modelName(props.model)}
        </button>
      )}
      {props.todos && props.todos.length > 0 && (
        <button class="session-chip" aria-expanded={open} onClick={() => setOpen(!open)}>
          {t.todos} {done}/{props.todos.length}
        </button>
      )}
      {open && props.todos && (
        <ul class="todo-list">
          {props.todos.map((x, i) => (
            <li key={i} class={`todo-${x.status}`}>
              <span class="todo-box" aria-hidden="true">
                {x.status === "completed" ? "✓" : x.status === "in_progress" ? "◐" : "○"}
              </span>
              {x.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ScreenPane({ text }: { text: string }) {
  const box = useRef<HTMLPreElement>(null);
  useLayoutEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [text]);
  return (
    <pre class="screen" ref={box}>
      {text ? <Linked text={text} /> : t.readingScreen}
    </pre>
  );
}
