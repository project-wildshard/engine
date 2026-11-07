import { Scope, type DisposeStep } from '@wildshard/engine/app/scope';
import { withOwner } from '@wildshard/engine/app/ownership';
import { decodeTerrainTile, terrainTileHeight } from '@wildshard/format/terrainTileBytes';
import { addBakedTerrainCollider } from '@wildshard/engine/physics/terrainTiles';
import { Physics } from '@wildshard/engine/physics/Physics';
import type { Rapier } from '@wildshard/engine/physics/rapier';
import { groups } from '@wildshard/engine/physics/groups';
import { tagCollider } from '@wildshard/engine/physics/surface';
import type { PropColliderPort } from '@wildshard/engine/physics/declaredProps';
import { declaredWaterBody } from '@wildshard/engine/world/water/declared';
import { WaterBodies } from '@wildshard/engine/world/water/body';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { clientGround } from '../../../shared/game/shardfile/clientGround';
import { installShardfileColliders } from '../../../shared/game/shardfile/collisionBindings';

/** The start a cell's page knows it by. */
export interface RegionLevel { readonly id: string; readonly player: { readonly at: { readonly x: number; readonly y: number; readonly z: number }; readonly yaw: number } }

/** A cell on a page: a physics world to predict a walk in and an owner for what stands in it. The server runs the cell, so nothing steps here. */
export class RegionShell {
  readonly level: RegionLevel;
  readonly scope: Scope;
  readonly physics: Physics;
  private disposed = false;
  constructor(level: RegionLevel, rapier: Rapier, owner?: Scope) {
    this.level = level;
    const [scope, physics] = withOwner(null, () => { const own = owner?.child(`region:${level.id}`) ?? new Scope(`region:${level.id}`); return [own, new Physics(rapier, undefined, own)] as const; });
    this.scope = scope; this.physics = physics;
    scope.onDispose(() => { this.disposed = true; physics.dispose(); });
    physics.step();
  }
  dispose(): void { if (!this.disposed) this.scope.dispose(); }
  *disposeSteps(): Generator<DisposeStep, void> { if (!this.disposed) yield* this.scope.disposeSteps(); }
}

/** A data cell as this page walks it. */
export interface DataCellWorld {
  readonly shell: RegionShell; readonly water: WaterBodies; readonly heightAt: (x: number, z: number) => number;
  readonly colliders: ReadonlyMap<string, PropColliderPort>;
}
/** The world a data shard's server lays, for this page's prediction: its ground, its props and its water. Solids are world data, not law. */
export function dataCellWorld(source: Shardfile, assets: ReadonlyMap<string, Uint8Array>, rapier: Rapier, groundResolution: 256 | 257): DataCellWorld {
  const { x, y, z, yaw } = source.spawn, shell = new RegionShell({ id: source.identity.slug, player: { at: { x, y, z }, yaw } }, rapier);
  try {
    const { physics, scope } = shell, terrain = source.terrain === null ? undefined : assets.get(source.terrain.collider);
    if (source.terrain !== null && terrain === undefined) throw new Error('Missing admitted terrain collider');
    if (terrain !== undefined) addBakedTerrainCollider(physics, terrain, scope);
    else if (source.meshCollision === null && source.entryways.some(entry => (entry.kind ?? 'ground') === 'ground')) {
      const flat = physics.world.createCollider(rapier.ColliderDesc.heightfield(groundResolution - 1, groundResolution - 1, new Float32Array(groundResolution ** 2).fill(0), { x: 500, y: 1, z: 500 }).setCollisionGroups(groups('WORLD')));
      tagCollider(flat, 'ground');
    }
    const tile = terrain === undefined ? undefined : decodeTerrainTile(terrain);
    const heightAt = source.meshCollision !== null ? clientGround(source, assets).heightAt : tile === undefined ? () => 0 : (at: number, on: number): number => terrainTileHeight(tile, at, on, { boundary: 'clamp' });
    const colliders = installShardfileColliders(source, assets, () => physics, scope), water = new WaterBodies();
    for (const row of [...source.water].sort((a, b) => Number(a.kind === 'sea') - Number(b.kind === 'sea'))) water.add(declaredWaterBody(row), scope);
    return { shell, water, heightAt, colliders };
  } catch (error) { shell.dispose(); throw error; }
}
