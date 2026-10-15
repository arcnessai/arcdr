import { useEffect, useState } from "preact/hooks";
import { api, type Agent, type AgentStatus, type Space } from "./api";
import { counts, STATUS_LABEL, type Counts } from "./format";
import * as I from "./icons";
import { t } from "./i18n";
import { nameOf, PartView, Parts, useDisplay } from "./parts";
import { applyMove, useReorder } from "./reorder";

export function StatusDot({ status }: { status: AgentStatus }) {
  return (
    <span class={`dot dot-${status}`} title={STATUS_LABEL[status]} role="img" aria-label={STATUS_LABEL[status]}>
      {status === "done" ? "✓" : status === "blocked" ? "!" : ""}
    </span>
  );
}

export function Summary({ c, compact = false }: { c: Counts; compact?: boolean }) {
  const parts: { status: AgentStatus; n: number }[] = [
    { status: "blocked", n: c.blocked },
    { status: "working", n: c.working },
    { status: "done", n: c.done },
  ];
  return (
    <span class={`summary${compact ? " compact" : ""}`}>
      {parts
        .filter((p) => p.n > 0)
        .map((p) => (
          <span key={p.status} class={`chip chip-${p.status}`}>
            <StatusDot status={p.status} />
            {compact ? p.n : `${STATUS_LABEL[p.status]} ${p.n}`}
          </span>
        ))}
    </span>
  );
}

/** The short value before the status icon, as the display spec names it (herdr's `$tree`, here by default). */
export function Badge({ agent }: { agent: Agent }) {
  const spec = useDisplay();
  return <span class="tree">{spec.agent.badge && <PartView part={{ as: "badge", ...spec.agent.badge }} of={agent} />}</span>;
}

/** The line under an agent's name: whatever the display spec puts there, from the values mods report. */
export function AgentLine({ agent, class: cls }: { agent: Agent; class: string }) {
  const spec = useDisplay();
  return <Parts parts={spec.agent.line} of={agent} class={cls} />;
}

export function AgentRow(props: {
  agent: Agent;
  selected: boolean;
  /** Open in a pane of its own (desktop): Ctrl+click or ⌘+click does it. */
  onBeside?: (pane: string) => void;
  /** Open in one of the desktop's panes, not the focused one. */
  inPane?: boolean;
}) {
  const { agent, selected, onBeside } = props;
  const spec = useDisplay();
  return (
    <a
      class={`agent-row st-${agent.status}${selected ? " selected" : ""}${props.inPane ? " in-pane" : ""}`}
      href={`#/a/${encodeURIComponent(agent.pane)}`}
      aria-current={selected ? "page" : undefined}
      onClick={(e) => {
        if (!onBeside || !(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        onBeside(agent.pane);
      }}
    >
      <Badge agent={agent} />
      <StatusDot status={agent.status} />
      <span class="row-main">
        <span class="row-name">{nameOf(spec, agent)}</span>
        <AgentLine agent={agent} class="row-sub" />
      </span>
      <I.Chevron size={18} class="row-chev" />
    </a>
  );
}

/**
 * A space's agents in herdr's tab order. Dragging a row (a finger holds it first) moves the agent's tab in
 * herdr itself, so the terminal's sidebar and every screen show the same order.
 */
export function AgentList(props: {
  agents: Agent[];
  selected: string | null;
  /** Desktop: the agents open in panes, and how to open one beside them. */
  open?: string[];
  onBeside?: (pane: string) => void;
}) {
  const { agents, selected, onBeside } = props;
  // herdr's new order arrives with the next snapshot, a moment later: until then the move shows already.
  const [pending, setPending] = useState<{ pane: string; before: string | null } | null>(null);
  const order = agents.map((a) => a.pane).join(",");
  useEffect(() => setPending(null), [order]);
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setPending(null), 4000);
    return () => clearTimeout(timer);
  }, [pending]);
  const shown = pending ? applyMove(agents, pending.pane, pending.before) : agents;
  const move = (pane: string, before: string | null) => {
    setPending({ pane, before });
    api.move(pane, before).catch(() => setPending(null));
  };
  const { list, drag } = useReorder(
    shown.map((a) => a.pane),
    move,
    agents.length > 0,
  );

  if (agents.length === 0) return <p class="empty">{t.noAgents}</p>;
  return (
    <nav ref={list} class={`agent-list${drag ? " is-dragging" : ""}`} aria-label={t.agents}>
      {shown.map((a) => {
        const lifted = drag?.pane === a.pane;
        return (
          <div
            key={a.pane}
            data-pane={a.pane}
            class={`agent-item${lifted ? " is-lifted" : ""}${drag && !lifted && drag.before === a.pane ? " drop-before" : ""}`}
            style={lifted ? { transform: `translateY(${drag!.dy}px)` } : undefined}
            title={t.dragToReorder}
          >
            <AgentRow
              agent={a}
              selected={a.pane === selected}
              inPane={a.pane !== selected && (props.open ?? []).includes(a.pane)}
              onBeside={onBeside}
            />
            {onBeside && (
              <button
                type="button"
                class="icon-btn small split-btn"
                aria-label={t.openBeside}
                title={t.openBeside}
                onClick={() => onBeside(a.pane)}
              >
                <I.Columns size={16} />
              </button>
            )}
          </div>
        );
      })}
      {drag && drag.before === null && <div class="drop-end" aria-hidden="true" />}
    </nav>
  );
}

export function SpaceCard({ space, agents }: { space: Space; agents: Agent[] }) {
  const c = counts(agents);
  const spec = useDisplay();
  return (
    <a class={`space-card${c.blocked ? " has-blocked" : ""}`} href={`#/s/${encodeURIComponent(space.id)}`}>
      <span class="space-main">
        <span class="space-name">{space.label}</span>
        <span class="space-meta">{t.agentCount(c.total)}</span>
        <Parts parts={spec.space.line} of={{ tokens: space.tokens, title: space.label }} class="row-sub" />
        <Summary c={c} />
      </span>
      <I.Chevron size={20} class="row-chev" />
    </a>
  );
}

export function SpaceRow({ space, agents, selected }: { space: Space; agents: Agent[]; selected: boolean }) {
  return (
    <a
      class={`space-row${selected ? " selected" : ""}`}
      href={`#/s/${encodeURIComponent(space.id)}`}
      aria-current={selected ? "page" : undefined}
    >
      <span class="space-row-name">{space.label}</span>
      <Summary c={counts(agents)} compact />
    </a>
  );
}
