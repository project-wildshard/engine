// @vitest-environment happy-dom
// oxlint-disable-next-line import/no-nodejs-modules -- Read the immutable Far Reach bake through its shipping collider installer.
import { readFileSync } from 'node:fs';
import { beforeAll, expect, test, vi } from 'vitest';
import { addBakedPieces } from '../src/server/game/plugin/simulation';
import { CharacterMotor, PLAYER_BODY, PLAYER_CAPSULE } from '../src/shared/engine/physics/CharacterMotor';
import { Physics } from '../src/shared/engine/physics/Physics';
import { groups } from '../src/shared/engine/physics/groups';
import type { Rapier } from '../src/shared/engine/physics/rapier';
import { loadCourseRapier } from './fixtures/motion-trace/parity';
import { wirePlay } from './fixtures/motion-trace/wirePlay';

interface Piece {
  readonly id: string;
  readonly colliders: readonly unknown[];
}

let rapier: Rapier;
let saved: readonly Piece[];
let bridge: readonly Piece[];
beforeAll(async () => {
  rapier = await loadCourseRapier();
  const data = JSON.parse(readFileSync('out/far-reach/sections/sim/runtime-plan.json', 'utf8')) as { baked: { pieces: Piece[] } };
  saved = data.baked.pieces;
  bridge = saved.filter(row => ['far.windmill', 'far.isle.windmill', 'far.isle.sunrest', 'far.rope.windmill'].includes(row.id));
});

const spots = [
  { id: 'windmill drum step', start: { x: -2.7, y: 30.45, z: -67.3, yaw: -Math.PI / 9 } },
  { id: 'north bridge seam', start: { x: 0.074, y: 28.8, z: -27, yaw: 0 } },
  { id: 'south bridge seam', start: { x: -0.074, y: 29.7, z: -45, yaw: Math.PI } },
] as const;

test.each(spots)('Far Reach at 180 ms: $id', spot => {
  const reverse = [...saved].reverse().map(piece => ({...piece, colliders: [...piece.colliders].reverse()}));
  const shifted = [...saved.slice(4), ...saved.slice(0, 4)];
  const reports = [saved, reverse, shifted].map(rows => wirePlay(rapier, { ...spot, ticks: 0, dry: true, intent: () => ({}) }, {
    seconds: 7, liveDevice: true, frameMs: () => 1000 / 60,
    link: { latencyMs: 90, jitterMs: 0, lossPct: 0, reorderPct: 0, random: () => 0.5 },
    press: (frame, page, host) => {
      if (frame === 0) {
        addBakedPieces(page.physics, saved);
        addBakedPieces(host.host.physics, rows);
      }
      if (frame === 20) page.player.keys.add('KeyW');
      if (frame === 110) page.player.keys.delete('KeyW');
    },
  }));
  for (const result of reports) {
    expect(result.steps).toBe(result.sent);
    expect(result.corrections).toBe(0);
    expect(result.feetGap).toBeLessThan(0.02);
    expect(result.feet[1]).toBeGreaterThan(28);
  }
});

test.each([
  { id: 'north bridge seam', at: [0, 28.55, -27.3], heading: -3 * Math.PI / 4 },
  { id: 'south bridge seam', at: [-0.074, 29.6, -45.2], heading: Math.PI / 6 },
])('a capsule restarted at the $id recovers consistently across collider orders', ({ at, heading }) => {
  const reversed = [...bridge].reverse().map(piece => ({ ...piece, colliders: [...piece.colliders].reverse() }));
  const alt = [...bridge.slice(2), ...bridge.slice(0, 2)];
  const [x = 0, y = 0, z = 0] = at;
  const [base, ...other] = [bridge, reversed, alt].map(order => {
    const physics = new Physics(rapier);
    addBakedPieces(physics, order);
    const motor = new CharacterMotor(physics, { ...PLAYER_BODY, ...PLAYER_CAPSULE });
    const feet = { x, y, z };
    motor.resetAt(feet);
    try {
      return Array.from({ length: 85 }, (_, tick) => {
        physics.step();
        const speed = tick < 5 ? 0 : 5 / 60;
        const { grounded } = motor.move(feet, { x: speed * Math.sin(heading), y: -22 / 3600, z: -speed * Math.cos(heading) });
        return { ...feet, grounded };
      });
    } finally { motor.dispose(); physics.dispose(); }
  });
  if (base === undefined) throw new Error('Missing original collider order');
  expect(base.filter(feet => feet.grounded).length).toBeGreaterThan(60);
  expect(base.some(feet => Math.abs(feet.z - z) > 0.5)).toBe(true);
  for (const trace of other) {
    const worst = Math.max(...base.map((feet, tick) => {
      const moved = trace[tick];
      if (moved === undefined) throw new Error('Missing reordered step');
      return Math.hypot(feet.x - moved.x, feet.y - moved.y, feet.z - moved.z);
    }));
    expect(worst).toBeLessThan(0.02);
  }
});

test('the bridge retry respects a low beam over the sloped railing', () => {
  const physics = new Physics(rapier);
  addBakedPieces(physics, bridge);
  const bottom = 30.47, halfHeight = 0.03;
  const beam = physics.world.createCollider(rapier.ColliderDesc.cuboid(0.38, halfHeight, 0.55)
    .setTranslation(-0.84, bottom + halfHeight, -26.2).setCollisionGroups(groups('WORLD')));
  const motor = new CharacterMotor(physics, { ...PLAYER_BODY, ...PLAYER_CAPSULE });
  const shapeCasts = vi.spyOn(physics.world, 'castShape');
  const feet = { x: 0, y: 28.55, z: -27.3 };
  try {
    motor.resetAt(feet);
    for (let tick = 0; tick < 40; tick++) {
      physics.step();
      const side = tick < 5 ? 0 : 5 / (60 * Math.SQRT2);
      motor.move(feet, { x: -side, y: -22 / 3600, z: side });
    }
    expect(shapeCasts.mock.results.some(cast => cast.type === 'return' && cast.value?.collider.handle === beam.handle)).toBe(true);
    expect(feet.y + PLAYER_CAPSULE.height).toBeLessThan(bottom);
    expect(feet.z).toBeGreaterThan(-26.7);
  } finally { shapeCasts.mockRestore(); motor.dispose(); physics.dispose(); }
});
