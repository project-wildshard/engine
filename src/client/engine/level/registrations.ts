import type { Scope } from '../../../shared/engine/app/scope';
import type { ContentRow, ContentRowMap, StringTable, TierKnobSchema } from '../../../server/engine/level/context';

/** Scoped row catalogs are consumed by their services between kit and play. */
export class LevelRegistrations {
  private readonly rows = new Map<keyof ContentRowMap, Map<string, ContentRow>>();
  private readonly tables: { table: StringTable; scope: Scope }[] = [];
  private readonly schemas = new Map<string, TierKnobSchema>();
  private readonly kitScopes = new Set<Scope>();
  openKit(scope: Scope): void { this.kitScopes.add(scope); }
  closeKit(scope: Scope): void { this.kitScopes.delete(scope); }
  assertKit(scope: Scope): void {
    if (scope.disposed || !this.kitScopes.has(scope)) throw new Error('Content rows may only register during level.kit');
  }

  add<K extends keyof ContentRowMap>(kind: K, values: ContentRowMap[K] | readonly ContentRowMap[K][], scope: Scope): void {
    if (scope.disposed) throw new Error(`Cannot register ${kind} on a disposed level`);
    const list: readonly ContentRowMap[K][] = Array.isArray(values) ? values : [values as ContentRowMap[K]];
    const rows = this.rows.get(kind) ?? new Map<string, ContentRow>();
    const ids = new Set<string>();
    for (const row of list) {
      if (rows.has(row.id) || ids.has(row.id)) throw new Error(`Duplicate ${kind} row: ${row.id}`);
      ids.add(row.id);
    }
    this.rows.set(kind, rows);
    for (const row of list) {
      rows.set(row.id, row);
      scope.onDispose(() => { rows.delete(row.id); if (rows.size === 0) this.rows.delete(kind); });
    }
  }
  get<K extends keyof ContentRowMap>(kind: K, id: string): ContentRowMap[K] | undefined {
    return this.rows.get(kind)?.get(id) as ContentRowMap[K] | undefined;
  }
  list<K extends keyof ContentRowMap>(kind: K): readonly ContentRowMap[K][] {
    return [...(this.rows.get(kind)?.values() ?? [])] as ContentRowMap[K][];
  }
  strings(table: StringTable, scope: Scope): void {
    const entry = { table, scope };
    this.tables.push(entry);
    scope.onDispose(() => { const at = this.tables.indexOf(entry); if (at !== -1) this.tables.splice(at, 1); });
  }
  findText(key: string, scope?: Scope): string | undefined {
    for (const entry of [...this.tables].reverse()) {
      if (scope !== undefined && !entry.scope.belongsTo(scope)) continue;
      const value = entry.table[key]; if (value !== undefined) return value;
    }
    return undefined;
  }
  text(key: string, scope?: Scope): string {
    const value = this.findText(key, scope);
    if (value !== undefined) return value;
    throw new Error(`Unknown string key: ${key}`);
  }
  knobs(schema: TierKnobSchema, scope: Scope): void {
    if (this.schemas.has(schema.id)) throw new Error(`Duplicate tier knob schema: ${schema.id}`);
    this.schemas.set(schema.id, schema); scope.onDispose(() => { this.schemas.delete(schema.id); });
  }
  knobSchemas(): readonly TierKnobSchema[] { return [...this.schemas.values()]; }
}
