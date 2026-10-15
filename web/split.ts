/**
 * The desktop's panes: which agents are open side by side, and which one has the focus. The focused pane
 * is the one the address names (#/a/<pane>), so the list, the back button and a reload all agree on it.
 */
export interface Split {
  panes: string[];
  focus: string | null;
}

export const MAX_PANES = 4;
export const EMPTY: Split = { panes: [], focus: null };

/** An agent opened the plain way: its pane if it has one, else it takes the focused pane's place. */
export function show(s: Split, pane: string): Split {
  if (s.panes.includes(pane)) return { ...s, focus: pane };
  const at = s.focus === null ? -1 : s.panes.indexOf(s.focus);
  if (at < 0) return { panes: [...s.panes.slice(0, MAX_PANES - 1), pane], focus: pane };
  return { panes: s.panes.map((p, i) => (i === at ? pane : p)), focus: pane };
}

/** An agent opened beside the others: a new pane while there is room, else the focused one's place. */
export function beside(s: Split, pane: string): Split {
  if (s.panes.includes(pane)) return { ...s, focus: pane };
  if (s.panes.length < MAX_PANES) return { panes: [...s.panes, pane], focus: pane };
  return show(s, pane);
}

/** A pane closed; the focus moves to the pane that takes its place, or the one before it. */
export function close(s: Split, pane: string): Split {
  const at = s.panes.indexOf(pane);
  if (at < 0) return s;
  const panes = s.panes.filter((p) => p !== pane);
  const focus = s.focus === pane ? (panes[Math.min(at, panes.length - 1)] ?? null) : s.focus;
  return { panes, focus };
}

/** Panes whose agent is gone (its session closed) are dropped. */
export function prune(s: Split, alive: Set<string>): Split {
  return s.panes.reduce((acc, p) => (alive.has(p) ? acc : close(acc, p)), s);
}

/** How the panes sit: one alone, two side by side, three with the first down the whole left, four in a 2×2 grid. */
export function layoutOf(n: number): "one" | "two" | "three" | "four" {
  return n <= 1 ? "one" : n === 2 ? "two" : n === 3 ? "three" : "four";
}

/** A split read back from storage, or nothing usable. */
export function parseSplit(raw: string | null): Split {
  try {
    const v = JSON.parse(raw ?? "");
    const panes = Array.isArray(v?.panes) ? v.panes.filter((p: unknown) => typeof p === "string").slice(0, MAX_PANES) : [];
    const focus = typeof v?.focus === "string" && panes.includes(v.focus) ? v.focus : (panes[0] ?? null);
    return { panes, focus };
  } catch {
    return EMPTY;
  }
}
