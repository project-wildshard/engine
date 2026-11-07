import * as v from 'valibot';
import type { ShardfileSimulation } from '../../../server/game/plugin/simulation';
import type { DeclaredItems } from './items';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { migrateLogicalState } from '@wildshard/format/migrations';
import { logicalStateFromLane, logicalStateFromWorld, restoreLogicalLane } from './logicalState';
import { test as flagsMatch } from '@wildshard/engine/world/interact/flags';
import { socketLiftEntries } from '@wildshard/format/socketLiftAssets';
import { captureLiftRider, firstLiftRider, parseLiftRiders, restoreLiftRider } from './liftRider';
import { portalTransitioning } from './portalTraversal';
import type { SimSnapshot } from '@wildshard/engine/sim/snapshot';

import { ClientCheckpointSchema, ItemCheckpointStatesSchema as itemsSchema, LogicalClientCheckpointSchema as logicalCheckpoint, type ClientCheckpoint, type ClientCheckpointInput } from '@wildshard/format/clientState';

/** Logical level progress, independent of the Game's borrowed physics world and player motor. */
export const clientStateSave: { key: string; scope: "shard"; version: number; schema: v.NullableSchema<v.GenericSchema<ClientCheckpointInput, ClientCheckpoint>, undefined>; initial: () => ClientCheckpoint | null; } = { key: 'platform.continuation', scope: 'shard' as const, version: 1,
  schema: v.nullable(ClientCheckpointSchema), initial: (): ClientCheckpoint | null => null };
type Runtimes = DeclaredItems['runtimes'];

function itemStates(items: Runtimes): v.InferOutput<typeof itemsSchema> {
  return v.parse(itemsSchema, Object.fromEntries([...items].map(([id, runtime]) => [id, runtime.snapshot()])));
}
function restoreItems(items: Runtimes, input: unknown): void {
  const states = v.parse(itemsSchema, input);
  if (Object.keys(states).length !== items.size || [...items.keys()].some((id) => states[id] === undefined)) throw new Error('Item continuation identities changed');
  for (const [id, runtime] of items) { const state = states[id]; if (state === undefined) throw new Error('Missing item continuation'); runtime.restore(state); }
}
/** Snapshot only logical authored progress; regional whole-world snapshots remain owned by the grid sim registry. */
export function captureClientState(source: Shardfile, sim: ShardfileSimulation, items: Runtimes): ClientCheckpoint {
  if (portalTransitioning(sim.host.physics)) throw new Error('Cannot checkpoint during a portal transfer');
  const lane = sim.lane?.snapshot() ?? null;
  // The live lane's world gives the same logical state as parsing its snapshot text back, without that parse.
  const logical = sim.lane === undefined ? logicalStateFromLane(source.state.version, null) : logicalStateFromWorld(source.state.version, sim.lane.world);
  return v.parse(logicalCheckpoint, { version: 2, shard: source.identity.slug, state: migrateLogicalState(logical, source.state), revision: source.identity.revision, tick: sim.host.state.tick,
    lane, ...clientStateParts(source, sim, items) });
}
/** Every continuation field except the clock and the script lane (and the logical state read from that lane), unparsed:
 * the continuation's schema admits them. */
export function clientStateParts(source: Shardfile, sim: ShardfileSimulation, items: Runtimes): Readonly<Record<string, unknown>> {
  return { liftRider: captureLiftRider(source, sim), moverPending: sim.movers?.snapshot(new Set(socketLiftEntries(source.entryways).flatMap(entry => [entry.lift.mover, entry.lift.gate]))) ?? [], items: itemStates(items), flags: sim.host.flags.all,
    health: Object.fromEntries([...sim.host.entities].map(([id, entity]) => [id, { hp: entity.hp, maxHp: entity.maxHp, alive: entity.alive }])),
    props: Object.fromEntries([...sim.colliders].map(([id, port]) => [id, port.active()])),
    quests: sim.quest.quests.map((quest) => quest.snapshot()), dialogue: sim.quest.snapshot() };
}
/** Persist a portable companion to a same-engine region snapshot, so later revisions never need its old Rapier bytes. Legacy regions supply their known state-version-1 origin. */
export function clientStateFromRegion(source: Shardfile, snapshot: Omit<SimSnapshot, 'physics'>, revision: number = source.identity.revision, stateVersion: number = source.state.version, props: Readonly<Record<string, boolean>> = {}): ClientCheckpoint {
  v.parse(v.literal(source.identity.slug), snapshot.levelId);
  const lane = snapshot.adapters.find((adapter) => adapter.id === 'script.declared')?.state ?? null;
  if (lane !== null && typeof lane !== 'string') throw new Error('Invalid regional script state');
  const itemState = snapshot.adapters.find((adapter) => adapter.id === 'items.declared')?.state;
  if (itemState !== undefined && typeof itemState !== 'string') throw new Error('Invalid regional item state');
  const items: unknown = itemState === undefined ? {} : JSON.parse(itemState);
  const state = logicalStateFromLane(stateVersion, lane);
  // The exact region snapshot already owns executable memory. Its migration companion must not duplicate or depend on it.
  return v.parse(logicalCheckpoint, { version: 2, shard: source.identity.slug, state, revision, tick: snapshot.state.tick, lane: null, items,
    liftRider: firstLiftRider(parseLiftRiders(snapshot.adapters.find(adapter => adapter.id === 'lift.rider')?.state ?? null)),
    health: Object.fromEntries(snapshot.entities.map((entity) => [entity.id, { hp: entity.state.motion.hp, maxHp: entity.state.motion.maxHp, alive: entity.state.flags.alive }])), props,
    flags: snapshot.flags, quests: snapshot.quests, dialogue: snapshot.adapters.find((adapter) => adapter.id === 'quest.declared')?.state ?? {} });
}
function restoreBuiltins(sim: ShardfileSimulation, state: ClientCheckpoint, exact: boolean): void {
  for (const [id, saved] of Object.entries(state.health ?? {})) {
    const entity = sim.host.entities.get(id);
    if (entity === undefined) { if (exact) throw new Error('Missing saved creature'); continue; }
    entity.hp = Math.min(saved.hp, entity.maxHp); entity.alive = entity.hp > 0;
    if (!entity.alive) entity.state = 'dead';
    else if (entity.state === 'dead') entity.state = 'idle';
  }
  for (const [id, active] of Object.entries(state.props ?? {})) {
    const port = sim.colliders.get(id);
    if (port === undefined) { if (exact) throw new Error('Missing saved prop'); continue; }
    port.setActive(active);
  }
}
function apply(source: Shardfile, sim: ShardfileSimulation, items: Runtimes, state: ClientCheckpoint): void {
  if ((sim.lane === undefined) !== (state.lane === null) || state.quests.length !== sim.quest.quests.length) throw new Error('Local continuation contract changed');
  const pending = state.moverPending ?? [], resetIds = new Set(socketLiftEntries(source.entryways).flatMap(entry => [entry.lift.mover, entry.lift.gate]));
  if ((sim.movers === undefined && pending.length > 0) || pending.some(([id]) => resetIds.has(id))) throw new Error('Invalid persistent mover commands');
  sim.movers?.restore(pending);
  restoreItems(items, state.items);
  sim.host.flags.restore(state.flags);
  for (const quest of sim.quest.quests) {
    const saved = state.quests.find((row) => row.id === quest.def.id); if (saved === undefined) throw new Error('Missing quest continuation'); quest.restore(saved);
  }
  sim.quest.restore(state.dialogue); restoreBuiltins(sim, state, true);
  // Restore the host last: transient lift modules require a fresh isolate, so earlier failures can roll back before admission.
  if (state.lane !== null) sim.lane?.restore(state.lane);
  sim.movers?.resetPublishedPoses(); sim.host.state.tick = state.tick; sim.decisions?.continueAt(state.tick);
}
function applyMigrated(source: Shardfile, sim: ShardfileSimulation, items: Runtimes, state: ClientCheckpoint, exact: boolean): void {
  // All historical version-1 client checkpoints predate authored state-version migrations and used state version 1.
  const logical = state.version === 2 ? state.state : logicalStateFromLane(1, state.lane);
  const migrated = migrateLogicalState(logical, source.state, source.migrations);
  restoreLogicalLane(sim.lane, migrated);
  for (const [id, runtime] of items) {
    const saved = state.items[id]; if (saved === undefined) continue;
    runtime.restore({ ...saved, tick: state.tick, cooldown: 0, held: false, chargeTime: 0, pending: [] });
  }
  sim.host.flags.restore(state.flags);
  for (const quest of sim.quest.quests) {
    const previous = state.quests.find((row) => row.id === quest.def.id);
    const currentId = previous?.currentId;
    const valid = currentId === null || (currentId !== undefined && quest.def.steps.some((step) => step.id === currentId));
    quest.restore(previous !== undefined && valid ? previous : { version: 1, id: quest.def.id,
      started: flagsMatch(sim.host.flags, quest.def.startWhen), currentId: quest.def.steps.find((step) => !flagsMatch(sim.host.flags, step.done))?.id ?? null });
  }
  const dialogue = sim.quest.snapshot();
  if (dialogue === null || typeof dialogue !== 'object' || Array.isArray(dialogue)) throw new Error('Invalid fresh dialogue');
  for (const row of source.quests.dialogue) {
    const saved = state.dialogue[row.id];
    if (saved === null || (saved !== undefined && row.nodes.some((node) => node.id === saved))) dialogue[row.id] = saved;
  }
  sim.quest.restore(dialogue); restoreBuiltins(sim, state, exact); sim.host.state.tick = state.tick;
  sim.decisions?.continueAt(state.tick); // fresh sim decisions follow the restored clock (not portable progress)
}
/**
 * Refuse incompatible/corrupt progress atomically. Silent quest restore never repeats profile rewards or scene events.
 * An exact lane is one build's: its contract holds the compiled modules, so a rebuild refuses it, and a server has no page's items to match its
 * rows against. Neither is the player's progress, which the logical state carries.
 */
export function restoreClientState(source: Shardfile, sim: ShardfileSimulation, items: Runtimes, input: unknown): boolean {
  const result = v.safeParse(ClientCheckpointSchema, input); if (!result.success || result.output.revision > source.identity.revision
    || !v.safeParse(v.literal(source.identity.slug), sim.host.level.id).success
    || (result.output.version === 2 && !v.safeParse(v.literal(source.identity.slug), result.output.shard).success)
    || (source.entryways.some(entry => entry.kind === 'socketLift') && (sim.lane?.host.currentTick ?? -1) >= 0)) return false;
  const previous = captureClientState(source, sim, items), saved = result.output, sameRevision = saved.revision === source.identity.revision;
  const tries = sameRevision && !(saved.version === 2 && saved.lane === null)
    ? [() => { apply(source, sim, items, saved); }, () => { applyMigrated(source, sim, items, saved, false); }] : [() => { applyMigrated(source, sim, items, saved, sameRevision); }];
  for (const attempt of tries) {
    try { attempt(); restoreLiftRider(source, sim, saved.liftRider ?? null); return true; }
    catch { apply(source, sim, items, previous); }
  }
  return false;
}
