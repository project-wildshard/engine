import { Vector3 } from 'three';
import { expect, test } from 'vitest';
import { Predictor, type PredictedBody } from '../src/client/engine/net/predictor';
import { PLAYER_CLASS } from '../src/shared/engine/net/netSchemas';
import type { CharacterMotor } from '../src/shared/engine/physics/CharacterMotor';
import { createMotionState } from '../src/shared/engine/player/motionState';
import { legacyDouble } from '../src/test/engine/FakeGame';

// NET-LAG NL12 (f) (meta docs/plans/NET-LAG-PLAN.md): on Pine's 180 ms rig a creature's blow landed on the sprinting player at
// z -155 every run. The room knocks the body back 0.5 to 0.8 m at the tick the blow lands (`PlayerSim.knockBack`, 5 to 9 m/s
// over SHOVE_TIME); the page hears it a round trip later, so its saved step has no shove where the room's has one. Taking
// the room's pose there is the server's word, as a lead's end or a reset is, not a wrong guess: it must not count as a
// correction (B2), and its glide is not B2's worst offset. A gap with no knock behind it still corrects.
const walking = { keyX: 0, keyY: 1, stickX: 0, stickY: 0 };
const column = (name: string): number => PLAYER_CLASS.owner.findIndex(row => row.name === name);

function frame(owner: { dz: number; shove: number }): { corrected: boolean; predictor: Predictor; z: number } {
  const state = createMotionState();
  state.position.set(0, 4.8, -155.9); state.fall.grounded = true;
  const result = { grounded: true, groundNormalY: 1, downhillX: 0, downhillZ: 0, horizontalFreedom: 1, groundCollider: null };
  const body: PredictedBody = { motionState: state, renderOffset: new Vector3(), ride: null, step: () => true,
    motor: legacyDouble<CharacterMotor>({ result, captureState: (out: Float64Array, at: number) => { out[at + 4] = 1; out[at + 8] = 1; }, restoreState: () => undefined }) };
  const predictor = new Predictor(body, PLAYER_CLASS.owner), wire = new Float64Array(PLAYER_CLASS.owner.length);
  predictor.step({ seq: 1, viewTick: 0, steer: walking, yaw: 0, pitch: 0, buttons: 0 });
  // the room's player as the owner block samples it (each column's own form)
  const room = { position: { x: 0, y: 4.8, z: -155.9 + owner.dz }, shove: { t: owner.shove, vx: 0, vz: owner.shove > 0 ? 8.4 : 0 }, fall: { grounded: true },
    hasMotor: true, motor: { result: { grounded: true, groundNormalY: 1, downhillX: 0, downhillZ: 0, horizontalFreedom: 1 } } };
  for (const name of ['px', 'py', 'pz', 'grounded', 'motorGrounded', 'freedom', 'shoveT', 'shoveZ']) wire[column(name)] = PLAYER_CLASS.owner[column(name)]?.sample(room as never, {} as never) ?? 0;
  const corrected = predictor.reconcile(1, wire);
  return { corrected, predictor, z: state.position.z };
}

test("a knock the room started is the server's word: taken, not a correction", () => {
  const { corrected, predictor, z } = frame({ dz: 0.6, shove: 0.163 });
  expect(corrected).toBe(false);
  expect(predictor.corrections).toBe(0);
  expect(predictor.authoritative.shoves).toBe(1);
  expect(predictor.missed.position).toBe(0);
  expect(z).toBeCloseTo(-155.3, 5); // the room's pose is taken
  expect(predictor.authoritativeGlide).toBe(true);
});

test('the same gap with no knock behind it still corrects', () => {
  const { corrected, predictor } = frame({ dz: 0.6, shove: 0 });
  expect(corrected).toBe(true);
  expect(predictor.authoritative.shoves).toBe(0);
  expect(predictor.authoritativeGlide).toBe(false);
});
