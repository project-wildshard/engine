/**
 * Touchable props on the page (meta SHARD-SOURCE SS9c, shard-format `props.bodies`). The server keeps each row as a dynamic
 * body (`server/game/shardfile/touchBodies.ts`) and the wire poses it as the row's `script:` body, the channel a mover rides.
 * Here each row gets a kinematic stand-in (the WORLD group, as every kinematic prop) in the page's or the cell's physics,
 * so the feet stand on the crate and meet it where the server has it, and its named props panel is drawn at the wire's
 * pose. Prediction only: the server's body is the law, and the page never pushes it.
 */
import { Euler, Quaternion, type Object3D } from 'three';
import type { Scope } from '@wildshard/engine/app/scope';
import type { Physics } from '@wildshard/engine/physics/Physics';
import type { MoverPose } from '@wildshard/engine/physics/mover';
import { groups } from '@wildshard/engine/physics/groups';
import { tagCollider } from '@wildshard/engine/physics/surface';
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { MoverView } from '../plugin/followedMovers';
import { moverLookKey, wirePage } from './wirePage';
import { moverPanelPose } from '../grid/neighbourPanels';

type Row = NonNullable<NonNullable<Shardfile['props']>['bodies']>[number];

/** A row's rest as a mover's: its seat and its yaw (the panel is drawn baked there). */
export function touchRest(row: Row): { readonly at: Row['at']; readonly euler: { readonly x: number; readonly y: number; readonly z: number } } {
  return { at: row.at, euler: { x: 0, y: row.yaw, z: 0 } };
}

/** One row's kinematic stand-in in `physics`, at rest until the wire poses it; it leaves with `scope`. */
export function touchCollider(physics: Physics, scope: Scope, row: Row): (pose: MoverPose) => void {
  const { R, world } = physics, half = row.yaw / 2;
  const rb = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(row.at.x, row.at.y, row.at.z)
    .setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) }));
  const s = row.shape;
  const shape = 'ball' in s ? R.ColliderDesc.ball(s.ball) : 'cylinder' in s ? R.ColliderDesc.cylinder(s.cylinder.halfHeight, s.cylinder.radius)
    : R.ColliderDesc.cuboid(s.cuboid.x, s.cuboid.y, s.cuboid.z);
  const collider = world.createCollider(shape.setCollisionGroups(groups('WORLD')), rb);
  tagCollider(collider, row.material, { kind: 'touch', id: row.id });
  scope.onDispose(() => { if (world.bodies.contains(rb.handle)) world.removeRigidBody(rb); });
  const q = new Quaternion(), euler = new Euler(0, 0, 0, 'YXZ');
  return (pose) => {
    rb.setNextKinematicTranslation(pose.position);
    q.setFromEuler(euler.set(pose.euler.x, pose.euler.y, pose.euler.z, 'YXZ'));
    rb.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
  };
}

/** A one-shard page's touchable props: each row's stand-in in the page's physics and its panel, posed off the wire. */
export function installDataPageBodies(source: Pick<Shardfile, 'props'>, page: { readonly physics: Physics; readonly scope: Scope; readonly panels?: ReadonlyMap<string, Object3D> }): number {
  const rows = source.props?.bodies ?? [];
  for (const row of rows) {
    const follow = touchCollider(page.physics, page.scope, row), panel = page.panels?.get(row.panel);
    const look = panel === undefined ? undefined : moverPanelPose(panel, touchRest(row));
    const view: MoverView = { pose: (pose) => { wirePage.posed++; follow(pose); look?.(pose); } };
    wirePage.movers.set(row.id, view);
    page.scope.onDispose(() => { if (wirePage.movers.get(row.id) === view) wirePage.movers.delete(row.id); });
  }
  return rows.length;
}

/** A grid cell's touchable props: their stand-ins in the cell's physics, taking the wire once the feet enter the cell (a
 *  row names its body by id alone, and two copies of one product share ids). The cell's drawn panel is its look
 *  (`neighbourPanels.ts` keys it by `moverLookKey`). */
export function installDataCellBodies(source: Pick<Shardfile, 'props'>, region: { readonly physics: Physics; readonly scope: Scope }, instance: string): { readonly claim: () => void } | null {
  const rows = source.props?.bodies ?? [];
  if (rows.length === 0) return null;
  const views = rows.map(row => {
    const follow = touchCollider(region.physics, region.scope, row), key = moverLookKey(instance, row.id);
    const view: MoverView = { pose: (pose, fields) => { wirePage.posed++; follow(pose); wirePage.moverLooks.get(key)?.pose(pose, fields); } };
    region.scope.onDispose(() => {
      if (wirePage.movers.get(row.id) !== view) return;
      const drawn = wirePage.moverLooks.get(key);
      if (drawn === undefined) wirePage.movers.delete(row.id); else wirePage.movers.set(row.id, drawn);
    });
    return { id: row.id, view };
  });
  return { claim: () => {
    if (region.scope.disposed || region.scope.disposing) return;
    for (const { id, view } of views) wirePage.movers.set(id, view);
  } };
}
