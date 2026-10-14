import type { Agent, AgentStatus } from "./api";
import { t } from "./i18n";

export const STATUS_LABEL: Record<AgentStatus, string> = t.status;

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
