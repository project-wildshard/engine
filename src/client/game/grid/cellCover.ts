/**
 * The coarse cover of a grid cell hands over to the region's own drawing while the region is entered (SHARD-PLATFORM
 * G223, E435).
 *
 * Every neighbour cell has a coarse root in the page scene (the session's `grid-cell:<instance>` group): its far proxy
 * and the shardfile's L1 / L0 ring tiles, its neighbour life and copy marks. That is what a cell shows from outside. An
 * admitted trusted runtime (a regional view) draws the cell's own native terrain, forest, buildings and creatures under a
 * separate root, visible only while the runtime is entered. Both at once is wrong: the far proxy is a decimated shell of
 * the same ground, and from inside it encloses the camera (Pine's canyon read as a smooth tan groove over its real
 * forest). So while any entry of a regional view lives, the cell's coarse root is hidden, and it comes back when the last
 * entry leaves (the parked runtime is hidden again at the same moment).
 *
 * The session binds its port to the page's root scene (`bindCellCover`) and a regional view looks it up from the scene it
 * draws into (`cellCoverOf`), as the one frame's look port does (`frameLook.ts`), so neither module names the other.
 * Generic game code (E405): no shard is named here.
 */

/** Cover the coarse root after replacement is ready, until the idempotent release. `ownGround`: the entered world draws
 *  its whole cell's ground itself (manifest `cellGround: 'world'`), so the root hides at once (G784 / D189). */
export interface CellCoverPort { readonly cover: (instance: string, ownGround?: boolean) => () => void }

const ports = new WeakMap<object, CellCoverPort>();
/** Bind the session's port to the scene it draws (the page's root scene); returns the unbind. One port per scene. */
export function bindCellCover(scene: object, port: CellCoverPort): () => void {
  if (ports.has(scene)) throw new Error('This scene already has a grid cell cover');
  ports.set(scene, port);
  return () => { if (ports.get(scene) === port) ports.delete(scene); };
}
/** The cover port bound to a scene (null: no grid session, e.g. a test page or Select a shard). */
export function cellCoverOf(scene: object): CellCoverPort | null { return ports.get(scene) ?? null; }

/**
 * The session's port over its coarse roots: active covers hide only after `ready` confirms complete replacement.
 * Until then the streamer masks the retained far view by its uploaded child quadrants.
 * An instance without a root (or one whose root has left) covers nothing.
 */
export function cellCoverPort(root: (instance: string) => { visible: boolean } | undefined,
  ready: (instance: string) => boolean = () => true): CellCoverPort & { readonly covered: (instance: string) => boolean; readonly refresh: () => void } {
  const counts = new Map<string, number>(), own = new Set<string>();
  const hidden = (instance: string): boolean => own.has(instance) || ready(instance);
  return {
    covered: (instance) => (counts.get(instance) ?? 0) > 0,
    refresh: () => { for (const instance of counts.keys()) { const target = root(instance); if (target !== undefined) target.visible = !hidden(instance); } },
    cover: (instance, ownGround = false) => {
      counts.set(instance, (counts.get(instance) ?? 0) + 1);
      if (ownGround) own.add(instance);
      const target = root(instance); if (target !== undefined) target.visible = !hidden(instance);
      let released = false;
      return () => {
        if (released) return; released = true;
        const left = (counts.get(instance) ?? 1) - 1;
        if (left > 0) { counts.set(instance, left); return; }
        counts.delete(instance); own.delete(instance);
        const shown = root(instance); if (shown !== undefined) shown.visible = true;
      };
    },
  };
}
