import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { api, ApiError, type Agent, type ChatItem, type Menu } from "./api";
import { agentName, agentSubtitle, STATUS_LABEL } from "./format";
import * as I from "./icons";
import { Stage, StatusDot } from "./lists";
import { Markdown } from "./markdown";

type Shown = Exclude<ChatItem, { kind: "tool-error" }>;
type Tool = Extract<ChatItem, { kind: "tool" }>;
type Row = { kind: "item"; item: Shown } | { kind: "tools"; id: string; tools: Tool[] };

interface Pending {
  id: number;
  text: string;
  at: number;
  state: "sending" | "sent" | "failed";
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
  const cursor = useRef<{ offset: number; file: string | null }>({ offset: 0, file: null });

  const absorb = useCallback((incoming: ChatItem[], replace: boolean) => {
    const errors = incoming.filter((i) => i.kind === "tool-error").map((i) => (i as { target: string }).target);
    if (errors.length) setFailed((f) => new Set([...(replace ? [] : f), ...errors]));
    else if (replace) setFailed(new Set());
    const shown = incoming.filter((i): i is Shown => i.kind !== "tool-error");
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
    setItems([]);
    setFailed(new Set());
    setState("loading");
    pull().catch(() => setState("error"));
  }, [pull]);

  useEffect(() => {
    if (!polling) return;
    const t = setInterval(() => pull().catch(() => {}), 1500);
    return () => clearInterval(t);
  }, [pull, polling]);

  return { items, failed, state, clipped };
}

/** The visible terminal and any menu on it. */
function useScreen(pane: string, intervalMs: number | null) {
  const [text, setText] = useState("");
  const [menu, setMenu] = useState<Menu | null>(null);
  const apply = useCallback((r: { text: string; menu: Menu | null }) => {
    setText(r.text);
    setMenu(r.menu);
  }, []);
  const refresh = useCallback(() => api.screen(pane).then(apply).catch(() => {}), [pane, apply]);
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
  return { text, menu, refresh, apply };
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
        더 보기
      </button>
    </>
  );
}

function ToolGroup({ tools, failed }: { tools: Tool[]; failed: Set<string> }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const errors = tools.filter((t) => failed.has(t.id)).length;
  const last = tools[tools.length - 1]!;
  return (
    <div class={`tools${open ? " open" : ""}`}>
      <button class="tools-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <I.Wrench size={14} />
        <span class="tools-count">도구 {tools.length}</span>
        {errors > 0 && <span class="tools-err">실패 {errors}</span>}
        {!open && (
          <span class="tools-last">
            <b>{last.name}</b> {last.summary}
          </span>
        )}
      </button>
      {open && (
        <ul class="tools-list">
          {tools.map((t) => (
            <li key={t.id} class={failed.has(t.id) ? "err" : ""}>
              <button class="tool-line" onClick={() => setDetail(detail === t.id ? null : t.id)}>
                <b>{t.name}</b> <span>{t.summary}</span>
              </button>
              {detail === t.id && t.detail && <pre class="tool-detail">{t.detail}</pre>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Message({ item, latest }: { item: Shown; latest: boolean }) {
  switch (item.kind) {
    case "user":
      return (
        <div class="msg msg-user">
          <div class="bubble">{item.text}</div>
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
              <p class="ask-title">{q.question}</p>
              <ol class="ask-options">
                {q.options.map((o, j) => (
                  <li key={j}>{o}</li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      );
    case "note":
      return <div class="msg msg-note">{item.text}</div>;
    case "tool":
      return null;
  }
}

function Messages(props: { rows: Row[]; failed: Set<string>; pending: Pending[]; state: string; clipped: boolean }) {
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
  }, [props.rows.length, props.pending.length, props.rows[props.rows.length - 1]]);

  // The newest answer is what the person came to read, so it is never folded.
  let lastAssistant: string | null = null;
  for (const r of props.rows) if (r.kind === "item" && r.item.kind === "assistant") lastAssistant = r.item.id;

  const toBottom = () => {
    const el = box.current!;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setBehind(false);
  };

  return (
    <div class="messages" ref={box} onScroll={onScroll}>
      <div class="messages-inner">
        {props.clipped && <p class="msg msg-note">앞부분은 생략했습니다</p>}
        {props.state === "loading" && <p class="msg msg-note">대화를 불러오는 중…</p>}
        {props.state === "none" && <p class="msg msg-note">이 에이전트의 대화 기록을 찾지 못했습니다. 「화면」에서 보세요.</p>}
        {props.state === "error" && <p class="msg msg-note">대화를 불러오지 못했습니다.</p>}
        {props.rows.map((r) =>
          r.kind === "tools" ? (
            <ToolGroup key={r.id} tools={r.tools} failed={props.failed} />
          ) : (
            <Message key={r.item.id} item={r.item} latest={r.item.id === lastAssistant} />
          ),
        )}
        {props.pending.map((p) => (
          <div key={p.id} class={`msg msg-user pending is-${p.state}`}>
            <div class="bubble">{p.text}</div>
            <span class="pending-state">{p.state === "failed" ? "못 보냄" : p.state === "sending" ? "보내는 중" : "보냄"}</span>
          </div>
        ))}
      </div>
      {behind && (
        <button class="to-bottom" onClick={toBottom}>
          <I.Down size={16} /> 새 메시지
        </button>
      )}
    </div>
  );
}

function MenuPanel(props: { pane: string; menu: Menu; onResult: (r: { text: string; menu: Menu | null }) => void; onError: (m: string) => void }) {
  const [busy, setBusy] = useState<number | null>(null);
  const choose = async (n: number, label: string) => {
    setBusy(n);
    navigator.vibrate?.(10);
    try {
      props.onResult(await api.choose(props.pane, n, label));
    } catch (e) {
      props.onError(e instanceof ApiError && e.code === "changed" ? "선택지가 바뀌었습니다. 다시 확인하세요." : e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
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
    <section class="menu-panel" aria-label="선택지">
      <p class="menu-head">
        <span class="menu-badge">답이 필요합니다</span>
      </p>
      {detail && (
        <pre class="menu-context" ref={detailBox}>
          {detail}
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
    <div class="keybar" role="toolbar" aria-label="키">
      {KEYS.map((k) => (
        <button key={k.key} class={`key${k.wide ? " key-wide" : ""}`} onClick={() => press(k.key)}>
          {k.label}
        </button>
      ))}
    </div>
  );
}

function Composer(props: { agent: Agent; onSend: (text: string) => Promise<boolean>; keysOpen: boolean; onKeys: () => void }) {
  const draftKey = `draft:${props.agent.pane}`;
  const [text, setText] = useState(() => stored(draftKey));
  const [sending, setSending] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setText(stored(draftKey)), [draftKey]);
  useEffect(() => store(draftKey, text), [draftKey, text]);
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, Math.round(window.innerHeight * 0.35))}px`;
  }, [text]);

  const submit = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    const ok = await props.onSend(t);
    setSending(false);
    if (ok) setText("");
  };

  const blocked = props.agent.status === "blocked";
  return (
    <form
      class="composer"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <button type="button" class="icon-btn" aria-pressed={props.keysOpen} aria-label="키 버튼" onClick={props.onKeys}>
        <I.Keyboard />
      </button>
      <textarea
        ref={area}
        rows={1}
        value={text}
        enterkeyhint={COARSE ? "enter" : "send"}
        placeholder={blocked ? "화면에 그대로 입력" : "메시지 보내기"}
        onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
        onKeyDown={(e) => {
          // Desktop: Enter sends, Shift+Enter breaks the line. A phone keeps Enter for new lines.
          // isComposing / 229: the Enter that commits a Hangul syllable must not send.
          if (e.key === "Enter" && !e.shiftKey && !COARSE && !e.isComposing && e.keyCode !== 229) {
            e.preventDefault();
            void submit();
          }
        }}
      />
      <button type="submit" class="send-btn" disabled={!text.trim() || sending} aria-label="보내기">
        <I.Send />
      </button>
    </form>
  );
}

export function ChatView({ agent, wide }: { agent: Agent; wide: boolean }) {
  const [tab, setTab] = useState<"chat" | "screen">("chat");
  const [keysOpen, setKeysOpen] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const visible = useVisible();
  const pane = agent.pane;

  const chat = useChat(pane, visible);
  const screenEvery = !visible ? null : tab === "screen" || agent.status === "blocked" ? 1000 : 2500;
  const screen = useScreen(pane, screenEvery);
  const rows = useMemo(() => toRows(chat.items), [chat.items]);

  useEffect(() => {
    setPending([]);
    setTab("chat");
  }, [pane]);

  // A sent message stops being pending once the transcript shows it.
  useEffect(() => {
    const said = new Set(chat.items.filter((i) => i.kind === "user").map((i) => (i as { text: string }).text.trim()));
    setPending((ps) => ps.filter((p) => !said.has(p.text) && Date.now() - p.at < 120_000));
  }, [chat.items]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const send = async (text: string): Promise<boolean> => {
    const p: Pending = { id: Date.now(), text, at: Date.now(), state: "sending" };
    setPending((ps) => [...ps, p]);
    try {
      if (agent.status === "blocked") await api.type(pane, text, true);
      else await api.send(pane, text);
      setPending((ps) => ps.map((x) => (x.id === p.id ? { ...x, state: "sent" } : x)));
      setTimeout(() => void screen.refresh(), 400);
      return true;
    } catch (e) {
      setPending((ps) => ps.filter((x) => x.id !== p.id));
      setToast(
        e instanceof ApiError && e.code === "agent_blocked"
          ? "선택지에 먼저 답하세요."
          : e instanceof ApiError
            ? e.message
            : String(e),
      );
      return false;
    }
  };

  const stage = agent.tokens.stage ?? "";
  const sub = agentSubtitle(agent);
  // herdr marks an agent blocked when it recognises an approval or question UI; a menu-shaped
  // screen without that is old output, so no buttons for it.
  const showMenu = screen.menu !== null && agent.status === "blocked";

  return (
    <section class={`chat st-${agent.status}`}>
      <header class="chat-head">
        {!wide && (
          <a class="icon-btn" href={`#/s/${encodeURIComponent(agent.space)}`} aria-label="목록으로">
            <I.Back />
          </a>
        )}
        <div class="chat-title">
          <p class="chat-name">
            {agent.tokens.tree && <span class="tree">{agent.tokens.tree}</span>}
            <span class="ellipsis">{agentName(agent)}</span>
          </p>
          {(stage || sub) && (
            <p class="chat-sub">
              {stage && <Stage text={stage} />}
              {sub && <span class="ellipsis">{sub}</span>}
            </p>
          )}
        </div>
        <span class={`status-pill st-${agent.status}`}>
          <StatusDot status={agent.status} />
          {STATUS_LABEL[agent.status]}
        </span>
      </header>

      <div class="seg" role="tablist">
        <button role="tab" aria-selected={tab === "chat"} onClick={() => setTab("chat")}>
          대화
        </button>
        <button role="tab" aria-selected={tab === "screen"} onClick={() => setTab("screen")}>
          화면
        </button>
      </div>

      {tab === "chat" ? (
        <Messages rows={rows} failed={chat.failed} pending={pending} state={chat.state} clipped={chat.clipped} />
      ) : (
        <ScreenPane text={screen.text} />
      )}

      <div class="dock">
        {toast && (
          <p class="toast" role="status">
            {toast}
          </p>
        )}
        {showMenu && <MenuPanel pane={pane} menu={screen.menu!} onResult={screen.apply} onError={setToast} />}
        {(keysOpen || tab === "screen") && <KeyBar pane={pane} onError={setToast} />}
        <Composer agent={agent} onSend={send} keysOpen={keysOpen} onKeys={() => setKeysOpen(!keysOpen)} />
      </div>
    </section>
  );
}

function ScreenPane({ text }: { text: string }) {
  const box = useRef<HTMLPreElement>(null);
  useLayoutEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [text]);
  return (
    <pre class="screen" ref={box}>
      {text || "화면을 읽는 중…"}
    </pre>
  );
}
