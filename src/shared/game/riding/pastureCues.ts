/**
 * A pasture raid's presentation cues, renderer-free (CI12: the Nalati tape reads the same "Wolves are raiding…" rows the page
 * toasts): the raid controller's cue keys (start, taken, drivenOff, crack) mapped through the admitted pasture actor's cue
 * rows into ordered cue values, with the actor a cue names. `PagePastureRaid` and the native population (its
 * `pastureCues` port) both read them; a restore cues nothing.
 *
 *   const cues = new PastureCues(rows.cues);   new NativePastureRaid(…, cues.sink);   cues.next() → { kind: 'start', … }
 */
import type { PastureActorRows } from '@wildshard/format/wildlifePopulation';

/** Cue rows leave the native owner without a shard callback. */
export interface PastureCue { kind: string; text: string; sound: string | null; actor: string | null }

export class PastureCues {
  private readonly pending: PastureCue[] = [];
  constructor(private readonly rows: PastureActorRows['cues']) {}
  /** The raid controller's cue sink: `kind`'s row, for `actor` when one is named. */
  readonly sink = (kind: string, actor?: { readonly entityId: string }): void => {
    const cue = this.rows[kind]; if (cue === undefined) throw new Error('Missing pasture cue row');
    this.pending.push({ kind, text: cue.text, sound: cue.sound, actor: actor?.entityId ?? null });
  };
  /** Read and retire one ordinary presentation cue. */
  next(): PastureCue | undefined { return this.pending.shift(); }
}
