// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';
import { Ray } from 'three';
import { walkPhysicsLeg } from '../scripts/physics-walk.mjs';

const originalProbe = Object.getOwnPropertyDescriptor(window, '__wildshard');
afterEach(() => {
  vi.useRealTimers();
  if (originalProbe === undefined) Reflect.deleteProperty(window, '__wildshard');
  else Object.defineProperty(window, '__wildshard', originalProbe);
});

async function fixture(phase = 'preparing', issue: string | null = null) {
  vi.useFakeTimers();
  const position = { x: 0, y: 0.55, z: 0 };
  const grid = { crossing: { phase, issue, target: 'home' },
    live: { current: null as string | null, pending: ['home'], residents: [] as string[] } };
  let tick: ((dt: number) => void) | undefined, stopped = false;
  const player = { position, velocity: { y: 0, set: () => undefined }, yaw: 0, pitch: 0,
    spawn: (x: number, z: number) => { position.x = x; position.z = z; },
    waterSurfaceAt: () => null, motor: { result: { groundCollider: null }, snapshot: () => ({}) } };
  const physics = { R: { Ray, QueryFilterFlags: { EXCLUDE_SENSORS: 1 } },
    world: { castRay: () => null }, colliderTag: () => undefined };
  const world = { player, physics, animals: { update: () => undefined }, game: {
    app: { input: { clear: () => undefined, setHeld: () => undefined } },
    watchFrames: (run: (dt: number) => void) => { tick = run; return () => { stopped = true; }; },
  } };
  Object.defineProperty(window, '__wildshard', { configurable: true,
    value: { world, shard: { grid: { state: () => ({ live: grid }) } } } });
  const result = walkPhysicsLeg({ start: { x: 0, z: 0, y: 0.55, yaw: 0 }, waypoints: [{ x: 10, z: 0 }], timeout: 8 });
  await vi.advanceTimersByTimeAsync(600);
  return { result, position, grid, stopped: () => stopped,
    step: () => { if (tick === undefined) throw new Error('Missing walk callback'); tick(1); } };
}

test('a declared pending incoming world waits without skipping or moving to its waypoint', async () => {
  const f = await fixture();
  for (let i = 0; i < 6; i++) f.step();
  expect(f.position.x).toBe(0); expect(f.stopped()).toBe(false);
  f.grid.crossing.phase = 'settled'; f.grid.live.current = 'home';
  f.grid.live.pending = []; f.grid.live.residents = ['home']; f.position.x = 10;
  f.step(); f.step();
  expect(await f.result).toMatchObject({ stuck: [], complete: true, timedOut: false });
  expect(f.stopped()).toBe(true);
});

test.each(['ready', 'blocked', 'save-failed'])('a %s crossing retains the original physical snag refusal', async phase => {
  const f = await fixture(phase, phase === 'ready' ? null : 'refused');
  for (let i = 0; i < 5; i++) f.step();
  const result = await f.result;
  expect(result.stuck).toHaveLength(1);
  expect(result.stuck[0]).toMatchObject({ x: 0, grid: { crossing: { phase } } });
  expect(result).toMatchObject({ complete: false, timedOut: false });
  expect(f.position.x).toBe(0); // No fallback teleport across the grid's readiness fence.
  expect(f.stopped()).toBe(true);
});

test('an unending preparation hits the unchanged whole-leg deadline and cannot pass', async () => {
  const f = await fixture();
  for (let i = 0; i < 10; i++) f.step();
  expect(await f.result).toMatchObject({ stuck: [], complete: false, timedOut: true });
  expect(f.position.x).toBe(0); expect(f.stopped()).toBe(true);
});

test('a closed frame gate still reaches the same wall-clock deadline without more callbacks', async () => {
  const f = await fixture();
  await vi.advanceTimersByTimeAsync(8_000);
  expect(await f.result).toMatchObject({ trace: [], stuck: [], complete: false, timedOut: true });
  expect(f.stopped()).toBe(true);
});
