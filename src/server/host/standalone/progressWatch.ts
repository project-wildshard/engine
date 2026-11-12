// TE-ENG8: a solo server saves when the player's progress moves, not only on the page's 30 s timer. The page can't make the
// worker save as it goes (a reload ends the worker before a save it asks for comes back), so a lit brazier, a kill or a
// quest step has to be in the page's storage already. Online, the room does the same from its seats' quest books (E7.4).
import type { SimHost } from '@wildshard/engine/sim';
import { shardRows } from '@wildshard/engine/sim/shardRows';

/** How often the watch reads the world's public fields, in server ticks: 33 ms at 60 Hz. */
export const PROGRESS_LOOK_TICKS = 2;
/** How long after a change the save waits. None: it starts once the tick is done, and what else that tick moved goes with it. */
export const PROGRESS_SETTLE_MS = 0;
/** The least time between two saves a change asked for: a field that flips every beat (a boss's tell) writes this often at most. */
export const PROGRESS_GAP_MS = 250;

/** What moved since the last look: a flag on the host's book (world and lead player), a public shared field, or a ledger filing. */
export class ProgressWatch {
  private host: SimHost | null = null;
  private off: (() => void) | null = null;
  private flagged = false;
  private fields: string | null = null;
  private filed = -1;
  private ticks = 0;
  /** True when progress moved since the last call. The first look at a host only takes where it stands. */
  look(host: SimHost, filed: number): boolean {
    let moved = false;
    if (host !== this.host) {
      this.off?.(); this.host = host; this.flagged = false; this.fields = null;
      this.off = host.flags.onChange(() => { this.flagged = true; });
      // A crossing is progress too, but the crossing's own save covers it; this host's fields start from here.
      this.fields = fieldsOf(host); this.ticks = 0;
      if (this.filed === -1) this.filed = filed;
    }
    if (this.flagged) { this.flagged = false; moved = true; }
    if (filed !== this.filed) { this.filed = filed; moved = true; }
    if (++this.ticks >= PROGRESS_LOOK_TICKS) {
      this.ticks = 0;
      const fields = fieldsOf(host);
      if (fields !== this.fields) { this.fields = fields; moved = true; }
    }
    return moved;
  }
  dispose(): void { this.off?.(); this.off = null; this.host = null; }
}

function fieldsOf(host: SimHost): string {
  const rows = shardRows(host).state?.();
  if (rows === undefined || rows.length === 0) return '';
  let out = '';
  for (const row of rows) out += `${row.name}=${String(row.value)};`;
  return out;
}

/**
 * When to save after a change: once it has settled, and never closer than `gap` to the last change save. One at a time:
 * a change during a save is saved after it.
 */
export class ProgressSaves {
  private due: number | null = null;
  private last = -Infinity;
  private saving = false;
  constructor(private readonly save: () => Promise<unknown>, private readonly settle: number = PROGRESS_SETTLE_MS, private readonly gap: number = PROGRESS_GAP_MS) {}
  /** Progress moved at `now`. */
  moved(now: number): void { this.due ??= Math.max(now + this.settle, this.last + this.gap); }
  /** Start the save that is due by `now`, if any. */
  poll(now: number): void {
    if (this.due === null || this.saving || now < this.due) return;
    this.due = null; this.last = now; this.saving = true;
    void this.save().catch(() => undefined).finally(() => { this.saving = false; });
  }
  /** Whether a change waits to be saved, or a save runs. */
  get pending(): boolean { return this.due !== null || this.saving; }
}
