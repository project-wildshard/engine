// @vitest-environment happy-dom
import type { NetCommand } from '@wildshard/wire/netCommand';
import { beforeAll, expect, test } from 'vitest';
import type { Rapier } from '../src/shared/engine/physics/rapier';
import { HostSide, loadCourseRapier, POOL_X, type MotionScenario } from './fixtures/motion-trace/parity';
import { wirePlay } from './fixtures/motion-trace/wirePlay';

// P1-E5.3-I2: on a clean wire a journey is corrected nowhere, and the server lands where a plain SimHost does on the same tape.
// `net-ride.test.ts` is its ride and `net-weapon-wire.test.ts` its swing: each needs its own world.
let R: Rapier;
beforeAll(async () => { R = await loadCourseRapier(); });

const WEST = Math.PI / 2;
const journey: MotionScenario = { id: 'clean-journey', start: { x: POOL_X + 10, z: 8, yaw: WEST }, ticks: 0, intent: () => ({}) };
const press = (frame: number, page: Parameters<NonNullable<Parameters<typeof wirePlay>[2]['press']>>[1]): void => {
  const { player } = page;
  if (frame === 0) player.keys.add('KeyW');
  if (frame === 20) player.touchJump = true;
  if (frame === 50) player.touchDodge = true;
  if (frame === 400) player.setHover(true);
  if (frame === 520) player.setHover(false);
};

test.each([['60 frames/s', () => 1000 / 60, 720], ['30 frames/s', () => 1000 / 30, 360]] as const)('%s: walk, jump, dodge, swim and board', (_name, frameMs, frames) => {
  const run = wirePlay(R, journey, { seconds: frames * frameMs() / 1000, frameMs, press: (frame, page) => { press(frame * 720 / frames, page); } });
  expect([...run.seen].sort()).toEqual(['air', 'board', 'dodge', 'swim']);
  expect(run.steps).toBe(run.sent);
  expect(run.corrections).toBe(0);
  expect(run.feetGap).toBeLessThan(.02);
  // the same tape, on a host with no wire
  const plain = new HostSide(R, journey);
  try {
    for (const command of run.commands) plain.host.step(new Map<string, NetCommand>([[plain.player.id, command]]));
    expect(plain.player.position.distanceTo({ x: run.feet[0], y: run.feet[1], z: run.feet[2] })).toBeLessThan(.02);
  } finally { plain.dispose(); }
});
