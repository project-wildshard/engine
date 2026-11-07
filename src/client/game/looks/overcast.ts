import * as THREE from 'three';

/**
 * An overcast laid over a day look, as rows (SHARD-PLATFORM W2 C2; Pine Hollow's keyed-sky weather, and the law Nalati's
 * steppe storm moves onto in W3): a cloud deck `s` (0 clear … 1 full) turns the hour's blended look in place — the key light
 * dimmed, the fill raised, colours greyed or pulled toward a storm palette, the shafts and rays put out, the fog thickened,
 * the lamps lit early. The look's own keyed numbers are never edited: the rows run over the copy the clock blended this
 * frame, in order (a colour greyed, then darkened, is two rows). Nothing here knows a shard or what its look holds; a row
 * names one of the look's number or colour fields and says what the deck does to it, × `s`:
 *
 *   scale    v × (1 + by·s)          (a colour: every channel)    `curve` [a, b]: s through smoothstep(a, b, s) first
 *   add      v + by·s                (a number)
 *   atLeast  max(v, by·s)            (a number)
 *   grey     v → its luminance × `tint`, by `by`·s   (a colour)
 *   toward   v → `colour` × (`lit` ? the hour's level × lit : 1), by `by`·s   (a colour; the level is the caller's, so a
 *            night storm stays dark between flashes)
 *
 *   overcastOver(look, rows, s, level)
 */

/** Linear RGB. */
export type OvercastRgb = readonly [number, number, number];
type NumberKey<T> = { [K in keyof T]-?: T[K] extends number ? K : never }[keyof T] & string;
type ColourKey<T> = { [K in keyof T]-?: T[K] extends THREE.Color ? K : never }[keyof T] & string;

/** One field's response to the deck (see the module comment). */
export type OvercastRow<T> =
  | { readonly op: 'scale'; readonly key: NumberKey<T> | ColourKey<T>; readonly by: number; readonly curve?: readonly [number, number] }
  | { readonly op: 'add'; readonly key: NumberKey<T>; readonly by: number }
  | { readonly op: 'atLeast'; readonly key: NumberKey<T>; readonly by: number }
  | { readonly op: 'grey'; readonly key: ColourKey<T>; readonly by: number; readonly tint: OvercastRgb }
  | { readonly op: 'toward'; readonly key: ColourKey<T>; readonly by: number; readonly colour: OvercastRgb; readonly lit?: number };

const target = new THREE.Color();
/** a row's colour field (a misnamed row throws) */
function colour(v: unknown, key: string): THREE.Color { if (v instanceof THREE.Color) return v; throw new Error(`overcast: ${key} is no colour`); }
const smooth = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Lay a deck `s` (clamped to 0 … 1) over `look` in place by its rows; `level` scales a `toward` row's `lit` colour. Returns s. */
export function overcastOver<T extends object>(look: T, rows: readonly OvercastRow<T>[], deck: number, level = 1): number {
  const s = Math.min(1, Math.max(0, deck));
  if (s <= 0) return 0;
  for (const row of rows) {
    const v: unknown = Reflect.get(look, row.key);
    if (row.op === 'scale') {
      const k = 1 + row.by * (row.curve === undefined ? s : smooth(row.curve[0], row.curve[1], s));
      if (v instanceof THREE.Color) v.multiplyScalar(k); else if (typeof v === 'number') Reflect.set(look, row.key, v * k);
      else throw new Error(`overcast: ${row.key} is no number or colour`);
    } else if (row.op === 'add' || row.op === 'atLeast') {
      if (typeof v !== 'number') throw new Error(`overcast: ${row.key} is no number`);
      Reflect.set(look, row.key, row.op === 'add' ? v + row.by * s : Math.max(v, row.by * s));
    } else if (row.op === 'grey') {
      const c = colour(v, row.key), l = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
      c.lerp(target.setRGB(l * row.tint[0], l * row.tint[1], l * row.tint[2]), row.by * s);
    } else {
      const k = row.lit === undefined ? 1 : level * row.lit;
      colour(v, row.key).lerp(target.setRGB(row.colour[0] * k, row.colour[1] * k, row.colour[2] * k), row.by * s);
    }
  }
  return s;
}
