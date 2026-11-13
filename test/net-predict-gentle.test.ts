import { Vector3 } from 'three';
import { expect, test } from 'vitest';
import { Predictor, type PredictedBody } from '../src/client/engine/net/predictor';
import { PLAYER_CLASS } from '../src/shared/engine/net/netSchemas';
import type { CharacterMotor } from '../src/shared/engine/physics/CharacterMotor';
import { createMotionState } from '../src/shared/engine/player/motionState';
import { legacyDouble } from '../src/test/engine/FakeGame';

// NET-LAG NL12 (a): standing on the ground, the ground decides Y. A server and a client a few cm apart in Y only, both grounded and
// level in XZ, are the same spot on the same floor; correcting it rubber-bands the feet for nothing (NL10 removed the drift that did
// it, this keeps a future one from showing). A miss in XZ, in the air, or past the slack is still a miss.
const standing = { keyX: 0, keyY: 0, stickX: 0, stickY: 0 };
const column = (name: string): number => PLAYER_CLASS.owner.findIndex(row => row.name === name);

function frame(gap: { x?: number; y?: number; z?: number }, grounded: boolean): { corrected: boolean; corrections: number } {
  const state = createMotionState();
  state.position.set(5, 1, 5); state.fall.grounded = grounded;
  const body: PredictedBody = { motionState: state, motor: legacyDouble<CharacterMotor>({ result: { grounded, groundNormalY: 1, downhillX: 0, downhillZ: 0, horizontalFreedom: 1, groundCollider: null }, captureState: () => undefined, restoreState: () => undefined }),
    ride: null, renderOffset: new Vector3(), step: () => true };
  const predictor = new Predictor(body, PLAYER_CLASS.owner), owner = new Float64Array(PLAYER_CLASS.owner.length);
  predictor.step({ seq: 1, viewTick: 0, steer: standing, yaw: 0, pitch: 0, buttons: 0 });
  owner[column('px')] = 5 + (gap.x ?? 0); owner[column('py')] = 1 + (gap.y ?? 0); owner[column('pz')] = 5 + (gap.z ?? 0);
  owner[column('grounded')] = grounded ? 1 : 0;
  const corrected = predictor.reconcile(1, owner);
  return { corrected, corrections: predictor.corrections };
}

test('a grounded 3 cm Y-only gap is not a correction', () => {
  expect(frame({ y: .03 }, true)).toEqual({ corrected: false, corrections: 0 });
  expect(frame({ y: -.03 }, true)).toEqual({ corrected: false, corrections: 0 });
  // within the XZ tolerance and the Y slack together
  expect(frame({ x: .015, y: .045 }, true)).toEqual({ corrected: false, corrections: 0 });
});

test('a gap in XZ, in the air, or past the slack still corrects', () => {
  expect(frame({ z: .3 }, true).corrected).toBe(true);
  expect(frame({ x: .03, y: .03 }, true).corrected).toBe(true);
  expect(frame({ y: .03 }, false).corrected).toBe(true);
  expect(frame({ y: .2 }, true).corrected).toBe(true);
});
