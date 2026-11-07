import type { Action } from './InputService';
import type { BindingGroupDef, BindingRowDef, Bindings } from './bindings';

/** One context's binding of one action. */
export interface BindingTarget { context: string; action: Action }
/** A key cell: the targets it writes and which logical key of theirs it is (0 = KEY, 1 = ALT). */
export interface BindingCell { targets: readonly BindingTarget[]; at: number }
export interface BindingTableRow { def: BindingRowDef; cells: readonly BindingCell[] }
export interface BindingTableGroup { def: BindingGroupDef; rows: readonly BindingTableRow[] }
/** Who already holds a key: a table cell, or a binding the table doesn't list. */
export interface BindingClash { label: string; row?: BindingTableRow; cell?: number; hidden?: BindingTarget }

const SIDED = ['Shift', 'Control', 'Alt', 'Meta'] as const;
/** Codes → logical keys: a Left + Right pair of one modifier reads as one key ("Shift"). */
export function foldKeys(codes: readonly string[]): string[] {
  const keys: string[] = [];
  for (const code of codes) {
    const side = SIDED.find((name) => code === `${name}Left` || code === `${name}Right`);
    const other = side === undefined ? '' : code.endsWith('Left') ? `${side}Right` : `${side}Left`;
    if (side !== undefined && codes.includes(other)) { if (!keys.includes(side)) keys.push(side); } else keys.push(code);
  }
  return keys;
}
export function expandKey(key: string): string[] { return (SIDED as readonly string[]).includes(key) ? [`${key}Left`, `${key}Right`] : [key]; }
/** A captured physical code → the logical key a player means (either Shift = Shift). */
export function keyOfCode(code: string): string { return SIDED.find((name) => code === `${name}Left` || code === `${name}Right`) ?? code; }
/** Control and Meta never reach play (InputService drops modified keydowns), so they can't be bound. */
export function bindableKey(key: string): boolean { return !['Control', 'Meta'].includes(keyOfCode(key)); }

const humanize = (action: string): string => action.replaceAll(/[.]/gu, ' ').replaceAll(/([a-z])([A-Z])/gu, '$1 $2').toLowerCase().replace(/^./u, (c) => c.toUpperCase());
const sameTarget = (a: BindingTarget, b: BindingTarget): boolean => a.context === b.context && a.action === b.action;

/** The player-facing binding table: rows over context bindings, conflicts and explicit swaps. Only defaults decide
 *  which contexts a row writes, so saved custom keys never move a context in or out of a row. */
export class BindingTable {
  private readonly bindings: Bindings;
  constructor(bindings: Bindings) { this.bindings = bindings; }

  /** every context binding `actions` whose default KEY equals the first one's: the row's write set */
  private targets(actions: readonly Action[]): BindingTarget[] {
    const found: { target: BindingTarget; key: string }[] = [];
    for (const context of this.bindings.contexts()) {
      const defaults = this.bindings.defaultKeys(context);
      for (const action of actions) {
        const key = foldKeys(defaults[action] ?? [])[0];
        const source = this.bindings.keySource(context, action);
        if (key !== undefined && !found.some((entry) => entry.target.context === source && entry.target.action === action)) found.push({ target: { context: source, action }, key });
      }
    }
    const anchor = found[0]?.key;
    return found.filter((entry) => entry.key === anchor).map((entry) => entry.target);
  }
  private row(def: BindingRowDef): BindingTableRow | undefined {
    if (def.chips === true) {
      const cells = def.actions.map((action) => ({ targets: this.targets([action]), at: 0 }));
      return cells.every((cell) => cell.targets.length > 0) ? { def, cells } : undefined;
    }
    const targets = this.targets(def.actions);
    return targets.length > 0 ? { def, cells: [{ targets, at: 0 }, { targets, at: 1 }] } : undefined;
  }
  /** the rows whose contexts are registered now (a level's own context brings its rows only on that level) */
  rows(): BindingTableRow[] { return this.bindings.table.rows.flatMap((def) => this.row(def) ?? []); }
  groups(): BindingTableGroup[] {
    const rows = this.rows();
    return this.bindings.table.groups.map((def) => ({ def, rows: rows.filter((row) => row.def.group === def.id) })).filter((group) => group.rows.length > 0);
  }
  /** the logical key a cell shows (from its first target) */
  key(row: BindingTableRow, cell: number): string | undefined {
    const at = row.cells[cell], target = at?.targets[0];
    if (at === undefined || target === undefined) return undefined;
    return foldKeys(this.bindings.keys(target.context)[target.action] ?? [])[at.at];
  }
  private shares(a: BindingRowDef, b: BindingRowDef): boolean { return a.id !== b.id && ((a.shares?.includes(b.id) ?? false) || (b.shares?.includes(a.id) ?? false)); }
  /** who holds `key` already, seen from `row`'s cell; undefined = free */
  conflict(row: BindingTableRow, cell: number, key: string): BindingClash | undefined {
    const rows = this.rows();
    for (const other of rows) {
      if (this.shares(row.def, other.def)) continue;
      for (let i = 0; i < other.cells.length; i++) {
        if (other.def.id === row.def.id && i === cell) continue;
        if (this.key(other, i) === key) return { label: other.def.label, row: other, cell: i };
      }
    }
    const listed = rows.flatMap((other) => other.cells.flatMap((c) => c.targets));
    const codes = expandKey(key), own = row.cells[cell]?.targets ?? [];
    for (const target of own) {
      for (const context of this.bindings.contexts()) {
        if (this.bindings.keySource(context, target.action) !== target.context) continue;
        for (const [action, bound] of Object.entries(this.bindings.keys(context))) {
          const hidden = { context, action: action as Action };
          const source = { context: this.bindings.keySource(context, hidden.action), action: hidden.action };
          if (action === target.action || listed.some((t) => sameTarget(t, source)) || !bound?.some((code) => codes.includes(code))) continue;
          return { label: humanize(action), hidden };
        }
      }
    }
    return undefined;
  }
  /** writes one logical key slot of a target: `key` undefined removes it */
  private put(target: BindingTarget, at: number, key: string | undefined): void {
    const keys = foldKeys(this.bindings.keys(target.context)[target.action] ?? []);
    if (key === undefined) keys.splice(at, 1); else if (at < keys.length) keys[at] = key; else keys.push(key);
    this.bindings.assign(target.context, target.action, [...new Set(keys)].flatMap(expandKey));
  }
  /** Binds `key` (undefined clears an ALT) to a cell. A conflict returns its holder and changes nothing, unless
   *  `swap`: then the holder takes this cell's old key (or loses the clashing key when there was none). */
  assign(row: BindingTableRow, cell: number, key: string | undefined, swap = false): BindingClash | undefined {
    const at = row.cells[cell]; if (at === undefined) return undefined;
    const clash = key === undefined ? undefined : this.conflict(row, cell, key);
    if (clash !== undefined && !swap) return clash;
    const previous = this.key(row, cell);
    for (const target of at.targets) this.put(target, at.at, key);
    if (clash?.row !== undefined && clash.cell !== undefined) {
      const theirs = clash.row.cells[clash.cell];
      if (theirs !== undefined) for (const target of theirs.targets) this.put(target, theirs.at, previous);
    } else if (clash?.hidden !== undefined && key !== undefined) {
      const { context, action } = clash.hidden, codes = expandKey(key);
      const bound = (this.bindings.keys(context)[action] ?? []).filter((code) => !codes.includes(code));
      this.bindings.assign(context, action, previous === undefined ? bound : [...bound, ...expandKey(previous)]);
    }
    return undefined;
  }
  reset(): void { this.bindings.reset(); }
}
