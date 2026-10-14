import { NOTIFY_TOKEN, type DisplaySpec, type Part, type Row } from "../server/spec";

/** Where one value is shown: the places of the display spec a person can pick in the editor. */
export type Place =
  | { at: "none" }
  | { at: "badge" }
  | { at: "line" }
  | { at: "band"; row: number; side: "left" | "right" }
  | { at: "footer"; side: "left" | "right" };

const source = (name: string) => `token:${name}`;

/** Where a token is shown first, and the part that shows it; a token shown nowhere is { at: "none" }. */
export function findToken(spec: DisplaySpec, name: string): { place: Place; part: Part | null } {
  const from = source(name);
  if (spec.agent.badge?.from === from) return { place: { at: "badge" }, part: spec.agent.badge };
  const inLine = spec.agent.line?.find((p) => p.from === from);
  if (inLine) return { place: { at: "line" }, part: inLine };
  for (const [row, r] of (spec.band ?? []).entries()) {
    for (const side of ["left", "right"] as const) {
      const p = r[side]?.find((p) => p.from === from);
      if (p) return { place: { at: "band", row, side }, part: p };
    }
  }
  for (const side of ["left", "right"] as const) {
    const p = spec.footer?.[side]?.find((p) => p.from === from);
    if (p) return { place: { at: "footer", side }, part: p };
  }
  return { place: { at: "none" }, part: null };
}

const without = (parts: Part[] | undefined, from: string) => parts?.filter((p) => p.from !== from);
const isEmpty = (r: Row) => !r.left?.length && !r.right?.length;

/** The spec with the token shown nowhere: every part that shows it is taken out, and band rows left empty go. */
export function removeToken(spec: DisplaySpec, name: string): DisplaySpec {
  const from = source(name);
  const strip = (r: Row): Row => ({ left: without(r.left, from), right: without(r.right, from) });
  return {
    ...spec,
    agent: {
      ...spec.agent,
      badge: spec.agent.badge?.from === from ? undefined : spec.agent.badge,
      line: without(spec.agent.line, from),
    },
    band: spec.band?.map(strip).filter((r) => !isEmpty(r)),
    footer: spec.footer && strip(spec.footer),
  };
}

/** The spec with the token shown at one place only, drawn as `part`. A row past the last one is a new row. */
export function placeToken(spec: DisplaySpec, name: string, place: Place, part: Part): DisplaySpec {
  const next = removeToken(spec, name);
  const p: Part = { ...part, from: source(name) };
  if (place.at === "none") return next;
  if (place.at === "badge") return { ...next, agent: { ...next.agent, badge: p } };
  if (place.at === "line") {
    // The conversation's title stays last: it is the longest and the one to cut short.
    const line = [...(next.agent.line ?? [])];
    const at = line.findIndex((x) => x.from === "field:conversation");
    line.splice(at < 0 ? line.length : at, 0, p);
    return { ...next, agent: { ...next.agent, line } };
  }
  if (place.at === "footer") {
    const footer = { ...next.footer };
    footer[place.side] = [...(footer[place.side] ?? []), p];
    return { ...next, footer };
  }
  const band = [...(next.band ?? [])];
  // Removing the token may have emptied rows above the one asked for; a row number past the end is a new row.
  const row = Math.min(place.row, band.length);
  const r = { ...(band[row] ?? {}) };
  r[place.side] = [...(r[place.side] ?? []), p];
  band[row] = r;
  return { ...next, band };
}

export interface Reported {
  name: string;
  /** A value it has now, for the preview; "" when no agent reports it at the moment. */
  sample: string;
  /** How many agents report it now. */
  agents: number;
}

/**
 * Every value worth placing: what the agents report now, then what the spec places that nobody reports at
 * the moment. The notify token is a message, not a value, and is left out.
 */
export function reported(agents: { tokens: Record<string, string> }[], spec: DisplaySpec): Reported[] {
  const seen = new Map<string, Reported>();
  for (const a of agents) {
    for (const [name, value] of Object.entries(a.tokens)) {
      if (name === NOTIFY_TOKEN || !value.trim()) continue;
      const r = seen.get(name) ?? { name, sample: value, agents: 0 };
      r.agents++;
      seen.set(name, r);
    }
  }
  const placed = [
    spec.agent.badge,
    ...(spec.agent.line ?? []),
    ...(spec.band ?? []).flatMap((r) => [...(r.left ?? []), ...(r.right ?? [])]),
    ...(spec.footer ? [...(spec.footer.left ?? []), ...(spec.footer.right ?? [])] : []),
  ]
    .flatMap((p) => (p?.from.startsWith("token:") ? [p.from.slice(6)] : []))
    .filter((name) => !seen.has(name));
  const now = [...seen.values()].sort((a, b) => b.agents - a.agents || a.name.localeCompare(b.name));
  return [...now, ...[...new Set(placed)].map((name) => ({ name, sample: "", agents: 0 }))];
}

/** A format that suits the value: a count as dots, a percentage as a meter, a time as "ago". */
export function guessFormat(sample: string): Part["as"] {
  const v = sample.trim();
  if (/^\d+\s*\/\s*\d+$/.test(v)) return "dots";
  if (/^\d{12,14}$/.test(v) || /^\d{4}-\d\d-\d\dT/.test(v)) return "ago";
  if (/^\d{1,3}(\.\d+)?$/.test(v) && Number(v) <= 100) return "meter";
  return v.length <= 16 ? "chip" : "text";
}
