import type * as v from 'valibot';
import type { AdventurePersistenceSchema } from '@wildshard/format/namedJsonContracts';

/**
 * CI12: an adventure's feat counters (its persistence rows' `counters`), storage-free: a kill or an event advances each
 * matching feat's saved count (up to the feat's count), the count is written back, and the feat's fact is witnessed once
 * per reached count (up to the rows' maximum). The page's adventure persistence (persistence.ts) and a Node simulation
 * call the same law over their own saved counts and fact ledger.
 *
 *   witnessSavedFeats(rows, ports);                        // the counts already saved, at load
 *   featOutcome(rows, ports, 'kill', 'titan', 'storm');    // persistence.kill / persistence.feat
 */
export type FeatCounterRows = NonNullable<v.InferOutput<typeof AdventurePersistenceSchema>['counters']>;
type Feat = FeatCounterRows['feats'][number];
/** The saved counts by feat id (the object read is the one written back) and the fact ledger. */
export interface FeatCounterPorts {
  readonly read: () => Record<string, number>;
  readonly write: (saved: Record<string, number>) => void;
  readonly fact: (fact: string, key: string) => void;
}

/** Witness `feat`'s fact for each reached count 1 … `total` (at most the rows' maximum). */
export function witnessFeat(rows: FeatCounterRows, feat: Feat, total: number, fact: FeatCounterPorts['fact']): void {
  if (feat.fact === null) return;
  for (let n = 1; n <= Math.min(total, rows.maximum); n++) fact(feat.fact, `${rows.prefix}${feat.id}${rows.separator}${String(n)}`);
}
/** Each feat's facts for its count already saved (read once a feat). */
export function witnessSavedFeats(rows: FeatCounterRows, ports: FeatCounterPorts): void {
  for (const feat of rows.feats) witnessFeat(rows, feat, Math.min(feat.count, ports.read()[feat.id] ?? 0), ports.fact);
}
/** A `kind` kill (of `variant`) or a `name` event (to `total`, else one more): every matching feat's count advances, is
 *  written back and witnessed, in the rows' order. */
export function featOutcome(rows: FeatCounterRows, ports: FeatCounterPorts, kind: 'event' | 'kill', name: string, variant?: string, total?: number): void {
  const saved = ports.read();
  for (const feat of rows.feats) {
    if (kind === 'event' ? feat.event !== name : feat.kind !== name || feat.variant !== undefined && feat.variant !== variant) continue;
    const before = saved[feat.id] ?? 0, after = Math.min(feat.count, total === undefined ? before + 1 : Math.max(before, total));
    if (after === before) continue;
    saved[feat.id] = after; ports.write(saved); witnessFeat(rows, feat, after, ports.fact);
  }
}
