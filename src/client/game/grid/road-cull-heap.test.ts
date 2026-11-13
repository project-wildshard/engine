// IOSMEM (meta PAGE-SIZE-PLAN, WILDSHARD-GAME-8G): the iPhone killed staging's page while Playing on Driftwood. The
// memory proof (scripts/memory-proof.mjs) found the road platform's install allocating ~580 MB of short-lived JS in the
// first minute of Playing, most of it the clip's and the bin sort's growing number[] index and vertex lists. Those lists
// live on the JS heap until the install ends; typed storage keeps them off it. This pins the install's live JS-heap peak.
// oxlint-disable-next-line import/no-nodejs-modules -- the live heap is read from V8 itself, after a forced collection.
import { setFlagsFromString, getHeapStatistics } from 'node:v8';
// oxlint-disable-next-line import/no-nodejs-modules -- --expose-gc's gc() is reachable only through a fresh context.
import { runInNewContext } from 'node:vm';
import { expect, test } from 'vitest';
import { BufferAttribute, BufferGeometry } from 'three';
import { clipToBinsSteps, cullCountsSteps, cullPlanSteps, ROAD_LOD } from './roadCull';

setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc') as () => void;

/** A 2.4 km x 48 m deck of 3 m quads, skewed so many triangles cross the 62.5 m tile lines (~51k triangles). */
function deck(): { geometry: BufferGeometry; positions: Float32Array; indices: Uint32Array } {
  const columns = 800, rows = 16, positions = new Float32Array((columns + 1) * (rows + 1) * 3), indices = new Uint32Array(columns * rows * 6);
  let p = 0, i = 0;
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= columns; c++) { positions[p++] = c * 3 - 1200 + r * 0.37; positions[p++] = 0; positions[p++] = r * 3 - 24; }
  for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
    const a = r * (columns + 1) + c, b = a + 1, d = a + columns + 1, e = d + 1;
    indices[i++] = a; indices[i++] = d; indices[i++] = b; indices[i++] = b; indices[i++] = d; indices[i++] = e;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions.slice(), 3));
  geometry.setAttribute('grainUv', new BufferAttribute(new Float32Array(positions.length / 3 * 4), 4));
  geometry.setIndex(new BufferAttribute(indices.slice(), 1));
  return { geometry, positions, indices };
}

/** The live JS heap's growth over a stepped build, read after a full collection every 32 yields. */
function peakHeap<T>(steps: Generator<void, T>): number {
  gc(); const base = getHeapStatistics().used_heap_size; let peak = 0, n = 0;
  for (;;) {
    const next = steps.next();
    if (next.done === true || ++n % 32 === 0) { gc(); peak = Math.max(peak, getHeapStatistics().used_heap_size - base); }
    if (next.done === true) return peak;
  }
}

test('the road clip, bin sort and byte plan hold their index and vertex lists off the JS heap', () => {
  // The least of three fresh runs: a stray allocation elsewhere in the worker (a timer, the runner) only ever adds.
  let triangles = 0, counts = Infinity, clip = Infinity, plan = Infinity;
  for (let run = 0; run < 3; run++) {
    const { geometry, positions, indices } = deck(); triangles = indices.length / 3;
    counts = Math.min(counts, peakHeap(cullCountsSteps([{ vertices: positions.length / 3, position: k => positions[k] ?? 0, indices }], 562.5, ROAD_LOD, 62.5)));
    clip = Math.min(clip, peakHeap(clipToBinsSteps(geometry, 562.5, 62.5)));
    plan = Math.min(plan, peakHeap(cullPlanSteps(geometry, 562.5, ROAD_LOD, 62.5)));
  }
  // Bytes of live JS heap a triangle. number[] storage measured 58 / 41 / 86 (counts / clip / plan); typed storage
  // measured 17 / 1.4 / 25, what is left being the far-LOD lattice maps (one entry per lattice box) and per-bin records.
  const perTriangle = { counts: counts / triangles, clip: clip / triangles, plan: plan / triangles };
  expect(perTriangle.counts, JSON.stringify(perTriangle)).toBeLessThan(30);
  expect(perTriangle.clip, JSON.stringify(perTriangle)).toBeLessThan(8);
  expect(perTriangle.plan, JSON.stringify(perTriangle)).toBeLessThan(40);
});
