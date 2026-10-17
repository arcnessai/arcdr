import { createContext, type ComponentChildren } from "preact";
import { useContext } from "preact/hooks";
import type { Agent } from "./api";
import { lang } from "./i18n";
import {
  DEFAULT_DISPLAY,
  matches,
  NOTIFY_TOKEN,
  valueOf,
  type DisplaySpec,
  type LoadedDisplay,
  type Format,
  type Part,
  type Row,
  type Style,
} from "../server/spec";

/** Draws the parts a display spec names — see docs/mods.md for the spec and what each format does. */

export const DisplayContext = createContext<DisplaySpec>(DEFAULT_DISPLAY);
/** Where the spec came from and what was wrong with it, for the settings screen. */
export const DisplayInfo = createContext<LoadedDisplay | null>(null);
export const useDisplay = () => useContext(DisplayContext);
/** Hands a newly saved spec to every screen at once, so the display editor's change shows without a reload. */
export const DisplaySet = createContext<(d: LoadedDisplay) => void>(() => {});

/** Colour names a mod author already knows from Claude Code's Ink theme, mapped to arcdr's palette. */
const ALIASES: Record<string, string> = {
  claude: "orange",
  suggestion: "purple",
  success: "green",
  warning: "yellow",
  error: "red",
  subtle: "dim",
  permission: "cyan",
  inverseText: "text",
};
const PALETTE = new Set(["cyan", "purple", "yellow", "green", "orange", "pink", "red", "text", "muted", "dim"]);

function styleProps(s: Style): { class: string; style?: { color: string } } {
  const classes: string[] = [];
  let style: { color: string } | undefined;
  if (s.color) {
    const name = ALIASES[s.color] ?? s.color;
    if (PALETTE.has(name)) classes.push(`tone-${name}`);
    else if (/^#[0-9a-f]{3,8}$/i.test(name)) style = { color: name };
  }
  if (s.bold) classes.push("part-bold");
  if (s.dim) classes.push("part-dim");
  return { class: classes.join(" "), style };
}

type Subject = Pick<Agent, "tokens"> & Partial<Pick<Agent, "tabLabel" | "title" | "conversation" | "kind" | "status">>;

/** Every token: name the spec mentions, so "tokens:rest" can show only the others. */
function namedTokens(spec: DisplaySpec): Set<string> {
  // The notify token is a message for the phone, not a value to show.
  const names = new Set<string>([NOTIFY_TOKEN]);
  const add = (p?: Part) => p?.from.startsWith("token:") && names.add(p.from.slice(6));
  const rows: Row[] = [...(spec.band ?? []), ...(spec.footer ? [spec.footer] : [])];
  add(spec.agent.badge);
  spec.agent.line?.forEach(add);
  spec.space.line?.forEach(add);
  for (const r of rows) [...(r.left ?? []), ...(r.right ?? [])].forEach(add);
  for (const n of spec.agent.name ?? []) if (n.startsWith("token:")) names.add(n.slice(6));
  return names;
}

function clip(value: string, max?: number) {
  return max && value.length > max ? value.slice(0, max - 1) + "…" : value;
}

function ago(value: string): string {
  const ms = /^\d+$/.test(value) ? Number(value) : Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  const sec = Math.round((ms - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  const abs = Math.abs(sec);
  if (abs < 60) return rtf.format(sec, "second");
  if (abs < 3600) return rtf.format(Math.round(sec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(sec / 3600), "hour");
  return rtf.format(Math.round(sec / 86400), "day");
}

function Formatted({ as, value, part }: { as: Format; value: string; part: Part }): ComponentChildren {
  const text = `${part.prefix ?? ""}${clip(value, part.max)}${part.suffix ?? ""}`;
  switch (as) {
    case "chip":
      return <span class="part-chip">{text}</span>;
    case "badge":
      return <span class="part-badge">{text}</span>;
    case "dots": {
      const m = /^(\d+)\s*\/\s*(\d+)$/.exec(value.trim());
      if (!m) return text;
      const total = Math.min(Number(m[2]), 12);
      const done = Math.min(Number(m[1]), total);
      return (
        <span class="part-dots">
          <span aria-hidden="true">{"●".repeat(done) + "○".repeat(total - done)}</span> {m[1]}/{m[2]}
        </span>
      );
    }
    case "meter": {
      const n = parseFloat(value);
      if (!Number.isFinite(n)) return text;
      const pct = Math.max(0, Math.min(100, n));
      return (
        <span class="part-meter" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          {part.prefix && <span class="part-dim">{part.prefix}</span>}
          <span class="meter-track">
            <span class="meter-fill" style={{ width: `${pct}%` }} />
          </span>
          {Math.round(pct)}%
        </span>
      );
    }
    case "ago":
      return `${part.prefix ?? ""}${ago(value)}${part.suffix ?? ""}`;
    default:
      return text;
  }
}

/** One part, or nothing when its value is empty or a rule hides it. */
export function PartView({ part, of }: { part: Part; of: Subject }) {
  const spec = useDisplay();
  if (part.from === "tokens:rest") {
    const named = namedTokens(spec);
    const rest = Object.entries(of.tokens).filter(([k, v]) => !named.has(k) && v.trim());
    if (rest.length === 0) return null;
    return (
      <>
        {rest.map(([k, v]) => (
          <span key={k} class={`part-chip ${styleProps(part).class}`} style={styleProps(part).style}>
            <span class="part-dim">{k}</span> {clip(v, part.max ?? 60)}
          </span>
        ))}
      </>
    );
  }
  const value = valueOf(part.from, of);
  if (value === null) return null;
  const rule = part.rules?.find((r) => matches(r, value));
  if (rule?.hide) return null;
  const style: Style = { color: rule?.color ?? part.color, bold: rule?.bold ?? part.bold, dim: rule?.dim ?? part.dim };
  const sp = styleProps(style);
  return (
    <span class={`part ${sp.class}`} style={sp.style}>
      <Formatted as={rule?.as ?? part.as ?? "text"} value={value} part={part} />
    </span>
  );
}

export function Parts({ parts, of, class: cls }: { parts?: Part[]; of: Subject; class?: string }) {
  if (!parts?.length) return null;
  return (
    <span class={`parts ${cls ?? ""}`}>
      {parts.map((p, i) => (
        <PartView key={i} part={p} of={of} />
      ))}
    </span>
  );
}

/** A row with a left and a right side, like a mod's band or footer line. */
export function PartRow({ row, of, band }: { row: Row; of: Subject; band?: boolean }) {
  return (
    <div class={`part-row${band ? " is-band" : ""}`}>
      <Parts parts={row.left} of={of} class="part-left" />
      <Parts parts={row.right} of={of} class="part-right" />
    </div>
  );
}

/** The agent's name: the first of the spec's name sources with a value. */
export function nameOf(spec: DisplaySpec, agent: Agent): string {
  for (const s of spec.agent.name ?? DEFAULT_DISPLAY.agent.name!) {
    const v = valueOf(s, agent);
    if (v) return v;
  }
  return agent.kind;
}
