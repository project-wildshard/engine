import * as v from 'valibot';
import { saves } from '../../../shared/engine/saves/runtime';
import type { Action } from './InputService';
import type { Scope } from '../../../shared/engine/app/scope';

const schema = v.record(v.string(), v.record(v.string(), v.array(v.string())));
const controls = saves.define({ key: 'controls', scope: 'global', version: 1, schema, initial: (): Record<string, Record<string, string[]>> => ({}) });
type Keys = Partial<Record<Action, readonly string[]>>;
/** A heading of the player-facing binding table; `column` 0 is the left half, 1 the right. */
export interface BindingGroupDef { id: string; label: string; column: 0 | 1 }
/** One plain-named table row over every context that binds `actions` with the same default key. `chips` gives each
 *  action its own key cell (a slot strip); `shares` names rows whose keys may overlap (their contexts block each other). */
export interface BindingRowDef { id: string; group: string; label: string; actions: readonly Action[]; chips?: boolean; shares?: readonly string[] }
export interface BindingTableDef { groups?: readonly BindingGroupDef[]; rows?: readonly BindingRowDef[] }
/** Context-local overrides retain unmodified defaults and swap conflicts explicitly. */
export class Bindings {
  private readonly defaults = new Map<string, Keys>();
  private readonly resolvedEntries = new Map<string, readonly (readonly [string, readonly string[] | undefined])[]>();
  private version = 0;
  /** Binding revisions invalidate stationary input scans, including inherited keys. */
  get revision(): number { return this.version; }
  private invalidate(): void { this.resolvedEntries.clear(); this.version++; }
  private readonly parents = new Map<string, { context: string; actions: readonly Action[] }>();
  private overrides = controls.read();
  private readonly changed: () => void;
  private readonly groupDefs: BindingGroupDef[] = [];
  private readonly rowDefs: BindingRowDef[] = [];
  constructor(changed: () => void) { this.changed = changed; }
  define(context: string, keys: Keys, parent?: { context: string; actions: readonly Action[] }): void {
    if (parent !== undefined) {
      if (!this.defaults.has(parent.context)) throw new Error(`Unknown key source context: ${parent.context}`);
      for (let id: string | undefined = parent.context; id !== undefined; id = this.parents.get(id)?.context) {
        if (id === context) throw new Error(`Cyclic key inheritance: ${context}`);
      }
      this.parents.set(context, parent);
    } else this.parents.delete(context);
    this.defaults.set(context, keys); this.invalidate();
  }
  remove(context: string): void { this.defaults.delete(context); this.parents.delete(context); this.invalidate(); }
  /** The registered contexts, in registration order. */
  contexts(): readonly string[] { return [...this.defaults.keys()]; }
  defaultKeys(context: string): Keys { return this.resolve(context, true); }
  /** The context owning this action's binding; inherited actions share their parent's saved choice. */
  keySource(context: string, action: Action): string {
    const parent = this.parents.get(context);
    if (Object.hasOwn(this.defaults.get(context) ?? {}, action) || parent === undefined || !parent.actions.includes(action)) return context;
    return this.keySource(parent.context, action);
  }
  /** Adds table groups and rows for as long as `scope` lives (the game's own, a level's riding rows). */
  describe(table: BindingTableDef, scope: Scope): void {
    const groups = [...(table.groups ?? [])], rows = [...(table.rows ?? [])];
    this.groupDefs.push(...groups); this.rowDefs.push(...rows);
    scope.onDispose(() => {
      for (const group of groups) this.groupDefs.splice(this.groupDefs.indexOf(group), 1);
      for (const row of rows) this.rowDefs.splice(this.rowDefs.indexOf(row), 1);
    });
  }
  get table(): { groups: readonly BindingGroupDef[]; rows: readonly BindingRowDef[] } { return { groups: this.groupDefs, rows: this.rowDefs }; }
  /** Saves `codes` as the action's keys in one context; the empty list unbinds it. */
  assign(context: string, action: Action, codes: readonly string[]): void {
    if (!this.defaults.has(context)) throw new Error(`Unknown binding context ${context}`);
    const source = this.keySource(context, action);
    this.overrides = { ...this.overrides, [source]: { ...this.overrides[source], [action]: [...codes] } }; controls.write(this.overrides); this.invalidate(); this.changed();
  }
  keys(context: string): Keys { return this.resolve(context, false); }
  /** Borrowed immutable scan rows; public keys() retains detached records. */
  keyEntries(context: string): readonly (readonly [string, readonly string[] | undefined])[] {
    let entries = this.resolvedEntries.get(context);
    if (entries === undefined) {
      entries = Object.freeze(Object.entries(this.resolve(context, false)).map(([action, codes]) => Object.freeze([action,
        codes === undefined ? undefined : Object.freeze([...codes])] as const)));
      this.resolvedEntries.set(context, entries);
    }
    return entries;
  }
  private resolve(context: string, defaultsOnly: boolean): Keys {
    const parent = this.parents.get(context);
    const inherited = parent === undefined ? {} : Object.fromEntries(Object.entries(this.resolve(parent.context, defaultsOnly)).filter(([action]) => parent.actions.includes(action as Action)));
    // Saved overrides cannot restore actions removed from a context's defaults.
    const defaults = { ...inherited, ...this.defaults.get(context) };
    if (defaultsOnly) return defaults;
    // Old copies of inherited keys never shadow the parent's current saved choice.
    const overrides = Object.fromEntries(Object.entries(this.overrides[context] ?? {}).filter(([action]) => Object.hasOwn(this.defaults.get(context) ?? {}, action)));
    return { ...defaults, ...overrides };
  }
  entries(): readonly { context: string; action: Action; codes: readonly string[] }[] {
    return [...this.defaults.keys()].flatMap((context) => Object.entries(this.keys(context)).map(([action, codes]) => ({ context, action: action as Action, codes: codes ?? [] })));
  }
  conflict(context: string, action: Action, code: string): Action | undefined {
    return Object.entries(this.keys(context)).find(([other, codes]) => other !== action && codes?.includes(code))?.[0] as Action | undefined;
  }
  rebind(context: string, action: Action, code: string, swap = false): Action | undefined {
    if (!this.defaults.has(context)) throw new Error(`Unknown binding context ${context}`);
    const source = this.keySource(context, action); if (source !== context) return this.rebind(source, action, code, swap);
    const conflict = this.conflict(context, action, code); if (conflict !== undefined && !swap) return conflict;
    const previous = this.keys(context)[action] ?? [], edits = { ...this.overrides[context], [action]: [code] };
    if (conflict !== undefined) edits[conflict] = [...previous];
    this.overrides = { ...this.overrides, [context]: edits }; controls.write(this.overrides); this.invalidate(); this.changed(); return undefined;
  }
  reset(): void { this.overrides = {}; controls.reset(); this.invalidate(); this.changed(); }
}
