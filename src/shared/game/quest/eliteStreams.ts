import { fnv1a32, Rng } from '@wildshard/engine/core/rng';
import type { EliteFeatureRows } from '@wildshard/format/eliteFeature';

/** One independently named content stream, derived only from the declared seed/prefix/id tuple. */
export function eliteStream(rows: EliteFeatureRows, seed: number, stream: keyof EliteFeatureRows['streams'], id: string): Rng {
  return new Rng(fnv1a32(`${seed}:${rows.streams[stream]}${id}`));
}
