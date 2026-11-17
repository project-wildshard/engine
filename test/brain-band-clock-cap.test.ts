import { expect, test } from "vitest";
import { BodyBandClocks } from "../src/shared/engine/sim/bands";

const rates = {
  ai: {
    bands: [
      { upTo: 60, brainHz: 60, body: "frame" },
      { upTo: 160, brainHz: 15, body: "half" },
      { upTo: Infinity, brainHz: "paused", body: "paused" },
    ],
  },
} as const;

test.each([3, 6])(
  "authored divisor %s bounds one existing clock and keeps exact saved credit",
  (divisor) => {
    const a = new BodyBandClocks(rates),
      b = new BodyBandClocks(rates),
      period = Math.max(4, divisor);
    let calls = 0;
    for (let tick = 1; tick <= 5; tick++) {
      a.beginTick(1 / 60);
      const dt = a.takeBrainDt("actual.actor", "ai", 80, false, 60 / divisor);
      if (dt > 0) {
        calls++;
        expect(dt).toBeCloseTo(period / 60);
      }
      expect(a.takeBrainDt("actual.actor", "ai", 80, false, 60 / divisor)).toBe(0);
    }
    b.restore(a.snapshot(), new Set(["actual.actor"]));
    for (let tick = 6; tick <= 48; tick++) {
      a.beginTick(1 / 60);
      b.beginTick(1 / 60);
      const dt = a.takeBrainDt("actual.actor", "ai", 80, false, 60 / divisor);
      expect(b.takeBrainDt("actual.actor", "ai", 80, false, 60 / divisor)).toBe(dt);
      if (dt > 0) {
        calls++;
        expect(dt).toBeCloseTo(period / 60);
      }
      expect(a.snapshot()).toEqual(b.snapshot());
    }
    expect(calls).toBe(48 / period);
  },
);

test("invalid caps refuse atomically and body cadence retains its original identity phase", () => {
  const a = new BodyBandClocks(rates),
    b = new BodyBandClocks(rates);
  a.beginTick(1 / 60);
  b.beginTick(1 / 60);
  const saved = a.snapshot();
  for (const invalid of [0, -1, NaN]) {
    expect(() => a.takeBrainDt("actual.actor", "ai", 80, false, invalid)).toThrow(
      "Invalid authored decision frequency",
    );
    expect(a.snapshot()).toEqual(saved);
  }
  for (let tick = 1; tick <= 32; tick++) {
    a.takeBrainDt("actual.actor", "ai", 80, false, 10);
    b.takeBrainDt("actual.actor", "ai", 80, false);
    expect(a.bodyDt("actual.actor", "ai", 80)).toBe(b.bodyDt("actual.actor", "ai", 80));
    a.beginTick(1 / 60);
    b.beginTick(1 / 60);
  }
});

test("a real damage timestamp wakes exactly once and is part of the same saved decision clock", () => {
  const a = new BodyBandClocks(rates),
    b = new BodyBandClocks(rates);
  a.beginTick(1 / 60);
  expect(a.takeBrainDt("actual.actor", "ai", 80, false, 20)).toBe(0);
  a.beginTick(1 / 60);
  expect(a.takeBrainDt("actual.actor", "ai", 80, false, 20, 1000 / 60)).toBeCloseTo(2 / 60);
  const saved = a.snapshot();
  b.restore(saved, new Set(["actual.actor"]));
  for (let tick = 0; tick < 3; tick++) {
    a.beginTick(1 / 60);
    b.beginTick(1 / 60);
    expect(a.takeBrainDt("actual.actor", "ai", 80, false, 20, 1000 / 60)).toBe(0);
    expect(b.takeBrainDt("actual.actor", "ai", 80, false, 20, 1000 / 60)).toBe(0);
  }
  expect(a.snapshot()).toEqual(b.snapshot());
  const invalid = structuredClone(saved),
    row = invalid.rows[0];
  if (row === undefined) throw new Error("Missing real clock");
  row.brain.damage = 1e9;
  expect(() => b.restore(invalid, new Set(["actual.actor"]))).toThrow(
    "Incompatible body band continuation",
  );
  expect(b.snapshot()).toEqual(a.snapshot());
});

test("an active body keeps fixed attack/impulse steps without resetting its decision credit", () => {
  const clock = new BodyBandClocks(rates);
  let decisions = 0;
  for (let tick = 1; tick <= 12; tick++) {
    clock.beginTick(1 / 60);
    if (clock.takeBrainDt("actual.actor", "ai", 80, false, 20) > 0) decisions++;
    if (tick >= 2 && tick <= 10)
      expect(clock.bodyDt("actual.actor", "ai", 80, true)).toBeCloseTo(1 / 60);
    else clock.bodyDt("actual.actor", "ai", 80);
  }
  expect(decisions).toBe(3);
});
