import type { ClientFeatureRow } from '@wildshard/format/clientPlan';
import { legacyAdventureNames,legacyAdventureCosmetics,legacyAdventureBond } from './legacyRecords';
import { AdventurePersistenceSchema } from '@wildshard/format/namedJsonContracts';
import * as v from 'valibot';
import { Flags } from '@wildshard/engine/world/interact/flags';
import type { ShardContext } from '../../../client/game/plugin/context';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { bindRuntimeJsonRecord, bindRuntimeLedger, bindRuntimeState, projectRuntimeFacts, type RuntimeFacts } from '../plugin/runtimeRows';
import { bossesSave, elitesSave, progressSave } from '../saves';
import type { Progress } from '../../../client/game/Progress';
import { publishBoundPersistence } from './chapterBindings';
import { featOutcome, witnessSavedFeats, type FeatCounterPorts } from './featCounters';
import { publishEntryOwner } from '../shardfile/entryOwners';

const finite = v.pipe(v.number(), v.finite());
const natural = v.pipe(finite, v.minValue(0));
const counts = v.record(v.string(), v.pipe(natural, v.integer()));
const names = v.record(v.string(), v.string());
const cosmetics: v.ObjectSchema<{ readonly owned: v.ArraySchema<v.StringSchema<undefined>, undefined>; readonly worn: v.RecordSchema<v.StringSchema<undefined>, v.StringSchema<undefined>, undefined>; }, undefined> = v.object({ owned: v.array(v.string()), worn: names });
/** A durable typed record; failure to persist refuses progression explicitly. */
export interface SavedRecord<T> { read: (namespace?: string) => T; write: (value: T, namespace?: string) => boolean }
/** Native records and projected progress share one placement identity. */
export interface AdventurePersistence {
  flags: Flags; facts: RuntimeFacts;
  bosses: SavedRecord<ReturnType<typeof bossesSave.read>>;
  elites: SavedRecord<ReturnType<typeof elitesSave.read>>;
  names: SavedRecord<Record<string, string>>;
  cosmetics: SavedRecord<v.InferOutput<typeof cosmetics>>;
  bond: { read: () => string | null; write: (value: string) => void };
  feat: (event: string, total?: number) => void;
  kill: (kind: string, variant?: string) => void;
  bindProgress: (progress: Pick<Progress, 'bindLedger' | 'refreshLedger'> | undefined) => void;
}

/** Bind declared encounter, companion and achievement records over the original
 * state fields. Pine and Nalati share this owner; rows retain their validation,
 * stable fact identities, flag projections and checkpoint boundaries. */
export function bindAdventurePersistence(ctx: Pick<ShardContext, 'app' | 'scope'>, source: Shardfile,
  input: unknown, instance: string = source.identity.slug): AdventurePersistence {
  const rows = v.parse(AdventurePersistenceSchema, input), flags = new Flags(instance);
  const legacyInstance = rows.legacyNamespace === 'instance' ? instance : source.identity.slug;
  const facts = projectRuntimeFacts(bindRuntimeLedger(ctx, source, instance), undefined);
  const number = rows.nonnegative ? natural : finite;
  const bossSchema = v.record(v.string(), v.object({ defeated: v.boolean(), rewardTaken: v.boolean(), kills: number }));
  const eliteSchema = v.record(v.string(), v.object({ timer: number, discovered: v.boolean(), skinTaken: v.boolean(), kills: number, retired: v.boolean() }));
  const record = <S extends v.GenericSchema>(field: string | undefined, schema: S,
    initial: () => v.InferOutput<S>, project?: (value: v.InferOutput<S>) => void): SavedRecord<v.InferOutput<S>> => {
    const bound = field === undefined ? undefined : bindRuntimeJsonRecord(ctx, source, field, schema, initial, instance);
    const owner = () => { if (bound === undefined) throw new Error('Undeclared saved record'); return bound; };
    if (bound !== undefined) project?.(bound.read());
    return { read: namespace => owner().read(namespace), write: (value, namespace) => {
      const written = owner().write(value, namespace);
      if (!written && rows.refuseWrites) throw new Error(`State could not be saved: ${field ?? ''}`);
      if (written) project?.(value);
      return written;
    } };
  };
  const bosses = record(rows.bosses.key, bossSchema, () => bossesSave.read(legacyInstance), value => {
    if (rows.bosses.flagPrefix !== undefined) for (const [id, saved] of Object.entries(value)) if (saved.defeated) flags.set(rows.bosses.flagPrefix + id);
  });
  const elites = record(rows.elites.key, eliteSchema, () => elitesSave.read(legacyInstance), value => {
    if (rows.elites.flagPrefix !== undefined) for (const [id, saved] of Object.entries(value)) if (saved.kills > 0 || saved.retired) flags.set(rows.elites.flagPrefix + id);
  });
  const nameRecord = record(rows.names, names, () => rows.legacy?.names===undefined?{}:legacyAdventureNames(rows.legacy.names).read(legacyInstance));
  const cosmeticRecord = record(rows.cosmetics?.key, cosmetics, () => rows.legacy?.cosmetics===undefined?{owned:[],worn:{}}:legacyAdventureCosmetics(rows.legacy.cosmetics).read(legacyInstance), value => {
    const prefix = rows.cosmetics?.flagPrefix;
    if (prefix !== undefined) for (const id of value.owned) flags.set(prefix + id);
  });
  const bondState = rows.bond === undefined ? undefined : bindRuntimeState(ctx, source, rows.bond.key, () => (rows.legacy?.bond===undefined?null:legacyAdventureBond(rows.legacy.bond).read(legacyInstance))??'', instance);
  const projectBond = (value: string | null): void => {
    if (value === null) return;
    for (const row of rows.bond?.flags ?? []) if (row.equals === undefined || row.equals === value) flags.set(row.flag);
  };
  const bond = { read: (): string | null => {
    const value = bondState?.read(); if (typeof value !== 'string') throw new Error('Undeclared string bond'); return value === '' ? null : value;
  }, write: (value: string): void => {
    if (bondState?.write(value) !== true) throw new Error('Bond could not be saved'); projectBond(value);
  } };
  const counterRows = rows.counters;
  const savedCounts = record(counterRows?.key, counts, () => progressSave.read(legacyInstance).counts);
  // the feat counters' law (featCounters.ts: a Node simulation runs the same over its own saved counts and ledger)
  const counterPorts: FeatCounterPorts = { read: () => savedCounts.read(), write: saved => { savedCounts.write(saved); }, fact: (fact, key) => { facts(fact, key); } };
  if (counterRows !== undefined) witnessSavedFeats(counterRows, counterPorts);
  const outcome = (kind: 'event' | 'kill', name: string, variant?: string, total?: number): void => {
    if (counterRows === undefined) return;
    featOutcome(counterRows, counterPorts, kind, name, variant, total);
  };
  if (bondState !== undefined) projectBond(bond.read());
  const persistence: AdventurePersistence = { flags, facts, bosses, elites, names: nameRecord, cosmetics: cosmeticRecord, bond,
    feat: (event: string, total?: number): void => { outcome('event', event, undefined, total); },
    kill: (kind: string, variant?: string): void => { outcome('kill', kind, variant); },
    bindProgress: (progress: Parameters<typeof facts.bindProgress>[0]): void => {
      facts.bindProgress(progress, () => { const state = bondState?.write(bondState.read()) ?? true, ledger = facts.flush(); return state && ledger; });
    } };
  publishBoundPersistence(ctx.scope, persistence);
  return persistence;
}

/** Install the existing saved-record owner from its admitted client-plan row. */
export async function installClientAdventurePersistence(ctx: ShardContext, feature: ClientFeatureRow): Promise<void> {
  const scope = ctx.scope, ended = (): boolean => scope.disposed || scope.disposing;
  if (feature.kind !== 'state.adventure' || ended()) throw new Error('Invalid adventure persistence feature');
  const world = ctx.game.runtime?.world;
  if (world === undefined || world === null) throw new Error('Adventure persistence requires its world identity');
  const product = ctx.product, runtime = ctx.game.runtime;
  const input = await product.json<unknown>(feature.file);
  if (ctx.scope !== scope || ended() || ctx.product !== product || ctx.game.runtime !== runtime || runtime?.world !== world) throw new Error('Adventure persistence owner changed during admission');
  const owner = bindAdventurePersistence(ctx, product.shardfile, input, world.chunk.slug);
  if (feature.id !== undefined) publishEntryOwner(ctx.scope, 'adventure', feature.id, owner);
}
