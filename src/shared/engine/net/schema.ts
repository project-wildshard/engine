// P1-E5.2 (J4, E5-REPLICATION §3): entity state declares what replicates. Declarations are plain data tables with
// accessors, as Source's SendTables and Unreal's replicated properties are lists; a field no table names stays on the
// server. Each table compiles once into columns; encode and decode are plain loops over those columns.
import { fnv1a32 } from '../core/rng';
import { bitsToFloat, floatToBits } from './bits';

/** Who receives a field. `initial` goes once in the spawn event, then never again (COND_InitialOnly). */
export type NetSend = 'all' | 'owner' | 'others' | 'initial';
/** A value a decoded field yields: a number, a flag, a string, or a `ref` handle (0 for none). */
export type NetValue = number | boolean | string;
interface NetFieldBase {
  readonly send?: NetSend;
  /** The owner's client predicts this field; it arrives unquantised in the owner block, and is compared unless a correction takes it. */
  readonly predicted?: true;
}
/** One declared field: its wire form and the accessor that reads it from a server-side view `S`. */
export type NetField<S> = NetFieldBase & (
  | { readonly kind: 'f32q'; readonly min: number; readonly max: number; readonly bits: number; readonly read: (view: S) => number }
  | { readonly kind: 'f32' | 'f64'; readonly read: (view: S) => number }
  | { readonly kind: 'angle'; readonly bits: 8 | 10 | 16; readonly read: (view: S) => number }
  | { readonly kind: 'u8' | 'u16' | 'u32'; readonly read: (view: S) => number }
  | { readonly kind: 'bool'; readonly read: (view: S) => boolean }
  | { readonly kind: 'enum'; readonly values: readonly string[]; readonly read: (view: S) => string }
  | { readonly kind: 'ref'; readonly read: (view: S) => string | null }
  | { readonly kind: 'text'; readonly read: (view: S) => string });
/** One entity class's declaration. */
export interface NetSchema<S> {
  readonly cls: string;
  readonly fields: Readonly<Record<string, NetField<S>>>;
  /** Replicated only within this many metres of the receiver's player; absent means everywhere in the cell. */
  readonly relevance?: { readonly radius: number };
}
/** Declare a class. Typed as a function so a table's accessors infer `S`. */
export function netSchema<S>(schema: NetSchema<S>): NetSchema<S> { return schema; }

/** Maps stable string ids to the receiver's net handles for `ref` fields (§3.4). */
export type NetRefs = (id: string) => number;
/** One compiled field. `sample` reads and quantises; `value` undoes it; `step` is one quantisation step (0 when exact). An `f64` is 64 bits: only an owner block, which holds doubles, carries it. */
export interface NetColumn<S> {
  readonly name: string; readonly kind: NetField<S>['kind']; readonly bits: number; readonly step: number;
  readonly sample: (view: S, refs: NetRefs) => number;
  readonly value: (quantised: number) => NetValue;
}
/** A compiled class: its fields split by audience. A row holds one quantised value per `row` column. */
export interface NetClass<S> {
  readonly id: number; readonly cls: string;
  /** Delta rows for everyone: `all` and `others` fields. */
  readonly row: readonly NetColumn<S>[];
  /** The owner block, written whole every frame: `all`, `owner` and `predicted` fields. */
  readonly owner: readonly NetColumn<S>[];
  /** Spawn-only fields that fit a row value. */
  readonly initial: readonly NetColumn<S>[];
  /** Spawn-only strings. */
  readonly text: readonly { readonly name: string; readonly read: (view: S) => string }[];
  readonly radius: number | null;
  /** Indices of the row's x, y and z, which relevance measures with; null for a class with no position. */
  readonly position: readonly [number, number, number] | null;
}

const TAU = Math.PI * 2;
/** The most row fields a class may declare: the changed-field mask is one 32-bit word. */
export const MAX_ROW_FIELDS = 32;
const clamp = (value: number, low: number, high: number): number => value < low ? low : value > high ? high : value;

function column<S>(name: string, field: NetField<S>): NetColumn<S> {
  const base = { name, kind: field.kind };
  if (field.kind === 'f32q') {
    const span = field.max - field.min, top = 2 ** field.bits - 1, step = span / top;
    return { ...base, bits: field.bits, step,
      sample: view => Math.round((clamp(field.read(view), field.min, field.max) - field.min) / step),
      value: quantised => field.min + quantised * step };
  }
  if (field.kind === 'f32') return { ...base, bits: 32, step: 0, sample: view => floatToBits(field.read(view)), value: bitsToFloat };
  if (field.kind === 'f64') return { ...base, bits: 64, step: 0, sample: view => field.read(view), value: double => double }; // an owner block holds the double itself
  if (field.kind === 'angle') {
    const turns = 2 ** field.bits, step = TAU / turns;
    return { ...base, bits: field.bits, step,
      sample: view => Math.round((((field.read(view) % TAU) + TAU) % TAU) / step) % turns,
      value: quantised => quantised * step };
  }
  if (field.kind === 'u8' || field.kind === 'u16' || field.kind === 'u32') {
    const bits = field.kind === 'u8' ? 8 : field.kind === 'u16' ? 16 : 32, top = 2 ** bits - 1;
    return { ...base, bits, step: 1, sample: view => clamp(Math.round(field.read(view)), 0, top), value: quantised => quantised };
  }
  if (field.kind === 'bool') return { ...base, bits: 1, step: 0, sample: view => field.read(view) ? 1 : 0, value: quantised => quantised === 1 };
  if (field.kind === 'enum') {
    const index = new Map(field.values.map((value, at) => [value, at]));
    return { ...base, bits: Math.max(1, Math.ceil(Math.log2(field.values.length))), step: 0,
      sample: view => {
        const raw = field.read(view), at = index.get(raw);
        if (at === undefined) throw new RangeError(`Undeclared ${name} value ${raw}`);
        return at;
      },
      value: quantised => field.values[quantised] ?? '' };
  }
  if (field.kind === 'ref') return { ...base, bits: 16, step: 0, sample: (view, refs) => { const id = field.read(view); return id === null ? 0 : refs(id); }, value: quantised => quantised };
  throw new RangeError(`Text field ${name} has no row form`);
}

/** Compile one declaration, refusing a table the wire cannot carry. */
export function compileSchema<S>(schema: NetSchema<S>, id: number): NetClass<S> {
  const row: NetColumn<S>[] = [], owner: NetColumn<S>[] = [], initial: NetColumn<S>[] = [], text: { name: string; read: (view: S) => string }[] = [];
  for (const [name, field] of Object.entries(schema.fields)) {
    const send = field.send ?? 'all';
    if (field.predicted === true && send !== 'all' && send !== 'owner') throw new RangeError(`${schema.cls}.${name}: a predicted field is the owner's`);
    if (field.kind === 'text') {
      if (send !== 'initial') throw new RangeError(`${schema.cls}.${name}: text is initial-only`);
      text.push({ name, read: field.read }); continue;
    }
    if (field.kind === 'f64' && field.predicted !== true && send !== 'owner') throw new RangeError(`${schema.cls}.${name}: a double fits only the owner block`);
    const compiled = column(name, field);
    if (send === 'initial') { initial.push(compiled); continue; }
    if (field.predicted === true) { owner.push(compiled); continue; }
    if (send !== 'others') owner.push(compiled);
    if (send !== 'owner') row.push(compiled);
  }
  if (row.length > MAX_ROW_FIELDS) throw new RangeError(`${schema.cls} declares more than ${String(MAX_ROW_FIELDS)} row fields`);
  const at = (name: string): number => row.findIndex(entry => entry.name === name);
  const x = at('x'), y = at('y'), z = at('z');
  return { id, cls: schema.cls, row, owner, initial, text, radius: schema.relevance?.radius ?? null, position: x < 0 || y < 0 || z < 0 ? null : [x, y, z] };
}

/** The canonical text of a declaration: class, field names, kinds, bounds and order. */
function describeSchema<S>(schema: NetSchema<S>): string {
  const fields = Object.entries(schema.fields).map(([name, field]) => {
    const bounds = field.kind === 'f32q' ? `${String(field.min)},${String(field.max)},${String(field.bits)}`
      : field.kind === 'angle' ? String(field.bits) : field.kind === 'enum' ? field.values.join(',') : '';
    return `${name}:${field.kind}:${bounds}:${field.send ?? 'all'}:${field.predicted === true ? 'p' : ''}`;
  });
  return `${schema.cls}{${fields.join(';')}}@${String(schema.relevance?.radius ?? '')}`;
}
/** The word NET_SCHEMA_HASH is: FNV-1a over every class's canonical text, so it changes whenever the wire does. */
export function netSchemaHash(descriptions: readonly string[]): number { return fnv1a32(descriptions.join('|')); }
/** One class's contribution to the hash. */
export function schemaDescription<S>(schema: NetSchema<S>): string { return describeSchema(schema); }
