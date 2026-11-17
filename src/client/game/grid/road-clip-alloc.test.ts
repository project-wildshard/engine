// SB38 (meta STAGING-BUGBASH, WILDSHARD-GAME-8Z): iPhone Safari kills the page while Playing on Driftwood, as the page
// builds the grid road beside play (a staging grid whose placements changed since the build misses the compiled road).
// The road clip cut every triangle that crosses a 62.5 m tile line with a Float64Array and an object a vertex and arrays
// a polygon and a split: garbage JavaScriptCore grows its heap for. This pins the bytes a cut triangle allocates and the
// exact clip it makes (vertices, interpolated channels, index order and the byte plan's counts).
// oxlint-disable-next-line import/no-nodejs-modules -- the sampling heap profiler is read from V8 itself.
import { Session } from 'node:inspector/promises';
// oxlint-disable-next-line import/no-nodejs-modules -- one digest over the clipped geometry.
import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { BufferAttribute, BufferGeometry } from 'three';
import { clipToBinsSteps, cullCountsSteps, finishRoadSteps, ROAD_LOD } from './roadCull';

// Pinned on the code before SB38's clip cut: the cut must not move a vertex, a channel or a triangle.
const GOLDEN = '47cf2f27f4103914708323e12cfeab27788189b328649e68d1acc7f240361c7f';
// Measured 1,244 bytes a triangle before SB38 (the counting pass and the clip), 241 after; what is left is mostly the
// clip's own output (the grown attributes and index).
const BUDGET = 500;

/** A 2.4 km x 48 m deck of 3 m quads, skewed and tilted so most triangles cross tile lines, with a 4-channel grain. */
function deck(): { geometry: BufferGeometry; positions: Float32Array; indices: Uint32Array } {
  const columns = 800, rows = 16, vertices = (columns + 1) * (rows + 1), positions = new Float32Array(vertices * 3), grain = new Float32Array(vertices * 4);
  const indices = new Uint32Array(columns * rows * 6);
  let p = 0, g = 0, i = 0;
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= columns; c++) {
    positions[p++] = c * 3 - 1200 + r * 0.37; positions[p++] = Math.sin(c * 0.05) * 2 + r * 0.1; positions[p++] = r * 3.7 - 24 + c * 0.013;
    grain[g++] = c * 0.25; grain[g++] = r * 0.5; grain[g++] = (c + r) % 4; grain[g++] = c % 2;
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
    const a = r * (columns + 1) + c, b = a + 1, d = a + columns + 1, e = d + 1;
    indices[i++] = a; indices[i++] = d; indices[i++] = b; indices[i++] = b; indices[i++] = d; indices[i++] = e;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions.slice(), 3));
  geometry.setAttribute('grainUv', new BufferAttribute(grain, 4));
  geometry.setIndex(new BufferAttribute(indices.slice(), 1));
  return { geometry, positions, indices };
}

const bytes = (array: Float32Array | Uint32Array | Uint16Array): Uint8Array => new Uint8Array(array.buffer, array.byteOffset, array.byteLength);

/** Bytes allocated (collected or not) while `run` works, from V8's sampling heap profiler at a 4 KiB interval. */
async function allocated(run: () => void): Promise<number> {
  const session = new Session(); session.connect();
  try {
    await session.post('HeapProfiler.enable');
    await session.post('HeapProfiler.startSampling', { samplingInterval: 4096, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
    run();
    const { profile: sampled } = await session.post('HeapProfiler.stopSampling');
    const total = (node: { readonly selfSize: number; readonly children: readonly unknown[] }): number =>
      node.selfSize + node.children.reduce<number>((sum, child) => sum + total(child as typeof node), 0);
    return total(sampled.head);
  } finally { session.disconnect(); }
}

test('the road clip makes the same geometry and counts', () => {
  const { geometry, positions, indices } = deck();
  const counts = finishRoadSteps(cullCountsSteps([{ vertices: positions.length / 3, position: k => positions[k] ?? 0, indices }], 562.5, ROAD_LOD, 62.5));
  finishRoadSteps(clipToBinsSteps(geometry, 562.5, 62.5));
  const hash = createHash('sha256');
  for (const name of ['position', 'grainUv']) hash.update(bytes(geometry.getAttribute(name).array as Float32Array));
  const index = geometry.getIndex(); if (index === null) throw new Error('no index');
  hash.update(bytes(index.array as Uint32Array)); hash.update(JSON.stringify(counts));
  expect(counts.clipped).toBeGreaterThan(counts.vertices); // the deck is cut
  expect(hash.digest('hex')).toBe(GOLDEN);
});

test('a cut triangle allocates under its budget', async () => {
  const warm = deck(); finishRoadSteps(clipToBinsSteps(warm.geometry, 562.5, 62.5));
  // The least of three runs: a stray allocation elsewhere in the worker only ever adds.
  let least = Infinity, triangles = 0;
  for (let run = 0; run < 3; run++) {
    const { geometry, positions, indices } = deck(); triangles = indices.length / 3;
    least = Math.min(least, await allocated(() => {
      finishRoadSteps(cullCountsSteps([{ vertices: positions.length / 3, position: k => positions[k] ?? 0, indices }], 562.5, undefined, 62.5));
      finishRoadSteps(clipToBinsSteps(geometry, 562.5, 62.5));
    }));
  }
  const perTriangle = least / triangles;
  expect(perTriangle, `${perTriangle.toFixed(1)} bytes a triangle`).toBeLessThan(BUDGET);
});
