import type { Texture } from 'three';

/**
 * The page environments the road may draw with (G639 frame floor). A backdrop layer swaps a cell's PMREM into the page
 * scene by its weight (`BackdropLayer.apply`), so the road beside a cell draws with that cell's environment, while a warm-up
 * between frames may see another or none. A program is keyed by the environment's mapping and cube height only (three's
 * `envMapCubeUVHeight`), not its texture, so one texture per height stands for all of them: a view root's warm-up
 * (`precompile.ts`, exterior jobs) also keys each recorded height (Driftwood 256, Nalati 512, Pine 1024 on desktop), and
 * a new height tells its listeners (the grid's ring prelink) to warm what the road already shows. Held weakly; a leaf.
 */
const byHeight = new Map<number, WeakRef<Texture>>();
const listeners = new Set<() => void>();

const heightOf = (texture: Texture): number => {
  const image: unknown = texture.image, height: unknown = typeof image === 'object' && image !== null ? Reflect.get(image, 'height') : undefined;
  return typeof height === 'number' && Number.isFinite(height) ? height : 0;
};
/** Record an environment the page draws with, or is about to (a layer's PMREM as it fades in). */
export function noteEnvironment(environment: Texture | null): void {
  if (environment === null) return;
  const height = heightOf(environment), known = byHeight.get(height)?.deref();
  if (known === environment) return;
  byHeight.set(height, new WeakRef(environment));
  if (known === undefined) for (const listener of listeners) listener();
}
/** Record the environment the frame just drawn lit with (null: none). */
export function noteDrawnEnvironment(environment: Texture | null): void { noteEnvironment(environment); }
/** One live environment per recorded cube height. */
export function pageEnvironments(): Texture[] {
  const out: Texture[] = [];
  for (const [height, ref] of byHeight) { const texture = ref.deref(); if (texture === undefined) byHeight.delete(height); else out.push(texture); }
  return out;
}
/** Hear when an environment of a height not seen before is recorded; returns the unsubscribe. */
export function onPageEnvironment(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }
