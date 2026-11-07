import type { Scope } from '../app/scope';
import { withOwner } from '../app/ownership';
import { CELL_ABOVE, CELL_BELOW, CHUNK_HALF } from '../core/config';
import type { Physics } from './Physics';
import { groups, queryGroups } from './groups';

const ORIGIN = { x: 0, y: 0, z: 0 };
interface Point { x: number; y: number; z: number }
/** Home walls affect creatures only, through Rapier. A traveler or player still sees the actual WORLD deck. */
export function installGridBorders(physics: Physics, scope: Scope, origin: Readonly<Point> = ORIGIN): void {
  if (![origin.x, origin.y, origin.z].every(Number.isFinite)) throw new RangeError('Invalid border origin');
  if (scope.disposed) return;
  const { R, world } = physics;
  const halfHeight = (CELL_ABOVE + CELL_BELOW) / 2, y = origin.y + (CELL_ABOVE - CELL_BELOW) / 2;
  withOwner(scope, () => {
    for (const [dx, dz, hx, hz] of [[CHUNK_HALF + 0.5, 0, 0.5, CHUNK_HALF + 1], [-CHUNK_HALF - 0.5, 0, 0.5, CHUNK_HALF + 1], [0, CHUNK_HALF + 0.5, CHUNK_HALF + 1, 0.5], [0, -CHUNK_HALF - 0.5, CHUNK_HALF + 1, 0.5]] as const) {
      world.createCollider(R.ColliderDesc.cuboid(hx, halfHeight, hz).setTranslation(origin.x + dx, y, origin.z + dz).setCollisionGroups(groups('BORDER')));
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
