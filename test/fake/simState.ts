// oxlint-disable-next-line import/no-nodejs-modules -- A witness's continuation hash is a sha256 of the canonical state.
import { createHash } from 'node:crypto';
import RAPIER, { RigidBodyType, type Collider, type World } from '@dimforge/rapier3d-simd';
import { Physics } from '../../src/shared/engine/physics/Physics';
import { decodeSimSnapshot, type SimSnapshot, type SimSnapshotBytes } from '../../src/shared/engine/sim/snapshot';

/**
 * A sim snapshot's native physics as restored world state, the one canonical form of "the same world" (SF72, E435).
 *
 * Rapier's snapshot bytes are not canonical: `takeSnapshot(restoreSnapshot(x))` can differ from `x` by a few records
 * (Driftwood's quest checkpoint: two 13-byte records swapped near offset 194 k of 3.3 MB, the broad phase's pair order),
 * and repeated round trips keep permuting them, with no step in between and every body, collider and contact the same.
 * Whether it shows hangs on where a dynamic body rests, so a byte check of a restore flakes about one run in two on the
 * wrong checkpoint. So a restore or a replay is judged on the world the bytes restore to: every rigid body (type,
 * enabled, asleep, pose, velocities, mass, damping, gravity scale, CCD, dominance), every collider (parent, enabled,
 * collision and solver groups, sensor, shape type, pose, friction, restitution, density) in the arenas' own order, and
 * every contact of a dynamic body's collider (partners by handle; per manifold its contacts' distances and impulses, the
 * solver's warm start). Numbers compare exactly: a 1-ULP pose difference still fails. Identical bytes need no restore.
 */
export interface PhysicsState {
  /** the state, flattened (booleans as 0 / 1, a missing parent as -1) */
  readonly values: number[];
  /** [index of a record's first value, what the record is], ascending: names the first difference */
  readonly marks: [number, string][];
}

const bodyType = (t: RigidBodyType): number => t === RigidBodyType.Dynamic ? 0 : t === RigidBodyType.Fixed ? 1 : t === RigidBodyType.KinematicPositionBased ? 2 : 3;

function contacts(world: World, collider: Collider, out: number[]): void {
  const partners: Collider[] = [];
  world.contactPairsWith(collider, other => { partners.push(other); });
  partners.sort((a, b) => a.handle - b.handle);
  out.push(partners.length);
  for (const other of partners) {
    out.push(other.handle);
    world.contactPair(collider, other, (manifold, flipped) => {
      const n = manifold.numContacts();
      out.push(flipped ? 1 : 0, n);
      for (let i = 0; i < n; i++) out.push(manifold.contactDist(i), manifold.contactImpulse(i));
    });
  }
}

/** The world `bytes` restore to, as state. */
export function physicsState(bytes: ArrayLike<number>): PhysicsState {
  const physics = new Physics(RAPIER, Uint8Array.from(bytes)), world = physics.world, values: number[] = [], marks: [number, string][] = [];
  try {
    world.forEachRigidBody(rb => {
      marks.push([values.length, `rigid body ${String(rb.handle)}`]);
      const t = rb.translation(), r = rb.rotation(), v = rb.linvel(), w = rb.angvel();
      values.push(rb.handle, bodyType(rb.bodyType()), rb.isEnabled() ? 1 : 0, rb.isSleeping() ? 1 : 0, t.x, t.y, t.z, r.x, r.y, r.z, r.w,
        v.x, v.y, v.z, w.x, w.y, w.z, rb.mass(), rb.linearDamping(), rb.angularDamping(), rb.gravityScale(), rb.isCcdEnabled() ? 1 : 0, rb.dominanceGroup());
    });
    world.forEachCollider(c => {
      marks.push([values.length, `collider ${String(c.handle)}`]);
      const t = c.translation(), r = c.rotation(), parent = c.parent();
      values.push(c.handle, parent?.handle ?? -1, c.isEnabled() ? 1 : 0, c.collisionGroups(), c.solverGroups(), c.isSensor() ? 1 : 0, c.shapeType(),
        t.x, t.y, t.z, r.x, r.y, r.z, r.w, c.friction(), c.restitution(), c.density());
      if (parent?.bodyType() === RigidBodyType.Dynamic) { marks.push([values.length, `contacts of collider ${String(c.handle)}`]); contacts(world, c, values); }
    });
  } finally { physics.dispose(); }
  return { values, marks };
}

/** Do two byte arrays hold the same bytes? */
export function sameBytes(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Where two physics states first differ (`null`: the same world, exactly). */
export function physicsDifference(a: PhysicsState, b: PhysicsState): string | null {
  const n = Math.max(a.values.length, b.values.length);
  for (let i = 0; i < n; i++) {
    const x = a.values[i], y = b.values[i];
    if (x !== undefined && y !== undefined && Object.is(x, y)) continue;
    let at = '';
    for (const [start, label] of a.marks) { if (start > i) break; at = label; }
    return `${at || 'the world'}: value ${String(i)} is ${String(x)}, expected ${String(y)}`;
  }
  return null;
}

/** Version 1's field order for a player. */
const V1_PLAYER_FIELDS = ['id', 'position', 'yaw', 'health', 'motor', 'walk', 'moveScale', 'impulse', 'fall', 'shove', 'board', 'swim', 'jump', 'dash', 'dodge', 'traversals'] as const;
/** A player in the version 1 shape: one velocity back out into each mode's. Footing never was a version 1 field. */
function versionOnePlayer(player: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const velocity = (player['velocity'] ?? [0, 0, 0]) as readonly [number, number, number], [x, y, z] = velocity;
  const board = player['board'] as Record<string, unknown> | undefined, swim = player['swim'] as ({ on: boolean } & Record<string, unknown>) | undefined;
  const riding = board !== undefined || swim?.on === true, airborne = player['airborne'] === true, vy = riding ? 0 : y;
  const mapped: Record<string, unknown> = { ...player,
    ...(riding || (x === 0 && z === 0) ? {} : { walk: { x, z } }),
    ...(board === undefined && (airborne || vy !== 0) ? { fall: { vy, grounded: !airborne } } : {}),
    ...(board === undefined ? {} : { board: { velocity: [...velocity], ...board, ground: !airborne } }),
    ...(swim === undefined ? {} : { swim: { on: swim.on, velocity: swim.on ? [...velocity] : [0, 0, 0], diving: swim['diving'], climbTo: swim['climbTo'], climbCooldown: swim['climbCooldown'], stroke: swim['stroke'], stood: swim['stood'] } }) };
  const out: Record<string, unknown> = {};
  for (const key of V1_PLAYER_FIELDS) if (mapped[key] !== undefined) out[key] = mapped[key];
  return out;
}
/** A one-player snapshot's fields in the version 1 shape, in order: the form every recorded digest and checkpoint hash was
 *  taken in. Comparing there is what proves the version 3 engine reaches exactly the state version 1 did. A room keeps
 *  its `players`: no version 1 record of one exists. */
function versionOneFields(fields: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const players = fields['players'], out: Record<string, unknown> = {};
  if (!Array.isArray(players) || players.length !== 1) return { ...fields };
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'version' || key === 'apiVersion') out[key] = 1;
    else if (key === 'players') out['player'] = versionOnePlayer((players as readonly Record<string, unknown>[])[0] ?? {});
    else out[key] = value;
  }
  return out;
}
// The wire's number form: JSON.stringify would lose a -0.
function wireText(value: unknown): string {
  if (typeof value === 'number' && Object.is(value, -0)) return '-0';
  if (Array.isArray(value)) return `[${value.map(wireText).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}:${wireText(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
/** A one-player wire as the version 1 writer left it, byte for byte: what a witness records, so its checkpoints stay real
 *  version 1 saves that every continuation proof loads through the migration. */
export function simWireV1(wire: string): string {
  const { format, snapshot } = JSON.parse(wire) as { format: string; snapshot: Record<string, unknown> };
  return wireText({ format, version: 1, snapshot: versionOneFields(snapshot) });
}
/**
 * The sha256 of a snapshot in canonical form, a witness's continuation hash: every field but the physics bytes as JSON,
 * then the physics as restored world state, each value's exact float64 bits (so -0, NaN payloads and 1 ULP all count).
 */
export function canonicalSimDigest(snapshot: SimSnapshot | SimSnapshotBytes | string): string {
  const { physics, ...rest } = typeof snapshot === 'string' ? decodeSimSnapshot(snapshot) : snapshot;
  return createHash('sha256').update(JSON.stringify(versionOneFields(rest))).update('\0').update(new Uint8Array(Float64Array.from(physicsState(physics).values).buffer)).digest('hex');
}
