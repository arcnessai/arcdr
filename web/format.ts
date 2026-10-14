import type { Agent, AgentStatus } from "./api";

export const STATUS_LABEL: Record<AgentStatus, string> = {
  working: "작업 중",
  blocked: "답 필요",
  done: "끝남",
  idle: "대기",
  unknown: "모름",
};

/** Same colours as the `$stage` rules in ~/.config/herdr/config.toml, keyed by the stage's first symbol. */
export function stageTone(stage: string): string {
  switch (stage.trim().charAt(0)) {
    case "◐":
      return "yellow";
    case "◆":
      return "cyan";
    case "▲":
      return "orange";
    case "✓":
      return "green";
    case "◇":
      return "pink";
    case "○":
      return "dim";
    default:
      return "purple";
  }
}

export interface Counts {
  working: number;
  blocked: number;
  done: number;
  idle: number;
  total: number;
}

export function counts(agents: Agent[]): Counts {
  const c: Counts = { working: 0, blocked: 0, done: 0, idle: 0, total: agents.length };
  for (const a of agents) if (a.status in c) c[a.status as keyof Omit<Counts, "total">]++;
  return c;
}

/** The name a row leads with: the tab's name, which the unit tooling sets, else the reported title. */
export function agentName(a: Agent): string {
  return a.tabLabel || a.title || a.kind;
}

/** The second line: the conversation's own title when it says more than the row's name. */
export function agentSubtitle(a: Agent): string {
  const c = a.conversation.trim();
  return c && c !== "Claude Code" && c !== agentName(a) ? c : "";
}
