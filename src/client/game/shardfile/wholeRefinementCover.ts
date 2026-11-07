import { Group } from 'three';
import type { Scope } from '@wildshard/engine/app/scope';
import { harnessPins } from '@wildshard/engine/app/identity';
import type { ShardContext } from '../plugin/context';
import { clientTileViews } from './clientViews';
import { prepareClientTile, ring, type ResidentTile, type TileContent } from './tileContent';
import { tileOf } from '../../../shared/game/shardfile/tileOrder';
import { productTileRing } from './tileDriver';
import { runtimeLookMaterials, runtimeProduct } from './runtimeProduct';
import { lendLooks } from './lentLooks';

/** Declared L1 props cover a native library. Every parent precedes entry, the spawn ring's first, then the rest nearest
 * first (MF5: a parent loaded after control linked its first-drawn programs in play; Nine's four are ~0.15 MB).
 * A fine read always awaits its parent, and masks it only after publication. */
export function wholeRefinementCover(ctx: ShardContext, owner: Scope, entry: { readonly x: number; readonly z: number }): {
  readonly content: TileContent; readonly ensure: (tile: number) => Promise<void>;
} {
  const source = ctx.product.shardfile, props = source.props, product = runtimeProduct(source);
  if (props === null) throw new Error('Fine refinement requires declared coarse props');
  const parents = new Map(props.tiles.filter(tile => tile.lod === 1).map(tile => [tile.z * 4 + tile.x, tile]));
  const pending = new Map<number, Promise<void>>(), masks = new Map<number, readonly ResidentTile[]>();
  /** the quadrant bits last written to a parent's tiles (a reloaded parent is a new list, so it is written again) */
  const applied = new WeakMap<readonly ResidentTile[], number>();
  const live = (): void => { if (owner.disposed || owner.disposing) throw new Error('Coarse refinement owner is retired'); };
  let presentation: Promise<ReturnType<typeof clientTileViews>> | undefined;
  const views = (): Promise<ReturnType<typeof clientTileViews>> => {
    presentation ??= (async () => {
    const looks = await runtimeLookMaterials({ scope: owner, game: ctx.game }, source, true); live();
      // NT4: the coarse props' own compile follows the owner's line, so the frame's param feeds (a shard's channel group:
      // wash, shade, light) reach it; unlent, every coarse graph drew with zero params (black walls under the fog). It
      // only follows: a lookup still hands the fine meshes the world's compile
      lendLooks(owner, looks, { follows: true });
      return clientTileViews({ terrain: null, ...looks });
    })();
    return presentation;
  };
  const load = (key: number): Promise<void> => {
    let found = pending.get(key); if (found !== undefined) return found;
    const row = parents.get(key); if (row === undefined) return Promise.reject(new Error('Fine refinement lacks its declared coarse parent'));
    found = (async () => {
      live(); const scope = owner.child(`refinement.coarse:${String(key)}`), root = new Group();
      scope.onDispose(() => { root.removeFromParent(); masks.delete(key); });
      try {
        const installer = await views(); live();
        const tiles = await prepareClientTile({ ...source, terrain: null }, product.assets, `1/${String(row.x)}/${String(row.z)}`, scope,
          { terrain: () => { throw new Error('Coarse props cannot install terrain'); }, props: (data, address, bytes, lifetime, additional) => installer.props(data, address, bytes, root, lifetime, additional) });
        live(); masks.set(key, tiles); ctx.root.add(root);
        await product.releaseTransport([row.file, ...row.additionalFiles ?? []]); live();
      } catch (error) { scope.dispose(); throw error; }
    })();
    pending.set(key, found); return found;
  };
  const ensure = (tile: number): Promise<void> => load(Math.floor(tile / 16) * 4 + Math.floor(tile % 8 / 2));
  const content: TileContent = { id: 'whole.refinement.coarse', tiles: () => new Set(), attach: () => Promise.resolve(), coarse: async (scope, rendered) => {
    const at = entry, spawn = new Set([...ring(tileOf(at.x, at.z), productTileRing(source)())].map(tile => Math.floor(tile / 16) * 4 + Math.floor(tile % 8 / 2)));
    const distance = (key: number): number => (-250 + (key % 4 + 0.5) * 125 - at.x) ** 2 + (-250 + (Math.floor(key / 4) + 0.5) * 125 - at.z) ** 2;
    const order = [...parents.keys()].sort((a, b) => distance(a) - distance(b));
    for (const key of order) if (spawn.has(key)) await load(key);
    for (const key of order) if (!spawn.has(key)) await load(key);
    ctx.system({ id: 'client.world.refinement-mask', phase: 'update', run: () => {
      if (scope.disposed || scope.disposing) return;
      // measurement only: a capture's pin lifts the mask, so the coarse cover draws over its fine tiles
      const forced = harnessPins()?.coarseLevel === 'forced';
      for (const [key, tiles] of masks) {
        const x = key % 4 * 2, z = Math.floor(key / 4) * 2;
        let bits = 0;
        for (let quadrant = 0; quadrant < 4; quadrant++) if (!forced && rendered((z + Math.floor(quadrant / 2)) * 8 + x + quadrant % 2)) bits |= 1 << quadrant;
        // NF15: a parent's mask changes only when a fine tile publishes or leaves; the rest of the frames write nothing
        if (applied.get(tiles) === bits) continue;
        applied.set(tiles, bits);
        const hidden = new Set<number>();
        for (let quadrant = 0; quadrant < 4; quadrant++) if ((bits & 1 << quadrant) !== 0) hidden.add(quadrant);
        for (const tile of tiles) tile.mask(hidden);
      }
    } });
  } };
  return { content, ensure };
}
