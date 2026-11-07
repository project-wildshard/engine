/** S3 road/junction adapter over the existing engine host. One125m cell offers
 * its coarse parent and up to four62.5m fine children, with ordinary masks. */
import type { Scope } from '@wildshard/engine/app/scope';
import { CONTENT_CAPS } from '@wildshard/engine/core/config';
import { TileStreamer, scopedTilePorts, type RingCatalogue, type RingCell, type TileStreamBudget } from '@wildshard/engine/world/tileStreamer';
import type { RoadLayout } from '../../../shared/game/grid/roadLayout';
import { loadRoadTile, type RoadTileReference, type RoadTileStore } from './roadTileArchive';
import type { RoadTileGeometry } from './roadTileGeometry';
import { roadTileWorkingBytes, type RoadTilePool } from './roadTilePool';

export interface RoadTileSource {
  readonly pool: RoadTilePool; readonly references: readonly RoadTileReference[];
  readonly coarseReferences: readonly RoadTileReference[];
}
export interface PreparedRoadTile { readonly scope: Scope; readonly parts: readonly { readonly pool: RoadTilePool; readonly data: RoadTileGeometry }[] }
interface Part { readonly pool: RoadTilePool; readonly reference: RoadTileReference }

/** Shared key for the source adapter and its bounded initial requirements. */
export function roadCellKey(id: string, x: number, z: number): string { return `${id}:road:${String(x)},${String(z)}`; }

/** The existing host owns parent-first publication, cache hysteresis, count/byte
 * caps and readiness. All geometry/working buffers charge the platform owner;
 * shared materials and original collider strips remain separately admitted. */
export function roadTileStream(scope: Scope, sources: readonly RoadTileSource[], origin: { readonly x: number; readonly z: number },
  layout: Pick<RoadLayout, 'junctions'>, budget: TileStreamBudget, store: RoadTileStore, id: string): TileStreamer<PreparedRoadTile> {
  if (scope.disposed || scope.disposing || !Number.isFinite(origin.x) || !Number.isFinite(origin.z)) throw new Error('Invalid road tile owner');
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u.test(id)) throw new Error('Invalid road stream identity');
  const cellKey = (x: number, z: number): string => roadCellKey(id, x, z);
  const contentKey = (instance: string, level: string, x: number, z: number): string => [instance, level, x, z].join(':');
  const size = CONTENT_CAPS.l1.size, parts = new Map<string, Part[]>(), coordinates = new Map<string, { x: number; z: number }>();
  const add = (pool: RoadTilePool, reference: RoadTileReference, coarse: boolean): void => {
    if (!Number.isSafeInteger(reference.x) || !Number.isSafeInteger(reference.z)) throw new Error('Invalid road tile coordinate');
    const px = coarse ? reference.x : Math.floor(reference.x / 2), pz = coarse ? reference.z : Math.floor(reference.z / 2);
    const instance = cellKey(px, pz), level = coarse ? 'l1' : 'l0';
    const key = contentKey(instance, level, coarse ? 0 : reference.x - px * 2, coarse ? 0 : reference.z - pz * 2), rows = parts.get(key) ?? [];
    if (rows.some(row => row.pool === pool)) throw new Error('Duplicate road material tile');
    rows.push({ pool, reference: { ...reference } }); parts.set(key, rows); coordinates.set(instance, { x: px, z: pz });
  };
  for (const source of sources) {
    for (const reference of source.references) add(source.pool, reference, false);
    for (const reference of source.coarseReferences) add(source.pool, reference, true);
  }
  const junctions = new Set(layout.junctions.map(junction => cellKey(Math.floor((junction.centre.x - origin.x) / size), Math.floor((junction.centre.z - origin.z) / size))));
  const cells: RingCell[] = [...coordinates].map(([instance, at]) => ({ instance, type: junctions.has(instance) ? 'junction' : 'road',
    origin: { x: origin.x + (at.x + 0.5) * size, z: origin.z + (at.z + 0.5) * size }, extent: { width: size, depth: size } }));
  const costs = new Map<string, number>();
  for (const [key, rows] of parts) {
    const cost = rows.reduce((sum, row) => sum + roadTileWorkingBytes(row.reference), 0);
    if (!Number.isSafeInteger(cost) || cost <= 0) throw new Error('Invalid road tile cost');
    costs.set(key, cost);
  }
  const catalogue: RingCatalogue = Object.assign((instance: string, level: 'far' | 'l1' | 'l0', x: number, z: number): number | null =>
    level === 'far' ? null : costs.get(contentKey(instance, level, x, z)) ?? null, { revision: (): number => 0 });
  const ports = scopedTilePorts<PreparedRoadTile>(scope, async (tile, owner) => {
    const rows = parts.get(contentKey(tile.instance, tile.level, tile.x, tile.z));
    if (rows === undefined || tile.level === 'far') throw new Error('Missing road tile backing');
    const prepared: { pool: RoadTilePool; data: RoadTileGeometry }[] = [];
    for (const row of rows) prepared.push({ pool: row.pool, data: await loadRoadTile(owner, store, row.reference) });
    return { scope: owner, parts: prepared };
  }, (tile, prepared) => {
    const views = prepared.parts.map(part => part.pool.publish(tile, part.data, prepared.scope));
    return { mask: excluded => { for (const view of views) view.mask(excluded); },
      shadow: enabled => { for (const view of views) view.shadow(enabled); } };
  });
  const roadBudget: TileStreamBudget = { ...(budget.now === undefined ? {} : { now: budget.now }),
    reserve: claim => budget.reserve({ ...claim, owner: 'platform' }) };
  const stream = new TileStreamer(cells, roadBudget, catalogue, ports, { viewDistance: CONTENT_CAPS.nearRadius, farPrefetch: 0, farRadius: CONTENT_CAPS.nearRadius });
  scope.onDispose(() => { stream.dispose(); }); return stream;
}
