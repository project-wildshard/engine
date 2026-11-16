import type { Scope } from '../app/scope';
import { withOwner } from '../app/ownership';
import { CELL_ABOVE, CELL_BELOW, CHUNK_HALF } from '../core/config';
import type { Physics } from './Physics';
import { groups, queryGroups } from './groups';
import { tagCollider } from './surface';

const ORIGIN = { x: 0, y: 0, z: 0 };
interface Point { x: number; y: number; z: number }
/** Home walls affect creatures only, through Rapier. A traveler or player still sees the actual WORLD deck. */
export function installGridBorders(physics: Physics, scope: Scope, origin: Readonly<Point> = ORIGIN): void {
  if (![origin.x, origin.y, origin.z].every(Number.isFinite)) throw new RangeError('Invalid border origin');
  if (scope.disposed) return;
  const { R, world } = physics;
  const halfHeight = (CELL_ABOVE + CELL_BELOW) / 2, y = origin.y + (CELL_ABOVE - CELL_BELOW) / 2;
  const border = groups('BORDER'), near = (a: number, b: number): boolean => Math.abs(a - b) < .001;
  withOwner(scope, () => {
    for (const [dx, dz, hx, hz] of [[CHUNK_HALF + 0.5, 0, 0.5, CHUNK_HALF + 1], [-CHUNK_HALF - 0.5, 0, 0.5, CHUNK_HALF + 1], [0, CHUNK_HALF + 0.5, CHUNK_HALF + 1, 0.5], [0, -CHUNK_HALF - 0.5, CHUNK_HALF + 1, 0.5]] as const) {
      // A restored world already carries its walls. Match their actual shape,
      // rather than an in-memory handle from the physics world it replaced.
      let installed = false;
      world.forEachCollider(collider => {
        if (collider.collisionGroups() !== border || collider.shapeType() !== R.ShapeType.Cuboid || collider.isSensor() || collider.parent() !== null) return;
        const at = collider.translation(), half = collider.halfExtents(), rotation = collider.rotation();
        if (half !== null && near(at.x, origin.x + dx) && near(at.y, y) && near(at.z, origin.z + dz)
          && near(half.x, hx) && near(half.y, halfHeight) && near(half.z, hz)
          && near(Math.abs(rotation.w), 1) && near(rotation.x, 0) && near(rotation.y, 0) && near(rotation.z, 0)) {
          installed = true; tagCollider(collider, 'edge', 'grid.home');
        }
      });
      if (!installed) tagCollider(world.createCollider(R.ColliderDesc.cuboid(hx, halfHeight, hz).setTranslation(origin.x + dx, y, origin.z + dz).setCollisionGroups(border)), 'edge', 'grid.home');
    }
  });
}
/** Physics-owned constraint for fliers and distant analytic creatures that have no movement capsule. Reuse per creature. */
export function gridCreatureConstraint(physics: () => Physics, radius: number): (from: Readonly<Point>, to: Point) => void {
  if (!Number.isFinite(radius) || radius <= 0) throw new RangeError('Invalid creature border radius');
  let cached: Physics | null = null;
  let ball: InstanceType<Physics['R']['Ball']> | null = null;
  const delta = { x: 0, y: 0, z: 0 }, rotation = { x: 0, y: 0, z: 0, w: 1 };
  return (from, to) => {
    const ph = physics();
    if (cached !== ph || ball === null) { cached = ph; ball = new ph.R.Ball(radius); }
    delta.x = to.x - from.x; delta.y = 0; delta.z = to.z - from.z;
    if (delta.x === 0 && delta.z === 0) return;
    const hit = ph.world.castShape(from, rotation, delta, ball, 0, 1, true, ph.R.QueryFilterFlags.EXCLUDE_SENSORS, queryGroups(['BORDER'], 'CREATURE'));
    if (hit !== null) {
      const fraction = Math.max(0, hit.time_of_impact - 0.0001);
      to.x = from.x + delta.x * fraction; to.z = from.z + delta.z * fraction;
    }
  };
}
