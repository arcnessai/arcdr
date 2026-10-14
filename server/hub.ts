import { snapshot, type Snapshot } from "./herdr";

type Listener = (event: "snapshot" | "down", data: string) => void;

/**
 * Polls herdr's session snapshot while anyone is listening and pushes it when it changes.
 * herdr has an event subscription too, but a one-second poll of one socket call is simpler
 * and catches token and title changes the same way.
 */
export class SnapshotHub {
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastJson: string | null = null;
  private last: { at: number; snap: Snapshot } | null = null;
  private downReason: string | null = null;

  constructor(
    private socketPath: string,
    private intervalMs = 1000,
  ) {}

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    if (this.lastJson) fn("snapshot", this.lastJson);
    if (!this.timer) {
      this.timer = setInterval(() => void this.tick(), this.intervalMs);
      void this.tick();
    }
    return () => {
      this.listeners.delete(fn);
      if (this.listeners.size === 0 && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    };
  }

  /** A snapshot no older than maxAgeMs, fetched if the cached one is stale. */
  async current(maxAgeMs = 800): Promise<Snapshot> {
    if (this.last && Date.now() - this.last.at <= maxAgeMs) return this.last.snap;
    const snap = await snapshot(this.socketPath);
    this.last = { at: Date.now(), snap };
    return snap;
  }

  private async tick(): Promise<void> {
    try {
      const snap = await this.current(this.intervalMs / 2);
      this.downReason = null;
      const json = JSON.stringify(snap);
      if (json === this.lastJson) return;
      this.lastJson = json;
      for (const fn of this.listeners) fn("snapshot", json);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      if (reason === this.downReason) return;
      this.downReason = reason;
      this.lastJson = null;
      for (const fn of this.listeners) fn("down", JSON.stringify({ reason }));
    }
  }
}
