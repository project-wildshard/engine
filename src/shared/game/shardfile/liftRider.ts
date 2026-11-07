import { canStandAt } from '@wildshard/engine/physics/query';
import { tagOf } from '@wildshard/engine/physics/surface';
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { ShardfileSimulation } from '../../../server/game/plugin/simulation';
import { socketLiftEntries } from '@wildshard/format/socketLiftAssets';

import { LiftRiderSchema, type LiftRider } from '@wildshard/format/liftRider';
import type { PlayerSim } from '@wildshard/engine/sim/playerSim';
import * as v from 'valibot';

/** One player's body, as a lift reads and places it. */
type LiftBody = Pick<PlayerSim, 'hasMotor' | 'motor' | 'position'>;
/** Every rider in a save: the host's first player's edge alone, as a one-player save always held it, or with the others aboard beside it. */
const LiftRidersSchema = v.union([LiftRiderSchema, v.strictObject({ lead: LiftRiderSchema, others: v.record(v.string(), LiftRiderSchema) })]);
export type LiftRiders = LiftRider | { readonly lead: LiftRider; readonly others: Readonly<Record<string, LiftRider>> };
/** A saved `lift.rider` value. */
export function parseLiftRiders(value: unknown): LiftRiders { return v.parse(LiftRidersSchema, value); }
/** The edge the host's first player rides, which is all a one-player client save names. */
export function firstLiftRider(saved: LiftRiders): LiftRider { return typeof saved === 'object' && saved !== null ? saved.lead : saved; }

/** Capture only a live grounded rider aboard a declared moving lift, never a proximity guess. */
function aboard(source: Shardfile, movers: ShardfileSimulation['movers'], player: LiftBody): LiftRider {
  if (!player.hasMotor || movers === undefined) return null;
  const motor = player.motor;
  if (!motor.result.grounded || motor.result.groundCollider === null) return null;
  const owner = tagOf(motor.result.groundCollider)?.owner;
  const entry = socketLiftEntries(source.entryways).find(row => row.lift.mover === owner);
  if (entry === undefined) return null;
  const at = movers.pose(entry.lift.mover).position;
  return Math.hypot(at.x - entry.lift.roadStop[0], at.y - entry.lift.roadStop[1], at.z - entry.lift.roadStop[2]) > 0.001 ? entry.edge : null;
}
/** Everyone aboard a moving lift. */
export function captureLiftRiders(source: Shardfile, sim: Pick<ShardfileSimulation, 'host' | 'movers'>): LiftRiders {
  let lead: LiftRider = null, first = true; const others: Record<string, LiftRider> = {};
  for (const player of sim.host.players.values()) {
    const edge = aboard(source, sim.movers, player);
    if (first) lead = edge; else if (edge !== null) others[player.id] = edge;
    first = false;
  }
  return Object.keys(others).length === 0 ? lead : { lead, others };
}
/** The rider a one-player client save names: the host's first player's edge. */
export function captureLiftRider(source: Shardfile, sim: Pick<ShardfileSimulation, 'host' | 'movers'>): LiftRider {
  return firstLiftRider(captureLiftRiders(source, sim));
}
/** Reset only on load. Actual deck collision and capsule clearance decide boarding; an absent/blocked landing uses normal safe spawn. */
function land(source: Shardfile, sim: Pick<ShardfileSimulation, 'host' | 'movers' | 'water'>, edge: LiftRider, player: LiftBody): void {
  if (edge === null || !player.hasMotor) return;
  const entry = socketLiftEntries(source.entryways).find(row => row.edge === edge);
  const stop = entry?.lift.roadStop, feet = stop === undefined ? undefined : { x: stop[0], y: stop[1], z: stop[2] };
  const water = feet === undefined ? null : sim.water.restAt(feet.x, feet.z);
  const valid = feet !== undefined && entry !== undefined && (water === null || water <= feet.y + 0.15)
    && canStandAt(sim.host.physics, feet, player.motor.opts, entry.lift.mover, player.motor.collider);
  const at = valid ? feet : source.spawn;
  player.position.set(at.x, at.y, at.z); player.motor.resetAt(player.position);
}
/** Put each saved rider back. */
export function restoreLiftRider(source: Shardfile, sim: Pick<ShardfileSimulation, 'host' | 'movers' | 'water'>, saved: LiftRiders): void {
  const lead = firstLiftRider(saved), others = typeof saved === 'object' && saved !== null ? saved.others : {};
  let first = true;
  for (const player of sim.host.players.values()) { land(source, sim, first ? lead : others[player.id] ?? null, player); first = false; }
}
