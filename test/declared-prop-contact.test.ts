// ONE-FORMAT OF22a3: a prop solid's capsule, contact material, friction and groups reach its Rapier collider; a solid that
// names none keeps the world's (groups('WORLD'), friction 0.5), even after a solid with its own on a reused box descriptor.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { parse } from 'valibot';
import { PropsSchema } from '@wildshard/format/props';
import { Scope } from '../src/shared/engine/app/scope';
import { installDeclaredPropColliders } from '../src/shared/engine/physics/declaredProps';
import { groups } from '../src/shared/engine/physics/groups';
import { Physics } from '../src/shared/engine/physics/Physics';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { tagOf } from '../src/shared/engine/physics/surface';
import { propColliderDescriptors } from '../src/shared/game/shardfile/props';

const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
const props = parse(PropsSchema, { version: 1, family: 'island', tiles: [], panels: [], models: [], far: null, textures: [],
  colliders: [{ id: 'piece.palms', panel: null, initialActive: true, shapes: [
    { kind: 'capsule', x: 12, y: 3.5, z: -40, halfHeight: 3, radius: 0.35, surface: 'wood', friction: 0.8, groups: 65_537 },
    { kind: 'box', x: 4, y: 0.1, z: 9, hx: 1, hy: 0.1, hz: 3, surface: 'ground', friction: 0.9 },
    { kind: 'box', x: 8, y: 0.1, z: 9, hx: 1, hy: 0.1, hz: 3, surface: 'planks' },
  ] }] });

test('a declared capsule keeps its material, friction and groups; a plain solid keeps the world\'s', () => {
  const physics = new Physics(rapier), scope = new Scope('declared-contact');
  try {
    const port = installDeclaredPropColliders(propColliderDescriptors(props), physics, scope).get('piece.palms');
    if (port === undefined) throw new Error('Missing declared port');
    const [trunk, path, deck] = port.snapshot().handles.map(handle => physics.world.getCollider(handle));
    if (trunk === undefined || path === undefined || deck === undefined) throw new Error('Missing declared solids');
    expect(trunk.shapeType()).toBe(rapier.ShapeType.Capsule);
    expect([trunk.halfHeight(), trunk.radius()]).toEqual([3, expect.closeTo(0.35, 6)]);
    expect([trunk.friction(), trunk.collisionGroups()]).toEqual([expect.closeTo(0.8, 6), 65_537]);
    expect(tagOf(trunk)).toEqual({ owner: 'piece.palms', material: 'wood' });
    expect([path.friction(), path.collisionGroups(), tagOf(path)?.material]).toEqual([expect.closeTo(0.9, 6), groups('WORLD'), 'ground']);
    expect([deck.friction(), deck.collisionGroups(), tagOf(deck)?.material]).toEqual([0.5, groups('WORLD'), 'planks']);
  } finally { scope.dispose(); physics.dispose(); }
});
