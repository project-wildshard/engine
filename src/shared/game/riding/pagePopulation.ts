import type { HerdBrain } from '@wildshard/engine/ai/herd';
import type { Scope } from '@wildshard/engine/app/scope';
import type { Animal } from '@wildshard/engine/entities/AnimalView';

/**
 * What a riding page reads of the wildlife around it. The page's own view lends it, over rows:
 * and the flip feeds it from rows: a view never holds the population, its groups or the wild environment.
 */
export interface PageRidingPopulation {
  readonly herds: readonly HerdBrain<Animal>[];
  readonly mountables: readonly Animal[];
  readonly predators: readonly Animal[];
  readonly wind: { x: number; z: number; strength: number };
  readonly wetAt: (x: number, z: number) => boolean;
  /** Tell the wild that this page's player sits a horse. */
  readonly rider: (mounted: boolean) => void;
}

const lent = new WeakMap<Scope, () => PageRidingPopulation | null>();
/** A scope's population, once its animal stage has built one. */
export function lendRidingPopulation(scope: Scope, read: () => PageRidingPopulation | null): void { lent.set(scope, read); }
/** The population this scope lends, null until it is built. */
export function ridingPopulation(scope: Scope): PageRidingPopulation | null {
  if (scope.disposed) throw new Error('Wildlife owner is disposed');
  const read = lent.get(scope);
  if (read === undefined) throw new Error('Wildlife feature is not installed');
  return read();
}
