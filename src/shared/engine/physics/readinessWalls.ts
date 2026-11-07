import type { Collider } from '@dimforge/rapier3d-simd';
import type { Scope } from '../app/scope';
import { withOwner } from '../app/ownership';
import { CELL_ABOVE, CELL_BELOW } from '../core/config';
import type { TraversalReadiness } from '../sim/readiness';
import type { Physics } from './Physics';
import { groups } from './groups';
import { tagCollider } from './surface';
import { PLATFORM_COLLIDER_OWNER } from './stripColliders';

/** A platform edge in this physics world's frame; null instance means an out-of-bounds proxy. */
export interface ReadinessEdge { instance: string | null; x: number; z: number; halfLength: number; axis: 'x' | 'z'; floor: number }

/** Real Rapier walls hold a capsule on the solid strip until all readiness fences open. Own the deck separately. */
export class ReadinessWalls {
  private readonly walls: { edge: ReadinessEdge; collider: Collider }[] = [];
  private closed = false;
  private readonly physics: Physics;

  constructor(physics: Physics, edges: readonly ReadinessEdge[], scope: Scope) {
    this.physics = physics;
    for (const edge of edges) if (![edge.x, edge.z, edge.halfLength, edge.floor].every(Number.isFinite) || edge.halfLength <= 0 || edge.instance === '') throw new RangeError('Invalid readiness edge');
    if (scope.disposed) throw new RangeError('Disposed readiness scope');
    const halfHeight = (CELL_ABOVE + CELL_BELOW) / 2;
    // Grid entry walls sit at the 6 m re-frame line on shared strip ground, before the capsule reaches the cell seam.
    for (const source of edges) {
      const edge = { ...source }, acrossX = edge.axis === 'x';
      const collider = withOwner(scope, () => physics.world.createCollider(physics.R.ColliderDesc.cuboid(acrossX ? 0.25 : edge.halfLength, halfHeight, acrossX ? edge.halfLength : 0.25)
        .setTranslation(edge.x, edge.floor + (CELL_ABOVE - CELL_BELOW) / 2, edge.z).setCollisionGroups(groups('WORLD'))));
      tagCollider(collider, 'edge', PLATFORM_COLLIDER_OWNER);
      this.walls.push({ edge, collider });
    }
    scope.onDispose(() => this.dispose());
  }

  /** Run before the fixed-step capsule move, including after a failed or unloaded residency attempt. */
  sync(readiness: TraversalReadiness): void {
    if (this.closed) return;
    for (const { edge, collider } of this.walls) collider.setEnabled(!readiness.isReady(edge.instance));
  }

  /** Removes only soft walls; highway, strip and proxy floors survive this scope. */
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    for (const { collider } of this.walls) if (collider.isValid()) this.physics.world.removeCollider(collider, false);
    this.walls.length = 0;
  }
}
