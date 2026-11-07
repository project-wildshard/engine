import type { DayLookSchema, DayLookRow } from '@wildshard/format/dayLook';
import { Color } from 'three';

/**
 * Keyed day-look presets from a schema (SHARD-PLATFORM W2 C2): a day clock's keyframes each hold a preset (the light's
 * colour and intensity, the fog, the sky's palette …) authored as data, and the clock blends the two around the phase. A
 * shard declares the preset's fields once as a schema; this turns a data row into its live preset (three.js colours), copies
 * one and blends two. Nothing here knows a shard or what the fields mean.
 *
 *   const kit = dayLookPresets({ key: 'name', sunColor: 'colour', sunI: 'number', sky: { zenith: 'colour' } });
 *   const live = kit.live(row);  kit.lerp(out, a, b, t);  // DayCycle keys: { frames, blend: kit.lerp }
 *
 * A field is a `'colour'` (data: an sRGB hex number, converted to linear like `new Color(hex)`, or a linear RGB triple;
 * live: a `Color`, blended linearly), a `'number'` (blended linearly), a `'name'` (a string that switches from a's to b's
 * at the midpoint), or a nested group of fields.
 */

/** A live preset: its colours as three.js colours. */
export type DayLookPreset<S extends DayLookSchema> = {
  -readonly [K in keyof S]: S[K] extends 'colour' ? Color : S[K] extends 'number' ? number : S[K] extends 'name' ? string : S[K] extends DayLookSchema ? DayLookPreset<S[K]> : never;
};

/** A schema's row → live preset, copy and blend. */
export interface DayLookPresets<S extends DayLookSchema> {
  /** a row's live preset (its own colours) */
  readonly live: (row: DayLookRow<S>) => DayLookPreset<S>;
  /** a preset's copy (its own colours) */
  readonly clone: (p: DayLookPreset<S>) => DayLookPreset<S>;
  /** `out` = a → b at t (a name switches at the midpoint) */
  readonly lerp: (out: DayLookPreset<S>, a: DayLookPreset<S>, b: DayLookPreset<S>, t: number) => void;
}

type Fields = Record<string, unknown>;
/** a schema as a flat list, compiled once (the clock blends every frame) */
type Plan = readonly (readonly [string, 'colour' | 'number' | 'name' | Plan])[];
const planOf = (schema: DayLookSchema): Plan => Object.entries(schema).map(([k, kind]) => [k, typeof kind === 'string' ? kind : planOf(kind)] as const);
const fieldsOf = (v: unknown): Fields => (typeof v === 'object' && v !== null ? v as Fields : {});
const num = (v: unknown): number => (typeof v === 'number' ? v : 0);
const colourOf = (v: unknown): Color => (Array.isArray(v) ? new Color(num(v[0]), num(v[1]), num(v[2])) : new Color(num(v)));
const colour = (v: unknown): Color => (v instanceof Color ? v : new Color());

function live(plan: Plan, row: Fields): Fields {
  const out: Fields = {};
  for (const [k, kind] of plan) {
    const v = row[k];
    out[k] = kind === 'colour' ? colourOf(v) : kind === 'number' ? num(v) : kind === 'name' ? String(v) : live(kind, fieldsOf(v));
  }
  return out;
}
function clone(plan: Plan, p: Fields): Fields {
  const out: Fields = {};
  for (const [k, kind] of plan) {
    const v = p[k];
    out[k] = kind === 'colour' ? colour(v).clone() : kind === 'number' || kind === 'name' ? v : clone(kind, fieldsOf(v));
  }
  return out;
}
function lerp(plan: Plan, out: Fields, a: Fields, b: Fields, t: number): void {
  for (const [k, kind] of plan) {
    if (kind === 'colour') colour(out[k]).copy(colour(a[k])).lerp(colour(b[k]), t);
    else if (kind === 'number') { const x = num(a[k]); out[k] = x + (num(b[k]) - x) * t; }
    else if (kind === 'name') out[k] = t < 0.5 ? a[k] : b[k];
    else lerp(kind, fieldsOf(out[k]), fieldsOf(a[k]), fieldsOf(b[k]), t);
  }
}

/** The live-preset kit a schema declares. */
export function dayLookPresets<S extends DayLookSchema>(schema: S): DayLookPresets<S> {
  const plan = planOf(schema);
  return {
    live: (row) => live(plan, fieldsOf(row)) as DayLookPreset<S>,
    clone: (p) => clone(plan, fieldsOf(p)) as DayLookPreset<S>,
    lerp: (out, a, b, t) => { lerp(plan, fieldsOf(out), fieldsOf(a), fieldsOf(b), t); },
  };
}
