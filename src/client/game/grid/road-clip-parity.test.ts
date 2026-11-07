import { expect, test } from 'vitest';
import { BufferAttribute, BufferGeometry } from 'three';
import { clipToBinsSteps, cullCountsSteps, cullPlanSteps, finishRoadSteps, ROAD_LOD, type CullLod } from './roadCull';

test.each([undefined, 62.5])('split extrema retain all boundary and signed-zero words (tiles %s)', async tileSize => {
  const coordinates: number[] = [], indices: number[] = [];
  const points = [-281.25, -140.625, -62.5, -0, 0, 0.0005, 62.5, 140.625, 281.25];
  for (const x of points) for (const z of points) {
    const n = coordinates.length / 3;
    coordinates.push(x, -0, z, x + 125, 1, z, x + 62.5, -1, z + 125); indices.push(n, n + 1, n + 2);
  }
  const positions = Float32Array.from(coordinates), geometry = new BufferGeometry().setAttribute('position', new BufferAttribute(positions, 3))
    .setAttribute('uv', new BufferAttribute(Float32Array.from({ length: positions.length / 3 * 2 }, (_, i) => i % 3 === 0 ? -0 : i / 13), 2)).setIndex(indices);
  try {
    const counts = finishRoadSteps(cullCountsSteps([{ vertices: positions.length / 3, position: k => positions[k] ?? 0, indices }], 562.5, ROAD_LOD, tileSize));
    finishRoadSteps(clipToBinsSteps(geometry, 562.5, tileSize));
    const plan = finishRoadSteps(cullPlanSteps(geometry, 562.5, ROAD_LOD, tileSize)), index = geometry.getIndex();
    if (index === null) throw new Error('Missing clipped boundary index');
    const arrays = [geometry.getAttribute('position').array, geometry.getAttribute('uv').array, index.array, plan.source];
    const facts = new TextEncoder().encode(JSON.stringify({ bins: plan.bins, lod: plan.lod, counts }));
    const wire = new Uint8Array(arrays.reduce((sum, row) => sum + row.byteLength, facts.length));
    let cursor = 0;
    for (const row of arrays) { wire.set(new Uint8Array(row.buffer, row.byteOffset, row.byteLength), cursor); cursor += row.byteLength; }
    wire.set(facts, cursor);
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', wire)), byte => byte.toString(16).padStart(2, '0')).join('');
    // Complete predecessor words, including -0, plus every LOD bin/bound/count.
    expect(hash).toBe(tileSize === undefined ? '0a992660477f272b8ed5d456230d7b3e41d361b9265fa4f2a28e9be86179c4a5' : '76af552e1f0c5c92496c6b031caca3b3533fcde6da0e05646897e0349344f194');
  } finally { geometry.dispose(); }
});

test('road clipping preserves edge vertices, interpolated UVs and exact LOD byte plans', async () => {
  const geometry = new BufferGeometry();
  const positions: number[] = [], weights: number[] = [], indices: number[] = [];
  const points = [-600, -375, -125, -124.999, 0, 124.999, 125, 375, 600];
  for (const [i, x] of points.entries()) for (const [j, z] of points.entries()) {
    const n = positions.length / 3;
    positions.push(x, i, z, x + (j % 2 === 0 ? 0 : 250), j, z + 0.125, x + 4, i + j, z + (i % 2 === 0 ? 4 : 750));
    weights.push(i, j, i + j, i - j, i / 3, j / 7);
    indices.push(n, n + 1, n + 2);
  }
  geometry.setAttribute('position', new BufferAttribute(Float32Array.from(positions), 3));
  geometry.setAttribute('uv', new BufferAttribute(Float32Array.from(weights), 2));
  geometry.setIndex(indices);
  const counts = finishRoadSteps(cullCountsSteps([{ vertices: positions.length / 3, position: (k) => geometry.getAttribute('position').array[k] ?? 0, indices }], 500, ROAD_LOD));
  finishRoadSteps(clipToBinsSteps(geometry, 500));
  const plan = finishRoadSteps(cullPlanSteps(geometry, 500, ROAD_LOD));
  // Golden output from the admitted builder at 97cb8c6723, before the allocation fast path.
  const content = { position: Array.from(geometry.getAttribute('position').array), uv: Array.from(geometry.getAttribute('uv').array), index: Array.from(geometry.getIndex()?.array ?? []), source: Array.from(plan.source), bins: plan.bins, lod: plan.lod, counts };
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(content)));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  expect({ hash, counts }).toEqual({ hash: '031db7363e523059eae3c0b34803ce11cb29fc7b4500641427f2c4e2f9fb3d0f', counts: { clipped: 489, source: 2892, vertices: 243 } });
});


test('road tiles share world-grid edges and the exact allocation arithmetic', () => {
  const geometry = new BufferGeometry();
  const points = [-125, 0, -125, 125, 0, -125, 125, 0, 125, -125, 0, 125];
  geometry.setAttribute('position', new BufferAttribute(Float32Array.from(points), 3));
  geometry.setAttribute('uv', new BufferAttribute(Float32Array.from([-125, -125, 125, -125, 125, 125, -125, 125]), 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const source = { vertices: 4, position: (k: number): number => points[k] ?? 0, indices: [0, 1, 2, 0, 2, 3] };
  const counts = finishRoadSteps(cullCountsSteps([source], 562.5, ROAD_LOD, 62.5));
  finishRoadSteps(clipToBinsSteps(geometry, 562.5, 62.5));
  const plan = finishRoadSteps(cullPlanSteps(geometry, 562.5, ROAD_LOD, 62.5));
  expect(plan.bins).toHaveLength(16);
  expect(geometry.getAttribute('position').count).toBe(counts.clipped);
  expect(plan.source.length).toBe(counts.source);
  const position = geometry.getAttribute('position'), uv = geometry.getAttribute('uv');
  for (const bin of plan.bins) {
    const tile = bin.tile;
    if (tile === undefined) throw new Error('Road tile has no lattice identity');
    expect(tile.x).toBeGreaterThanOrEqual(-2); expect(tile.x).toBeLessThan(2);
    expect(tile.z).toBeGreaterThanOrEqual(-2); expect(tile.z).toBeLessThan(2);
    for (let k = bin.start; k < bin.start + bin.count; k++) {
      const vertex = plan.source[k];
      if (vertex === undefined) throw new Error('Road tile index is missing');
      const x = position.getX(vertex), z = position.getZ(vertex);
      expect(x).toBeGreaterThanOrEqual(tile.x * 62.5 - 1e-4);
      expect(x).toBeLessThanOrEqual((tile.x + 1) * 62.5 + 1e-4);
      expect(z).toBeGreaterThanOrEqual(tile.z * 62.5 - 1e-4);
      expect(z).toBeLessThanOrEqual((tile.z + 1) * 62.5 + 1e-4);
      expect(uv.getX(vertex)).toBeCloseTo(x); expect(uv.getY(vertex)).toBeCloseTo(z);
    }
  }
  geometry.dispose();
});

test.each([undefined, 62.5])('count-only admission matches actual clipped storage without LOD (tiles %s)', tileSize => {
  const values: number[] = [], indices: number[] = [];
  // More than one unchanged 256-triangle batch, with strict boundary points,
  // interior crossings on both axes, shared indices and unused vertices.
  for (let triangle = 0; triangle < 600; triangle++) {
    const base = values.length / 3, x = (triangle % 13 - 6) * 62.5, z = (triangle % 17 - 8) * 62.5;
    values.push(x, -0, z, x + (triangle % 2 ? 0 : 250), 3, z + 0.125, x + 4, -7, z + 750);
    indices.push(base, base + 1, triangle % 11 === 0 && base > 0 ? base - 1 : base + 2);
  }
  values.push(10000, 0, 10000);
  const positions = Float32Array.from(values), geometry = new BufferGeometry().setAttribute('position', new BufferAttribute(positions, 3)).setIndex(indices);
  const steps = cullCountsSteps([{ vertices: positions.length / 3, position: index => positions[index] ?? 0, indices }], 562.5, undefined, tileSize);
  let result = steps.next(), yields = 0; while (!result.done) { yields++; result = steps.next(); }
  expect(yields).toBe(3);
  finishRoadSteps(clipToBinsSteps(geometry, 562.5, tileSize));
  const plan = finishRoadSteps(cullPlanSteps(geometry, 562.5, [], tileSize));
  expect(result.value).toEqual({ vertices: positions.length / 3, clipped: geometry.getAttribute('position').count, source: plan.source.length });
  expect(result.value.clipped).toBeGreaterThan(result.value.vertices);
  geometry.dispose();
});

test('an explicitly empty LOD list remains live across the original clipping pause', () => {
  const positions = Float32Array.of(-125, 0, -125, 125, 0, -125, 125, 0, 125, -125, 0, 125), indices = [0, 1, 2, 0, 2, 3];
  const lod: CullLod[] = [], steps = cullCountsSteps([{ vertices: 4, position: index => positions[index] ?? 0, indices }], 562.5, lod, 62.5);
  expect(steps.next().done).toBe(false); lod.push(...ROAD_LOD);
  const counts = finishRoadSteps(steps), geometry = new BufferGeometry().setAttribute('position', new BufferAttribute(positions, 3)).setIndex(indices);
  finishRoadSteps(clipToBinsSteps(geometry, 562.5, 62.5));
  const plan = finishRoadSteps(cullPlanSteps(geometry, 562.5, lod, 62.5));
  expect(counts).toEqual({ vertices: 4, clipped: geometry.getAttribute('position').count, source: plan.source.length });
  geometry.dispose();
});

test('count-only admission observes later source edits after each original triangle batch', () => {
  const positions = new Float32Array(600 * 9), indices = Uint32Array.from({ length: 600 * 3 }, (_, index) => index);
  for (let triangle = 0; triangle < 600; triangle++) positions.set([0, 0, 0, 1, 1, 0, 0, 0, 1], triangle * 9);
  const steps = cullCountsSteps([{ vertices: positions.length / 3, position: index => positions[index] ?? 0, indices }], 562.5, undefined, 62.5);
  expect(steps.next().done).toBe(false); // before triangle zero
  expect(steps.next().done).toBe(false); // before triangle 256
  positions[400 * 9 + 3] = 200; positions[400 * 9 + 8] = 180;
  const counts = finishRoadSteps(steps), geometry = new BufferGeometry().setAttribute('position', new BufferAttribute(positions, 3)).setIndex(new BufferAttribute(indices, 1));
  finishRoadSteps(clipToBinsSteps(geometry, 562.5, 62.5));
  const plan = finishRoadSteps(cullPlanSteps(geometry, 562.5, [], 62.5));
  expect(counts).toEqual({ vertices: positions.length / 3, clipped: geometry.getAttribute('position').count, source: plan.source.length });
  expect(counts.clipped).toBeGreaterThan(counts.vertices);
  geometry.dispose();
});
