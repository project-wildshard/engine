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
