import { PMREMGenerator, type WebGLRenderer } from 'three';
import { TIER_CONFIG } from '../core/tier';

/**
 * One PMREM cube size a tier (`TIER_CONFIG.pmremCube`; 0 keeps each source's own). three keys a program by its
 * environment's cube-UV height (the envmap define), so two shards' environments of two sizes compiled every lit material
 * on the road once per size: 17 of the programs of a phone-4x Nine road drive, 256 and 512 (Driftwood's 64 cube beside
 * the HDR backdrops' 128).
 */
export function tierPmremCube(own: number): number {
  const cube = TIER_CONFIG.pmremCube;
  return cube > 0 ? cube : own;
}

/** A PMREMGenerator whose every build (from a scene, an equirect or a cube texture) is at the tier's cube size. */
export function tierPmremGenerator(renderer: WebGLRenderer): PMREMGenerator {
  const gen = new PMREMGenerator(renderer), size: unknown = Reflect.get(gen, '_setSize');
  // three sizes the cube in `_setSize` (the scene's `size`, a quarter of an equirect's width, a cube face's width)
  if (TIER_CONFIG.pmremCube > 0 && typeof size === 'function') Reflect.set(gen, '_setSize', (own: number): void => { Reflect.apply(size, gen, [tierPmremCube(own)]); });
  return gen;
}
