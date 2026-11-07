import { BoxGeometry } from 'three';
import { expect, test } from 'vitest';
import { encodeMeshCollision } from '@wildshard/format/meshCollisionBytes';
import { fixtureBytes } from '@wildshard/engine/test/nativeBytes';
import { Scope } from '../app/scope';
import { CharacterMotor, PLAYER_BODY } from './CharacterMotor';
import { Physics } from './Physics';
import { groups } from './groups';
import { installBakedMeshColliders } from './meshCollision';
import { loadRapier } from './rapier';
import { isTerrainCollider, tagCollider, tagOf } from './surface';
import { TransferWalls } from './transferWalls';

const options = { radius: .38, height: 1.7, step: .35, maxClimbDeg: 40, snap: .3, ...PLAYER_BODY };
async function fixture() {
  const rapier = await loadRapier(Uint8Array.from(fixtureBytes(new URL('../../../../public/assets/physics/rapier.wasm', import.meta.url))));
  return { physics: new Physics(rapier), scope: new Scope('mesh-board') };
}

for (const restored of [false, true]) for (const hover of [false, true]) test(`${hover ? 'board' : 'walk'} stops at ${restored ? 'restored' : 'fresh'} structural collision mesh`, async () => {
  let { physics, scope } = await fixture();
  const geometry = new BoxGeometry(.4, 4, 6).translate(0, 2, 0);
  const index = geometry.getIndex(); if (index === null) throw new Error('Fixture needs indexed wall');
  const bytes = encodeMeshCollision({ vertices: Float32Array.from(geometry.getAttribute('position').array), indices: Uint32Array.from(index.array) });
  const rows = [{ id: 'house-wall', bytes, initialActive: true }];
  let colliders = installBakedMeshColliders(rows, physics, scope);
  if (restored) {
    const saved = new Map([...colliders].map(([id, port]) => [id, port.snapshot()]));
    const snapshot = physics.snapshot(), rapier = physics.R;
    scope.dispose(); physics.dispose();
    physics = new Physics(rapier, snapshot); scope = new Scope('restored-mesh-board');
    colliders = installBakedMeshColliders(rows, physics, scope, saved);
    colliders.get('house-wall')?.restore(saved.get('house-wall') ?? { handles: [] });
    // Generic saved-tag replay must derive the same classification without a new wire field.
    physics.world.forEachCollider(collider => tagCollider(collider, 'ground', 'house-wall'));
  }
  const motor = new CharacterMotor(physics, options), feet = { x: -2, y: .45, z: 0 };
  try {
    for (let tick = 0; tick < 60; tick++) { physics.step(); motor.move(feet, { x: .1, y: 0, z: 0 }, hover); }
    expect(feet.x).toBeLessThan(-.5);
    expect(feet.x).toBeGreaterThan(-1);
    expect(colliders.get('house-wall')?.active()).toBe(true);
    expect(physics.world.colliders.len()).toBe(2);
  } finally { motor.dispose(); scope.dispose(); physics.dispose(); geometry.dispose(); }
});

test('board movement still ignores the actual terrain heightfield', async () => {
  const { physics, scope } = await fixture();
  const ground = physics.world.createCollider(physics.R.ColliderDesc.heightfield(2, 2,
    Float32Array.of(0, 0, 0, 2, 2, 2, 4, 4, 4), { x: 12, y: 1, z: 12 }).setCollisionGroups(groups('WORLD')));
  tagCollider(ground, 'ground');
  const motor = new CharacterMotor(physics, options), feet = { x: -2, y: .45, z: 0 };
  try {
    for (let tick = 0; tick < 60; tick++) { physics.step(); motor.move(feet, { x: .1, y: 0, z: 0 }, true); }
    expect(feet.x).toBeGreaterThan(3.9);
    expect(feet.y).toBe(.45);
  } finally { motor.dispose(); scope.dispose(); physics.dispose(); }
});


test('board transfer fence reaches the entry trigger with the unchanged edge filter', async () => {
  const { physics, scope } = await fixture();
  const walls = new TransferWalls(() => physics, [{ x: -562.5, z: -562.5 }], .38, 'entry', scope);
  const motor = new CharacterMotor(physics, options), feet = { x: -562.5, y: .45, z: -281.25 };
  try {
    for (const handle of walls.snapshot()) {
      const collider = physics.world.getCollider(handle);
      expect(tagOf(collider)?.material).toBe('edge');
      // The previous ground-tag predicate and G721's terrain predicate both
      // include this permanent fence. It must not become a board bypass.
      expect(tagOf(collider)?.material !== 'ground').toBe(!isTerrainCollider(collider));
    }
    for (let tick = 0; tick < 120; tick++) { physics.step(); motor.move(feet, { x: 0, y: 0, z: -.5 }, true); }
    expect(feet.z).toBeCloseTo(-306.515, 2);
    expect(Math.abs(feet.z + 562.5) - 250).toBeLessThan(6);
    expect(motor.result.horizontalFreedom).toBeLessThan(.01);
  } finally { motor.dispose(); scope.dispose(); physics.dispose(); }
});
