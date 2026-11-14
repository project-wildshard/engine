import { Vector3 } from 'three';
import { expect, test } from 'vitest';
import { GLIDE_MIN_S, GLIDE_SPEED, Predictor, PREDICTION_SNAP, type PredictedBody } from '../src/client/engine/net/predictor';
import { PLAYER_CLASS } from '../src/shared/engine/net/netSchemas';
import type { CharacterMotor } from '../src/shared/engine/physics/CharacterMotor';
import { createMotionState } from '../src/shared/engine/player/motionState';
import { legacyDouble } from '../src/test/engine/FakeGame';

// NET-LAG NL12 (b): at 150 to 200 ms (J282: the box stays in Nuremberg) a correction is routine, so the drawn feet glide onto the
// predicted ones at a pace the eye reads as walking, never as a step. A small one spreads over at least ~4 frames at 30 fps and
// ~8 at 60, evenly; a 0.3 m one never moves the drawn feet more in a frame than GLIDE_SPEED allows on top of the feet's own motion.
// The scripted round trip is 180 ms (11 ticks at 60 Hz) of a walk at 4.3 m/s, with the server's feet one gap off at one frame.
const WALK = 4.3, TICK = 1 / 60, DELAY = 11;
const column = (name: string): number => PLAYER_CLASS.owner.findIndex(row => row.name === name);

interface Run { readonly corrections: number; readonly glideFrames: number; readonly worstExtra: number; readonly worstStep: number }
/** Walk +z; at tick 40 the server's feet stand `gap` off. `fps`: render frames, each running whole ticks. */
function walk(gap: { x?: number; y?: number; z?: number }, fps: number): Run {
  const state = createMotionState(), dt = 1 / fps, ticksPerFrame = Math.round(dt / TICK);
  state.position.set(0, 1, 0); state.fall.grounded = true;
  const body: PredictedBody = { motionState: state, motor: legacyDouble<CharacterMotor>({ result: { grounded: true, groundNormalY: 1, downhillX: 0, downhillZ: 0, horizontalFreedom: 1, groundCollider: null }, captureState: () => undefined, restoreState: () => undefined }),
    ride: null, renderOffset: new Vector3(), step: () => { state.position.z += WALK * TICK; return true; } };
  const predictor = new Predictor(body, PLAYER_CLASS.owner), server: { seq: number; z: number }[] = [];
  const off = { x: 0, y: 0, z: 0 };
  let seq = 0, serverZ = 0, glideFrames = 0, worstExtra = 0, worstStep = 0, injected = false;
  const drawn = (): Vector3 => state.position.clone().add(body.renderOffset);
  let last = drawn();
  for (let frame = 0; frame < 120; frame++) {
    for (let t = 0; t < ticksPerFrame; t++) {
      seq++;
      predictor.step({ seq, viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: 0 });
      serverZ += WALK * TICK; server.push({ seq, z: serverZ });
      const due = server.length > DELAY ? server.shift() : undefined;
      if (due === undefined) continue;
      const owner = new Float64Array(PLAYER_CLASS.owner.length);
      if (!injected && due.seq >= 40) { injected = true; off.x = gap.x ?? 0; off.y = gap.y ?? 0; off.z = gap.z ?? 0; }
      owner[column('px')] = off.x; owner[column('py')] = 1 + off.y; owner[column('pz')] = due.z + off.z;
      owner[column('grounded')] = 1;
      predictor.reconcile(due.seq, owner);
    }
    predictor.update(dt);
    const now = drawn(), moved = now.clone().sub(last);
    // what the drawn feet moved this frame past the walk itself: the correction as the eye sees it
    const extra = moved.clone().sub(new Vector3(0, 0, WALK * TICK * ticksPerFrame)).length();
    if (body.renderOffset.lengthSq() > 0) glideFrames++;
    worstExtra = Math.max(worstExtra, extra); worstStep = Math.max(worstStep, moved.length());
    last = now;
  }
  return { corrections: predictor.corrections, glideFrames, worstExtra, worstStep };
}

test('a 3 cm grounded Y gap at 180 ms is no correction', () => {
  for (const fps of [30, 60]) expect(walk({ y: .03 }, fps).corrections).toBe(0);
});

test('a small correction glides over at least 4 frames at 30 fps and 8 at 60', () => {
  for (const [fps, frames] of [[30, 4], [60, 8]] as const) {
    const run = walk({ x: .05 }, fps);
    expect(run.corrections, `${fps} fps`).toBe(1);
    expect(run.glideFrames, `${fps} fps`).toBeGreaterThanOrEqual(frames - 1);
    expect(run.worstExtra, `${fps} fps`).toBeLessThanOrEqual(.05 / frames * 1.01);
  }
});

test('a 0.3 m XZ correction never moves the drawn feet faster than the glide speed on top of the walk', () => {
  for (const fps of [30, 60]) for (const gap of [{ x: .3 }, { z: .3 }, { z: -.3 }]) {
    const run = walk(gap, fps), label = `${fps} fps ${JSON.stringify(gap)}`;
    expect(run.corrections, label).toBe(1);
    expect(run.worstExtra, label).toBeLessThanOrEqual(GLIDE_SPEED / fps + 1e-6);
    expect(run.worstStep, label).toBeLessThanOrEqual((WALK + GLIDE_SPEED) / fps + 1e-6);
  }
});

test('the glide ends: a 1 m correction is gone within half a second, a far one snaps', () => {
  const near = walk({ x: 1 }, 60);
  expect(near.glideFrames).toBeLessThanOrEqual(31);
  expect(GLIDE_MIN_S).toBeGreaterThanOrEqual(4 / 30 - 1e-9);
  expect(walk({ x: PREDICTION_SNAP + 1 }, 60).glideFrames).toBe(0);
});
