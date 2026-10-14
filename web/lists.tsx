import type { Agent, AgentStatus, Space } from "./api";
import { counts, STATUS_LABEL, type Counts } from "./format";
import * as I from "./icons";
import { t } from "./i18n";
import { nameOf, PartView, Parts, useDisplay } from "./parts";

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

export function AgentRow({ agent, selected }: { agent: Agent; selected: boolean }) {
  const spec = useDisplay();
  return (
    <a
      class={`agent-row st-${agent.status}${selected ? " selected" : ""}`}
      href={`#/a/${encodeURIComponent(agent.pane)}`}
      aria-current={selected ? "page" : undefined}
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

export function AgentList({ agents, selected }: { agents: Agent[]; selected: string | null }) {
  if (agents.length === 0) return <p class="empty">{t.noAgents}</p>;
  return (
    <nav class="agent-list" aria-label={t.agents}>
      {agents.map((a) => (
        <AgentRow key={a.pane} agent={a} selected={a.pane === selected} />
      ))}
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
