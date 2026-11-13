// @vitest-environment node
// meta ROAD-RESIDENT-PLAN RR3 (J320; Jake 2026-11-13 ~10:35: "no walls anywhere": the roads are always free). The road as a dedicated
// worker holds it (`openRoad`: every baked strip, the void floor round the 25 cells, and the walls round every cell, as a worker that
// hosts none of them builds it) is swept with the player's own capsule, lifted by its autostep, along lanes kerb to kerb of every road
// segment and both ways through every junction, with the deck under its feet probed every metre. Then one seat really runs through a
// four-way junction on the motor. A seat walking every strip would take about 480k ticks; the sweep covers the same road in about a
// second. The walls at a cell's edge (GC30's entryway wall, the readiness line) are GRID-CROSSING's; this pins the road itself.
import { afterAll, beforeAll, expect, test } from 'vitest';
import { fixtureBytes } from '@wildshard/engine/test/nativeBytes';
import { CONTENT_CAPS } from '../src/shared/engine/core/config';
import { groups } from '../src/shared/engine/physics/groups';
import { PLAYER_CAPSULE } from '../src/shared/engine/physics/CharacterMotor';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import type { SimHost } from '../src/server/engine/sim';
import { LEAD_SEAT } from '../src/server/host/standalone/cellWorld';
import type { NetCommand } from '@wildshard/wire/netCommand';
import { GridAssembly } from '../src/shared/game/grid/assembly';
import type { GridCollisionStrip } from '../src/shared/game/grid/gridCollision';
import { GAP_HALF, ROAD_HALF, roadLayout, SEGMENT_HALF } from '../src/shared/game/grid/roadLayout';
import { openRoad } from '../src/server/host/standalone/roadWorld';
import catalogue from '../src/shared/game/grid/singleplayer.json' with { type: 'json' };
import { bakedGridCollision } from './fixtures/gridCollision';

const j305 = new GridAssembly({ developer: false, devserver: false }, catalogue.grid), layout = roadLayout(j305, slug => slug);
/** The capsule rides this far up: what is lower, the motor's autostep climbs (`PLAYER_CAPSULE.step`). */
const { radius: RADIUS, height: HEIGHT, step: STEP } = PLAYER_CAPSULE, HALF = HEIGHT / 2 - RADIUS, LIFT = STEP + 0.05;
/** The outer lanes keep the capsule this far inside the kerb. */
const KERB = 0.25, EDGE = ROAD_HALF - RADIUS - KERB;
/** Lanes across the road, close enough that their capsules overlap: nothing on the deck a player could meet stands between two. */
const ACROSS: readonly number[] = (() => { const n = Math.ceil(2 * EDGE / (1.8 * RADIUS)); return Array.from({ length: n + 1 }, (_, i) => -EDGE + 2 * EDGE * i / n); })();
/** Deck under the feet: a probe each metre must find ground within this of road level (0). */
const DECK = 0.3;

interface Finding { readonly strip: string; readonly lane: string; readonly at: { readonly x: number; readonly y: number; readonly z: number }; readonly what: 'wall' | 'hole' }
interface Lane { readonly strip: string; readonly lane: string; readonly from: { readonly x: number; readonly z: number }; readonly to: { readonly x: number; readonly z: number } }

/** Every lane the bench sweeps: each segment end to end, kerb to kerb (`ACROSS`), and each junction across both ways. */
function lanes(): readonly Lane[] {
  const out: Lane[] = [];
  for (const segment of layout.segments) for (const t of ACROSS) {
    const at = (s: number): { x: number; z: number } => segment.axis === 'z' ? { x: segment.centre.x + t, z: segment.centre.z + s } : { x: segment.centre.x + s, z: segment.centre.z + t };
    out.push({ strip: segment.id, lane: `t ${t.toFixed(2)}`, from: at(-SEGMENT_HALF), to: at(SEGMENT_HALF) });
  }
  for (const junction of layout.junctions) for (const t of ACROSS) {
    const { x, z } = junction.centre;
    out.push({ strip: junction.id, lane: `x, t ${t.toFixed(2)}`, from: { x: x - GAP_HALF, z: z + t }, to: { x: x + GAP_HALF, z: z + t } });
    out.push({ strip: junction.id, lane: `z, t ${t.toFixed(2)}`, from: { x: x + t, z: z - GAP_HALF }, to: { x: x + t, z: z + GAP_HALF } });
  }
  return out;
}

/** Sweep each lane with the player's capsule; every wall it meets and every metre with no deck under it is a finding. */
function sweep(road: SimHost, all: readonly Lane[]): readonly Finding[] {
  const { R, world } = road.physics, capsule = new R.Capsule(HALF, RADIUS), rot = { x: 0, y: 0, z: 0, w: 1 }, filter = groups('PLAYER'), y = LIFT + HEIGHT / 2;
  const findings: Finding[] = [];
  for (const lane of all) {
    const dx = lane.to.x - lane.from.x, dz = lane.to.z - lane.from.z, length = Math.hypot(dx, dz), dir = { x: dx / length, y: 0, z: dz / length };
    for (let s = 0; s < length;) {
      const hit = world.castShape({ x: lane.from.x + dir.x * s, y, z: lane.from.z + dir.z * s }, rot, dir, capsule, 0, length - s, true, R.QueryFilterFlags.EXCLUDE_SENSORS, filter);
      if (hit === null) break;
      s += hit.time_of_impact;
      findings.push({ strip: lane.strip, lane: lane.lane, at: { x: lane.from.x + dir.x * s, y, z: lane.from.z + dir.z * s }, what: 'wall' });
      s += 1;
    }
    for (let s = 0; s <= length; s += 1) {
      const x = lane.from.x + dir.x * s, z = lane.from.z + dir.z * s, ray = world.castRay(new R.Ray({ x, y: LIFT, z }, { x: 0, y: -1, z: 0 }), LIFT + DECK, true, R.QueryFilterFlags.EXCLUDE_SENSORS, filter);
      if (ray === null) findings.push({ strip: lane.strip, lane: lane.lane, at: { x, y: Number.NaN, z }, what: 'hole' });
    }
  }
  return findings;
}

let rapier: Rapier, strips: readonly GridCollisionStrip[];
const disposers: (() => void)[] = [];
beforeAll(async () => {
  rapier = await loadRapier(Uint8Array.from(fixtureBytes(new URL('../node_modules/@dimforge/rapier3d-simd/rapier_wasm3d_bg.wasm', import.meta.url))));
  strips = await bakedGridCollision();
}, 120_000);
afterAll(() => { for (const dispose of disposers.reverse()) dispose(); });
const roadOf = (extra: (road: SimHost) => void = () => undefined): SimHost => {
  const road = openRoad(rapier, j305.cells, strips, j305.cells); disposers.push(() => { road.dispose(); });
  extra(road); road.physics.step(); return road;
};

test('every baked strip is a road segment or a junction the bench sweeps', () => {
  const swept = new Set(lanes().map(lane => lane.strip));
  expect(strips.map(strip => strip.id).filter(id => !swept.has(id))).toEqual([]);
  expect([...swept].filter(id => !strips.some(strip => strip.id === id))).toEqual([]);
  expect(CONTENT_CAPS.pitch).toBe(562.5);
});

/** One seat on the motor, run `metres` from `from` heading `yaw`, one fixed tick at a time: how far it got along `ahead` and every half second it stood. */
function walk(road: SimHost, from: { readonly x: number; readonly z: number }, yaw: number, ahead: { readonly x: number; readonly z: number }, metres: number): { readonly went: number; readonly stalls: readonly { x: number; z: number }[]; readonly low: number; readonly high: number } {
  const lead = road.players.get(LEAD_SEAT);
  if (lead !== undefined) { lead.motor.setEnabled(false); road.parked.add(lead.id); }
  const player = road.addPlayer('walker', { x: from.x, y: 0.2, z: from.z }, yaw), stalls: { x: number; z: number }[] = [];
  const command = (seq: number): NetCommand => ({ seq, viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw, pitch: 0, buttons: 0 });
  let low = Infinity, high = -Infinity, went = 0, last = { x: from.x, z: from.z };
  for (let tick = 1; tick <= 60 * 40 && went < metres; tick++) {
    road.step(new Map([['walker', command(tick)]]));
    const at = player.position;
    went = (at.x - from.x) * ahead.x + (at.z - from.z) * ahead.z;
    if (tick > 30) { low = Math.min(low, at.y); high = Math.max(high, at.y); }
    if (tick % 30 === 0) { if (Math.hypot(at.x - last.x, at.z - last.z) < 1) stalls.push({ x: at.x, z: at.z }); last = { x: at.x, z: at.z }; }
  }
  road.removePlayer('walker');
  return { went, stalls, low, high };
}
/** A crate on the deck, as a placed prop would stand: one block of the road. */
const crate = (road: SimHost, x: number, z: number): void => {
  const { R, world } = road.physics;
  world.createCollider(R.ColliderDesc.cuboid(1, 1, 1).setTranslation(x, 1, z).setCollisionGroups(groups('WORLD')));
};
/** cross.0.0 is a four-way junction (a roundabout), Driftwood's north-east corner. */
const junction = layout.junctions.find(row => row.id === 'cross.0.0');

test('the roads are always free: the capsule meets no wall and never leaves the deck on any strip', () => {
  const all = lanes(), findings = sweep(roadOf(), all);
  expect(all.length).toBe(ACROSS.length * (layout.segments.length + 2 * layout.junctions.length));
  expect(findings.map(row => `${row.what} on ${row.strip} (${row.lane}) at ${row.at.x.toFixed(1)}, ${row.at.z.toFixed(1)}`)).toEqual([]);
});

test('the bench sees a wall: a crate mid-road on gap.x.0.0, a thin post between lanes on gap.z.-1.1, and the kerb walls', () => {
  const road = roadOf(row => {
    crate(row, 281.25, 100);
    // A 0.3 m post 3.3 m off gap.z.-1.1's centre line (it runs along x at z 843.75): only lanes that overlap meet it.
    const { R, world } = row.physics;
    world.createCollider(R.ColliderDesc.cuboid(0.15, 1, 0.15).setTranslation(-562.5 + 120, 1, 843.75 + 3.3).setCollisionGroups(groups('WORLD')));
  }), findings = sweep(road, lanes());
  expect(findings.every(row => row.what === 'wall'), JSON.stringify(findings)).toBe(true);
  expect([...new Set(findings.map(row => row.strip))].sort()).toEqual(['gap.x.0.0', 'gap.z.-1.1']);
  expect(findings.filter(row => row.strip === 'gap.x.0.0').every(row => Math.abs(row.at.x - 281.25) <= EDGE && Math.abs(row.at.z - 100) < 2)).toBe(true);
  expect(findings.filter(row => row.strip === 'gap.z.-1.1').every(row => Math.abs(row.at.x + 442.5) < 1.5)).toBe(true);
  // The road's own kerb (its road walls and guard rails, G101) stands at the road edge: a lane run along it meets them.
  const kerb = sweep(roadOf(), [{ strip: 'gap.x.0.0', lane: 'kerb', from: { x: 281.25 + ROAD_HALF, z: -200 }, to: { x: 281.25 + ROAD_HALF, z: 200 } }]);
  expect(kerb.some(row => row.what === 'wall')).toBe(true);
});

test('the bench sees a hole: a lane over a cell\'s square, where the road world has no deck, finds no ground', () => {
  // Driftwood's own square: its world is the cell's, so the road's has nothing there but the ground far below.
  const findings = sweep(roadOf(), [{ strip: 'driftwood', lane: 'centre', from: { x: 0, z: 0 }, to: { x: 0, z: 10 } }]);
  expect(findings.map(row => row.what)).toEqual(Array.from({ length: 11 }, () => 'hole'));
});

test('a seat on the motor runs through a four-way junction both ways without a stop', () => {
  if (junction === undefined || !junction.roundabout) throw new Error('cross.0.0 is a four-way junction');
  const { x, z } = junction.centre, reach = GAP_HALF + 40;
  // The motor faces atan2(own - target): yaw -pi/2 runs +x, yaw pi runs +z.
  for (const [from, yaw, ahead] of [[{ x: x - reach, z }, -Math.PI / 2, { x: 1, z: 0 }], [{ x, z: z - reach }, Math.PI, { x: 0, z: 1 }]] as const) {
    const run = walk(roadOf(), from, yaw, ahead, 2 * reach);
    expect(run.stalls, `stood at ${JSON.stringify(run.stalls)}`).toEqual([]);
    expect(run.went).toBeGreaterThanOrEqual(2 * reach);
    expect(run.low).toBeGreaterThan(-DECK); expect(run.high).toBeLessThan(DECK + 0.5);
  }
  // Red with a crate on its line: the same run stands at the crate.
  const blocked = walk(roadOf(row => { crate(row, x, z); }), { x: x - reach, z }, -Math.PI / 2, { x: 1, z: 0 }, 2 * reach);
  expect(blocked.went).toBeLessThan(reach);
  expect(blocked.stalls.length).toBeGreaterThan(0);
});
