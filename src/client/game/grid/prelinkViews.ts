import type { Object3D } from 'three';
import type { Scope } from '@wildshard/engine/app/scope';

type PrepareView = (root: Object3D, current: () => boolean) => Promise<void>;
type PrepareViews = (roots: readonly Object3D[], current: () => boolean) => Promise<void>;

/** Stable page-owned neighbour/road roots share one complete preparation inventory.
 * The native renderer deduplicates identical material/object variants across roots.
 * Single-view hosts retain independent work and failure reporting. This is only the
 * lighting refresh; individual hidden-view admission keeps its own readiness gate. */
export function prelinkGridViews(owner: Scope, roots: readonly Object3D[], prepare: PrepareView | undefined,
  prepareMany?: PrepareViews): void {
  if (owner.disposed || owner.disposing || roots.length === 0) return;
  const live = (): boolean => !owner.disposed && !owner.disposing;
  const report = (error: unknown): void => { console.warn('[grid] neighbour view prelink stopped', error); };
  if (prepareMany !== undefined) {
    const warm = async (): Promise<void> => {
      try { await prepareMany(roots, () => live() && roots.every(root => root.parent !== null)); }
      catch (error) { report(error); }
    };
    void warm();
  } else if (prepare !== undefined) {
    for (const root of roots) {
      const warm = async (): Promise<void> => {
        try { await prepare(root, () => live() && root.parent !== null); }
        catch (error) { report(error); }
      };
      void warm();
    }
  }
}
