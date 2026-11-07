import { Vector3 } from 'three';
import { describe, expect, test } from 'vitest';
import { stepPlayerMotion, type MotionWorld, type PlayerMotionState } from '../src/shared/engine/player/motion';

// P1-E5.3: one step, one law, the page's (J112). What the law table's rows did, held.

const DT = 1 / 60;
function player(): PlayerMotionState {
  return { position: new Vector3(), yaw: 0, tick: 0, lock: { r0: 0 }, moveScale: 1, impulse: new Vector3(), velocity: new Vector3(), fall: { grounded: true },
    shove: { t: 0, vx: 0, vz: 0 }, dash: { t: 0, vx: 0, vz: 0 }, dodge: { cd: 0, t: 0 }, jump: { ago: Infinity, left: 0 },
    board: { on: false, hoverAir: false, hoverBob: 0, onGround: false },
    swim: { on: false, stood: false, diving: false, climbTo: null, climbCooldown: 0, strokeTime: 0 },
    footing: { water: null, depth: 0, wading: false, onPlatform: false, sliding: false } };
}
/** Flat ground at y = 0 with a slope normal the test sets, and a capsule that records its moves. */
function world(): MotionWorld & { moves: number } {
  const result = { grounded: true, groundNormalY: 1, downhillX: 0, downhillZ: 0, horizontalFreedom: 1, groundCollider: null };
  const w: MotionWorld & { moves: number } = { moves: 0, hasWater: false, water: () => null, heightAt: () => 0, platforms: [], floor: () => undefined, bob: () => 0,
    motor: { result, carry: () => false, move: (feet, want) => {
      w.moves++; feet.x += want.x; feet.z += want.z; feet.y = Math.max(0, feet.y + want.y); result.grounded = feet.y === 0; return result;
    } },
    foot: { speed: () => 4, crouching: false, coyoteMs: 100 },
    boardTop: () => 14, boardCapped: () => false, jumped: () => undefined, dodged: () => undefined, landed: () => undefined, boardLanded: () => undefined, lunged: () => undefined, dodgeScale: () => 1,
    swimChanged: () => undefined, stroked: () => undefined, ride: null, scratch: null };
  return w;
}
const still = { moveX: 0, moveZ: 0, yaw: 0 };

describe('the one law', () => {
  test('a dash leaves momentum', () => {
    const s = player();
    Object.assign(s.dash, { t: DT * 2, vx: 12, vz: 0 });
    stepPlayerMotion(s, still, world(), DT);
    expect(s.velocity.x).toBe(12);
  });
  test('ground too steep to stand on slides', () => {
    const s = player(), w = world();
    Object.assign(w.motor.result, { groundNormalY: .5, downhillX: 1 });
    stepPlayerMotion(s, still, w, DT);
    expect(s.footing.sliding).toBe(true);
  });
  test('a resting body steps, with or without a command', () => {
    const s = player(), w = world();
    expect(stepPlayerMotion(s, undefined, w, DT).mode).toBe('foot');
    stepPlayerMotion(s, still, w, DT);
    expect(w.moves).toBe(2);
  });
  test('on the board a walk\'s speed is kept', () => {
    const s = player();
    s.velocity.x = 3;
    Object.assign(s.board, { on: true });
    stepPlayerMotion(s, still, world(), DT);
    expect(s.velocity.x).toBeGreaterThan(2); // it coasts down from 3, and is not dropped
  });
});
