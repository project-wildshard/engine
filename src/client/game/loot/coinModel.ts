import type { BufferGeometry } from 'three';

let build: ((seed: number) => BufferGeometry) | undefined;

/** The composition root installs a reusable content recipe; loot simulation owns no geometry builder. */
export function installCoinModel(factory: (seed: number) => BufferGeometry): void { build = factory; }
/** A gold coin rendered by the installed content recipe. */
export function coinModel(seed: number): BufferGeometry {
  if (build === undefined) throw new Error('No coin geometry recipe installed');
  return build(seed);
}
