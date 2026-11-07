import type { Scope } from '../app/scope';
import { withOwner } from '../app/ownership';
import { CELL_ABOVE, CELL_BELOW, CHUNK_HALF } from '../core/config';
import type { Physics } from './Physics';
import { groups } from './groups';
import { tagCollider, untagCollider } from './surface';
import { PLATFORM_COLLIDER_OWNER } from './stripColliders';

/** Conservative native wall/handle allowance per four-sided cell, reserved before construction. */
export const TRANSFER_WALL_BYTES = 65_536;
/** Outgoing feet may reach the >10 m target threshold, but never pass this solid hold line before a durable commit. */
export const TRANSFER_EXIT_LIMIT = 10.1;
/** Incoming contact reaches the <=6 m target threshold without crossing the cell boundary in the highway frame. */
export const TRANSFER_ENTER_LIMIT = 5.9;
/** Cell centres in this physics frame; entry walls enclose highway destinations, exit walls enclose the active region. */
export interface TransferWallCell { readonly x: number; readonly z: number }

/**
 * Always-solid transfer fences, independent of asset readiness. The current capsule reaches the hysteresis query
 * threshold, then waits on shared ground until a fixed-boundary reframe into the other world's corridor. Turning
 * back remains free. No source wall opens, so a pending/failed save cannot leak movement during preparation.
 * The getter and handle adapter reconnect after native restore without allocating duplicate geometry.
 */
export class TransferWalls {
  private handles: number[] = [];
  private disposed = false;
  private readonly count: number;
  private readonly physics: () => Physics;
  constructor(physics: () => Physics, cells: readonly TransferWallCell[], radius: number, mode: 'entry' | 'exit', scope: Scope, restoring = false) {
    if (scope.disposed || !Number.isFinite(radius) || radius <= 0 || radius > 2
      || cells.length === 0 || cells.some(cell => ![cell.x, cell.z].every(Number.isFinite))) throw new RangeError('Invalid transfer fence');
    this.physics = physics;
    const half = 0.25, pad = radius + half + 0.02;
    const reach = CHUNK_HALF + (mode === 'exit' ? TRANSFER_EXIT_LIMIT - 0.05 + pad : TRANSFER_ENTER_LIMIT + 0.085 - pad);
    const segments = Math.ceil((reach + 1) * 2 / 32);
    this.count = cells.length * 4 * (segments + 2);
    if (!restoring) {
      // Rapier KCC's 2 cm contact offset plus a small query overlap lets the feet reach the unchanged 6/10 m thresholds.
      const ph = physics();
      // Bounded 32x16 m contact boxes avoid giant-cuboid GJK precision drift at the road. Upper/lower slabs close
      // the entire declared vertical envelope too; jumping cannot bypass a pending save.
      const slabs = [[-8, 8], [8, CELL_ABOVE], [-CELL_BELOW, -8]] as const;
      try {
        for (const cell of cells) for (const [x, z, acrossX] of [[reach, 0, true], [-reach, 0, true], [0, reach, false], [0, -reach, false]] as const) for (const [bottom, top] of slabs) {
          const parts = bottom === -8 ? segments : 1, alongHalf = (reach + 1) / parts;
          for (let part = 0; part < parts; part++) {
            const along = -(reach + 1) + alongHalf * (part * 2 + 1);
            // Explicit cleanup follows the current world after restore; ambient page ownership must never capture it.
            const collider = withOwner(null, () => ph.world.createCollider(ph.R.ColliderDesc.cuboid(acrossX ? half : alongHalf + 0.01, (top - bottom) / 2, acrossX ? alongHalf + 0.01 : half)
              .setTranslation(cell.x + x + (acrossX ? 0 : along), (top + bottom) / 2, cell.z + z + (acrossX ? along : 0)).setCollisionGroups(groups('WORLD'))));
            tagCollider(collider, 'edge', PLATFORM_COLLIDER_OWNER); this.handles.push(collider.handle);
          }
        }
      } catch (error) { this.dispose(); throw error; }
    }
    scope.onDispose(() => { this.dispose(); });
  }
  /** Run before movement; malformed/missing restored handles fail closed instead of silently dropping the hold. */
  sync(): void {
    if (this.disposed) return;
    if (this.handles.length !== this.count) throw new RangeError('Missing transfer fence handles');
    const world = this.physics().world;
    for (const handle of this.handles) {
      const collider = world.colliders.get(handle);
      if (collider === null) throw new RangeError('Missing transfer fence collider');
      collider.setEnabled(true);
    }
  }
  /** Handle-only continuation; native physics carries the exact wall geometry and collision flags. */
  snapshot(): number[] { return [...this.handles]; }
  /** Validate the adapter before physics replacement; handles are resolved lazily in the restored world. */
  restore(value: unknown): void {
    if (!Array.isArray(value) || value.length !== this.count || value.some((handle: unknown) => typeof handle !== 'number' || !Number.isFinite(handle) || handle < 0)
      || new Set(value).size !== value.length) throw new RangeError('Invalid transfer fence handles');
    this.handles = value.map((handle: unknown) => { if (typeof handle !== 'number') throw new RangeError('Invalid transfer fence handle'); return handle; });
  }
  /** Remove only this world's fences; the deck, readiness walls and traveller remain owned by their existing scopes. */
  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    const world = this.physics().world;
    for (const handle of this.handles) if (world.colliders.contains(handle)) { const collider = world.getCollider(handle); untagCollider(collider); world.removeCollider(collider, false); }
    this.handles.length = 0;
  }
}
