// @vitest-environment happy-dom
// oxlint-disable-next-line import/no-unassigned-import -- The bits these files pin are the portable ones.
import '../src/shared/engine/core/portableMathFirst';
import { PerspectiveCamera } from 'three';
import { beforeAll, expect, test } from 'vitest';
import { Player } from '../src/client/engine/player/Player';
import { NET_BUTTONS } from '../src/shared/engine/input/netButtons';
import { FIXED_STEP } from '../src/shared/engine/core/fixedStep';
import { Physics } from '../src/shared/engine/physics/Physics';
import { addTerrain } from '../src/shared/engine/physics/terrain';
import type { Rapier } from '../src/shared/engine/physics/rapier';
import { loadCourseRapier } from './fixtures/motion-trace/parity';

// Jake, 2026-11-12 (preview, Mossgate, build 243820b7): "glitched into the pond cant use shift to surface". Mossgate's pond
// is a 5 m water circle over a crater the shard's 257² lattice (1.95 m a sample) smears past the circle: just outside the
// mask the ground is still ~2 m under the waterline. A swimmer pushing at the bank under water left the mask there, went
// "dry" on foot in a pit under the surface, slid back in, swam a few ticks, and went dry again: the head never came up and
// SURFACE did nothing. Here on the real Player and its real motor: the mask's edge over deep ground holds the swimmer, so the
// float brings the head up and keeps it up; and a pond whose bowl shelves to a beach inside the mask is swum out of.

let R: Rapier;
beforeAll(async () => { R = await loadCourseRapier(); });

const RES = 257, SIZE = 500, D = SIZE / (RES - 1), CX = 25, CZ = 20, RADIUS = 5;
type Ground = (r: number) => number;
/** Mossgate as shipped in 243820b7: −3 inside the circle, 0 outside (its noise left out). */
const PIT: Ground = r => r < RADIUS ? -3 : 0;
/** A bowl that shelves at 37° to a beach inside the circle (the Template's graded pond). */
const BOWL: Ground = r => Math.min(0, -3 + Math.max(0, r - 1.5) * 0.75);

function pond(ground: Ground): { grid: Float32Array; heightAt: (x: number, z: number) => number } {
  const grid = new Float32Array(RES * RES);
  for (let iz = 0; iz < RES; iz++) for (let ix = 0; ix < RES; ix++) grid[iz * RES + ix] = ground(Math.hypot(ix * D - SIZE / 2 - CX, iz * D - SIZE / 2 - CZ));
  const at = (ix: number, iz: number): number => grid[Math.max(0, Math.min(RES - 1, iz)) * RES + Math.max(0, Math.min(RES - 1, ix))] ?? 0;
  return { grid, heightAt: (x, z) => {
    const fx = (x + SIZE / 2) / D, fz = (z + SIZE / 2) / D, ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
    return (at(ix, iz) * (1 - tx) + at(ix + 1, iz) * tx) * (1 - tz) + (at(ix, iz + 1) * (1 - tx) + at(ix + 1, iz + 1) * tx) * tz;
  } };
}
const water = (x: number, z: number): number | null => Math.hypot(x - CX, z - CZ) < RADIUS ? 0 : null;

interface Run { underAtEnd: number; flips: number; out: boolean }
/** Walk in from `deg`, dive for 2 s, swim back at the bank still holding DIVE (under the lip), then hold SURFACE (Shift). */
function swimAtTheBank(ground: Ground, deg: number): Run {
  const physics = new Physics(R), { grid, heightAt } = pond(ground);
  addTerrain(physics, grid, RES, SIZE);
  const player = new Player(new PerspectiveCamera(), physics, document.createElement('canvas'), { waterLine: { update: () => undefined, setHint: () => undefined } });
  try {
    player.bindFrame(physics, player.motor, { heightAt, waterSurfaceAt: water, platforms: [] });
    const a = deg * Math.PI / 180, sx = CX + Math.cos(a) * 9, sz = CZ + Math.sin(a) * 9;
    player.position.set(sx, heightAt(sx, sz), sz); player.motor.resetAt(player.position); physics.step();
    let underAtEnd = 0, flips = 0, was = false;
    for (let t = 0; t < 1000; t++) {
      const p = player.position, inward = Math.atan2(CZ - p.z, CX - p.x), dir = t < 200 ? inward : inward + Math.PI;
      const go = t < 200 || t >= 320, buttons = t < 200 ? 0 : t < 600 ? NET_BUTTONS.dive : NET_BUTTONS.surface | NET_BUTTONS.sprint;
      physics.step();
      player.step(FIXED_STEP, { steer: { keyX: 0, keyY: 0, stickX: go ? Math.cos(dir) : 0, stickY: go ? -Math.sin(dir) : 0 }, yaw: 0, pitch: 0, buttons });
      if (t >= 700) {
        if (player.swimming !== was) flips++;
        // the eye under the waterline while the pond is around the feet: what Jake saw
        if (p.y + EYE < 0 && Math.hypot(p.x - CX, p.z - CZ) < RADIUS + 2) underAtEnd++;
      }
      was = player.swimming;
    }
    const p = player.position;
    return { underAtEnd, flips, out: !player.swimming && p.y > -0.1 && Math.hypot(p.x - CX, p.z - CZ) > RADIUS };
  } finally { player.motor.dispose(); physics.dispose(); }
}

/** The page's eye over the feet (swim.ts FLOAT_DEPTH's 1.68). */
const EYE = 1.68;
const BEARINGS = [0, 60, 120, 180, 240, 300] as const;

test('a swimmer under the bank of a pit pond surfaces on SURFACE and stays up: no dry pit under the waterline', () => {
  for (const deg of BEARINGS) {
    const run = swimAtTheBank(PIT, deg);
    expect({ deg, under: run.underAtEnd, flips: run.flips }).toEqual({ deg, under: 0, flips: 0 });
  }
});

test('a pond whose bowl shelves to a beach inside its mask is swum out of from every side', () => {
  for (const deg of BEARINGS) {
    const run = swimAtTheBank(BOWL, deg);
    expect({ deg, ...run }).toEqual({ deg, underAtEnd: 0, flips: 0, out: true });
  }
});
