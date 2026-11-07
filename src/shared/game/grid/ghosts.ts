import { diagnosticNow } from '@wildshard/engine/core/clock';

/** a retired region still alive this long after its retirement counts as a ghost */
export const GHOST_AFTER_MS = 30_000;
/** One retired owner's key and age, shared by independent region and tile registries. */
export interface GhostRegion { readonly instance: string; readonly ageS: number }

/**
 * M6 (G628, the memory strip's ghost-worlds counter): a retired region's roots (its runtime scope, its view root, its
 * world) should be collected soon after its disposal. A region with a root still alive GHOST_AFTER_MS after it retired
 * is a ghost world: memory a leak after unload keeps (O18: a closed region scope held through three's program cache,
 * keying the scope-keyed registries that hold its visit's world). Tile owners use a separate registry keyed by tile.
 * Nothing here holds a root: the registry watches them.
 */
export class GhostWorlds {
  private next = 0;
  private readonly alive = new Map<number, { readonly instance: string; readonly at: number; left: number }>();
  private readonly registry = new FinalizationRegistry<number>((id) => {
    const row = this.alive.get(id);
    if (row === undefined) return;
    row.left--;
    if (row.left <= 0) this.alive.delete(id);
  });

  /** `instance` retired now; watch `roots` until every one is collected */
  retired(instance: string, roots: readonly object[], now: number = diagnosticNow()): void {
    if (roots.length === 0) return;
    const id = this.next++;
    this.alive.set(id, { instance, at: now, left: roots.length });
    for (const root of roots) this.registry.register(root, id);
  }
  /** the retired regions with a root still alive, oldest first */
  regions(now: number = diagnosticNow()): GhostRegion[] {
    return [...this.alive.values()].map((row) => ({ instance: row.instance, ageS: Math.round((now - row.at) / 100) / 10 }));
  }
  /** the ghosts: retired regions alive GHOST_AFTER_MS or longer after their retirement */
  count(now: number = diagnosticNow()): number {
    let n = 0;
    for (const row of this.alive.values()) if (now - row.at >= GHOST_AFTER_MS) n++;
    return n;
  }
}
