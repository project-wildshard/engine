// @vitest-environment node
// meta ROAD-RESIDENT-PLAN RR3 (J320; Jake 2026-11-13 ~10:35: "no walls anywhere": the roads are always free). The road as a dedicated
// worker holds it (`openRoad`: every baked strip, the void floor round the 25 cells, and the walls round every cell, as a worker that
// hosts none of them builds it) is swept with a flat-bottomed cylinder round the player's capsule, its bottom at what the motor
// climbs: along lanes kerb to kerb of every road segment, out through every turn-in, both ways through every junction and round every
// roundabout, with the deck under its feet probed closer than the capsule is wide. Then one seat really runs through a four-way
// junction on all four arms on the motor. A seat walking every strip would take about 480k ticks; the sweep takes about two seconds.
// The walls at a cell's edge (GC30's entryway wall, the readiness line) are GRID-CROSSING's; this pins the road itself.
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
import { GAP_HALF, RING_ISLAND, RING_OUTER, ROAD_HALF, roadLayout, SEGMENT_HALF, TURN_IN_HALF } from '../src/shared/game/grid/roadLayout';
import { openRoad } from '../src/server/host/standalone/roadWorld';
import catalogue from '../src/shared/game/grid/singleplayer.json' with { type: 'json' };
import { bakedGridCollision } from './fixtures/gridCollision';

const j305 = new GridAssembly({ developer: false, devserver: false }, catalogue.grid), layout = roadLayout(j305, slug => slug);
/**
 * The sweep is a flat-bottomed cylinder round the player's capsule, its bottom this far up: about what the motor climbs (its 0.35 m
 * autostep climbs about 0.41 m in a real walk). A capsule's round bottom would let a thin post between two lanes pass under it.
 */
const { radius: RADIUS, height: HEIGHT, step: STEP } = PLAYER_CAPSULE, LIFT = STEP + 0.05;
/** The outer lanes keep the capsule this far inside the kerb. */
const KERB = 0.25, EDGE = ROAD_HALF - RADIUS - KERB;
/** Lanes across the road, close enough that their capsules overlap: nothing on the deck a player could meet stands between two. */
const ACROSS: readonly number[] = (() => { const n = Math.ceil(2 * EDGE / (1.8 * RADIUS)); return Array.from({ length: n + 1 }, (_, i) => -EDGE + 2 * EDGE * i / n); })();
/** Deck under the feet: a probe every `PROBE` metres must find ground within this of road level (0). Closer than the capsule is wide. */
const DECK = 0.3, PROBE = RADIUS;
/** Findings kept per lane: a long wall would give one a metre. */
const PER_LANE = 4;
/** Turn-in lanes end short of the wall a worker stands round a cell it does not host (`addCellWalls`: 2 m out, 0.5 m thick). */
const TURN_IN_END = GAP_HALF - 2 - 0.5 - RADIUS - KERB;

interface Finding { readonly strip: string; readonly lane: string; readonly at: { readonly x: number; readonly y: number; readonly z: number }; readonly what: 'wall' | 'hole' }
interface Lane { readonly strip: string; readonly lane: string; readonly from: { readonly x: number; readonly z: number }; readonly to: { readonly x: number; readonly z: number } }

/** Ring lanes round a roundabout's island, between it and the outer kerb. */
const RINGS: readonly number[] = [RING_ISLAND + RADIUS + KERB, (RING_ISLAND + RING_OUTER) / 2, RING_OUTER - RADIUS - KERB];

/**
 * Every lane the bench sweeps: each segment end to end, kerb to kerb (`ACROSS`); each segment's turn-in (its midpoint) out to the cells
 * on each side it has one; each junction across both ways; and round each roundabout's ring.
 */
function lanes(): readonly Lane[] {
  const out: Lane[] = [];
  for (const segment of layout.segments) {
    const at = (s: number, t: number): { x: number; z: number } => segment.axis === 'z' ? { x: segment.centre.x + t, z: segment.centre.z + s } : { x: segment.centre.x + s, z: segment.centre.z + t };
    for (const t of ACROSS) out.push({ strip: segment.id, lane: `t ${t.toFixed(2)}`, from: at(-SEGMENT_HALF, t), to: at(SEGMENT_HALF, t) });
    const turnIn = TURN_IN_HALF - RADIUS - KERB;
    for (const s of [-turnIn, 0, turnIn]) for (const [side, cell] of [[-1, segment.low], [1, segment.high]] as const)
      if (cell !== undefined) out.push({ strip: segment.id, lane: `turn-in ${side < 0 ? 'low' : 'high'}, s ${s.toFixed(2)}`, from: at(s, 0), to: at(s, side * TURN_IN_END) });
  }
  for (const junction of layout.junctions) {
    const { x, z } = junction.centre;
    for (const t of ACROSS) {
      out.push({ strip: junction.id, lane: `x, t ${t.toFixed(2)}`, from: { x: x - GAP_HALF, z: z + t }, to: { x: x + GAP_HALF, z: z + t } });
      out.push({ strip: junction.id, lane: `z, t ${t.toFixed(2)}`, from: { x: x + t, z: z - GAP_HALF }, to: { x: x + t, z: z + GAP_HALF } });
    }
    if (junction.roundabout) for (const r of RINGS) {
      const chords = Math.ceil(2 * Math.PI * r), point = (i: number): { x: number; z: number } => ({ x: x + r * Math.cos(2 * Math.PI * i / chords), z: z + r * Math.sin(2 * Math.PI * i / chords) });
      for (let i = 0; i < chords; i++) out.push({ strip: junction.id, lane: `ring r ${r.toFixed(2)}`, from: point(i), to: point(i + 1) });
    }
  }
  return out;
}

/** Sweep each lane with the player's capsule; every wall it meets and every metre with no deck under it is a finding. */
function sweep(road: SimHost, all: readonly Lane[]): readonly Finding[] {
  const { R, world } = road.physics, body = new R.Cylinder(HEIGHT / 2, RADIUS), rot = { x: 0, y: 0, z: 0, w: 1 }, filter = groups('PLAYER'), y = LIFT + HEIGHT / 2;
  const findings: Finding[] = [];
  for (const lane of all) {
    const dx = lane.to.x - lane.from.x, dz = lane.to.z - lane.from.z, length = Math.hypot(dx, dz), dir = { x: dx / length, y: 0, z: dz / length }, kept = findings.length;
    for (let s = 0; s < length && findings.length - kept < PER_LANE;) {
      const hit = world.castShape({ x: lane.from.x + dir.x * s, y, z: lane.from.z + dir.z * s }, rot, dir, body, 0, length - s, true, R.QueryFilterFlags.EXCLUDE_SENSORS, filter);
      if (hit === null) break;
      s += hit.time_of_impact;
      findings.push({ strip: lane.strip, lane: lane.lane, at: { x: lane.from.x + dir.x * s, y, z: lane.from.z + dir.z * s }, what: 'wall' });
      s += 1;
    }
    const steps = Math.ceil(length / PROBE);
    for (let i = 0; i <= steps && findings.length - kept < PER_LANE; i++) {
      const s = length * i / steps, x = lane.from.x + dir.x * s, z = lane.from.z + dir.z * s, ray = world.castRay(new R.Ray({ x, y: LIFT, z }, { x: 0, y: -1, z: 0 }), LIFT + DECK, true, R.QueryFilterFlags.EXCLUDE_SENSORS, filter);
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
const roadOf = (extra: (road: SimHost) => void = () => undefined, leave?: string): SimHost => {
  const road = openRoad(rapier, j305.cells, strips.filter(strip => strip.id !== leave), j305.cells); disposers.push(() => { road.dispose(); });
  extra(road); road.physics.step(); return road;
};

test('every baked strip is a road segment or a junction the bench sweeps', () => {
  const swept = new Set(lanes().map(lane => lane.strip));
  expect(strips.map(strip => strip.id).filter(id => !swept.has(id))).toEqual([]);
  expect([...swept].filter(id => !strips.some(strip => strip.id === id))).toEqual([]);
  expect(CONTENT_CAPS.pitch).toBe(562.5);
});

/**
 * One seat on the motor, run `metres` from `from` heading `yaw`, one fixed tick at a time: how far it got along `ahead`, how far it
 * drifted off that line, and every half second (after the first) it made under 80 % of its own steady pace (the median half second).
 */
function walk(road: SimHost, from: { readonly x: number; readonly z: number }, yaw: number, ahead: { readonly x: number; readonly z: number }, metres: number): { readonly went: number; readonly drift: number; readonly stalls: readonly { x: number; z: number }[]; readonly low: number; readonly high: number } {
  const lead = road.players.get(LEAD_SEAT);
  if (lead !== undefined) { lead.motor.setEnabled(false); road.parked.add(lead.id); }
  const player = road.addPlayer('walker', { x: from.x, y: 0.2, z: from.z }, yaw), stalls: { x: number; z: number }[] = [];
  const command = (seq: number): NetCommand => ({ seq, viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw, pitch: 0, buttons: 0 });
  let low = Infinity, high = -Infinity, went = 0, drift = 0, last = { x: from.x, z: from.z };
  const paces: { readonly metres: number; readonly at: { x: number; z: number } }[] = [];
  for (let tick = 1; tick <= 60 * 40 && went < metres; tick++) {
    road.step(new Map([['walker', command(tick)]]));
    const at = player.position;
    went = (at.x - from.x) * ahead.x + (at.z - from.z) * ahead.z;
    drift = Math.max(drift, Math.abs((at.x - from.x) * ahead.z - (at.z - from.z) * ahead.x));
    if (tick > 30) { low = Math.min(low, at.y); high = Math.max(high, at.y); }
    if (tick % 30 === 0) { if (tick > 30 && went < metres) paces.push({ metres: Math.hypot(at.x - last.x, at.z - last.z), at: { x: at.x, z: at.z } }); last = { x: at.x, z: at.z }; }
  }
  road.removePlayer('walker');
  const steady = [...paces].sort((a, b) => a.metres - b.metres)[Math.floor(paces.length / 2)]?.metres ?? 0;
  for (const pace of paces) if (pace.metres < Math.max(0.8 * steady, 1)) stalls.push(pace.at);
  return { went, drift, stalls, low, high };
}
/** A crate on the deck, as a placed prop would stand: one block of the road. */
const crate = (road: SimHost, x: number, z: number): void => {
  const { R, world } = road.physics;
  world.createCollider(R.ColliderDesc.cuboid(1, 1, 1).setTranslation(x, 1, z).setCollisionGroups(groups('WORLD')));
};
/** cross.0.0 is a four-way junction (a roundabout), Driftwood's north-east corner. */
const junction = layout.junctions.find(row => row.id === 'cross.0.0');

test('the roads are always free: the sweep meets no wall and never leaves the deck on any strip', () => {
  const all = lanes(), findings = sweep(roadOf(), all);
  expect(all.filter(lane => lane.lane.startsWith('t ')).length).toBe(ACROSS.length * layout.segments.length);
  expect(all.filter(lane => lane.lane.startsWith('turn-in')).length).toBe(3 * 2 * j305.cells.length * 2);
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
  expect(findings.filter(row => row.strip === 'gap.x.0.0').every(row => Math.abs(row.at.x - 281.25) <= 1 + RADIUS && Math.abs(row.at.z - 100) < 2)).toBe(true);
  expect(findings.filter(row => row.strip === 'gap.z.-1.1').every(row => Math.abs(row.at.x + 442.5) < 1.5)).toBe(true);
  // The road's own kerb (its road walls and guard rails, G101) stands at the road edge: a lane run along it meets them.
  const kerb = sweep(roadOf(), [{ strip: 'gap.x.0.0', lane: 'kerb', from: { x: 281.25 + ROAD_HALF, z: -200 }, to: { x: 281.25 + ROAD_HALF, z: 200 } }]);
  expect(kerb.some(row => row.what === 'wall')).toBe(true);
});

test('the bench sees a low post between two lanes: 0.45 m, more than the motor climbs, and less than a capsule\'s round bottom', () => {
  // gap.x.0.0 runs along z at x 281.25; its lanes are ACROSS apart, so this post stands midway between two of them.
  const between = 281.25 + ((ACROSS[10] ?? 0) + (ACROSS[11] ?? 0)) / 2;
  const findings = sweep(roadOf(row => {
    const { R, world } = row.physics;
    world.createCollider(R.ColliderDesc.cuboid(0.05, 0.225, 0.05).setTranslation(between, 0.225, -60).setCollisionGroups(groups('WORLD')));
  }), lanes());
  expect(findings.length).toBeGreaterThan(0);
  expect(findings.every(row => row.strip === 'gap.x.0.0' && row.what === 'wall' && Math.abs(row.at.z + 60) < 2), JSON.stringify(findings)).toBe(true);
});

test('the bench sees a hole: a strip missing from the road, and a lane over a cell\'s square, have no deck', () => {
  const missing = sweep(roadOf(undefined, 'gap.x.0.0'), lanes());
  expect(missing.length).toBeGreaterThan(0);
  expect(missing.some(row => row.strip === 'gap.x.0.0')).toBe(true);
  // Every hole lies on its square (a junction lane's last probe sits on the seam with it).
  expect(missing.every(row => row.what === 'hole' && Math.abs(row.at.x - 281.25) <= GAP_HALF + 1e-6 && Math.abs(row.at.z) <= SEGMENT_HALF + 1e-6), JSON.stringify(missing.filter(row => row.strip !== 'gap.x.0.0').slice(0, 5))).toBe(true);
  // Driftwood's own square: its world is the cell's, so the road's has nothing there but the ground far below.
  const square = sweep(roadOf(), [{ strip: 'driftwood', lane: 'centre', from: { x: 0, z: 0 }, to: { x: 0, z: 10 } }]);
  expect(square.map(row => row.what)).toEqual(Array.from({ length: PER_LANE }, () => 'hole'));
});

test('a seat on the motor runs through a four-way junction on all four arms without a stop', () => {
  if (junction === undefined || !junction.roundabout) throw new Error('cross.0.0 is a four-way junction');
  const { x, z } = junction.centre, reach = GAP_HALF + 40;
  // The motor faces atan2(own - target): yaw -pi/2 runs +x, pi/2 runs -x, pi runs +z, 0 runs -z.
  const runs = [[{ x: x - reach, z }, -Math.PI / 2, { x: 1, z: 0 }], [{ x: x + reach, z }, Math.PI / 2, { x: -1, z: 0 }], [{ x, z: z - reach }, Math.PI, { x: 0, z: 1 }], [{ x, z: z + reach }, 0, { x: 0, z: -1 }]] as const;
  for (const [from, yaw, ahead] of runs) {
    const run = walk(roadOf(), from, yaw, ahead, 2 * reach);
    expect(run.stalls, `slowed at ${JSON.stringify(run.stalls)}`).toEqual([]);
    expect(run.went).toBeGreaterThanOrEqual(2 * reach);
    expect(run.drift).toBeLessThan(0.5);
    expect(run.low).toBeGreaterThan(-DECK); expect(run.high).toBeLessThan(DECK);
  }
  // Red with a crate on its line: the same run stands at the crate.
  const blocked = walk(roadOf(row => { crate(row, x, z); }), { x: x - reach, z }, -Math.PI / 2, { x: 1, z: 0 }, 2 * reach);
  expect(blocked.went).toBeLessThan(reach);
  expect(blocked.stalls.length).toBeGreaterThan(0);
});
