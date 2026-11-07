/**
 * `SlotGeometry` — one merged geometry whose parts come and go without a second draw (E314: the sea glass chime that
 * grows a piece at a time, the trophy plaques that fill when a fight is won). The geometry is built as usual (a kit's
 * `finish`: non-indexed, flat), its parts recorded as vertex ranges in build order (`slot`s), and an index lists the
 * vertices of the slots that are on. `set(slot, on)` rewrites that index in place — no allocation, one small upload, only
 * when something changes (a pickup, a trophy: a few times a game). Every slot is drawn by the one mesh on the one shared
 * material, whatever is shown.
 *
 *   // ranges: each slot's vertices in the finished geometry, in build order (3 per triangle the kit added)
 *   const slots = new SlotGeometry(kit.finish({ ao: false }), [{ start: 0, count: 36 }, { start: 36, count: 24 }], [true, false]);
 *   slots.set(1, true);
 */
import * as THREE from 'three';

/** a slot: `count` vertices from `start` in the finished geometry */
export interface SlotRange { readonly start: number; readonly count: number }

/** one merged geometry whose recorded parts (slots) show and hide without another draw */
export class SlotGeometry {
  readonly geometry: THREE.BufferGeometry;
  private readonly ranges: readonly SlotRange[];
  private readonly on: boolean[];
  private readonly index: THREE.BufferAttribute;

  /** `geometry`: non-indexed; `initial[i]`: slot i shown (default all shown) */
  constructor(geometry: THREE.BufferGeometry, ranges: readonly SlotRange[], initial?: readonly boolean[]) {
    if (geometry.index !== null) throw new Error('SlotGeometry: the geometry must be non-indexed (a kit\'s finish())');
    this.geometry = geometry;
    this.ranges = ranges;
    this.on = ranges.map((_, i) => initial?.[i] ?? true);
    const n = geometry.getAttribute('position').count;
    this.index = new THREE.BufferAttribute(n > 65535 ? new Uint32Array(n) : new Uint16Array(n), 1);
    geometry.setIndex(this.index);
    this.write();
  }

  get slots(): number { return this.ranges.length; }
  shown(slot: number): boolean { return this.on[slot] ?? false; }

  /** show or hide one slot (no-op when unchanged) */
  set(slot: number, on: boolean): void {
    if (slot < 0 || slot >= this.on.length || this.on[slot] === on) return;
    this.on[slot] = on;
    this.write();
  }

  /** show exactly slots [from, from + n) of the slots [from, to) (a count: the chime's first n pieces), without a write per slot */
  setRun(from: number, to: number, n: number): void {
    let changed = false;
    for (let s = from; s < to && s < this.on.length; s++) {
      const want = s - from < n;
      if (this.on[s] !== want) { this.on[s] = want; changed = true; }
    }
    if (changed) this.write();
  }

  private write(): void {
    const arr = this.index.array;
    let k = 0;
    for (let s = 0; s < this.ranges.length; s++) {
      if (this.on[s] !== true) continue;
      const r = this.ranges[s];
      if (r === undefined) continue;
      for (let v = r.start, end = r.start + r.count; v < end; v++) arr[k++] = v;
    }
    this.index.needsUpdate = true;
    this.geometry.setDrawRange(0, k);
  }
}
