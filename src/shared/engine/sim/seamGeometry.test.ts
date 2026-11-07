import { expect, test } from 'vitest';
import { CONTENT_CAPS } from '@wildshard/format/contentBounds';
import { cornerSeamGeometry, seamGeometry, SEAM_OFFSETS } from './seamGeometry';
import type { StripProfile } from './strips';

const profile = (height: number): StripProfile => ({ roadHeight: 0,
  heights: Array.from({ length: 257 }, () => height),
  colours: Array.from({ length: 257 }, () => [0.6, 0.4, 0.2]) });

test('one tile gap keeps the asphalt and neutral buffer inside both widened verges', () => {
  expect(CONTENT_CAPS.pitch).toBe(562.5);
  expect(SEAM_OFFSETS[0]).toBe(-31.25);
  expect(SEAM_OFFSETS.at(-1)).toBe(31.25);
  expect(SEAM_OFFSETS).toEqual(expect.arrayContaining([-11.5, -7.5, 7.5, 11.5]));
  for (let i = 1; i < SEAM_OFFSETS.length; i++) {
    const before = SEAM_OFFSETS[i - 1] ?? 0, after = SEAM_OFFSETS[i] ?? 0;
    expect(after - before).toBeLessThanOrEqual(before === -7.5 ? 15 : 2);
    expect(after).toBeGreaterThan(before);
  }
});

for (const axis of ['x', 'z'] as const) test(`${axis} seam meets both native cell edges and retains its overlap apron`, () => {
  const seam = seamGeometry({ id: 'gap', axis, origin: { x: 0, z: 0 },
    edges: [{ profile: profile(3), entryWidth: 0 }, { profile: profile(-1), entryWidth: 0 }] });
  const across = axis === 'x' ? 0 : 2, along = axis === 'x' ? 2 : 0;
  const rows: number[][] = [];
  for (let i = 0; i < seam.mesh.positions.length; i += 3) rows.push(Array.from(seam.mesh.positions.subarray(i, i + 3)));
  expect(Math.min(...rows.map(row => row[across] ?? 0))).toBe(-31.5);
  expect(Math.max(...rows.map(row => row[across] ?? 0))).toBe(31.5);
  for (const [edge, height] of [[-31.25, 3], [31.25, -1]] as const) {
    const boundary = rows.filter(row => row[across] === edge && row[1] === height);
    expect(new Set(boundary.map(row => row[along])).size).toBe(257);
  }
  const deck = rows.filter(row => Math.abs(row[across] ?? 0) <= 11.5);
  expect(deck.length).toBeGreaterThan(0);
  expect(deck.every(row => row[1] === 0)).toBe(true);
});

test('cliff faces stay capped while their native boundary stays exact', () => {
  const seam = seamGeometry({ id: 'cliff', axis: 'x', origin: { x: 0, z: 0 },
    edges: [{ profile: profile(30), entryWidth: 0 }, { profile: profile(0), entryWidth: 8 }] });
  const cliff = seam.features.find(row => row.kind === 'cliff');
  if (cliff === undefined) throw new Error('Missing cliff');
  expect(cliff.top).toBe(14);
  const vertices = Array.from(seam.mesh.indices.subarray(cliff.firstIndex, cliff.firstIndex + cliff.indexCount));
  const xs = vertices.map(index => seam.mesh.positions[index * 3] ?? 0);
  expect(Math.min(...xs)).toBe(-31.25);
  expect(Math.max(...xs)).toBeLessThan(-11.5);
  expect(seam.features.some(row => row.kind === 'overlap' && row.top === 30)).toBe(true);
  expect(seam.features.some(row => row.kind === 'talus')).toBe(true);
});

test('junction faces keep their ten metre returns at the wider cell corners', () => {
  const corner = { height: 8, colour: [0.6, 0.4, 0.2] as const };
  const seam = cornerSeamGeometry({ id: 'junction', origin: { x: 0, z: 0 }, corners: [corner, corner, corner, corner] });
  const returns = seam.features.filter(row => row.kind === 'retaining-wall');
  expect(returns).toHaveLength(8);
  for (const row of returns) {
    expect(row.to - row.from).toBe(10);
    expect(Math.max(Math.abs(row.from), Math.abs(row.to))).toBe(31.25);
  }
});
