import { describe, expect, it } from 'vitest';
import { fallStep, hardLanding, HARD_LANDING_SPEED, MAX_JUMP_APEX, SAFE_FALL } from './fall';
import { DOUBLE_JUMP, DOUBLE_JUMP_KEEP, JUMP_SPEED } from './jump';

// QA 2026-11-23-b row 12 (Jake, staging v0.1.74, iPhone): "you should not take damage on a jump". The fall law is
// stepped the way the motor steps it (gravity first, then the move), at 60 and at 30 fps, against flat ground at y = 0.

/** The downward speed (m/s, negative) the feet touch ground at, from height `y` rising at `vy`, double jumping at `pressAt`. */
function touchdown(fromY: number, fromVy: number, dt: number, pressAt?: (vy: number) => boolean): number {
  let y = fromY, vy = fromVy, pressed = pressAt === undefined;
  for (let step = 0; step < 100_000; step++) {
    if (!pressed && pressAt?.(vy) === true) { vy = Math.max(vy, 0) * DOUBLE_JUMP_KEEP + DOUBLE_JUMP; pressed = true; }
    vy = fallStep(vy, dt);
    y += vy * dt;
    if (y <= 0) return vy;
  }
  throw new Error('never landed');
}
/** The hardest touchdown over every step a double jump can be pressed on the way up or down. */
function worstDoubleJump(dropBelow: number, dt: number): number {
  let worst = 0;
  for (let at = 0; at < 200; at++) {
    let seen = 0;
    worst = Math.min(worst, touchdown(dropBelow, JUMP_SPEED, dt, () => seen++ === at));
  }
  return worst;
}

describe('fall damage (QA 11-23-b row 12)', () => {
  it('derives the safe fall from the highest jump', () => {
    expect(MAX_JUMP_APEX).toBeGreaterThan(2.9);
    expect(MAX_JUMP_APEX).toBeLessThan(3.1);
    expect(SAFE_FALL).toBeCloseTo(2 * MAX_JUMP_APEX);
    expect(HARD_LANDING_SPEED).toBeGreaterThan(16);
  });
  for (const fps of [60, 30]) {
    const dt = 1 / fps;
    it(`a jump and a double jump on flat ground deal nothing at ${String(fps)} fps`, () => {
      expect(hardLanding(touchdown(0, JUMP_SPEED, dt), 0)).toBe(false);
      expect(hardLanding(worstDoubleJump(0, dt), 0)).toBe(false);
    });
    it(`a double jump off a ledge one jump high deals nothing at ${String(fps)} fps`, () => {
      expect(hardLanding(worstDoubleJump(MAX_JUMP_APEX, dt), 0)).toBe(false);
      expect(hardLanding(touchdown(MAX_JUMP_APEX, 0, dt), 0)).toBe(false);
    });
    it(`a real fall still hurts at ${String(fps)} fps`, () => {
      expect(hardLanding(touchdown(12, 0, dt), 0)).toBe(true);
      expect(hardLanding(touchdown(SAFE_FALL + 2, 0, dt), 0)).toBe(true);
    });
    it(`deep water still takes a real fall at ${String(fps)} fps`, () => {
      expect(hardLanding(touchdown(12, 0, dt), 1)).toBe(false);
    });
  }
});
