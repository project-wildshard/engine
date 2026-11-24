/**
 * Touchable props on a shard (meta SHARD-SOURCE SS9b, shard-format `props.bodies`). Each row is one Rapier dynamic
 * body in the host's world, in the ITEM group, so a player's capsule pushes it (the character motor applies impulses to
 * dynamic bodies) and every player sees the same crate move. Its pose is published as a script body under the row's id
 * (`script:<id>` on the wire, the channel a mover's panel already rides), and the page draws the named panel there.
 *
 *   installTouchBodies(host, shard.props?.bodies ?? [], ports.restoring)
 *
 * The bodies live in the physics world, so a save carries them in the world's own snapshot; this owner saves only each
 * row's body handle and rebinds them after the world is replaced on restore. A missing or changed body refuses.
 */
import { Euler, Quaternion } from 'three';
import { Bodies, Body, type BodySpec } from '@wildshard/engine/physics/bodies';
import { tagCollider } from '@wildshard/engine/physics/surface';
import { publishScriptBody, type ScriptNetView } from '@wildshard/engine/sim/shardRows';
import type { SimHost, SimValue } from '@wildshard/engine/sim';

/** One `props.bodies` row (shard-format SS9a). */
export interface TouchBodyRow {
  readonly id: string;
  readonly panel: string;
  readonly at: { readonly x: number; readonly y: number; readonly z: number };
  readonly yaw: number;
  readonly shape: BodySpec['shape'];
  readonly material: BodySpec['material'];
  readonly density?: number | undefined;
  readonly friction?: number | undefined;
  readonly restitution?: number | undefined;
  readonly linearDamping?: number | undefined;
  readonly angularDamping?: number | undefined;
  readonly keep?: boolean | undefined;
}

/** The installed bodies, by row id (null only between a restore and its world's reconnection). */
export interface TouchBodies {
  readonly body: (id: string) => Body | null;
  readonly view: (id: string) => ScriptNetView;
}

/** A body is the row's: its owner tag, so contacts and restores can name it. */
export interface TouchOwner { readonly kind: 'touch'; readonly id: string }

function specOf(row: TouchBodyRow): BodySpec {
  const owner: TouchOwner = { kind: 'touch', id: row.id };
  return { shape: row.shape, material: row.material, owner, group: 'ITEM', keep: row.keep ?? true,
    ...(row.density === undefined ? {} : { density: row.density }), ...(row.friction === undefined ? {} : { friction: row.friction }),
    ...(row.restitution === undefined ? {} : { restitution: row.restitution }),
    ...(row.linearDamping === undefined ? {} : { linearDamping: row.linearDamping }),
    ...(row.angularDamping === undefined ? {} : { angularDamping: row.angularDamping }) };
}

/** Install every row's body (none on a restore: the saved world brings them back) and publish their poses. */
export function installTouchBodies(host: SimHost, rows: readonly TouchBodyRow[], restoring = false): TouchBodies | null {
  if (rows.length === 0) return null;
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('Duplicate touchable body id');
  let service = new Bodies(host.physics, host.playerFocus, rows.length);
  const slots = new Map<string, Body | null>();
  for (const row of rows) {
    if (restoring) { slots.set(row.id, null); continue; }
    const half = row.yaw / 2;
    slots.set(row.id, service.spawn(specOf(row), row.at, undefined, { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) }));
  }
  let pending: Readonly<Record<string, number>> | null = null;
  const rebind = (handles: Readonly<Record<string, number>>): void => {
    const world = host.physics.world;
    service.list.length = 0;
    for (const row of rows) {
      const handle = handles[row.id];
      if (handle === undefined || !world.bodies.contains(handle)) throw new Error(`Touchable body ${row.id} missing from the restored world`);
      const rb = world.getRigidBody(handle);
      if (rb.numColliders() !== 1 || !rb.isDynamic()) throw new Error(`Touchable body ${row.id} changed in the restored world`);
      const collider = rb.collider(0), spec = specOf(row);
      tagCollider(collider, spec.material, spec.owner);
      const body = new Body(rb, collider, spec, 0);
      service.list.push(body); slots.set(row.id, body);
    }
  };
  host.onStep('props.touch', (dt) => { service.post(dt); service.pre(dt); }, {
    snapshot: (): SimValue => Object.fromEntries(rows.map(row => [row.id, slots.get(row.id)?.rb.handle ?? -1])),
    restore: (value: SimValue) => {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid touchable body continuation');
      const handles: Record<string, number> = {};
      for (const row of rows) {
        const handle = value[row.id];
        if (typeof handle !== 'number' || !Number.isInteger(handle) || handle < 0) throw new Error(`Invalid touchable body handle ${row.id}`);
        handles[row.id] = handle;
      }
      if (Object.keys(value).length !== rows.length) throw new Error('Unknown touchable body in continuation');
      pending = handles;
    },
    physicsRestored: () => {
      if (pending === null) throw new Error('Missing touchable body continuation');
      // the restore replaced host.physics: the service steps the new world's bodies (as the native roster does)
      service = new Bodies(host.physics, host.playerFocus, rows.length);
      rebind(pending); pending = null;
    },
  });
  const q = new Quaternion(), euler = new Euler(0, 0, 0, 'YXZ');
  const view = (id: string): ScriptNetView => {
    const body = slots.get(id);
    if (body === undefined) throw new Error(`Unknown touchable body ${id}`);
    if (body === null || !body.alive) return { position: { x: 0, y: 0, z: 0 }, euler: { x: 0, y: 0, z: 0 }, enabled: false };
    const t = body.rb.translation(), r = body.rb.rotation();
    euler.setFromQuaternion(q.set(r.x, r.y, r.z, r.w), 'YXZ');
    return { position: { x: t.x, y: t.y, z: t.z }, euler: { x: euler.x, y: euler.y, z: euler.z }, enabled: true };
  };
  for (const row of rows) publishScriptBody(host, row.id, () => view(row.id));
  return { body: (id) => slots.get(id) ?? null, view };
}
