/**
 * A small heightfield collider re-shaped at run time — a floor that grows and drains (the Golden King's sand drifts in
 * the kurgan dungeon, NALATI-MERGE P1). A registered piece is static, so this is the one moving floor that is not a
 * `follows` body: `set(grid)` swaps the collider for one with the new heights (a 41 × 41 grid rebuilds in well under
 * a millisecond), throttled by its caller. Flat (every height ≤ `flat`) means no collider at all: the floor under it
 * is the room's own slab.
 *
 *   const drifts = new HeightPatch(physics, { x, y, z, size: 20, res: 41, material: 'sand', owner: dungeon });
 *   drifts.set(heights);   // row-major (iz × res + ix), metres above y, x and z from −size / 2 to +size / 2
 */
import type { Collider } from '@dimforge/rapier3d-simd';
import type { Physics } from './Physics';
import { groups } from './groups';
import { tagCollider, untagCollider, type Material } from './surface';
import { toColumnMajor } from './terrain';

export interface HeightPatchOpts { x: number; y: number; z: number; size: number; res: number; material: Material; owner?: unknown; flat?: number }

/** a small heightfield collider re-shaped at run time (a floor that grows and drains) */
export class HeightPatch {
  private collider: Collider | null = null;

  private readonly physics: Physics;
  private readonly o: HeightPatchOpts;
  constructor(physics: Physics, o: HeightPatchOpts) {
    this.physics = physics;
    this.o = o;
  }

  set(grid: Float32Array): void {
    this.clear();
    const flat = this.o.flat ?? 0.01;
    if (!grid.some((h) => h > flat)) return;
    const { R, world } = this.physics, { res, size } = this.o;
    const desc = R.ColliderDesc.heightfield(res - 1, res - 1, toColumnMajor(grid, res), { x: size, y: 1, z: size })
      .setTranslation(this.o.x, this.o.y, this.o.z).setCollisionGroups(groups('WORLD'));
    this.collider = world.createCollider(desc);
    tagCollider(this.collider, this.o.material, this.o.owner ?? null);
  }

  clear(): void {
    if (!this.collider) return;
    untagCollider(this.collider);
    this.physics.world.removeCollider(this.collider, false);
    this.collider = null;
  }

  get active(): boolean { return this.collider !== null; }
}
