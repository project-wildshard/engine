import { expect, test } from 'vitest';
import { AI_TICK_RATE, bandAt, bandBetween, creatureBodyDistance, CREATURE_BODY_FAR, CREATURE_BODY_NEAR, keepsCreatureBody, keepsLiveCreatureBody, tickDistance } from './bands';

// QA 2026-11-23 row 2b: the squared-sum shortcuts choose what the exact distance chooses, at and around every edge.
const ulp = (x: number, steps: number): number => {
  const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, x);
  view.setBigInt64(0, view.getBigInt64(0) + BigInt(steps)); return view.getFloat64(0);
};
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** Points at `length` from a random player, in random directions, nudged a few ulps either way. */
function around(length: number, rng: () => number, count: number): { at: { x: number; y: number; z: number }; player: { x: number; y: number; z: number } }[] {
  const rows = [];
  for (let i = 0; i < count; i++) {
    const player = { x: (rng() - 0.5) * 2000, y: (rng() - 0.5) * 200, z: (rng() - 0.5) * 2000 };
    const yaw = rng() * Math.PI * 2, pitch = (rng() - 0.5) * (i % 2 === 0 ? 0 : 1.5), r = ulp(length, Math.round((rng() - 0.5) * 8));
    rows.push({ at: { x: player.x + Math.cos(pitch) * Math.sin(yaw) * r, y: player.y + Math.sin(pitch) * r, z: player.z + Math.cos(pitch) * Math.cos(yaw) * r }, player });
  }
  rows.push({ at: { x: length, y: 0, z: 0 }, player: { x: 0, y: 0, z: 0 } }, { at: { x: 0, y: 0, z: ulp(length, 1) }, player: { x: 0, y: 0, z: 0 } });
  return rows;
}

test('a band span chooses the band its exact distance chooses', () => {
  const rng = mulberry(0x2b), rates = [AI_TICK_RATE, { bands: [{ upTo: 0.5, brainHz: 60, body: 'frame' as const }, { upTo: 1e200, brainHz: 2, body: 'half' as const }, { upTo: Infinity, brainHz: 'paused' as const, body: 'paused' as const }] }];
  const spans = [...[0.5, 60, 160, 1e-3, 1e5].flatMap(length => around(length, rng, 4000)),
    { at: { x: Number.NaN, y: 0, z: 0 }, player: { x: 0, y: 0, z: 0 } }, { at: { x: 1e300, y: 1e300, z: 0 }, player: { x: -1e300, y: 0, z: 0 } }];
  for (const rate of rates) for (const span of spans) expect(bandBetween(rate, span)).toBe(bandAt(rate, tickDistance(span.at, span.player)));
});

test('a live body keeps or gains its motor exactly as the measured distance says', () => {
  const rng = mulberry(0x2c);
  for (const span of [...around(CREATURE_BODY_NEAR, rng, 4000), ...around(CREATURE_BODY_FAR, rng, 4000), ...around(10, rng, 200), ...around(80, rng, 200)])
    for (const has of [false, true])
      expect(keepsLiveCreatureBody(has, span.at, span.player)).toBe(keepsCreatureBody(has, true, false, creatureBodyDistance(span.at, span.player)));
});
