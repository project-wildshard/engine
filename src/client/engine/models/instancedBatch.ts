/**
 * InstancedBatch: the BatchedMesh surface a kit fills (geometries, then copies it moves, tints, shows and hides), drawn
 * instanced: one InstancedMesh per geometry, holding only that geometry's visible copies, packed as they change. Never
 * multi-draw (E271 / E272: it killed the iPhone; a graph look on a multi-draw batch did not even compile on the grid).
 * A culler drives it as a `BatchSink` (models/cull.ts `BatchedCull`). Copies are not frustum-culled one by one: callers
 * that need it cull first and hide what is out of view.
 *
 * FC16: copies the owner names still (`mergeStill`) draw together instead, while shown: their geometries baked at their
 * matrices into one mesh, drawn as one instance at the identity (the same instanced program). A still copy may settle
 * (be moved up to STILL_SETTLES times: its owner places it on the floor once the ground is in); moved again, tinted or
 * given another geometry it goes back to its own geometry's mesh for good. One hidden and shown again stays still.
 * Driftwood's interactables were one draw a shape (14 draws of 18 copies at the spawn).
 *
 *   const batch = new InstancedBatch(material, { name: 'interact-lit', castShadow: true });
 *   const id = batch.addInstance(batch.addGeometry(geometry)); batch.setMatrixAt(id, matrix);
 */
import * as THREE from 'three';
import type { BatchSink } from './cull';
import { cullCopiesPerCascade } from '../world/cascadeCull';


interface Slot { readonly geometry: THREE.BufferGeometry; mesh: THREE.InstancedMesh | null; capacity: number; copies: Int32Array }
/** `held` of a copy drawn by the still merge */
const MERGED = -2;
/** moves a still copy may make (each re-bakes the merge) before it is drawn on its own for good */
const STILL_SETTLES = 2;
const WHITE = new THREE.Color(1, 1, 1), IDENTITY = new THREE.Matrix4();
/** a geometry the merge can bake: plain attributes (float positions and normals), one index or none, no morphs, tangents
 *  or draw range (its groups do not matter: one material draws the whole geometry); `key` names its attribute layout,
 *  which every merged geometry shares */
function mergeKey(geometry: THREE.BufferGeometry): string | null {
  if (Object.keys(geometry.morphAttributes).length > 0 || geometry.drawRange.start !== 0 || geometry.drawRange.count !== Infinity) return null;
  const parts: string[] = [];
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    if (!(attribute instanceof THREE.BufferAttribute) || name === 'tangent') return null;
    if ((name === 'position' || name === 'normal') && (attribute.itemSize !== 3 || attribute.normalized || !(attribute.array instanceof Float32Array))) return null;
    parts.push(`${name}:${attribute.itemSize}:${attribute.normalized ? 'n' : ''}:${attribute.array.constructor.name}`);
  }
  return geometry.getAttribute('position') === undefined ? null : parts.sort().join(',');
}
/** The copies' geometries at their matrices, as one geometry: positions as three's instancing transforms them, normals by
 *  its instancing rule (each axis divided by its squared scale, then the matrix's 3x3), every other attribute as it is. */
function bakeCopies(copies: readonly { readonly geometry: THREE.BufferGeometry; readonly matrix: THREE.Matrix4 }[]): THREE.BufferGeometry {
  const first = copies[0]?.geometry; if (first === undefined) throw new Error('Instanced batch merges no copies');
  let vertices = 0, indices = 0;
  for (const { geometry } of copies) { const count = geometry.getAttribute('position').count; vertices += count; indices += geometry.index?.count ?? count; }
  const out = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(first.attributes)) {
    if (!(attribute instanceof THREE.BufferAttribute)) throw new Error('Instanced batch merges plain attributes');
    const Typed = attribute.array.constructor as new (length: number) => THREE.TypedArray;
    const array = new Typed(vertices * attribute.itemSize);
    let at = 0;
    for (const { geometry, matrix } of copies) {
      const source = geometry.getAttribute(name); if (!(source instanceof THREE.BufferAttribute)) throw new Error('Instanced batch merge lost an attribute');
      const e = matrix.elements, from = source.array, n = source.count * source.itemSize;
      if (name === 'position') for (let i = 0; i < n; i += 3) {
        const x = from[i] ?? 0, y = from[i + 1] ?? 0, z = from[i + 2] ?? 0;
        array[at + i] = (e[0] ?? 1) * x + (e[4] ?? 0) * y + (e[8] ?? 0) * z + (e[12] ?? 0);
        array[at + i + 1] = (e[1] ?? 0) * x + (e[5] ?? 1) * y + (e[9] ?? 0) * z + (e[13] ?? 0);
        array[at + i + 2] = (e[2] ?? 0) * x + (e[6] ?? 0) * y + (e[10] ?? 1) * z + (e[14] ?? 0);
      } else if (name === 'normal') {
        const sx = (e[0] ?? 1) ** 2 + (e[1] ?? 0) ** 2 + (e[2] ?? 0) ** 2, sy = (e[4] ?? 0) ** 2 + (e[5] ?? 1) ** 2 + (e[6] ?? 0) ** 2, sz = (e[8] ?? 0) ** 2 + (e[9] ?? 0) ** 2 + (e[10] ?? 1) ** 2;
        for (let i = 0; i < n; i += 3) {
          const x = (from[i] ?? 0) / sx, y = (from[i + 1] ?? 0) / sy, z = (from[i + 2] ?? 0) / sz;
          array[at + i] = (e[0] ?? 1) * x + (e[4] ?? 0) * y + (e[8] ?? 0) * z;
          array[at + i + 1] = (e[1] ?? 0) * x + (e[5] ?? 1) * y + (e[9] ?? 0) * z;
          array[at + i + 2] = (e[2] ?? 0) * x + (e[6] ?? 0) * y + (e[10] ?? 1) * z;
        }
      } else array.set(from.subarray(0, n), at);
      at += n;
    }
    out.setAttribute(name, new THREE.BufferAttribute(array, attribute.itemSize, attribute.normalized));
  }
  const index = vertices > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
  let base = 0, written = 0;
  for (const { geometry } of copies) {
    const count = geometry.getAttribute('position').count, source = geometry.index;
    if (source === null) for (let i = 0; i < count; i++) index[written++] = base + i;
    else for (let i = 0; i < source.count; i++) index[written++] = base + source.getX(i);
    base += count;
  }
  out.setIndex(new THREE.BufferAttribute(index, 1));
  return out;
}
export interface InstancedBatchOptions {
  readonly name?: string;
  readonly castShadow?: boolean;
  readonly receiveShadow?: boolean;
  /** dispose the added geometries with the batch (a kit's own shapes); false when another owner holds them */
  readonly ownsGeometry?: boolean;
}

export class InstancedBatch extends THREE.Group implements BatchSink {
  private readonly slots: Slot[] = [];
  /** per copy: its geometry, the slot holding it now (-1: hidden), its index there, its matrix and tint */
  private geometryOf = new Int32Array(16);
  private held = new Int32Array(16);
  private at = new Int32Array(16);
  private matrices = new Float32Array(16 * 16);
  private colors: Float32Array | null = null;
  /** per copy: 1 when it is still (`mergeStill`): drawn by `merged` while shown */
  private still = new Uint8Array(16);
  /** per copy: the moves it made while still */
  private settles = new Uint8Array(16);
  private merged: THREE.InstancedMesh | null = null;
  private copies = 0;
  private readonly scratchMatrix = new THREE.Matrix4();
  private readonly scratchColor = new THREE.Color();

  readonly material: THREE.Material;
  private readonly options: InstancedBatchOptions;

  constructor(material: THREE.Material, options: InstancedBatchOptions = {}) {
    super();
    this.material = material; this.options = options;
    this.name = options.name ?? 'instanced-batch';
  }

  /** A shape its copies can draw; returns its id. */
  addGeometry(geometry: THREE.BufferGeometry): number {
    this.slots.push({ geometry, mesh: null, capacity: 0, copies: new Int32Array(0) });
    return this.slots.length - 1;
  }

  /** Size geometry `geometry`'s mesh for `capacity` copies now (it otherwise grows as copies show). */
  reserve(geometry: number, capacity: number): this {
    const slot = this.slots[geometry];
    if (slot === undefined) throw new Error(`Instanced batch has no geometry ${geometry}`);
    if (capacity > slot.capacity) this.widen(slot, capacity);
    return this;
  }

  /** A new visible copy of geometry `geometry`, at the identity until moved; returns its id. */
  addInstance(geometry: number): number {
    if (this.slots[geometry] === undefined) throw new Error(`Instanced batch has no geometry ${geometry}`);
    const id = this.copies++;
    if (id >= this.held.length) this.grow(this.held.length * 2);
    this.geometryOf[id] = geometry; this.held[id] = -1;
    this.scratchMatrix.identity().toArray(this.matrices, id * 16);
    this.colors?.fill(1, id * 3, id * 3 + 3);
    this.show(id);
    return id;
  }

  get instanceCount(): number { return this.copies; }

  setMatrixAt(id: number, matrix: THREE.Matrix4): this {
    this.check(id);
    if (this.still[id] === 1) {
      if (this.sameMatrix(id, matrix)) return this;
      const settles = (this.settles[id] ?? 0) + 1; this.settles[id] = settles;
      if (settles <= STILL_SETTLES) { matrix.toArray(this.matrices, id * 16); if (this.held[id] === MERGED) this.bake(); return this; }
      this.unstill(id);
    }
    matrix.toArray(this.matrices, id * 16);
    const slot = this.slots[this.held[id] ?? -1];
    if (slot?.mesh) { slot.mesh.setMatrixAt(this.at[id] ?? 0, matrix); slot.mesh.instanceMatrix.needsUpdate = true; }
    return this;
  }

  getMatrixAt(id: number, out: THREE.Matrix4): THREE.Matrix4 { this.check(id); return out.fromArray(this.matrices, id * 16); }

  setColorAt(id: number, color: THREE.Color): this {
    this.check(id);
    if (this.colors === null) {
      this.colors = new Float32Array(this.held.length * 3).fill(1); for (const slot of this.slots) if (slot.mesh) this.tint(slot);
      if (this.merged !== null) { this.merged.setColorAt(0, WHITE); }
    }
    if (this.still[id] === 1) {
      const c = this.colors, at = id * 3;
      if (c[at] === Math.fround(color.r) && c[at + 1] === Math.fround(color.g) && c[at + 2] === Math.fround(color.b)) return this;
      this.unstill(id);
    }
    color.toArray(this.colors, id * 3);
    const slot = this.slots[this.held[id] ?? -1];
    if (slot?.mesh) { slot.mesh.setColorAt(this.at[id] ?? 0, color); if (slot.mesh.instanceColor) slot.mesh.instanceColor.needsUpdate = true; }
    return this;
  }

  setVisibleAt(id: number, visible: boolean): this {
    this.check(id);
    if (this.still[id] === 1) {
      if (visible === (this.held[id] === MERGED)) return this;
      this.held[id] = visible ? MERGED : -1; this.bake(); return this;
    }
    if (!visible) this.hide(id); else if ((this.held[id] ?? -1) < 0) this.show(id);
    return this;
  }

  getVisibleAt(id: number): boolean { this.check(id); const held = this.held[id] ?? -1; return held >= 0 || held === MERGED; }

  /**
   * Every copy not in `except`, untinted and of a geometry the merge can bake, is still from now on: drawn in the one
   * merged mesh while it is shown and stays where it is (a caller names the copies it will animate in `except`). A copy
   * hidden now joins the merge when it is shown.
   */
  mergeStill(except: ReadonlySet<number> = new Set()): this {
    let key: string | null = null;
    for (let id = 0; id < this.copies; id++) {
      const slot = this.slots[this.geometryOf[id] ?? -1];
      if (slot === undefined || except.has(id) || this.still[id] === 1) continue;
      const c = this.colors, at = id * 3;
      if (c !== null && (c[at] !== 1 || c[at + 1] !== 1 || c[at + 2] !== 1)) continue;
      const own = mergeKey(slot.geometry); if (own === null || (key !== null && own !== key)) continue;
      key = own; this.still[id] = 1;
      if ((this.held[id] ?? -1) >= 0) { this.hide(id); this.held[id] = MERGED; }
    }
    this.bake();
    return this;
  }

  setGeometryIdAt(id: number, geometry: number): this {
    this.check(id);
    if (this.slots[geometry] === undefined) throw new Error(`Instanced batch has no geometry ${geometry}`);
    if (this.geometryOf[id] === geometry) return this;
    if (this.still[id] === 1) this.unstill(id);
    const shown = (this.held[id] ?? -1) >= 0;
    this.hide(id); this.geometryOf[id] = geometry;
    if (shown) this.show(id);
    return this;
  }

  getGeometryIdAt(id: number): number { this.check(id); return this.geometryOf[id] ?? -1; }

  /** Free the instance buffers (and the geometries when it owns them); the material stays its owner's. */
  override dispose(): void {
    if (this.merged !== null) { this.merged.geometry.dispose(); this.merged.dispose(); this.merged.removeFromParent(); this.merged = null; }
    for (const slot of this.slots) {
      slot.mesh?.dispose(); slot.mesh?.removeFromParent(); slot.mesh = null;
      if (this.options.ownsGeometry === true) slot.geometry.dispose();
    }
  }

  private check(id: number): void { if (id < 0 || id >= this.copies) throw new Error(`Instanced batch has no copy ${id}`); }

  private grow(size: number): void {
    const widen = <T extends Int32Array | Float32Array>(from: T, to: T): T => { to.set(from); return to; };
    this.geometryOf = widen(this.geometryOf, new Int32Array(size)); this.held = widen(this.held, new Int32Array(size));
    this.at = widen(this.at, new Int32Array(size)); this.matrices = widen(this.matrices, new Float32Array(size * 16));
    const still = new Uint8Array(size); still.set(this.still); this.still = still;
    const settles = new Uint8Array(size); settles.set(this.settles); this.settles = settles;
    if (this.colors !== null) this.colors = widen(this.colors, new Float32Array(size * 3).fill(1));
  }

  /** the copy's stored matrix equals `matrix` as stored (float32) */
  private sameMatrix(id: number, matrix: THREE.Matrix4): boolean {
    const e = matrix.elements, at = id * 16;
    for (let i = 0; i < 16; i++) if (this.matrices[at + i] !== Math.fround(e[i] ?? 0)) return false;
    return true;
  }

  /** A still copy changes: back to its own geometry's mesh for good (shown there if it was drawn by the merge). */
  private unstill(id: number): void {
    this.still[id] = 0;
    if (this.held[id] !== MERGED) return;
    this.held[id] = -1; this.show(id); this.bake();
  }

  /** (Re)build the merged mesh of the still copies now shown. */
  private bake(): void {
    const old = this.merged; this.merged = null;
    if (old !== null) { old.geometry.dispose(); old.dispose(); old.removeFromParent(); }
    const copies: { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 }[] = [];
    for (let id = 0; id < this.copies; id++) {
      const slot = this.slots[this.geometryOf[id] ?? -1];
      if (this.held[id] === MERGED && slot !== undefined) copies.push({ geometry: slot.geometry, matrix: new THREE.Matrix4().fromArray(this.matrices, id * 16) });
    }
    if (copies.length === 0) return;
    const mesh = new THREE.InstancedMesh(bakeCopies(copies), this.material, 1);
    mesh.name = `${this.name}:still`; mesh.frustumCulled = false; cullCopiesPerCascade(mesh);
    mesh.castShadow = this.options.castShadow ?? false; mesh.receiveShadow = this.options.receiveShadow ?? false;
    mesh.setMatrixAt(0, IDENTITY);
    if (this.colors !== null) mesh.setColorAt(0, WHITE);
    this.merged = mesh; this.add(mesh);
  }

  /** Pack copy `id` at the end of its geometry's mesh (a larger mesh replaces a full one). */
  private show(id: number): void {
    const index = this.geometryOf[id] ?? -1, slot = this.slots[index];
    if (slot === undefined) return;
    if (slot.mesh === null || slot.mesh.count >= slot.capacity) this.widen(slot, Math.max(4, slot.capacity * 2));
    const mesh = slot.mesh; if (mesh === null) return;
    const at = mesh.count;
    mesh.setMatrixAt(at, this.scratchMatrix.fromArray(this.matrices, id * 16)); mesh.instanceMatrix.needsUpdate = true;
    if (this.colors !== null) { mesh.setColorAt(at, this.scratchColor.fromArray(this.colors, id * 3)); if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }
    slot.copies[at] = id; mesh.count = at + 1; this.held[id] = index; this.at[id] = at;
  }

  /** Unpack copy `id`: the mesh's last copy fills its place. */
  private hide(id: number): void {
    const slot = this.slots[this.held[id] ?? -1], mesh = slot?.mesh;
    if (slot === undefined || mesh === undefined || mesh === null) return;
    const at = this.at[id] ?? 0, last = mesh.count - 1, moved = slot.copies[last] ?? -1;
    if (at !== last && moved >= 0) {
      mesh.setMatrixAt(at, this.scratchMatrix.fromArray(this.matrices, moved * 16));
      if (this.colors !== null) mesh.setColorAt(at, this.scratchColor.fromArray(this.colors, moved * 3));
      slot.copies[at] = moved; this.at[moved] = at;
    }
    mesh.count = last; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.held[id] = -1;
  }

  private widen(slot: Slot, capacity: number): void {
    const old = slot.mesh, mesh = new THREE.InstancedMesh(slot.geometry, this.material, capacity);
    mesh.name = `${this.name}:${this.slots.indexOf(slot)}`; mesh.frustumCulled = false; mesh.count = 0; cullCopiesPerCascade(mesh);
    mesh.castShadow = this.options.castShadow ?? false; mesh.receiveShadow = this.options.receiveShadow ?? false;
    const copies = new Int32Array(capacity);
    if (old !== null) {
      for (let i = 0; i < old.count; i++) { old.getMatrixAt(i, this.scratchMatrix); mesh.setMatrixAt(i, this.scratchMatrix); copies[i] = slot.copies[i] ?? -1; }
      mesh.count = old.count; old.dispose(); old.removeFromParent();
    }
    slot.mesh = mesh; slot.capacity = capacity; slot.copies = copies;
    if (this.colors !== null) this.tint(slot);
    this.add(mesh);
  }

  /** Give a slot's mesh its packed copies' tints (the first tint arrives after it was built). */
  private tint(slot: Slot): void {
    const mesh = slot.mesh; if (mesh === null || this.colors === null) return;
    for (let i = 0; i < mesh.count; i++) mesh.setColorAt(i, this.scratchColor.fromArray(this.colors, (slot.copies[i] ?? 0) * 3));
    if (mesh.count === 0) mesh.setColorAt(0, this.scratchColor.setRGB(1, 1, 1));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}
