// TE-ENG8: a solo server saves when the player's progress moves, not only on the page's 30 s timer. The page can't make the
// worker save as it goes (a reload ends the worker before a save it asks for comes back), so a lit brazier, a kill or a
// quest step has to be in the page's storage already. Online, the room does the same from its seats' quest books (E7.4).
import type { SimHost } from '@wildshard/engine/sim';
import { shardRows } from '@wildshard/engine/sim/shardRows';

/** How often the watch reads the world's public fields, in server ticks: 33 ms at 60 Hz. */
export const PROGRESS_LOOK_TICKS = 2;
/** How long after a change the save waits. None: it starts once the tick is done, and what else that tick moved goes with it. */
export const PROGRESS_SETTLE_MS = 0;
/** The least time between two saves a flag, a grant or a crossing asked for. */
export const PROGRESS_GAP_MS = 250;
/** The least time between two saves only a public field asked for: a field that flips every beat (a boss's tell) writes once a second at most. */
export const FIELD_GAP_MS = 1000;
/** A save the page's storage refused is tried again after this, doubling to `RETRY_MAX_MS`, until one lands. */
export const RETRY_MS = 1000, RETRY_MAX_MS = 30_000;
/** What moved: nothing, a public field only, or a flag, a grant or the host itself (a crossing). */
export type ProgressMove = 'none' | 'field' | 'progress';

/** What moved since the last look: a flag on the host's book (world and lead player), a public shared field, or a ledger filing. */
export class ProgressWatch {
  private host: SimHost | null = null;
  private off: (() => void) | null = null;
  private flagged = false;
  private fields: string | null = null;
  private filed = -1;
  private ticks = 0;
  /** What moved since the last call. The first look, at boot before any tick, only takes where the world stands; a later host is a crossing. */
  look(host: SimHost, filed: number): ProgressMove {
    let moved: ProgressMove = 'none';
    if (host !== this.host) {
      if (this.host !== null) moved = 'progress';
      this.off?.(); this.host = host; this.flagged = false;
      this.off = host.flags.onChange(() => { this.flagged = true; });
      this.fields = fieldsOf(host); this.ticks = 0;
      if (this.filed === -1) this.filed = filed;
    }
    if (this.flagged) { this.flagged = false; moved = 'progress'; }
    if (filed !== this.filed) { this.filed = filed; moved = 'progress'; }
    if (++this.ticks >= PROGRESS_LOOK_TICKS) {
      this.ticks = 0;
      const fields = fieldsOf(host);
      if (fields !== this.fields) { this.fields = fields; if (moved === 'none') moved = 'field'; }
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
 * When to save after a change: once its tick is done, never closer than a gap to the last change save, and one at a time:
 * a change during a save is saved after it. A save the storage refused stays owed, and is tried again with a growing wait.
 */
export class ProgressSaves {
  private due: number | null = null;
  private last = -Infinity;
  private saving = false;
  private retry = RETRY_MS;
  /** `save` resolves true once the page's storage holds it. */
  constructor(private readonly save: () => Promise<boolean>, private readonly settle: number = PROGRESS_SETTLE_MS, private readonly gap: number = PROGRESS_GAP_MS, private readonly fieldGap: number = FIELD_GAP_MS) {}
  /** Progress moved at `now`; a field alone waits the longer gap. */
  moved(now: number, move: ProgressMove): void {
    if (move === 'none') return;
    const at = Math.max(now + this.settle, this.last + (move === 'field' ? this.fieldGap : this.gap));
    this.due = this.due === null ? at : Math.min(this.due, at);
  }
  /** Start the save that is due by `now`, if any. */
  poll(now: number): void {
    if (this.due === null || this.saving || now < this.due) return;
    this.due = null; this.last = now; this.saving = true;
    void this.run(now);
  }
  private async run(now: number): Promise<void> {
    let durable = false;
    try { durable = await this.save(); } catch { /* owed, as a refusal is */ }
    this.saving = false;
    if (durable) { this.retry = RETRY_MS; return; }
    this.due ??= now + this.retry; this.retry = Math.min(this.retry * 2, RETRY_MAX_MS);
  }
  /** Whether a change waits to be saved, or a save runs. */
  get pending(): boolean { return this.due !== null || this.saving; }
}
