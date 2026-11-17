// SB38 (meta STAGING-BUGBASH, WILDSHARD-GAME-8Z): iPhone Safari kills the page while Playing on Driftwood. A staging grid
// whose placements changed since the build (auto-placed uploads) misses the compiled road, so the page builds every seam
// itself right after play starts, beside the far ring; WebKit's page process then climbs from 1.15 to 1.8 GB in three
// seconds. The seam lattice's certification (seamLattice.ts, seamError.ts) was the largest short-lived allocator in it:
// a filtered copy of the kept rows per candidate, a fresh array per visited triangle and closures per colour transform.
// Garbage is not free on a phone: JavaScriptCore grows its heap with the allocation rate. This pins the bytes a seam
// allocates while it is built, and the exact mesh it builds.
// oxlint-disable-next-line import/no-unassigned-import -- Match the simulation realm before evaluating seam constants.
import '../core/portableMathFirst';
// oxlint-disable-next-line import/no-nodejs-modules -- the sampling heap profiler is read from V8 itself.
import { Session } from 'node:inspector/promises';
// oxlint-disable-next-line import/no-nodejs-modules -- one digest over the built meshes.
import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { cornerSeamGeometry, seamGeometrySteps, type SeamFeature, type SeamGeometry } from './seamGeometry';
import type { StripCorner, StripMesh, StripProfile } from './strips';

// Replay the pre-SB38 lattice (8af8cb73) with the same portable Math. Native trig rounds differently on x64 and arm64.
const GOLDEN = '80eb37f5c18215a28d1605a0e7c6ed737ec6ed83d7c776b1cf094f00a5075952';
// Measured 934 MiB a seam before SB38 (7.7 s for four), 85 MiB after (1.4 s): no filtered row copy a candidate,
// no array a visited triangle, no closures or scratch arrays a triangle error.
const BUDGET = 160 * 1048576;

/** A varied edge: hills and a colour ramp, so the certification visits many candidate rows. */
const profile = (seed: number): StripProfile => ({ roadHeight: 0,
  heights: Array.from({ length: 257 }, (_, i) => Math.abs(i * 500 / 256 - 250) <= 10 ? 0 : 2.5 * Math.sin(i * 0.071 + seed) + 1.2 * Math.sin(i * 0.23 + seed * 2.1) + (i % 17 === 0 ? 0.4 : 0)),
  colours: Array.from({ length: 257 }, (_, i) => [0.4 + 0.2 * Math.sin(i * 0.05 + seed), 0.35 + 0.15 * Math.cos(i * 0.031 + seed), 0.2 + 0.1 * Math.sin(i * 0.11)]) });

const seams = (): { id: string; axis: 'x' | 'z'; origin: { x: number; z: number }; edges: [{ profile: StripProfile; entryWidth: number }, { profile: StripProfile; entryWidth: number }] }[] =>
  [0, 1, 2, 3].map(seed => ({ id: `s${String(seed)}`, axis: seed % 2 === 0 ? 'x' as const : 'z' as const, origin: { x: seed * 562.5, z: 0 },
    edges: [{ profile: profile(seed), entryWidth: seed === 1 ? 0 : 8 }, { profile: profile(seed + 0.5), entryWidth: seed === 1 ? 0 : 8 }] }));

const build = (input: ReturnType<typeof seams>[number]): SeamGeometry => {
  const steps = seamGeometrySteps(input);
  for (;;) { const next = steps.next(); if (next.done === true) return next.value; }
};

const digest = (built: readonly { readonly mesh: StripMesh; readonly features: readonly SeamFeature[] }[]): string => {
  const hash = createHash('sha256');
  for (const seam of built) {
    hash.update(new Uint8Array(seam.mesh.positions.buffer, seam.mesh.positions.byteOffset, seam.mesh.positions.byteLength));
    hash.update(new Uint8Array(seam.mesh.colours.buffer, seam.mesh.colours.byteOffset, seam.mesh.colours.byteLength));
    hash.update(new Uint8Array(seam.mesh.indices.buffer, seam.mesh.indices.byteOffset, seam.mesh.indices.byteLength));
    hash.update(JSON.stringify(seam.features));
  }
  return hash.digest('hex');
};

/** Bytes allocated (collected or not) while `run` builds, from V8's sampling heap profiler at a 4 KiB interval. */
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

test('the seam lattice builds the same meshes', () => {
  const corners: [StripCorner, StripCorner, StripCorner, StripCorner] = [{ height: 3, colour: [0.5, 0.4, 0.3] }, { height: -1, colour: [0.2, 0.3, 0.4] },
    { height: 5, colour: [0.6, 0.5, 0.2] }, { height: 0.5, colour: [0.3, 0.6, 0.3], shore: true }];
  const built = [...seams().map(build), cornerSeamGeometry({ id: 'c', origin: { x: 0, z: 0 }, corners })];
  expect(digest(built)).toBe(GOLDEN);
});

test('a seam allocates under its budget while it is built', async () => {
  const inputs = seams(); build(inputs[0] ?? (() => { throw new Error('no seam'); })()); // warm the JIT
  // The least of three runs: a stray allocation elsewhere in the worker only ever adds.
  let least = Infinity;
  for (let run = 0; run < 3; run++) least = Math.min(least, await allocated(() => { for (const input of inputs) build(input); }));
  const perSeam = least / inputs.length;
  expect(perSeam, `${String(Math.round(perSeam / 1024))} KiB a seam`).toBeLessThan(BUDGET);
});
