import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { parse } from 'valibot';
import { PropsSchema } from '@wildshard/format/props';
import { Scope } from '../src/shared/engine/app/scope';
import { installDeclaredPropColliders } from '../src/shared/engine/physics/declaredProps';
import { NearColliders } from '../src/shared/engine/physics/nearColliders';
import { Physics } from '../src/shared/engine/physics/Physics';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { tagOf } from '../src/shared/engine/physics/surface';
import { propColliderDescriptors } from '../src/shared/game/shardfile/props';

const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
const props = parse(PropsSchema, { version: 1, family: 'scene', tiles: [], panels: [], models: [], far: null, textures: [],
  colliders: [{ id: 'banyan.paifang', panel: null, initialActive: false, shapes: [{
    kind: 'hull', x: 18.4, y: 125, z: -22.6, yaw: Math.PI / 4, surface: 'stone',
    points: [0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 2],
  }] }] });

test.each([false, true])('declared prop installs a posed, mutable convex solid with near mode %s', near => {
  const physics = new Physics(rapier), scope = new Scope('declared-hull');
  if (near) physics.near = new NearColliders();
  try {
    const port = installDeclaredPropColliders(propColliderDescriptors(props), physics, scope).get('banyan.paifang');
    if (port === undefined) throw new Error('Missing declared hull port');
    const [handle] = port.snapshot().handles;
    if (handle === undefined) throw new Error('Missing declared hull handle');
    const collider = physics.world.getCollider(handle);
    expect(collider.shapeType()).toBe(rapier.ShapeType.ConvexPolyhedron);
    expect(collider.translation().y).toBe(125);
    expect(collider.rotation().y).toBeCloseTo(Math.sin(Math.PI / 8));
    expect(tagOf(collider)).toEqual({ owner: 'banyan.paifang', material: 'stone' });
    expect(port.active()).toBe(false);
    port.setActive(true);
    expect(collider.isEnabled()).toBe(true);
    scope.dispose();
    expect(physics.world.colliders.contains(handle)).toBe(false);
  } finally { scope.dispose(); physics.dispose(); }
});
