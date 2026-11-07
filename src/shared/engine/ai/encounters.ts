import { readSpawnTables } from '@wildshard/format/spawnTables';
import type { Scope } from '../app/scope';
import { WeightedTable, type TableSpec } from './weighted';

export interface EncounterDefinition { id: string; displayName?: string; showHeadBar?: boolean }
interface Entry { definition: EncounterDefinition; scope: Scope }
export interface SpawnEntry { kind: string; variant?: string }
export interface SpawnContext { tags: readonly string[]; kind?: string }
export interface SpawnTableRow { id: string; table: TableSpec<SpawnEntry, SpawnContext> }
export interface SpawnPoint { x: number; z: number; yaw: number }
export interface Spawner<T> {
  spawn: (context: SpawnContext, point: SpawnPoint, next: () => number) => T[];
  retire: (actor: T) => void;
}
/** Admit data gates into the existing ordered table mechanism, before any registration or random draw. */
export function declaredSpawnTables(input: unknown): SpawnTableRow[] {
  return readSpawnTables(input).map(row => ({ id: row.id, table: { mode: row.table.mode, rows: row.table.rows.map(({ when, ...entry }) => {
    if (when === undefined) return entry;
    return Object.assign(entry, { when: (context: SpawnContext) => (when.kind === undefined || context.kind === when.kind)
      && (when.tags === undefined || when.tags.every(tag => context.tags.includes(tag))) });
  }) } }));
}
interface SpawnRegistration { row: SpawnTableRow; scope: Scope }
interface RuntimeRegistration { id: string; brain: object; scope: Scope }
/** Resident content names are read from the active level and released with their scope. */
export class EncounterRegistry {
  private readonly entries = new Map<string, Entry[]>();
  private readonly tables: SpawnRegistration[] = [];
  private readonly runtimes: RuntimeRegistration[] = [];
  private readonly active: () => Scope | null;
  constructor(active: () => Scope | null) { this.active = active; }
  register(definition: EncounterDefinition, scope: Scope): void {
    if (scope.disposed) throw new Error('Cannot register an encounter on a disposed scope');
    const list = this.entries.get(definition.id) ?? [];
    if (list.some((entry) => entry.scope === scope)) throw new Error(`Duplicate encounter: ${definition.id}`);
    const entry = { definition, scope }; list.push(entry); this.entries.set(definition.id, list);
    scope.onDispose(() => { const i = list.indexOf(entry); if (i !== -1) list.splice(i, 1); if (list.length === 0) this.entries.delete(definition.id); });
  }
  get(id: string): EncounterDefinition | undefined {
    const active = this.active(); if (active === null) return undefined;
    return this.entries.get(id)?.find((entry) => entry.scope.belongsTo(active))?.definition;
  }
  registerSpawn(row: SpawnTableRow, scope: Scope): void {
    if (scope.disposed) throw new Error('Cannot register a spawn table on a disposed scope');
    if (this.tables.some((entry) => entry.scope === scope && entry.row.id === row.id)) throw new Error(`Duplicate spawn table: ${row.id}`);
    const entry = { row, scope }; this.tables.push(entry);
    scope.onDispose(() => { const i = this.tables.indexOf(entry); if (i !== -1) this.tables.splice(i, 1); });
  }
  spawn<T>(id: string, scope: Scope, ports: { create: (entry: SpawnEntry, point: SpawnPoint) => T; retire: (actor: T) => void }): Spawner<T> {
    if (scope.disposed) throw new Error('Cannot create a spawner on a disposed scope');
    const row = this.tables.find((entry) => entry.row.id === id && entry.scope.belongsTo(scope))?.row;
    if (row === undefined) throw new Error(`Unknown spawn table: ${id}`);
    const table = new WeightedTable(row.table), actors = new Set<T>();
    const retire = (actor: T): void => { if (actors.delete(actor)) ports.retire(actor); };
    scope.onDispose(() => { for (const actor of actors) ports.retire(actor); actors.clear(); });
    return {
      spawn: (context, point, next) => {
        if (scope.disposed) throw new Error('Cannot spawn on a disposed scope');
        const result: T[] = [];
        for (const drop of table.roll(context, next)) for (let i = 0; i < drop.count; i++) {
          const actor = ports.create(drop.item, point); actors.add(actor); result.push(actor);
        }
        return result;
      }, retire,
    };
  }
  /** Preflight the complete ordered runtime names before any controller/UI allocation. */
  preflightElite(ids: readonly string[], scope: Scope): void {
    if (scope.disposed || scope.disposing || ids.length > 64 || new Set(ids).size !== ids.length
      || ids.some(id => id.length === 0 || id.length > 128 || this.runtimes.some(entry => entry.scope === scope && entry.id === id))) throw new Error('Invalid or occupied elite runtime slots');
  }
  /** One prepared lease over the existing runtime registry, with the original
   * construction owner and reverse registration teardown order. No body book. */
  prepareElites(rows: readonly { readonly id: string; readonly brain: { despawn: () => void } }[], scope: Scope): {
    readonly validate: () => void; readonly commit: () => void; readonly commitNext: () => void; readonly release: () => void;
  } {
    const method = <O extends object>(owner: O, key: keyof O): unknown => owner[key];
    const captured = rows.map(row => ({ row, id: row.id, brain: row.brain, method: method(row.brain, 'despawn'),
      despawn: row.brain.despawn.bind(row.brain), entry: { id: row.id, brain: row.brain, scope } }));
    let committed = false, count = 0, released = false, forget = (): void => undefined;
    const validate = (): void => {
      if (released || scope.disposed || scope.disposing || rows.length !== captured.length || captured.some((value, index) => rows[index] !== value.row || value.row.id !== value.id || value.row.brain !== value.brain
        || method(value.brain, 'despawn') !== value.method
        || captured.indexOf(value) < count && !this.runtimes.includes(value.entry))) throw new Error('Retired or replaced elite runtime lease');
      this.preflightElite(captured.slice(count).map(value => value.id), scope);
    };
    const release = (): void => {
      if (released) return;
      released = true; forget();
      if (!committed) return;
      const errors: unknown[] = [];
      for (const value of captured.slice(0, count).reverse()) {
        const at = this.runtimes.indexOf(value.entry); if (at !== -1) this.runtimes.splice(at, 1);
        try { value.despawn(); } catch (error) { errors.push(error); }
      }
      if (errors.length > 0) throw new AggregateError(errors, 'Elite runtime release failed');
    };
    const commitNext = (): void => {
      validate(); const value = captured[count];
      if (value === undefined) throw new Error('Elite runtime lease already committed');
      if (!committed) { forget = scope.capture('disposers', release); committed = true; }
      this.runtimes.push(value.entry); count++;
    };
    validate();
    return { validate, release, commitNext, commit: () => {
      if (count === captured.length) throw new Error('Elite runtime lease already committed');
      while (count < captured.length) commitNext();
    } };
  }
  boss<T extends { disarm: () => void }>(id: string, brain: T, scope: Scope): T { return this.bind(id, brain, scope, () => { brain.disarm(); }); }
  elite<T extends { despawn: () => void }>(id: string, brain: T, scope: Scope): T { return this.bind(id, brain, scope, () => { brain.despawn(); }); }
  private bind<T extends object>(id: string, brain: T, scope: Scope, dispose: () => void): T {
    if (scope.disposed) throw new Error('Cannot bind an encounter on a disposed scope');
    if (this.runtimes.some((entry) => entry.id === id && entry.scope === scope)) throw new Error(`Duplicate encounter runtime: ${id}`);
    const entry = { id, brain, scope }; this.runtimes.push(entry);
    scope.onDispose(() => { const i = this.runtimes.indexOf(entry); if (i !== -1) this.runtimes.splice(i, 1); dispose(); });
    return brain;
  }
  runtime(id: string): object | undefined {
    const active = this.active();
    return active === null ? undefined : this.runtimes.find((entry) => entry.id === id && entry.scope.belongsTo(active))?.brain;
  }
}
export { EncounterRegistry as EncounterService };
