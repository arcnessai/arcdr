/**
 * What arcdr shows besides the conversation, and from which values. Mods (and any program in a herdr pane)
 * report values to herdr — a pane's title and named tokens, a workspace's tokens, a tab's label — and this
 * spec says where each one goes and how it is drawn. See docs/mods.md.
 *
 * The places mirror the ones a Claude Code mod draws into: the herdr sidebar row (agent, space), the band
 * above the prompt (band), the prompt footer (footer); plus notifications (alerts) and slash commands.
 */

/** Where a part's value comes from. */
export type Source = string; // "token:<name>" | "field:<tab|title|conversation|kind|status>" | "text:<literal>" | "tokens:rest"

export type Format = "text" | "chip" | "badge" | "dots" | "meter" | "ago";

export interface Style {
  color?: string;
  bold?: boolean;
  dim?: boolean;
}

/** A condition on the value; the first rule that matches overrides the part's style (or hides it). */
export interface Rule extends Style {
  startsWith?: string;
  endsWith?: string;
  equals?: string;
  contains?: string;
  matches?: string;
  above?: number;
  below?: number;
  hide?: boolean;
  as?: Format;
}

export interface Part extends Style {
  from: Source;
  as?: Format;
  prefix?: string;
  suffix?: string;
  /** Longest value shown, in characters. */
  max?: number;
  rules?: Rule[];
}

export interface Row {
  left?: Part[];
  right?: Part[];
}

export interface Alert extends Omit<Rule, keyof Style | "hide" | "as"> {
  /** The value watched; the alert fires when it starts to match. */
  from: Source;
  /** Notification text; {value} and {name} are filled in. */
  body: string;
}

export interface DisplaySpec {
  agent: {
    /** Short value before the status icon — a number, a code. */
    badge?: Part;
    /** First non-empty source names the agent. */
    name?: Source[];
    /** The line under the name, in the list and the chat header. */
    line?: Part[];
  };
  space: { line?: Part[] };
  /** Rows above the message box, like the band a mod draws above Claude Code's prompt. */
  band?: Row[];
  /** One row under the message box, like the prompt footer. */
  footer?: Row;
  alerts?: Alert[];
  /** Slash commands the "/" list offers on top of the ones found on disk, e.g. ones a mod registers. */
  commands?: { name: string; detail?: string }[];
}

export interface LoadedDisplay {
  spec: DisplaySpec;
  /** Which source it came from: the person's file, their herdr sidebar config, or arcdr's default. */
  origin: "file" | "herdr" | "default";
  errors: string[];
}

/** The conversation's own title, under the name — except Claude Code's placeholder before it names one. */
export const CONVERSATION_PART: Part = {
  from: "field:conversation",
  dim: true,
  max: 80,
  rules: [{ equals: "Claude Code", hide: true }],
};

export const DEFAULT_DISPLAY: DisplaySpec = {
  agent: { name: ["field:tab", "field:title", "field:kind"], line: [CONVERSATION_PART] },
  space: {},
  // Values a mod reports that nothing else shows still appear, as chips above the message box.
  band: [{ left: [{ from: "tokens:rest", as: "chip" }] }],
};

const FORMATS = new Set<Format>(["text", "chip", "badge", "dots", "meter", "ago"]);
const FIELDS = new Set(["tab", "title", "conversation", "kind", "status"]);

function isSource(v: unknown): v is Source {
  if (typeof v !== "string") return false;
  if (v === "tokens:rest") return true;
  const [kind, rest] = [v.slice(0, v.indexOf(":")), v.slice(v.indexOf(":") + 1)];
  if (kind === "token") return /^[\w.-]{1,64}$/.test(rest);
  if (kind === "field") return FIELDS.has(rest);
  if (kind === "text") return rest.length <= 200;
  return false;
}

function cleanStyle(v: Record<string, unknown>, at: string, errors: string[]): Style {
  const s: Style = {};
  if (typeof v.color === "string") s.color = v.color.slice(0, 40);
  else if (v.color !== undefined) errors.push(`${at}.color must be a string`);
  if (typeof v.bold === "boolean") s.bold = v.bold;
  if (typeof v.dim === "boolean") s.dim = v.dim;
  return s;
}

const MATCH_KEYS = ["startsWith", "endsWith", "equals", "contains", "matches"] as const;

function cleanMatch(v: Record<string, unknown>, at: string, errors: string[]) {
  const m: Partial<Record<(typeof MATCH_KEYS)[number], string>> & { above?: number; below?: number } = {};
  for (const k of MATCH_KEYS) {
    if (typeof v[k] === "string") m[k] = (v[k] as string).slice(0, 200);
  }
  if (m.matches !== undefined) {
    try {
      new RegExp(m.matches);
    } catch {
      errors.push(`${at}.matches is not a regular expression`);
      delete m.matches;
    }
  }
  if (typeof v.above === "number") m.above = v.above;
  if (typeof v.below === "number") m.below = v.below;
  return m;
}

function cleanPart(v: unknown, at: string, errors: string[]): Part | null {
  if (!v || typeof v !== "object") return (errors.push(`${at} must be an object`), null);
  const o = v as Record<string, unknown>;
  if (!isSource(o.from)) return (errors.push(`${at}.from must be token:<name>, field:<name>, text:<words> or tokens:rest`), null);
  const p: Part = { from: o.from, ...cleanStyle(o, at, errors) };
  if (typeof o.as === "string") {
    if (FORMATS.has(o.as as Format)) p.as = o.as as Format;
    else errors.push(`${at}.as must be one of ${[...FORMATS].join(", ")}`);
  }
  if (typeof o.prefix === "string") p.prefix = o.prefix.slice(0, 40);
  if (typeof o.suffix === "string") p.suffix = o.suffix.slice(0, 40);
  if (typeof o.max === "number" && o.max > 0) p.max = Math.min(o.max, 500);
  if (Array.isArray(o.rules)) {
    p.rules = o.rules.slice(0, 32).flatMap((r, i) => {
      if (!r || typeof r !== "object") return [];
      const ro = r as Record<string, unknown>;
      const rule: Rule = { ...cleanMatch(ro, `${at}.rules[${i}]`, errors), ...cleanStyle(ro, `${at}.rules[${i}]`, errors) };
      if (ro.hide === true) rule.hide = true;
      if (typeof ro.as === "string" && FORMATS.has(ro.as as Format)) rule.as = ro.as as Format;
      return [rule];
    });
  }
  return p;
}

function cleanParts(v: unknown, at: string, errors: string[]): Part[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) return (errors.push(`${at} must be a list`), undefined);
  return v.slice(0, 16).flatMap((p, i) => cleanPart(p, `${at}[${i}]`, errors) ?? []);
}

function cleanRow(v: unknown, at: string, errors: string[]): Row | undefined {
  if (!v || typeof v !== "object") return (errors.push(`${at} must be an object with left and right`), undefined);
  const o = v as Record<string, unknown>;
  return { left: cleanParts(o.left, `${at}.left`, errors), right: cleanParts(o.right, `${at}.right`, errors) };
}

/** Checks a spec someone wrote; what is wrong is dropped and reported, the rest is kept. */
export function cleanSpec(raw: unknown): { spec: DisplaySpec; errors: string[] } {
  const errors: string[] = [];
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const agent = (o.agent && typeof o.agent === "object" ? o.agent : {}) as Record<string, unknown>;
  const space = (o.space && typeof o.space === "object" ? o.space : {}) as Record<string, unknown>;
  const spec: DisplaySpec = {
    agent: {
      badge: agent.badge === undefined ? undefined : (cleanPart(agent.badge, "agent.badge", errors) ?? undefined),
      name: Array.isArray(agent.name) ? agent.name.filter(isSource) : DEFAULT_DISPLAY.agent.name,
      line: cleanParts(agent.line, "agent.line", errors),
    },
    space: { line: cleanParts(space.line, "space.line", errors) },
  };
  if (o.band !== undefined) {
    if (Array.isArray(o.band)) spec.band = o.band.slice(0, 4).flatMap((r, i) => cleanRow(r, `band[${i}]`, errors) ?? []);
    else errors.push("band must be a list of rows");
  }
  if (o.footer !== undefined) spec.footer = cleanRow(o.footer, "footer", errors);
  if (Array.isArray(o.alerts)) {
    spec.alerts = o.alerts.slice(0, 32).flatMap((a, i) => {
      const ao = (a && typeof a === "object" ? a : {}) as Record<string, unknown>;
      if (!isSource(ao.from) || typeof ao.body !== "string") {
        errors.push(`alerts[${i}] needs from and body`);
        return [];
      }
      return [{ from: ao.from, body: ao.body.slice(0, 200), ...cleanMatch(ao, `alerts[${i}]`, errors) }];
    });
  }
  if (Array.isArray(o.commands)) {
    spec.commands = o.commands.slice(0, 64).flatMap((c) => {
      const co = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
      return typeof co.name === "string" && /^[\w:.-]{1,64}$/.test(co.name)
        ? [{ name: co.name, detail: typeof co.detail === "string" ? co.detail.slice(0, 160) : "" }]
        : [];
    });
  }
  return { spec, errors };
}

/** The value a source names, for an agent; null when it is empty. */
export function valueOf(
  from: Source,
  agent: {
    tokens: Record<string, string>;
    tabLabel?: string;
    title?: string;
    conversation?: string;
    kind?: string;
    status?: string;
  },
): string | null {
  const v = from.startsWith("token:")
    ? agent.tokens[from.slice(6)]
    : from.startsWith("field:")
      ? (
          {
            tab: agent.tabLabel,
            title: agent.title,
            conversation: agent.conversation,
            kind: agent.kind,
            status: agent.status,
          } as Record<string, string | undefined>
        )[from.slice(6)]
      : from.startsWith("text:")
        ? from.slice(5)
        : undefined;
  return v && v.trim() ? v : null;
}

/** Whether a value meets a rule's or an alert's conditions (all that are given). */
export function matches(cond: Omit<Rule, keyof Style | "hide" | "as">, value: string): boolean {
  const num = parseFloat(value);
  if (cond.startsWith !== undefined && !value.startsWith(cond.startsWith)) return false;
  if (cond.endsWith !== undefined && !value.endsWith(cond.endsWith)) return false;
  if (cond.equals !== undefined && value !== cond.equals) return false;
  if (cond.contains !== undefined && !value.includes(cond.contains)) return false;
  if (cond.matches !== undefined && !new RegExp(cond.matches).test(value)) return false;
  if (cond.above !== undefined && !(num > cond.above)) return false;
  if (cond.below !== undefined && !(num < cond.below)) return false;
  return true;
}
