import { Vector3 } from 'three';
import { expect, test } from 'vitest';
import { Predictor, STALL_FREEDOM, STALL_SLACK, type PredictedBody } from '../src/client/engine/net/predictor';
import { floatToBits } from '../src/shared/engine/net/bits';
import { PLAYER_CLASS } from '../src/shared/engine/net/netSchemas';
import type { CharacterMotor } from '../src/shared/engine/physics/CharacterMotor';
import { createMotionState } from '../src/shared/engine/player/motionState';
import { legacyDouble } from '../src/test/engine/FakeGame';

// NET-LAG NL12/NL14b1 (meta docs/plans/NET-LAG-PLAN.md): a sprint pressed into Nalati's bank beside a boulder (3.35, -7.28, 142) is
// a pocket the motor cannot leave. Its feet chatter there between two terrain faces (41 and 34 degrees, across the climb
// limit): three steps 0.7 cm along the steep face, then one 1.85 to 3 cm back off the climbable one, every 3 or 4 ticks,
// offline too. The page and the room chatter the same way but not in step, so at 180 ms they were 3.4 to 4.3 cm apart at
// the acknowledged step and corrected 25 to 30 times a minute (B2 allows 2), each correction landing in another phase of
// the same chatter. Both pressed in, feet a few cm apart are the same pocket: not a miss. Free feet, or a gap past the
// slack, still correct.
const pressed = { keyX: 0, keyY: 1, stickX: 0, stickY: 0 };
const column = (name: string): number => PLAYER_CLASS.owner.findIndex(row => row.name === name);

function frame(gap: { x?: number; z?: number }, freedom: { page: number; room: number }): boolean {
  const state = createMotionState();
  state.position.set(3.35, -7.28, 142); state.fall.grounded = true;
  const result = { grounded: true, groundNormalY: 0.83, downhillX: 0, downhillZ: 1, horizontalFreedom: freedom.page, groundCollider: null };
  const body: PredictedBody = { motionState: state, renderOffset: new Vector3(), ride: null, step: () => true,
    motor: legacyDouble<CharacterMotor>({ result, captureState: (out: Float64Array, at: number) => { out[at + 4] = 1; out[at + 8] = result.horizontalFreedom; }, restoreState: () => undefined }) };
  const predictor = new Predictor(body, PLAYER_CLASS.owner), owner = new Float64Array(PLAYER_CLASS.owner.length);
  predictor.step({ seq: 1, viewTick: 0, steer: pressed, yaw: 0, pitch: 0, buttons: 8 });
  owner[column('px')] = 3.35 + (gap.x ?? 0); owner[column('py')] = -7.28; owner[column('pz')] = 142 + (gap.z ?? 0);
  owner[column('grounded')] = 1; owner[column('motorGrounded')] = 1; owner[column('freedom')] = floatToBits(freedom.room); // an f32 column carries its bits
  return predictor.reconcile(1, owner);
}

test("the pocket's chatter, both sides pressed in, is not a correction", () => {
  // the rig's kept misses: the room at one end of the chatter, the page at the other
  expect(frame({ x: -0.039, z: -0.011 }, { page: 0.097, room: 0.268 })).toBe(false);
  expect(frame({ x: 0.032, z: 0.008 }, { page: 0.265, room: 0.098 })).toBe(false);
  expect(STALL_SLACK).toBeGreaterThanOrEqual(0.045);
  expect(STALL_FREEDOM).toBeGreaterThan(0.27);
});

test('free feet, one side free, or a gap past the slack still corrects', () => {
  expect(frame({ x: 0.04 }, { page: 1, room: 1 })).toBe(true);
  expect(frame({ x: 0.04 }, { page: 0.1, room: 1 })).toBe(true);
  expect(frame({ x: 0.04 }, { page: 1, room: 0.1 })).toBe(true);
  expect(frame({ x: STALL_SLACK + 0.01 }, { page: 0.1, room: 0.1 })).toBe(true);
});
