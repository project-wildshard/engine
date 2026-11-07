// @vitest-environment happy-dom
// oxlint-disable-next-line import/no-nodejs-modules -- Count collections around a tight loop.
import { PerformanceObserver } from 'node:perf_hooks';
import { beforeAll, expect, test } from 'vitest';
import type { CharacterMotor } from '../src/shared/engine/physics/CharacterMotor';
import type { Rapier } from '../src/shared/engine/physics/rapier';
import { legacyDouble } from '../src/test/engine/FakeGame';
import { captureMotion, createMotionState, MOTION_WORDS, restoreMotion } from '../src/shared/engine/player/motionState';
import type { PlayerMotionState } from '../src/shared/engine/player/motion';
import { DECK, HILL_X, loadCourseRapier, PageSide, terrainHeight, type MotionIntent, type MotionScenario } from './fixtures/motion-trace/parity';

// P1-E5.3-C1: the step's state is plain data. A capture and a restore put a real Player back exactly, on the two states
// the plain fields alone do not hold: mid-slide, where the step reads the motor's last ground, and on a deck, where it reads
// the pinned anchor.

let R: Rapier;
beforeAll(async () => { R = await loadCourseRapier(); });

const scenario = (id: string, start: MotionScenario['start']): MotionScenario => ({ id, start, ticks: 0, intent: () => ({}) });
const still: MotionIntent = {};

/** From `at`, run `ticks`, restore, and run them again: the second pass must be the first, bit for bit. */
function replays(page: PageSide, at: number, ticks: number, intent: (tick: number) => MotionIntent): void {
  const { player, course } = page, state = player.motionState, saved = new Float64Array(MOTION_WORDS), trace = new Float64Array(ticks * MOTION_WORDS), again = new Float64Array(MOTION_WORDS);
  captureMotion(state, player.motor, saved);
  for (let tick = 0; tick < ticks; tick++) { page.tick(at + tick + 1, intent(tick)); captureMotion(state, player.motor, trace, tick * MOTION_WORDS); }
  restoreMotion(state, player.motor, saved);
  // the world goes back to the capture's tick, as C5's movers read the predicted tick
  course.advance(at); page.stepWorld();
  for (let tick = 0; tick < ticks; tick++) {
    page.tick(at + tick + 1, intent(tick)); captureMotion(state, player.motor, again);
    expect([...again]).toEqual([...trace.subarray(tick * MOTION_WORDS, (tick + 1) * MOTION_WORDS)]);
  }
}

test('a capture replays mid-slide, where the step reads the motor\'s last ground', () => {
  const x = HILL_X + 2.4, page = new PageSide(R, scenario('slide', { x, y: terrainHeight(x, 0), z: 0, yaw: -Math.PI / 2 }));
  try {
    let tick = 0;
    while (!page.player.sliding || tick < 4) { page.tick(tick++, still); if (tick > 60) throw new Error('Never slid'); }
    expect(page.player.motor.result.groundNormalY).toBeLessThan(.6);
    replays(page, tick - 1, 40, () => still);
  } finally { page.dispose(); }
});

test('a capture replays on a moving deck, where the step reads the pinned anchor', () => {
  const page = new PageSide(R, scenario('deck', { x: DECK.x, y: DECK.y + .1, z: DECK.z, yaw: 0 }));
  try {
    for (let tick = 0; tick < 30; tick++) page.tick(tick, still);
    expect(page.player.motor.result.groundCollider?.parent()?.isKinematic()).toBe(true);
    replays(page, 29, 60, tick => tick < 30 ? { keyX: 1 } : still);
  } finally { page.dispose(); }
});

test('a body the world dropped is let go', () => {
  const page = new PageSide(R, scenario('gone', { x: DECK.x, y: DECK.y + .1, z: DECK.z, yaw: 0 }));
  try {
    for (let tick = 0; tick < 30; tick++) page.tick(tick, still);
    const { player } = page, saved = new Float64Array(MOTION_WORDS), own = player.motor, ground = own.result.groundCollider;
    if (ground === null) throw new Error('Not on the deck');
    captureMotion(player.motionState, own, saved);
    own.resetAt(player.position);
    page.physics.world.removeCollider(ground, false);
    restoreMotion(player.motionState, own, saved);
    expect(own.result.groundCollider).toBeNull();
  } finally { page.dispose(); }
});

/** Every leaf of the state, as a path. */
function leaves(value: object, at: readonly string[] = []): (readonly string[])[] {
  return Object.entries(value).flatMap(([key, entry]: [string, unknown]) => {
    const path = [...at, key];
    return typeof entry === 'object' && entry !== null ? leaves(entry, path) : [path];
  });
}
const motor = legacyDouble<CharacterMotor>({ captureState: () => undefined, restoreState: () => undefined });
/** Write through a leaf's path. Only a test walks the state by name. */
function poke(state: PlayerMotionState, path: readonly string[]): void {
  const last = path.at(-1);
  if (last === undefined) throw new Error('Empty path');
  let owner: object = state;
  for (const key of path.slice(0, -1)) {
    const next: unknown = Reflect.get(owner, key);
    if (typeof next !== 'object' || next === null) throw new Error(`No object at ${key}`);
    owner = next;
  }
  const value: unknown = Reflect.get(owner, last);
  Reflect.set(owner, last, typeof value === 'boolean' ? !value : typeof value === 'number' && Number.isFinite(value) ? value + 1 : 7);
}

test('every field of the state has its word, so a new one cannot go unsaved', () => {
  const paths = leaves(createMotionState());
  const words = (state: PlayerMotionState): readonly number[] => { const out = new Float64Array(MOTION_WORDS); captureMotion(state, motor, out); return [...out]; };
  expect(paths.length).toBeGreaterThan(30);
  for (const path of paths) {
    const state = createMotionState(), before = words(state);
    poke(state, path);
    expect(words(state), path.join('.')).not.toEqual(before);
    const fresh = createMotionState(), out = new Float64Array(MOTION_WORDS);
    captureMotion(state, motor, out);
    restoreMotion(fresh, motor, out);
    expect(words(fresh), path.join('.')).toEqual(words(state));
  }
});

// A capture runs per command. A restore runs per correction, and writing the anchor boxes its numbers as `pin` does.
test('a capture allocates nothing', async () => {
  const page = new PageSide(R, scenario('quiet', { x: DECK.x, y: DECK.y + .1, z: DECK.z, yaw: 0 }));
  try {
    for (let tick = 0; tick < 30; tick++) page.tick(tick, still);
    const { player } = page, state = player.motionState, ring = new Float64Array(MOTION_WORDS * 64);
    const seen: number[] = [], observer = new PerformanceObserver(list => { for (const entry of list.getEntries()) seen.push(entry.startTime); });
    observer.observe({ entryTypes: ['gc'] });
    await new Promise(resolve => { setTimeout(resolve, 0); });
    const start = performance.now();
    for (let at = 0; at < 3_000_000; at++) captureMotion(state, player.motor, ring, (at & 63) * MOTION_WORDS);
    const end = performance.now();
    await new Promise(resolve => { setTimeout(resolve, 20); });
    observer.disconnect();
    expect(seen.filter(time => time >= start && time <= end).length).toBeLessThanOrEqual(2);
  } finally { page.dispose(); }
}, 30_000);
