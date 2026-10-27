import { render, type ComponentChildren } from "preact";
import "./theme";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { api, type Agent, type Health, type LoadedDisplay, type Snapshot } from "./api";
import { DisplayContext, DisplayInfo, DisplaySet } from "./parts";
import { DisplayEditor } from "./displayedit";
import { DEFAULT_DISPLAY } from "../server/spec";
import { ChatView } from "./chat";
import { ConnectView, type Conn } from "./connect";
import { counts } from "./format";
import * as I from "./icons";
import { NewSessionView } from "./newsession";
import { SettingsView } from "./settings";
import { AgentList, SpaceCard, SpaceRow, Summary } from "./lists";
import { beside, close, layoutOf, parseSplit, prune, show, type Split } from "./split";
import { t } from "./i18n";

type Route =
  | { name: "connect" }
  | { name: "spaces" }
  | { name: "settings" }
  | { name: "display" }
  | { name: "space"; space: string }
  | { name: "new"; space: string }
  | { name: "agent"; pane: string };

function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  if (parts[0] === "spaces") return { name: "spaces" };
  if (parts[0] === "settings") return { name: "settings" };
  if (parts[0] === "display") return { name: "display" };
  if (parts[0] === "s" && parts[1]) return { name: "space", space: parts[1] };
  if (parts[0] === "new" && parts[1]) return { name: "new", space: parts[1] };
  if (parts[0] === "a" && parts[1]) return { name: "agent", pane: parts[1] };
  return { name: "connect" };
}

const go = (hash: string) => {
  if (location.hash !== hash) location.hash = hash;
};

function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseRoute(location.hash));
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return route;
}

function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}

function useStored(key: string, initial: string): [string, (v: string) => void] {
  const [value, setValue] = useState(() => {
    try {
      return localStorage.getItem(key) ?? initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (v: string) => {
      setValue(v);
      try {
        localStorage.setItem(key, v);
      } catch {
        /* private mode */
      }
    },
    [key],
  );
  return [value, set];
}

type Live = "waiting" | "up" | "lost" | "herdr-down";

/**
 * How long the stream may be down before the page says so. A phone drops it whenever the screen turns off, the
 * app is switched or the carrier moves its address, and the browser reconnects by itself within seconds.
 */
const LOST_AFTER_MS = 8_000;

declare const __BUILD__: string;

/** A newer build is being served than the one this page runs: offer to load it. */
function useNewBuild(): boolean {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    const check = () =>
      void api
        .health()
        .then((h) => h.build && h.build !== __BUILD__ && setStale(true))
        .catch(() => {});
    const timer = setInterval(check, 60_000);
    const onShow = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onShow);
    check();
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, []);
  return stale;
}

function Banner({ live, onRetry }: { live: Live; onRetry: () => void }) {
  if (live === "up" || live === "waiting") return null;
  return (
    <div class="banner" role="status">
      {live === "lost" ? t.lost : t.herdrDown}
      <button class="link-btn" onClick={onRetry}>
        {t.retry}
      </button>
    </div>
  );
}

function TopBar({
  title,
  back,
  machine,
  children,
}: {
  title: string;
  back?: string;
  machine?: string;
  children?: ComponentChildren;
}) {
  return (
    <header class="topbar">
      {back !== undefined ? (
        <a class="icon-btn" href={back} aria-label={t.back}>
          <I.Back />
        </a>
      ) : (
        <span class="topbar-mark">
          <I.Mark size={24} />
        </span>
      )}
      <div class="topbar-title">
        <h1>{title}</h1>
        {machine && <span class="topbar-machine">{machine}</span>}
      </div>
      {children}
    </header>
  );
}

/** The desktop's panes, kept per device: which agents are open side by side survives a reload. */
function useSplit(): [Split, (next: Split | ((s: Split) => Split)) => void] {
  const [split, setSplit] = useState<Split>(() => {
    try {
      return parseSplit(localStorage.getItem("split"));
    } catch {
      return parseSplit(null);
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("split", JSON.stringify(split));
    } catch {
      /* private mode: the split lasts for this page */
    }
  }, [split]);
  return [split, setSplit];
}

/** Up to four conversations at once: one alone, two side by side, three with the first down the left, four in a grid. */
function Panes(props: { split: Split; agents: Agent[]; onFocus: (pane: string) => void; onClose: (pane: string) => void }) {
  const shown = props.split.panes.flatMap((p) => props.agents.find((a) => a.pane === p) ?? []);
  const layout = layoutOf(shown.length);
  return (
    <div class={`panes panes-${layout}`}>
      {shown.map((a) => (
        <div
          key={a.pane}
          class={`pane${a.pane === props.split.focus ? " is-focus" : ""}`}
          // The pane a person touches is the one the address and the list follow.
          onMouseDownCapture={() => a.pane !== props.split.focus && props.onFocus(a.pane)}
          onFocusCapture={() => a.pane !== props.split.focus && props.onFocus(a.pane)}
        >
          <ChatView
            agent={a}
            wide
            onClose={shown.length > 1 ? () => props.onClose(a.pane) : undefined}
            compact={layout === "four" || (layout === "three" && a.pane !== shown[0]!.pane)}
          />
        </div>
      ))}
    </div>
  );
}

function Screens() {
  const route = useRoute();
  const wide = useMedia("(min-width: 900px)");
  const [conn, setConn] = useState<Conn>("checking");
  const [health, setHealth] = useState<Health | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [live, setLive] = useState<Live>("waiting");
  const [machine, setMachine] = useStored("machine", "PC");
  const [auto, setAuto] = useStored("autoconnect", "0");
  const [stream, setStream] = useState(0);
  const reopens = useRef(0);
  /** When the stream last went down, kept across the streams opened again so that their waits add up. */
  const downSince = useRef<number | null>(null);

  const probe = useCallback(async () => {
    setConn("checking");
    try {
      const h = await api.health();
      setHealth(h);
      setMachine(h.machine);
      setConn("online");
      setStream((n) => n + 1);
      return h;
    } catch {
      setConn("offline");
      return null;
    }
  }, [setMachine]);

  useEffect(() => {
    void probe().then((h) => {
      if (h && auto === "1" && parseRoute(location.hash).name === "connect") go(wide ? "#/s/" : "#/spaces");
    });
    // Once, at start: later probes come from the retry button and from the page becoming visible.
  }, []);

  useEffect(() => {
    if (conn !== "online") return;
    const es = new EventSource("/api/events");
    let lost: ReturnType<typeof setTimeout> | undefined;
    let reopen: ReturnType<typeof setTimeout> | undefined;
    es.addEventListener("snapshot", (e) => {
      clearTimeout(lost);
      lost = undefined;
      reopens.current = 0;
      downSince.current = null;
      setSnap(JSON.parse((e as MessageEvent<string>).data));
      setLive("up");
    });
    es.addEventListener("down", () => setLive("herdr-down"));
    es.onerror = () => {
      const since = (downSince.current ??= Date.now());
      lost ??= setTimeout(() => setLive("lost"), Math.max(0, since + LOST_AFTER_MS - Date.now()));
      // The browser gives up for good after a refused response (a proxy's 502 while the tunnel rebinds), so a
      // closed stream is opened again here, waiting longer each time.
      if (es.readyState === EventSource.CLOSED && reopen === undefined) {
        const wait = Math.min(30_000, 1_000 * 2 ** reopens.current++);
        reopen = setTimeout(() => setStream((n) => n + 1), wait);
      }
    };
    return () => {
      clearTimeout(lost);
      clearTimeout(reopen);
      es.close();
    };
  }, [conn, stream]);

  useEffect(() => {
    const on = () => {
      if (document.visibilityState === "visible" && (conn === "offline" || live === "lost")) void probe();
    };
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, [conn, live, probe]);

  const blocked = snap ? counts(snap.agents).blocked : 0;
  useEffect(() => {
    document.title = blocked > 0 ? `(${blocked}) arcdr` : "arcdr";
  }, [blocked]);

  const firstSpace = snap?.spaces[0]?.id ?? "";
  const connect = () => go(wide ? `#/s/${encodeURIComponent(firstSpace)}` : "#/spaces");

  // "#/s/" with no id (auto-connect before the first snapshot) settles on the first space.
  useEffect(() => {
    if (location.hash === "#/s/" && firstSpace) go(`#/s/${encodeURIComponent(firstSpace)}`);
  }, [firstSpace]);

  const agent = route.name === "agent" ? (snap?.agents.find((a) => a.pane === route.pane) ?? null) : null;

  // The address names the focused pane; a plain click puts an agent there (or focuses its pane).
  const [split, setSplit] = useSplit();
  const routePane = route.name === "agent" ? route.pane : null;
  useEffect(() => {
    if (wide && routePane) setSplit((s) => show(s, routePane));
  }, [wide, routePane]);
  useEffect(() => {
    if (snap) setSplit((s) => prune(s, new Set(snap.agents.map((a) => a.pane))));
  }, [snap]);
  // Already this render, before the effect above keeps it: no frame shows the old agent in the focused pane.
  const view = wide && routePane ? show(split, routePane) : split;
  const openBeside = (pane: string) => {
    setSplit((s) => beside(s, pane));
    go(`#/a/${encodeURIComponent(pane)}`);
  };
  const closePane = (pane: string) => {
    const next = close(view, pane);
    setSplit(next);
    go(next.focus ? `#/a/${encodeURIComponent(next.focus)}` : `#/s/${encodeURIComponent(firstSpace)}`);
  };
  const spaceId = route.name === "space" || route.name === "new" ? route.space : agent ? agent.space : firstSpace;
  const space = snap?.spaces.find((s) => s.id === spaceId) ?? null;
  const spaceAgents = useMemo(() => snap?.agents.filter((a) => a.space === spaceId) ?? [], [snap, spaceId]);

  if (route.name === "connect" || !snap) {
    return (
      <ConnectView
        conn={conn}
        health={health}
        machine={machine}
        auto={auto === "1"}
        onAuto={(on) => setAuto(on ? "1" : "0")}
        onRetry={() => void probe()}
        onConnect={connect}
      />
    );
  }

  const banner = <Banner live={live} onRetry={() => void probe()} />;
  const lostAgent =
    route.name === "agent" && !agent ? (
      <div class="placeholder">
        <p>{t.agentGone}</p>
        <a class="btn btn-ghost" href={`#/s/${encodeURIComponent(firstSpace)}`}>
          {t.toList}
        </a>
      </div>
    ) : null;

  if (wide) {
    return (
      <div class="shell">
        <aside class="sidebar">
          <div class="side-head">
            <a class="side-home" href="#/" title={t.connectScreen}>
              <I.Mark size={22} />
              <span class="side-machine">{health?.machine ?? machine}</span>
              <span class={`conn-dot conn-${live === "up" ? "online" : "offline"}`} />
            </a>
            <a
              class="icon-btn"
              href="#/settings"
              aria-label={t.settings}
              aria-current={route.name === "settings" ? "page" : undefined}
            >
              <I.Gear />
            </a>
          </div>
          <p class="side-label">{t.spaces}</p>
          <nav class="space-rows">
            {snap.spaces.map((s) => (
              <SpaceRow key={s.id} space={s} agents={snap.agents.filter((a) => a.space === s.id)} selected={s.id === spaceId} />
            ))}
          </nav>
          <p class="side-label side-label-row">
            <span>
              {t.agents} <span class="side-count">{spaceAgents.length}</span>
            </span>
            <a
              class="icon-btn small"
              href={`#/new/${encodeURIComponent(spaceId)}`}
              aria-label={t.newSession}
              title={t.newSession}
            >
              <I.Plus size={16} />
            </a>
          </p>
          <AgentList agents={spaceAgents} selected={agent?.pane ?? null} open={view.panes} onBeside={openBeside} />
        </aside>
        <main class="main">
          {banner}
          {route.name === "settings" ? (
            <div class="scroll">
              <SettingsView health={health} />
            </div>
          ) : route.name === "display" ? (
            <div class="scroll">
              <DisplayEditor agents={snap.agents} />
            </div>
          ) : route.name === "new" && space ? (
            <div class="scroll">
              <NewSessionView space={space} agents={spaceAgents} />
            </div>
          ) : agent ? (
            <Panes
              split={view}
              agents={snap.agents}
              onFocus={(pane) => go(`#/a/${encodeURIComponent(pane)}`)}
              onClose={closePane}
            />
          ) : (
            (lostAgent ?? (
              <div class="placeholder">
                <I.Mark size={48} />
                <p>{t.pickAgent}</p>
                {space && <Summary c={counts(spaceAgents)} />}
              </div>
            ))
          )}
        </main>
      </div>
    );
  }

  if (route.name === "settings") {
    return (
      <div class="screen-wrap">
        <TopBar title={t.settings} back="#/spaces" machine={health?.machine ?? machine} />
        <div class="scroll">
          <SettingsView health={health} />
        </div>
      </div>
    );
  }

  if (route.name === "display") {
    return (
      <div class="screen-wrap">
        <TopBar title={t.customize} back="#/settings" machine={health?.machine ?? machine} />
        <div class="scroll">
          <DisplayEditor agents={snap.agents} />
        </div>
      </div>
    );
  }

  if (route.name === "new" && space) {
    return (
      <div class="screen-wrap">
        <TopBar title={t.newSession} back={`#/s/${encodeURIComponent(space.id)}`} machine={space.label} />
        <div class="scroll">
          <NewSessionView space={space} agents={spaceAgents} />
        </div>
      </div>
    );
  }

  if (route.name === "agent") {
    return (
      <div class="screen-wrap">
        {banner}
        {agent ? <ChatView agent={agent} wide={false} /> : lostAgent}
      </div>
    );
  }

  if (route.name === "space" && space) {
    return (
      <div class="screen-wrap">
        <TopBar title={space.label} back="#/spaces" machine={health?.machine ?? machine}>
          <Summary c={counts(spaceAgents)} compact />
          <a class="icon-btn" href={`#/new/${encodeURIComponent(space.id)}`} aria-label={t.newSession}>
            <I.Plus />
          </a>
        </TopBar>
        {banner}
        <div class="scroll">
          <AgentList agents={spaceAgents} selected={null} />
        </div>
      </div>
    );
  }

  return (
    <div class="screen-wrap">
      <TopBar title={t.spaces} back="#/" machine={health?.machine ?? machine}>
        <a class="icon-btn" href="#/settings" aria-label={t.settings}>
          <I.Gear />
        </a>
      </TopBar>
      {banner}
      <div class="scroll">
        <div class="space-cards">
          {snap.spaces.map((s) => (
            <SpaceCard key={s.id} space={s} agents={snap.agents.filter((a) => a.space === s.id)} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Hands the display spec (docs/mods.md) to every screen; reread every 30 s so an edited display.json shows up. */
function App() {
  const [display, setDisplay] = useState<LoadedDisplay | null>(null);
  useEffect(() => {
    const load = () =>
      void api
        .display()
        .then(setDisplay)
        .catch(() => {});
    load();
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, []);
  const stale = useNewBuild();
  return (
    <DisplayInfo.Provider value={display}>
      {stale && (
        <div class="banner update-banner" role="status">
          {t.newVersion}
          <button class="link-btn" onClick={() => location.reload()}>
            {t.reload}
          </button>
        </div>
      )}
      <DisplaySet.Provider value={setDisplay}>
        <DisplayContext.Provider value={display?.spec ?? DEFAULT_DISPLAY}>
          <Screens />
        </DisplayContext.Provider>
      </DisplaySet.Provider>
    </DisplayInfo.Provider>
  );
}

render(<App />, document.getElementById("app")!);

if ("serviceWorker" in navigator) {
  addEventListener("load", () => void navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
