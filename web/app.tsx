import { render, type ComponentChildren } from "preact";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { api, type Health, type Snapshot } from "./api";
import { ChatView } from "./chat";
import { ConnectView, type Conn } from "./connect";
import { counts } from "./format";
import * as I from "./icons";
import { AgentList, SpaceCard, SpaceRow, Summary } from "./lists";

type Route = { name: "connect" } | { name: "spaces" } | { name: "space"; space: string } | { name: "agent"; pane: string };

function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  if (parts[0] === "spaces") return { name: "spaces" };
  if (parts[0] === "s" && parts[1]) return { name: "space", space: parts[1] };
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

function Banner({ live, onRetry }: { live: Live; onRetry: () => void }) {
  if (live === "up" || live === "waiting") return null;
  return (
    <div class="banner" role="status">
      {live === "lost" ? "연결이 끊겼습니다 · 다시 연결하는 중" : "herdr 가 응답하지 않습니다"}
      <button class="link-btn" onClick={onRetry}>
        다시 시도
      </button>
    </div>
  );
}

function TopBar({ title, back, machine, children }: { title: string; back?: string; machine?: string; children?: ComponentChildren }) {
  return (
    <header class="topbar">
      {back !== undefined ? (
        <a class="icon-btn" href={back} aria-label="뒤로">
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

function App() {
  const route = useRoute();
  const wide = useMedia("(min-width: 900px)");
  const [conn, setConn] = useState<Conn>("checking");
  const [health, setHealth] = useState<Health | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [live, setLive] = useState<Live>("waiting");
  const [machine, setMachine] = useStored("machine", "PC");
  const [auto, setAuto] = useStored("autoconnect", "0");
  const [stream, setStream] = useState(0);

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
    es.addEventListener("snapshot", (e) => {
      setSnap(JSON.parse((e as MessageEvent<string>).data));
      setLive("up");
    });
    es.addEventListener("down", () => setLive("herdr-down"));
    es.onerror = () => setLive("lost");
    return () => es.close();
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
  const spaceId = route.name === "space" ? route.space : agent ? agent.space : firstSpace;
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
        <p>이 에이전트는 더 이상 없습니다.</p>
        <a class="btn btn-ghost" href={`#/s/${encodeURIComponent(firstSpace)}`}>
          목록으로
        </a>
      </div>
    ) : null;

  if (wide) {
    return (
      <div class="shell">
        <aside class="sidebar">
          <a class="side-head" href="#/" title="연결 화면">
            <I.Mark size={22} />
            <span class="side-machine">{health?.machine ?? machine}</span>
            <span class={`conn-dot conn-${live === "up" ? "online" : "offline"}`} />
          </a>
          <p class="side-label">Spaces</p>
          <nav class="space-rows">
            {snap.spaces.map((s) => (
              <SpaceRow key={s.id} space={s} agents={snap.agents.filter((a) => a.space === s.id)} selected={s.id === spaceId} />
            ))}
          </nav>
          <p class="side-label">
            에이전트 <span class="side-count">{spaceAgents.length}</span>
          </p>
          <AgentList agents={spaceAgents} selected={agent?.pane ?? null} />
        </aside>
        <main class="main">
          {banner}
          {agent ? (
            <ChatView agent={agent} wide />
          ) : (
            (lostAgent ?? (
              <div class="placeholder">
                <I.Mark size={48} />
                <p>왼쪽에서 에이전트를 고르세요.</p>
                {space && <Summary c={counts(spaceAgents)} />}
              </div>
            ))
          )}
        </main>
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
      <TopBar title="Spaces" back="#/" machine={health?.machine ?? machine} />
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

render(<App />, document.getElementById("app")!);

if ("serviceWorker" in navigator) {
  addEventListener("load", () => void navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
