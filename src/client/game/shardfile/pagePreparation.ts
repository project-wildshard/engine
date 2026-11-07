import type { ClientFeatureRow } from '@wildshard/format/clientPlan';
/** Client-only native preparation, with rows instead of author callbacks. */
import type { WorldRegistry } from '@wildshard/engine/world/registry';
import { pathRampDescs } from '@wildshard/engine/physics/paths';
import { TRAILS, heightAt, normalAt } from '@wildshard/engine/world/Heightfield';
import * as v from 'valibot';
import { cutTerrain } from '@wildshard/engine/physics/terrain';
import { yawLocal, yawWorld } from '@wildshard/engine/world/yawFrame';
import { slicer } from '@wildshard/engine/boot/plan';
import { PagePathRampSchema, PageTerrainCutSchema, type PageTerrainCutRows } from '@wildshard/format/pagePreparation';
import type { ShardContext } from '../plugin/context';

/** Exact native triangle/AABB overlap law over a yawed generated opening. */
export function terrainOpeningHits(rows: PageTerrainCutRows, ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number): boolean {
  const [alx, alz] = yawLocal(rows.frame, ax, az), [blx, blz] = yawLocal(rows.frame, bx, bz), [clx, clz] = yawLocal(rows.frame, cx, cz);
  const x0 = Math.min(alx, blx, clx), x1 = Math.max(alx, blx, clx), z0 = Math.min(alz, blz, clz), z1 = Math.max(alz, blz, clz), y0 = Math.min(ay, by, cy), y1 = Math.max(ay, by, cy);
  return rows.holes.some(h => !(x1 < h.lx - h.hw || x0 > h.lx + h.hw || z1 < h.lz - h.hd || z0 > h.lz + h.hd || y1 < h.y0 || y0 > h.y1));
}
/** Native terrain owns both physical and drawn openings, in their old order. */
export async function punchPageTerrain(ctx: ShardContext, input: unknown): Promise<void> {
  const rows = v.parse(PageTerrainCutSchema, input), world = ctx.game.runtime?.world;
  if (world === undefined || world === null) throw new Error('Terrain preparation requires its world');
  cutTerrain(world.physics, rows.cuts.map(row => { const [x, z] = yawWorld(rows.frame, row.lx, row.lz); return { x, z, hw: row.hw, hd: row.hd, yaw: rows.frame.yaw, below: row.below }; }));
  await world.terrain.punchSliced((...triangle) => terrainOpeningHits(rows, ...triangle), slicer(30).due);
}

/** Install after decks register; live floor bindings preserve the baked ramp
 * profile and native registry lifetime without author query callbacks. */
export function installPagePathRamps(registry: WorldRegistry, input: unknown): void {
  const rows = v.parse(PagePathRampSchema, input);
  registry.add({ ...rows, category: 'ground', file: 'src/shared/engine/physics/paths.ts', surface: 'ground',
    colliders: pathRampDescs(TRAILS, heightAt, (x, z) => normalAt(x, z)[1], { carried: (x, z) => registry.floorAt(x, z) !== undefined }) });
}

/** Kit begins after every world deck is registered, so the plan's path ramps
 * retain native carrier suppression and the same registry lifetime. */
export function installClientPathRamps(ctx: ShardContext, feature: ClientFeatureRow): void {
  if (feature.kind !== 'world.paths' || ctx.scope.disposed) throw new Error('Invalid path ramp feature');
  installPagePathRamps(ctx.app.registry, feature.rows);
}
