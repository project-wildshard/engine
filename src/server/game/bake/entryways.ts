/** Build/proof entry walks. Gameplay imports never load this module. */
import { CharacterMotor } from '@wildshard/engine/physics/CharacterMotor';
import { tagOf } from '@wildshard/engine/physics/surface';
import { canStandAt } from '@wildshard/engine/physics/query';
import { walkEdgeEntries } from '@wildshard/engine/physics/edgeEntries';
import type { SimHost } from '@wildshard/engine/sim';
import { parseSocketLift } from '@wildshard/format/socketLift';
import { socketLiftEntries, socketLiftRules, type SocketLiftEntry } from '@wildshard/format/socketLiftAssets';
import { portalLinkEntries } from '@wildshard/format/portalLinkAssets';
import type { LiftApproachSource } from '@wildshard/format/liftApproach';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { provePortalLinks } from '../shardfile/portalLinkProof';
import type { MoverRuntime } from '../plugin/mover';
import { commandSocketLift, createShardfileSim, type ShardfileSimulation, type ShardfileSimPorts } from '../plugin/simulation';

type Physics = SimHost['physics'];

/** Trusted admission world: advance the existing one host/runtime/world fixed step before moving the real capsule. */
export interface SocketLiftProofPorts {
  physics: Physics; runtime: MoverRuntime; fixedStep: () => void;
  waterAt?: (x: number, z: number) => number | null;
  approachSource?: LiftApproachSource;
}
/** Counts come from actual fixed steps and motor moves, including both stop calls and the automatic idle return. */
export interface SocketLiftProof { steps: number; rides: number; calls: number; maximumDeckStep: number }
/** One world an entry ride walks: its collision, its admitted movers (a lift's deck and road gate), fixed step and water. */
export interface EntryProofWorld {
  physics: Physics; movers?: MoverRuntime | undefined; fixedStep: () => void;
  waterAt?: (x: number, z: number) => number | null; dispose: () => void;
}
/** Real lanes and steps of every declared entryway, plus the lift rides and calls and the portal transfers it proved. */
export interface EntryProof { lanes: number; steps: number; liftRides?: number; liftCalls?: number; portalTransfers?: number }
/**
 * Every declared entryway, proven by its kind: ordinary entries by the caller's `edges` walk (refused when it has none),
 * each socket lift by its complete ride and 23 road-gate lanes on its own `world()`, and all portal links on one more.
 * The untrusted shardfile host and the trusted runtimes share this one law; each brings only how its world is built.
 */
export function proveEntryways(source: Shardfile, assets: ReadonlyMap<string, Uint8Array>, ports: {
  edges?: (sides: readonly Shardfile['entryways'][number]['edge'][]) => { lanes: number; steps: number };
  world: () => EntryProofWorld;
}): EntryProof {
  const lifts = socketLiftEntries(source.entryways), portals = portalLinkEntries(source.entryways);
  const sides = source.entryways.filter(entry => entry.kind !== 'socketLift' && entry.kind !== 'portalLink').map(entry => entry.edge);
  if (ports.edges === undefined && sides.length > 0) throw new Error('Edge entries require an edge walk');
  const result = ports.edges?.(sides) ?? { lanes: 0, steps: 0 };
  const within = (prove: (world: EntryProofWorld) => void): void => { const world = ports.world(); try { prove(world); } finally { world.dispose(); } };
  let liftRides = 0, liftCalls = 0, portalTransfers = 0;
  // Every ride starts at a freshly admitted road stop, independently of validation ticks or other lifts.
  for (const entry of lifts) within(({ physics, movers, fixedStep, waterAt }) => {
    if (movers === undefined) throw new Error('Socket lift requires admitted mover runtime');
    const proof = proveSocketLift(entry, { physics, runtime: movers, fixedStep, ...(waterAt === undefined ? {} : { waterAt }), approachSource: source });
    result.lanes += 23; result.steps += proof.steps; liftRides += proof.rides; liftCalls += proof.calls;
  });
  if (portals.length > 0) within(({ physics, waterAt }) => {
    const proof = provePortalLinks(portals, source, assets, { physics, ...(waterAt === undefined ? {} : { waterAt }) });
    result.lanes += proof.lanes; result.steps += proof.steps; portalTransfers = proof.transfers;
  });
  return { ...result, ...(lifts.length > 0 ? { liftRides, liftCalls } : {}), ...(portals.length > 0 ? { portalTransfers } : {}) };
}
/** The untrusted shardfile host: ordinary entries walk the live sim; each ride proof gets a freshly admitted one. */
export function proveShardfileEntries(source: Shardfile, sim: ShardfileSimulation, assets: ReadonlyMap<string, Uint8Array>, ports: ShardfileSimPorts): EntryProof {
  return proveEntryways(source, assets, { edges: sides => walkEdgeEntries(sim.host.physics, (x, z) => sim.water.restAt(x, z), sides), world: () => {
    const fresh = createShardfileSim(source, assets, { ...ports, ground: false });
    return { physics: fresh.host.physics, movers: fresh.movers, waterAt: (x, z) => fresh.water.restAt(x, z), dispose: () => { fresh.dispose(); },
      fixedStep: () => { fresh.host.step(); if ((fresh.lane?.host.failureCount ?? 0) !== 0) throw new Error('Socket lift script call failed'); } };
  } });
}
const distance = (a: { x: number; y: number; z: number }, b: readonly [number, number, number]) => Math.hypot(a.x - b[0], a.y - b[1], a.z - b[2]);
const options = { radius: 0.35, height: 1.8, step: 0.3, maxClimbDeg: 45, snap: 0.2, group: 'PLAYER', blockedBy: ['WORLD'] } as const;

/** Walk, command, ride and return through actual collision. Feet are initialized once; every later move comes from the motor. */
function proveSocketLift(entry: SocketLiftEntry, ports: SocketLiftProofPorts): SocketLiftProof {
  const errors = socketLiftRules([entry], ports.runtime.data, ports.approachSource); if (errors.length > 0) throw new Error(errors.join('; '));
  const lift = parseSocketLift(entry.lift), motor = new CharacterMotor(ports.physics, options);
  const inward = entry.edge === 'north' ? [0, -1] : entry.edge === 'south' ? [0, 1] : entry.edge === 'east' ? [-1, 0] : [1, 0];
  const ix = inward[0] ?? 0, iz = inward[1] ?? 0;
  const start = { x: entry.edge === 'east' ? 237 : entry.edge === 'west' ? -237 : 0, y: 0.05,
    z: entry.edge === 'north' ? 237 : entry.edge === 'south' ? -237 : 0 };
  const feet = { ...start };
  let steps = 0, probeSteps = 0, grounded = false, maximumDeckStep = 0, previous = ports.runtime.pose(lift.mover).position;
  const gateRest = ports.runtime.pose(lift.gate), approachOwners = new Set(lift.approach?.colliders), boardingOwners = new Set([...approachOwners, lift.mover]);
  const owner = (): string | undefined => { const value = tagOf(motor.result.groundCollider ?? motor.collider)?.owner; return typeof value === 'string' ? value : undefined; };
  const requireOwner = (allowed: ReadonlySet<string>): void => {
    const ground = owner();
    if (ground !== undefined && allowed.has(ground)) return;
    // At touching floors Rapier may pick the socket. Query the real named floor and capsule clearance at its admitted y=0, without moving feet.
    if ([...allowed].some(id => canStandAt(ports.physics, { x: feet.x, y: 0, z: feet.z }, options, id, motor.collider))) return;
    if (allowed.has(lift.mover) && lift.approach !== undefined) {
      const last = lift.approach.route[lift.approach.route.length - 1];
      if (last !== undefined) {
        const dx = last[0] - lift.roadStop[0], dz = last[2] - lift.roadStop[2], length = Math.hypot(dx, dz);
        // The admitted seam may leave the centre ray over <=5cm of void. Probe its two named lips; the real motor remains grounded and never moves by this query.
        if (length > 0 && [-1, 1].some(sign => [...allowed].some(id => canStandAt(ports.physics,
          { x: feet.x + sign * dx / length * 0.05, y: 0, z: feet.z + sign * dz / length * 0.05 }, options, id, motor.collider)))) return;
      }
    }
    throw new Error('Socket lift approach is not supported by its declared colliders');
  };
  const checkStop = (stop: readonly [number, number, number]): boolean => distance(ports.runtime.pose(lift.mover).position, stop) <= 0.001;
  const step = (dx = 0, dz = 0): void => {
    if (++steps > 50_000) throw new Error('Socket lift admission step allowance');
    ports.fixedStep();
    if (lift.approach !== undefined) {
      const gate = ports.runtime.pose(lift.gate);
      if (Math.hypot(gate.position.x - gateRest.position.x, gate.position.y - gateRest.position.y, gate.position.z - gateRest.position.z) > 1e-8
        || Math.hypot(gate.euler.x - gateRest.euler.x, gate.euler.y - gateRest.euler.y, gate.euler.z - gateRest.euler.z) > 1e-8) throw new Error('Socket lift road gate moved away from its stationary pose');
    }
    const pose = ports.runtime.pose(lift.mover);
    if (lift.approach !== undefined && distance(pose.position, lift.roadStop) > 0.001 && !ports.runtime.pose(lift.gate).enabled) throw new Error('Socket lift road gate opened while its deck was away');
    const delta = Math.hypot(pose.position.x - previous.x, pose.position.y - previous.y, pose.position.z - previous.z);
    maximumDeckStep = Math.max(maximumDeckStep, delta); previous = pose.position;
    if (!pose.enabled || delta > 15 / 60 + 1e-6) throw new Error('Socket lift disabled or teleported instead of riding');
    const carried = grounded && motor.carry(feet);
    const result = motor.move(feet, { x: dx, y: carried ? 0 : -9.81 / 3600, z: dz }); grounded = result.grounded;
    const water = ports.waterAt?.(feet.x, feet.z);
    if (water !== undefined && water !== null && water > feet.y + 0.15) throw new Error('Submerged socket lift route');
    if (!grounded && steps > 15) throw new Error('Socket lift rider lost the walk surface');
  };
  const walk = (point: readonly [number, number, number], allowed?: ReadonlySet<string>): void => {
    let stalled = 0;
    for (let tick = 0; Math.hypot(feet.x - point[0], feet.z - point[2]) > 0.06; tick++) {
      if (tick > 6000) throw new Error('Socket lift onward route too long or blocked');
      const dx = point[0] - feet.x, dz = point[2] - feet.z, d = Math.hypot(dx, dz), before = d;
      step(dx / d * Math.min(d, 5 / 60), dz / d * Math.min(d, 5 / 60));
      if (allowed !== undefined) requireOwner(allowed);
      stalled = Math.hypot(feet.x - point[0], feet.z - point[2]) >= before - 0.02 ? stalled + 1 : 0;
      if (stalled >= 5) throw new Error('Blocked socket lift route');
    }
    if (Math.abs(feet.y - point[1]) > 0.1) throw new Error('Socket lift route does not reach its declared walk height');
  };
  const wait = (stop: readonly [number, number, number], bound: number): void => {
    for (let tick = 0; !checkStop(stop); tick++) {
      if (tick >= bound) throw new Error('Socket lift did not reach its stop within the declared ride');
      step();
    }
  };
  const command = (action: 1 | 2 | 3): void => {
    const at = ports.runtime.pose(lift.mover).position; commandSocketLift(ports.runtime, lift, action);
    for (let tick = 0; tick < 6; tick++) step();
    if (distance(ports.runtime.pose(lift.mover).position, [at.x, at.y, at.z]) < 0.001) throw new Error('Socket lift did not answer the normal interaction');
  };
  try {
    if (!checkStop(lift.roadStop)) throw new Error('Socket lift must load at the road stop');
    // Loaded and idle means actually resting, including after a fresh unload/reload; no saved travel pose is accepted.
    for (let tick = 0; tick < 30; tick++) { step(); if (!checkStop(lift.roadStop)) throw new Error('Socket lift must remain at its idle road stop'); }
    if (lift.approach !== undefined) {
      const mouth = lift.approach.route[0]; if (mouth === undefined) throw new Error('Missing static approach mouth');
      walk(mouth);
      for (const point of lift.approach.route.slice(1)) walk(point, approachOwners);
    }
    walk(lift.roadStop, lift.approach === undefined ? undefined : boardingOwners);
    if (tagOf(motor.result.groundCollider ?? motor.collider)?.owner !== lift.mover) throw new Error('Socket lift rider never boarded the declared deck');
    command(1);
    if (!ports.runtime.pose(lift.gate).enabled) throw new Error('Missing active platform gate while the lift is away');
    // Overlapping independent road probes witness collision across the full opening, not a presentation boolean.
    for (let lane = 0; lane <= 22; lane++) {
      const guard = new CharacterMotor(ports.physics, options), offset = -3.65 + lane * 7.3 / 22;
      const guardFeet = { x: start.x + (iz === 0 ? 0 : offset), y: start.y, z: start.z + (ix === 0 ? 0 : offset) };
      try {
        for (let tick = 0; tick < 40; tick++) { guard.move(guardFeet, { x: ix / 10, y: -9.81 / 3600, z: iz / 10 }); probeSteps++; }
        if ((guardFeet.x - start.x) * ix + (guardFeet.z - start.z) * iz > 2.2) throw new Error('Socket lift road gate did not block the real capsule');
      } finally { guard.dispose(); }
    }
    wait(lift.topStop, lift.rideTicks - 6);
    if (distance(feet, lift.topStop) > 0.15 || tagOf(motor.result.groundCollider ?? motor.collider)?.owner !== lift.mover) throw new Error(`Socket lift rider did not reach the top on its deck (${feet.x},${feet.y},${feet.z}; owner ${String(tagOf(motor.result.groundCollider ?? motor.collider)?.owner)})`);
    for (const point of lift.route) walk(point);
    if (tagOf(motor.result.groundCollider ?? motor.collider)?.owner === lift.mover) throw new Error('Socket lift onward route never reaches playable ground');
    // Walk back to the first off-deck route point, then wait on real static ground for the automatic idle return.
    for (const point of lift.route.slice(1).reverse()) walk(point);
    wait(lift.roadStop, lift.rideTicks * 2);
    command(3); wait(lift.topStop, lift.rideTicks - 6); // call up from the top landing
    walk(lift.topStop); command(1); wait(lift.roadStop, lift.rideTicks - 6);
    if (distance(feet, lift.roadStop) > 0.15) throw new Error('Socket lift rider did not return on its deck');
    if (lift.approach !== undefined) {
      const back = [...lift.approach.route].reverse(), landing = back[0];
      if (landing === undefined) throw new Error('Missing static approach landing');
      walk(landing, boardingOwners); requireOwner(approachOwners);
      for (const point of back.slice(1)) walk(point, approachOwners);
    }
    walk([start.x, 0, start.z]);
    command(3); wait(lift.topStop, lift.rideTicks - 6); // empty up, then the road-side call down
    command(2); wait(lift.roadStop, lift.rideTicks - 6);
    if (ports.runtime.pose(lift.gate).enabled) throw new Error('Socket lift road gate did not reopen');
    return { steps: steps + probeSteps, rides: 2, calls: 2, maximumDeckStep };
  } finally { motor.dispose(); }
}
