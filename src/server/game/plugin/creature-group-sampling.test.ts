import { expect, test } from 'vitest';
import { Rng } from '@wildshard/engine/core/rng';
import { sampleCreatureGroup, type CreatureGroupSpec } from './brain';


const ground = (x: number, z: number): number => Math.sin(x * 0.05) * 3 + Math.cos(z * 0.07) * 2;

test('group sampling keeps source order, accepted variants and data gates, refusing before draws', () => {
  const rng = new Rng(357);
  const row: CreatureGroupSpec<'hunter'> = { kind: 'hunter', count: 3, herd: 2, variant: 'small', firstVariant: 'big',
    source: { kind: 'radial', centre: { x: 5, z: 9 }, radius: [1, 3], firstAtCentre: true } };
  const accepted = sampleCreatureGroup(row, rng);
  expect(accepted[0]).toMatchObject({ kind: 'hunter', variant: 'big', herd: 2, x: 5, z: 9 });
  expect(accepted.map(sample => sample.variant)).toEqual(['big', 'small', 'small']);
  expect(accepted.every(sample => Number.isFinite(sample.yaw) && sample.herd === row.herd)).toBe(true);
  const points = [{ x: 7, z: -2 }, { x: 4, z: 8 }];
  const indexed = sampleCreatureGroup({ ...row, count: 2, variants: ['elder', null], source: { kind: 'indexed', points }, yaw: 0 }, rng);
  expect(indexed.map(sample => ({ x: sample.x, z: sample.z }))).toEqual(points);
  expect(indexed.map(sample => sample.variant)).toEqual(['elder', null]);
  const faced = sampleCreatureGroup({ ...row, count: 1, face: { x: 5, z: 20 }, source: { kind: 'indexed', points } }, rng);
  expect(faced[0]?.yaw).toBe(Math.atan2(5 - 7, 20 + 2));
  const saved = rng.snapshot();
  expect(() => sampleCreatureGroup({ ...row, count: 17 }, rng)).toThrow('group');
  expect(() => sampleCreatureGroup({ ...row, source: { kind: 'indexed', points: [] } }, rng)).toThrow('group');
  expect(() => sampleCreatureGroup({ ...row, source: { kind: 'radial', centre: { x: 0, z: 0 }, radius: [4, 1] } }, rng)).toThrow('group');
  expect(() => sampleCreatureGroup({ ...row, accept: { minHeight: 0 } }, rng)).toThrow('group');
  expect(() => sampleCreatureGroup({ ...row, yaw: 0, face: { x: 0, z: 0 } }, rng)).toThrow('group');
  expect(rng.snapshot()).toEqual(saved);
  const fallback = sampleCreatureGroup({ ...row, count: 1, accept: { bound: 0.001 },
    source: { kind: 'radial', centre: points[0] ?? { x: 0, z: 0 }, radius: [0, 4], radiusLaw: 'area', attempts: 2, fallback: 'centre' } }, rng);
  expect(fallback[0]).toMatchObject(points[0] ?? {});
});

/** The retired callback form of the radial draw (`Rng.range`, a borrowed accept), kept as the oracle for Driftwood's crab groups. */
function retiredRadial(centre: { x: number; z: number }, count: number, rng: Rng, accept: (x: number, z: number) => boolean): { x: number; z: number; yaw: number }[] {
  const out: { x: number; z: number; yaw: number }[] = [];
  for (let index = 0; index < count; index++) {
    const angle = rng.range(0, Math.PI * 2), radius = index === 0 ? 0 : rng.range(1.2, 2.8);
    const x = centre.x + Math.cos(angle) * radius, z = centre.z + Math.sin(angle) * radius;
    if (!accept(x, z)) continue;
    out.push({ x, z, yaw: rng.range(0, Math.PI * 2) });
  }
  return out;
}

test('Driftwood crab groups on data gates match the retired accept callback bit for bit', () => {
  for (let seed = 0; seed < 200; seed++) {
    const a = new Rng(seed ^ 0xe11e), b = new Rng(seed ^ 0xe11e), centre = { x: seed * 1.7 - 150, z: 80 - seed * 0.9 }, water = 0.4;
    const old = retiredRadial(centre, 5, a, (x, z) => !(ground(x, z) < water + .15));
    const now = sampleCreatureGroup({ kind: 'crab', count: 5, herd: 0, variant: 'small', firstVariant: 'big',
      source: { kind: 'radial', centre, radius: [1.2, 2.8], firstAtCentre: true }, accept: { minHeight: water + .15 } }, b, { heightAt: ground });
    expect(now.map(({ x, z, yaw }) => ({ x, z, yaw }))).toEqual(old);
    expect(b.snapshot()).toEqual(a.snapshot());
  }
});
