// oxlint-disable-next-line import/no-nodejs-modules -- Exercise shipped Rapier and real saved worlds.
import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import { Physics } from '../src/shared/engine/physics/Physics';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { CharacterMotor, PLAYER_BODY, PLAYER_CAPSULE } from '../src/shared/engine/physics/CharacterMotor';
import { gridCreatureConstraint, installGridBorders } from '../src/shared/engine/physics/gridBorders';
import { CHUNK_HALF } from '../src/shared/engine/core/config';

let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });

test('home walls reinstall without duplicating live or restored physics colliders', () => {
  const scope = new Scope('home-border'), physics = new Physics(rapier, undefined, scope);
  const otherScope = new Scope('restored-border'); let restored: Physics | undefined;
  try {
    installGridBorders(physics, scope); physics.step();
    expect(physics.world.colliders.len()).toBe(4);
    installGridBorders(physics, scope);
    expect(physics.world.colliders.len()).toBe(4);
    restored = new Physics(rapier, physics.snapshot(), otherScope);
    installGridBorders(restored, otherScope);
    expect(restored.world.colliders.len()).toBe(4);
  } finally { scope.dispose(); otherScope.dispose(); physics.dispose(); restored?.dispose(); }
});

test.each([[1, 0], [-1, 0], [0, 1], [0, -1]])('edge %s,%s holds a creature and analytic flier while players and mounted motors pass', (x, z) => {
  const scope = new Scope('home-physics'), physics = new Physics(rapier, undefined, scope);
  try {
    installGridBorders(physics, scope); physics.step();
    for (const mode of ['creature', 'player', 'mounted'] as const) {
      const motor = new CharacterMotor(physics, { ...PLAYER_CAPSULE, ...PLAYER_BODY, group: mode === 'player' ? 'PLAYER' : 'CREATURE' });
      const feet = { x: x * (CHUNK_HALF - 2), y: 1, z: z * (CHUNK_HALF - 2) };
      try {
        if (mode === 'mounted') motor.passThrough(['BORDER']);
        motor.resetAt(feet);
        for (let tick = 0; tick < 100; tick++) { physics.step(); motor.move(feet, { x: x * .2, y: 0, z: z * .2 }); }
        const distance = feet.x * x + feet.z * z;
        if (mode === 'creature') expect(distance).toBeLessThan(CHUNK_HALF);
        else expect(distance).toBeGreaterThan(CHUNK_HALF + 10);
      } finally { motor.dispose(); }
    }
    const from = { x: x * (CHUNK_HALF - 2), y: 100, z: z * (CHUNK_HALF - 2) }, to = { x: x * (CHUNK_HALF + 20), y: 100, z: z * (CHUNK_HALF + 20) };
    gridCreatureConstraint(() => physics, .38)(from, to);
    expect(to.x * x + to.z * z).toBeLessThan(CHUNK_HALF);
  } finally { scope.dispose(); physics.dispose(); }
});
