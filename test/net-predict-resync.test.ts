import { Vector3 } from 'three';
import { expect, test } from 'vitest';
import { Predictor, type PredictedBody } from '../src/client/engine/net/predictor';
import { PLAYER_CLASS } from '../src/shared/engine/net/netSchemas';
import type { CharacterMotor } from '../src/shared/engine/physics/CharacterMotor';
import { createMotionState } from '../src/shared/engine/player/motionState';
import { legacyDouble } from '../src/test/engine/FakeGame';

// NET-LAG NL12 (h) (meta docs/plans/MULTI-REPO-SAGA/MMO-SAGA/NET-LAG-PLAN.md): on Pine's 180 ms rig the page and the room
// parted by millimetres on open ground, and a key change on the steep stream bank grew a 0.4 mm gap to 12 mm in two steps
// and a climb two ticks apart: one sprint correction a run. A match within tolerance kept the page's own state, so a gap
// from the session's first frame (the page adopts a frame with commands in flight) was never closed. After any correction
// the two stepped bit for bit alike for 700 frames in Chromium and WebKit: the step is the same; only the start differed.
// So a match that is not exact takes the room's state quietly and replays what is in flight: no correction, the drawn
// feet held where they were. An exact match, and a deck's phase (DECK_PHASE_TICKS), keep the page's own.
const walking = { keyX: 0, keyY: 1, stickX: 0, stickY: 0 };
const column = (name: string): number => PLAYER_CLASS.owner.findIndex(row => row.name === name);

function rig(carried = 0): { predictor: Predictor; body: PredictedBody; steps: number[] } {
  const state = createMotionState(), steps: number[] = [];
  state.position.set(2, 1, -20); state.fall.grounded = true;
  const result = { grounded: true, groundNormalY: 1, downhillX: 0, downhillZ: 0, horizontalFreedom: 1, groundCollider: null };
  const body: PredictedBody = { motionState: state, renderOffset: new Vector3(), ride: null,
    // a step that only moves the feet forward: the same from the same state, as the shared step is
    step: command => { steps.push(command.seq); state.position.z += 0.1; return true; },
    motor: legacyDouble<CharacterMotor>({ result, captureState: (out: Float64Array, at: number) => { out[at + 4] = 1; out[at + 8] = 1; out[at + 10] = carried; }, restoreState: () => undefined }) };
  const predictor = new Predictor(body, PLAYER_CLASS.owner);
  for (const seq of [1, 2, 3]) predictor.step({ seq, viewTick: 0, steer: walking, yaw: 0, pitch: 0, buttons: 0 });
  return { predictor, body, steps };
}
/** The room's state after `seq` 1, `dz` off the page's. */
function room(dz: number): Float64Array {
  const wire = new Float64Array(PLAYER_CLASS.owner.length);
  const sim = { position: { x: 2, y: 1, z: -19.9 + dz }, velocity: { x: 0, y: 0, z: 0 }, fall: { grounded: true }, shove: { t: 0, vx: 0, vz: 0 },
    hasMotor: true, motor: { result: { grounded: true, groundNormalY: 1, downhillX: 0, downhillZ: 0, horizontalFreedom: 1 } } };
  for (const name of ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'grounded', 'motorGrounded', 'groundNormalY', 'freedom']) wire[column(name)] = PLAYER_CLASS.owner[column(name)]?.sample(sim as never, {} as never) ?? 0;
  return wire;
}

test("a match off by a hair takes the room's state and replays what is in flight, with no correction", () => {
  const { predictor, body, steps } = rig();
  const drawn = body.motionState.position.z; // -19.7, after seq 3
  expect(predictor.reconcile(1, room(0.0004))).toBe(false);
  expect(predictor.corrections).toBe(0);
  expect(predictor.resyncs).toBe(1);
  expect(steps).toEqual([1, 2, 3, 2, 3]); // seq 2 and 3 replayed from the room's seq 1
  expect(body.motionState.position.z).toBe(-19.9 + 0.0004 + 0.1 + 0.1);
  // the drawn feet stay put: the render offset holds the hair and glides it out
  expect(body.motionState.position.z + body.renderOffset.z).toBeCloseTo(drawn, 12);
  expect(predictor.pending).toBe(2);
});

test('an exact match keeps the page as it is', () => {
  const { predictor, body, steps } = rig();
  const z = body.motionState.position.z;
  expect(predictor.reconcile(1, room(0))).toBe(false);
  expect(predictor.resyncs).toBe(0);
  expect(steps).toEqual([1, 2, 3]);
  expect(body.motionState.position.z).toBe(z);
  expect(body.renderOffset.length()).toBe(0);
});

test("on a deck a match keeps the page's own phase", () => {
  const { predictor, steps } = rig(0.05);
  expect(predictor.reconcile(1, room(0.004))).toBe(false);
  expect(predictor.resyncs).toBe(0);
  expect(steps).toEqual([1, 2, 3]);
});

test('a gap past tolerance still corrects', () => {
  const { predictor } = rig();
  expect(predictor.reconcile(1, room(0.3))).toBe(true);
  expect(predictor.corrections).toBe(1);
  expect(predictor.resyncs).toBe(0);
});
