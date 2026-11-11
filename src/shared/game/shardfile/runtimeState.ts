import * as v from 'valibot';
import type { SaveKeyDef, SaveStore } from '@wildshard/engine/saves/store';
import type { Scope } from '@wildshard/engine/app/scope';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { LogicalStateSchema, migrateLogicalState } from '@wildshard/format/migrations';

const schema = v.looseObject({ state: LogicalStateSchema, initialized: v.array(v.pipe(v.number(), v.integer(), v.minValue(1))) });
const runtimeStateSave = { key: 'platform.runtime-state', scope: 'shard' as const, version: 1,
  schema: v.nullable(schema), initial: (): v.InferOutput<typeof schema> | null => null };
/** The same bounded scalar values as declared simulation state; JSON continuations use a declared string field. */
export type RuntimeStateValue = number | boolean | string;

/** A world's first boot: the fields a page's save held, by name. A server's fights keep their records in the world, so they start from these. */
export function pageRuntimeState(store: SaveStore, instance: string): ReadonlyMap<string, RuntimeStateValue> {
  return new Map((store.define(runtimeStateSave).read(instance)?.state.shared ?? []).map(row => [row.name, row.value]));
}
const heldPageState = new WeakMap<object, ReadonlyMap<string, RuntimeStateValue>>();
/** Lend a world what its page saved, before its fights install. */
export function holdPageState(host: object, state: ReadonlyMap<string, RuntimeStateValue>): void { heldPageState.set(host, state); }
/** A JSON field a page saved under this name, or with this ending, or null: a save a world can't read starts it fresh, as a page's first boot does. */
export function pageStateOf(host: object, name: string): unknown {
  const held = heldPageState.get(host), value = held?.get(name) ?? [...held ?? []].find(([key]) => key.endsWith(name))?.[1];
  try { return typeof value === 'string' ? JSON.parse(value) : null; } catch { return null; }
}
/** A declared host field, scoped to its runtime owner and durable under its stable placement identity. */
export interface RuntimeState {
  readonly read: () => RuntimeStateValue;
  readonly write: (value: RuntimeStateValue) => boolean;
}

/** Bind one host-owned shared state field. Its legacy reader runs only before that field's first durable initialization. */
export function installRuntimeState(store: SaveStore, scope: Scope, source: Pick<Shardfile, 'state' | 'migrations'>,
  instance: string, key: string, legacyRead: () => RuntimeStateValue | null): RuntimeState {
  const field = source.state.shared.find((row) => row.name === key);
  if (field?.privacy !== 'host') throw new Error(`Runtime state needs a declared host-owned shared field: ${key}`);
  const live = (): void => { if (scope.disposed) throw new Error('Runtime state owner is disposed'); };
  live();
  const slot = store.define(runtimeStateSave);
  let cached: v.InferOutput<typeof schema> | undefined, cachedRevision: number | undefined;
  const current = (): v.InferOutput<typeof schema> => {
    live();
    const revision = slot.revision?.(instance);
    if (revision !== undefined && cached !== undefined && revision === cachedRevision) return cached;
    if (slot.status?.(instance) === 'future') throw new Error('Runtime state was saved by a newer platform');
    const prior = slot.read(instance);
    const doc = { state: migrateLogicalState(prior?.state ?? { version: source.state.version, shared: [], players: [] }, source.state, source.migrations),
      initialized: prior?.initialized ?? [] };
    cached = doc; cachedRevision = slot.revision?.(instance); return doc;
  };
  const change = (value: RuntimeStateValue, initialize: boolean): boolean => {
    const doc = structuredClone(current()), row = doc.state.shared.find((entry) => entry.id === field.id);
    if (row === undefined) throw new Error(`Missing runtime state field: ${key}`);
    row.value = value;
    // Reuse the full state's typed/default/bounds checks before any save mutation.
    doc.state = migrateLogicalState(doc.state, source.state);
    if (initialize && !doc.initialized.includes(field.id)) doc.initialized.push(field.id);
    const written = slot.write(doc, instance);
    cached = undefined; cachedRevision = undefined; return written;
  };
  const first = current();
  if (!first.initialized.includes(field.id)) change(legacyRead() ?? field.default, true);
  return { read: () => {
    const row = current().state.shared.find((entry) => entry.id === field.id);
    if (row === undefined) throw new Error(`Missing runtime state field: ${key}`);
    return row.value;
  }, write: (value) => change(value, true) };
}
/** WIRE-STABILITY WR7: this file's save keys, for saves.lock.json (test/saves-lock.test.ts). */
export const runtimeStateSaves: readonly SaveKeyDef<unknown>[] = [runtimeStateSave];
