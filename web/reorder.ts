import { useEffect, useRef, useState } from "preact/hooks";

/** The list with `pane` taken out and put back before `before` (null: at the end). */
export function applyMove<T extends { pane: string }>(list: T[], pane: string, before: string | null): T[] {
  const moving = list.find((x) => x.pane === pane);
  if (!moving || pane === before) return list;
  const rest = list.filter((x) => x.pane !== pane);
  const at = before === null ? rest.length : rest.findIndex((x) => x.pane === before);
  return at < 0 ? list : [...rest.slice(0, at), moving, ...rest.slice(at)];
}

/** Whether moving `pane` before `before` leaves the order as it was. */
export function isSamePlace(order: string[], pane: string, before: string | null): boolean {
  const at = order.indexOf(pane);
  return (order[at + 1] ?? null) === before;
}

export interface Drag {
  pane: string;
  /** How far the row has been pulled from where it was, in pixels. */
  dy: number;
  /** Where it would land: before this pane, or null for the end. */
  before: string | null;
}

const LONG_PRESS_MS = 380;
const SLOP = 8;

/**
 * Drag rows (elements with data-pane) of the list to reorder them. A mouse drags at once; a finger first
 * holds still for a moment, so a swipe still scrolls and a tap still opens the agent.
 */
export function useReorder(order: string[], onMove: (pane: string, before: string | null) => void, enabled: boolean) {
  const list = useRef<HTMLElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const live = useRef<Drag | null>(null);
  const orderRef = useRef(order);
  orderRef.current = order;
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  useEffect(() => {
    const root = list.current;
    if (!root) return;
    let start: { pane: string; x: number; y: number; id: number; touch: boolean } | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let swallowClick = false;
    let frame = 0;
    let lastY = 0;

    const rows = () => [...root.querySelectorAll<HTMLElement>("[data-pane]")];
    const scroller = () =>
      root.closest<HTMLElement>(".sidebar, .scroll") ?? (document.scrollingElement as HTMLElement | null) ?? document.body;

    const target = (y: number, pane: string): string | null => {
      for (const el of rows()) {
        if (el.dataset.pane === pane) continue;
        const r = el.getBoundingClientRect();
        if (y < r.top + r.height / 2) return el.dataset.pane!;
      }
      return null;
    };
    const update = (y: number) => {
      if (!start || !live.current) return;
      lastY = y;
      const next = { pane: start.pane, dy: y - start.y, before: target(y, start.pane) };
      live.current = next;
      setDrag(next);
    };
    // Near the top or bottom edge, the list scrolls by itself while a row is held there.
    const autoscroll = () => {
      if (!live.current) return;
      const sc = scroller();
      const box = sc.getBoundingClientRect();
      const edge = 48;
      const speed = lastY < box.top + edge ? -10 : lastY > box.bottom - edge ? 10 : 0;
      if (speed !== 0) {
        // Only what really scrolled moves the row's origin: at the top or the end there is nothing to scroll.
        const was = sc.scrollTop;
        sc.scrollBy(0, speed);
        const moved = sc.scrollTop - was;
        if (moved !== 0 && start) {
          start.y -= moved;
          update(lastY);
        }
      }
      frame = requestAnimationFrame(autoscroll);
    };
    const begin = () => {
      if (!start) return;
      navigator.vibrate?.(15);
      live.current = { pane: start.pane, dy: 0, before: target(start.y, start.pane) };
      setDrag(live.current);
      frame = requestAnimationFrame(autoscroll);
    };
    const end = (commit: boolean) => {
      if (timer) clearTimeout(timer);
      timer = null;
      cancelAnimationFrame(frame);
      const done = live.current;
      live.current = null;
      start = null;
      setDrag(null);
      if (!done) return;
      swallowClick = true;
      setTimeout(() => (swallowClick = false), 400);
      if (commit && !isSamePlace(orderRef.current, done.pane, done.before)) onMoveRef.current(done.pane, done.before);
    };

    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const row = (e.target as HTMLElement).closest<HTMLElement>("[data-pane]");
      // The buttons inside a row (open beside) stay buttons.
      if (!row || (e.target as HTMLElement).closest("button")) return;
      start = { pane: row.dataset.pane!, x: e.clientX, y: e.clientY, id: e.pointerId, touch: e.pointerType !== "mouse" };
      lastY = e.clientY;
      if (start.touch) timer = setTimeout(begin, LONG_PRESS_MS);
    };
    const move = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      if (live.current) return update(e.clientY);
      const far = Math.hypot(e.clientX - start.x, e.clientY - start.y) > SLOP;
      if (!far) return;
      if (start.touch)
        end(false); // moved before the hold: a scroll, not a drag
      else begin();
    };
    const up = (e: PointerEvent) => {
      if (start && e.pointerId === start.id) end(true);
    };
    const cancel = () => end(false);
    // Once a finger is dragging, the page must not scroll under it.
    const touchmove = (e: TouchEvent) => {
      if (live.current) e.preventDefault();
    };
    // A long press would open the link menu; a drag that ends on a row would open the agent.
    const contextmenu = (e: Event) => {
      if (start?.touch || live.current) e.preventDefault();
    };
    const click = (e: Event) => {
      if (!swallowClick) return;
      e.preventDefault();
      e.stopPropagation();
    };
    // A row is a link, and a browser drags links on its own: that would cut the drag short.
    const dragstart = (e: Event) => e.preventDefault();
    const key = (e: KeyboardEvent) => {
      if (live.current && e.key === "Escape") end(false);
    };

    root.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    root.addEventListener("touchmove", touchmove, { passive: false });
    root.addEventListener("contextmenu", contextmenu);
    root.addEventListener("click", click, true);
    root.addEventListener("dragstart", dragstart);
    window.addEventListener("keydown", key);
    return () => {
      end(false);
      root.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      root.removeEventListener("touchmove", touchmove);
      root.removeEventListener("contextmenu", contextmenu);
      root.removeEventListener("click", click, true);
      root.removeEventListener("dragstart", dragstart);
      window.removeEventListener("keydown", key);
    };
    // Again when the list appears: an empty space draws no list to listen on.
  }, [enabled]);

  return { list, drag };
}
