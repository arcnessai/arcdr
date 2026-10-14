import type { Agent, AgentStatus, Space } from "./api";
import { agentName, agentSubtitle, counts, stageTone, STATUS_LABEL, type Counts } from "./format";
import * as I from "./icons";
import { t } from "./i18n";

export function StatusDot({ status }: { status: AgentStatus }) {
  return (
    <span class={`dot dot-${status}`} title={STATUS_LABEL[status]} role="img" aria-label={STATUS_LABEL[status]}>
      {status === "done" ? "✓" : status === "blocked" ? "!" : ""}
    </span>
  );
}

export function Stage({ text }: { text: string }) {
  return <span class={`stage tone-${stageTone(text)}`}>{text}</span>;
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

export function AgentRow({ agent, selected }: { agent: Agent; selected: boolean }) {
  const stage = agent.tokens.stage ?? "";
  const sub = agentSubtitle(agent);
  return (
    <a
      class={`agent-row st-${agent.status}${selected ? " selected" : ""}`}
      href={`#/a/${encodeURIComponent(agent.pane)}`}
      aria-current={selected ? "page" : undefined}
    >
      <span class="tree">{agent.tokens.tree ?? ""}</span>
      <StatusDot status={agent.status} />
      <span class="row-main">
        <span class="row-name">{agentName(agent)}</span>
        {(stage || sub) && (
          <span class="row-sub">
            {stage && <Stage text={stage} />}
            {sub && <span class="row-conv">{sub}</span>}
          </span>
        )}
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
  return (
    <a class={`space-card${c.blocked ? " has-blocked" : ""}`} href={`#/s/${encodeURIComponent(space.id)}`}>
      <span class="space-main">
        <span class="space-name">{space.label}</span>
        <span class="space-meta">{t.agentCount(c.total)}</span>
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
