import type { Rng } from '@wildshard/engine/core/rng';
import type { ReturnProgram } from '../../../shared/game/population/returnProgram';

/** Finite site observations. Coordinates and metadata are immutable authored data. */
export interface ProjectedSite { readonly x: number; readonly z: number; readonly [field: string]: number }
/** Select one site in source order. Admission precedes guest calls and entropy;
 * tied scores keep the first site. The stateless guest owns the scoring law.
 * A refused batch restores the entire borrowed stream, including earlier sites. */
export function projectedSite<T extends ProjectedSite>(sites: readonly T[], program: ReturnProgram, request: {
  readonly signal: string; readonly limit: number; readonly origin: { readonly x: number; readonly z: number };
  readonly minimum: number; readonly maximum: number;
  readonly observations: Readonly<Record<string, number>>;
  readonly away?: { readonly x: number; readonly z: number };
}, random?: Rng): { readonly index: number; readonly site: T } | null {
  const { origin, minimum, maximum, away } = request;
  if (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 16384 || sites.length > request.limit || !Number.isFinite(minimum) || minimum < 0 || !Number.isFinite(maximum) || maximum < minimum
    || !Number.isFinite(origin.x) || !Number.isFinite(origin.z)
    || (away !== undefined && (!Number.isFinite(away.x) || !Number.isFinite(away.z)))
    || Object.values(request.observations).some(value => !Number.isFinite(value))
    || sites.some(site => Object.values(site).some(value => !Number.isFinite(value)))) throw new RangeError('Invalid projected site selection');
  const admitted = sites.flatMap((site, index) => {
    const distance = Math.hypot(site.x - origin.x, site.z - origin.z);
    return distance < minimum || distance > maximum ? [] : [{ index, site, observations: { ...site, distance,
      awayDistance: away === undefined ? 0 : Math.hypot(site.x - away.x, site.z - away.z) } }];
  });
  if (admitted.length === 0) return null;
  const before = random?.snapshot();
  let best: { index: number; site: T; score: number } | null = null;
  try {
    for (let start = 0; start < admitted.length; start += 8) {
      const batch = admitted.slice(start, start + 8);
      const result = program.project(request.signal, { ...request.observations, candidates: batch.length }, random, batch.map(row => row.observations));
      const index = result['index'], score = result['score'];
      if (index === undefined || !Number.isSafeInteger(index) || index < 0 || index >= batch.length || score === undefined || !Number.isFinite(score)) throw new Error('Invalid projected site result');
      const selected = batch[index];
      if (selected === undefined) throw new Error('Missing projected site');
      if (best === null || score > best.score) best = { index: selected.index, site: selected.site, score };
    }
    return best;
  } catch (error) { if (before !== undefined) random?.restore(before); throw error; }
}
