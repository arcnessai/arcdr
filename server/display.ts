import { existsSync, readFileSync, statSync } from "node:fs";
import { cleanSpec, CONVERSATION_PART, DEFAULT_DISPLAY, type DisplaySpec, type LoadedDisplay, type Part } from "./spec";

/** herdr's dracula sidebar colours, mapped to the palette names so a light theme can choose its own shade. */
const HEX_NAMES: [string, string][] = [
  ["#8be9fd", "cyan"],
  ["#bd93f9", "purple"],
  ["#f1fa8c", "yellow"],
  ["#50fa7b", "green"],
  ["#ffb86c", "orange"],
  ["#ff79c6", "pink"],
  ["#ff5555", "red"],
  ["#6272a4", "dim"],
  ["#f8f8f2", "text"],
];

function nearestName(hex: string): string {
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const [r, g, b] = rgb(hex.toLowerCase());
  let best = HEX_NAMES[0]!;
  let bestD = Infinity;
  for (const entry of HEX_NAMES) {
    const [r2, g2, b2] = rgb(entry[0]);
    const d = (r! - r2!) ** 2 + (g! - g2!) ** 2 + (b! - b2!) ** 2;
    if (d < bestD) [best, bestD] = [entry, d];
  }
  return best[1];
}

type HerdrItem = string | { token?: string; fg?: string; bold?: boolean; dim?: boolean; rules?: Record<string, unknown>[] };

function partFromHerdr(item: HerdrItem): Part | null {
  if (typeof item === "string" || !item.token?.startsWith("$")) return null;
  const part: Part = { from: `token:${item.token.slice(1)}` };
  if (item.fg) part.color = nearestName(item.fg);
  if (item.bold) part.bold = true;
  if (item.dim) part.dim = true;
  if (Array.isArray(item.rules))
    part.rules = item.rules.flatMap((r) =>
      typeof r.starts_with === "string"
        ? [
            {
              startsWith: r.starts_with,
              ...(typeof r.fg === "string" && { color: nearestName(r.fg) }),
              ...(r.bold === true && { bold: true }),
              ...(r.dim === true && { dim: true }),
            },
          ]
        : [],
    );
  return part;
}

/**
 * The herdr sidebar's own rows for Claude agents, read from ~/.config/herdr/config.toml: a token before the
 * tab name becomes the badge, tokens on later rows become the line under the name. So without a display.json
 * an agent looks here the way it looks in herdr.
 */
export function fromHerdrConfig(toml: string, kind = "claude"): DisplaySpec | null {
  let conf: Record<string, unknown>;
  try {
    conf = Bun.TOML.parse(toml) as Record<string, unknown>;
  } catch {
    return null;
  }
  const sidebar = ((conf.ui as Record<string, unknown> | undefined)?.sidebar ?? {}) as Record<string, unknown>;
  const byAgent = ((sidebar.agents as Record<string, unknown> | undefined)?.rows_by_agent ?? {}) as Record<string, unknown>;
  const rows = (byAgent[kind] ?? (sidebar.agents as Record<string, unknown> | undefined)?.rows) as HerdrItem[][] | undefined;
  const spaceRows = (sidebar.spaces as Record<string, unknown> | undefined)?.rows as HerdrItem[][] | undefined;
  if (!Array.isArray(rows) && !Array.isArray(spaceRows)) return null;

  const spec: DisplaySpec = { agent: { name: DEFAULT_DISPLAY.agent.name }, space: {}, band: DEFAULT_DISPLAY.band };
  if (Array.isArray(rows)) {
    const first = rows[0] ?? [];
    const nameAt = first.findIndex((i) => i === "tab" || i === "title");
    const before = (nameAt < 0 ? first : first.slice(0, nameAt)).map(partFromHerdr).filter((p): p is Part => p !== null);
    if (before[0]) spec.agent.badge = before[0];
    const line = rows
      .slice(1)
      .flat()
      .map(partFromHerdr)
      .filter((p): p is Part => p !== null);
    spec.agent.line = [...line, CONVERSATION_PART];
  }
  if (Array.isArray(spaceRows))
    spec.space.line = spaceRows
      .slice(1)
      .flat()
      .map(partFromHerdr)
      .filter((p): p is Part => p !== null);
  return spec;
}

/** Reads display.json if there is one, else the herdr sidebar config, else the default; rereads when a file changes. */
export function displayLoader(displayFile: string, herdrConfig: string): () => LoadedDisplay {
  let cache: { key: string; value: LoadedDisplay } | null = null;
  const mtime = (f: string) => (existsSync(f) ? statSync(f).mtimeMs : 0);
  return () => {
    const key = `${mtime(displayFile)}:${mtime(herdrConfig)}`;
    if (cache?.key === key) return cache.value;
    let value: LoadedDisplay;
    if (existsSync(displayFile)) {
      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(displayFile, "utf8"));
        const { spec, errors } = cleanSpec(raw);
        value = { spec, origin: "file", errors };
      } catch (e) {
        value = { spec: DEFAULT_DISPLAY, origin: "default", errors: [`${displayFile}: ${(e as Error).message}`] };
      }
    } else {
      const fromHerdr = existsSync(herdrConfig) ? fromHerdrConfig(readFileSync(herdrConfig, "utf8")) : null;
      value = fromHerdr
        ? { spec: fromHerdr, origin: "herdr", errors: [] }
        : { spec: DEFAULT_DISPLAY, origin: "default", errors: [] };
    }
    cache = { key, value };
    return value;
  };
}
