// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the boundary on shipped native collision bytes.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { arenaBoundary } from './arenaAnswers';
import { CharacterMotor, PLAYER_BODY, PLAYER_CAPSULE } from '@wildshard/engine/physics/CharacterMotor';
import { Physics } from '@wildshard/engine/physics/Physics';
import { loadRapier } from '@wildshard/engine/physics/rapier';
import { addTerrain } from '@wildshard/engine/physics/terrain';
import { groups } from '@wildshard/engine/physics/groups';

const lines = { tie: 'tie', tieOnFoot: 'foot', tieQuiet: 'quiet' }, record = { kind: 'heart', variant: 'storm' };
for (const wall of [false, true]) test(`the arena holds a player through rising terrain${wall ? ' and a wall' : ''} and restores exactly`, async () => {
  const R = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))), physics = new Physics(R);
  // A 1:4 rising plane: the old X/Z assignment buried the capsule by half a metre.
  addTerrain(physics, Float32Array.from([-2.5, 2.5, -2.5, 2.5]), 2, 20);
  if (wall) physics.world.createCollider(R.ColliderDesc.cuboid(.1, 3, 5).setTranslation(1, 1, 0).setCollisionGroups(groups('WORLD')));
  const opts = { ...PLAYER_CAPSULE, ...PLAYER_BODY }, motor = new CharacterMotor(physics, opts), player = { x: 0, y: .05, z: 0 };
  let restored: Physics | undefined, resumed: CharacterMotor | undefined;
  const hold = (body: CharacterMotor, feet: typeof player): void => arenaBoundary({ x: 2, z: 0 }, lines, record, {
    player: feet, motor: body, boss: { arm: () => undefined, disarm: () => undefined }, fight: { tied: true },
    prompt: { radius: 0, label: '' }, toast: () => undefined, wall: () => undefined, clear: () => undefined,
    persistence: { kill: () => undefined, feat: () => undefined },
  });
  try {
    physics.step(); motor.move(player, { x: 0, y: -.03, z: 0 });
    hold(motor, player);
    expect(player.y).toBeGreaterThanOrEqual(player.x / 4);
    if (wall) { expect(player.x).toBeGreaterThan(0); expect(player.x).toBeLessThan(.55); }
    else { expect(player.x).toBeGreaterThan(1.8); expect(player.y).toBeGreaterThan(.45); }
    const saved = physics.world.takeSnapshot(), state = motor.snapshot(), feet = { ...player };
    restored = new Physics(R, saved); resumed = new CharacterMotor(restored, opts, state);
    expect(restored.world.takeSnapshot()).toEqual(saved);
    for (let tick = 0; tick < 5; tick++) {
      physics.step(); restored.step(); hold(motor, player); hold(resumed, feet);
      expect(feet).toEqual(player); expect(resumed.snapshot()).toEqual(motor.snapshot());
      expect(restored.world.takeSnapshot()).toEqual(physics.world.takeSnapshot());
      expect(player.y).toBeGreaterThanOrEqual(player.x / 4);
    }
  } finally { resumed?.dispose(); restored?.dispose(); motor.dispose(); physics.dispose(); }
});
