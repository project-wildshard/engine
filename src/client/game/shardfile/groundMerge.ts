/**
 * Tile streaming P1 (draws): a splat ground's resident tiles drawn as merged meshes per material, one per 250 m block (a
 * 2 x 2 of coarse tiles: at most four draws over a cell), so a tiled ground takes about as few draws as the whole one.
 * Each tile's ground mesh joins its block's merge hidden; the block rebuilds (once per task, on a microtask) whenever one of
 * its tiles arrives, leaves or (a coarse tile) changes which of its quadrants fine tiles cover: those quadrants' triangles
 * (by centroid) are left out, as the coarse tile mask's fragment test would hide them.
 *
 *   const merge = groundMerge(parent, material);
 *   const hide = merge.add(mesh, tileScope, { x: 1, z: 2 });   // a coarse tile; the fine tiles over it: hide(new Set([0, 3]))
 *
 * Positions go into the parent's space; a block's merged mesh carries the attributes every member of it has (a coarse
 * tile's vertex colours, say, are left out when a fine tile has none). A merged mesh receives shadow and never casts (as
 * the tiles), and leaves with its block's last member. Each tile keeps its transformed attributes and its kept triangles
 * (refreshed when its transform, an attribute's version or its hidden quadrants change), so a rebuild is copies.
 */
import { Box3, BufferAttribute, BufferGeometry, InterleavedBufferAttribute, Matrix4, Mesh, Sphere, Vector3, type Material, type Object3D } from 'three';
import type { Scope } from '@wildshard/engine/app/scope';

const HALF = 250, COARSE = 125, BLOCK = 250;
/** an attribute's change count (an interleaved one counts on its buffer) */
const versionOf = (attribute: BufferAttribute | InterleavedBufferAttribute): number => attribute instanceof InterleavedBufferAttribute ? attribute.data.version : attribute.version;
/** an attribute's float storage and layout when three's readers would return its stored values unchanged (not normalized,
 *  Float32 storage), else null (T10: per-component getComponent reads were a third of a Nalati entry's merges at phone 4x) */
function plainFloats(attribute: BufferAttribute | InterleavedBufferAttribute): { array: Float32Array; stride: number; offset: number } | null {
  if (attribute.normalized) return null;
  if (attribute instanceof InterleavedBufferAttribute) return attribute.data.array instanceof Float32Array ? { array: attribute.data.array, stride: attribute.data.stride, offset: attribute.offset } : null;
  return attribute.array instanceof Float32Array ? { array: attribute.array, stride: attribute.itemSize, offset: 0 } : null;
}
interface Cached<T> { readonly key: string; readonly version: number; readonly values: T }
interface Member {
  readonly mesh: Mesh; readonly corner: { readonly x: number; readonly z: number } | null; hidden: ReadonlySet<number>;
  /** this tile's attributes in the parent's space (position under its transform `key`), and its kept triangles */
  readonly attributes: Map<string, Cached<Float32Array>>; triangles: Cached<Uint32Array> | null;
  /** G782: the bounds of its parent-space positions, kept with the position array they were read from */
  bounds: { readonly positions: Float32Array; readonly box: Box3 } | null;
}
interface Block { readonly members: Map<Mesh, Member>; merged: Mesh | null; queued: boolean }

export class GroundMerge {
  private readonly blocks = new Map<string, Block>();
  /** `onRebuild`: each new merged mesh, before it draws (its shadow flags, render order or a terrain's mesh slot) */
  constructor(private readonly parent: Object3D, private readonly material: Material, private readonly name: string, private readonly onRebuild?: (mesh: Mesh) => void, readonly grouping: 'quadrant' | 'cell' = 'quadrant') {
    if (grouping !== 'quadrant' && grouping !== 'cell') throw new Error('Unknown ground merge grouping');
  }

  /** The tile's ground `mesh` joins (hidden itself) until `scope` ends. Detached meshes are already parent-local;
   * attached meshes keep their scene transform. `coarse` returns the quadrant setter.
   *
   * A mesh attached under a tree that is not under the parent yet (a ring tile prepared in its own group, published under
   * the ring's root later) joins when that tree is added under the parent, rebuilding its block then: never drawn before
   * its tile is, and placed by the transform it is published with (FC16: the ring tiles had merged per tile group, one
   * draw a tile, 22 of Pine's ground draws a frame). */
  add(mesh: Mesh, scope: Scope, coarse?: { readonly x: number; readonly z: number }): (hidden: ReadonlySet<number>) => void {
    const corner = coarse === undefined ? null : { x: -HALF + coarse.x * COARSE, z: -HALF + coarse.z * COARSE };
    const member: Member = { mesh, corner, hidden: new Set(), attributes: new Map(), triangles: null, bounds: null };
    let owner: Block | null = null;
    const join = (now: boolean): void => {
      const key = this.blockOf(member);
      let block = this.blocks.get(key);
      if (block === undefined) { block = { members: new Map(), merged: null, queued: false }; this.blocks.set(key, block); }
      owner = block; block.members.set(mesh, member);
      if (now) this.rebuildBlock(block); else this.queue(block);
    };
    // the tree's own 'added', owned by the tile's scope (released with it, so a retired tile never joins)
    const wait = (): void => {
      let top: Object3D = mesh; while (top.parent !== null) top = top.parent;
      scope.listenOnceEmitter(top, 'added', () => { if (this.outside(mesh)) wait(); else join(true); });
    };
    mesh.visible = false;
    if (this.outside(mesh)) wait(); else join(false);
    scope.onDispose(() => { if (owner?.members.delete(mesh) === true) this.queue(owner); });
    return (hidden) => { member.hidden = new Set(hidden); if (owner !== null) this.queue(owner); };
  }

  /** attached, but not (yet) under the parent */
  private outside(mesh: Mesh): boolean {
    if (mesh.parent === null) return false;
    for (let node: Object3D | null = mesh.parent; node !== null; node = node.parent) if (node === this.parent) return false;
    return true;
  }

  /** How many members the merge draws (tests and the overlay read it). */
  get size(): number { let count = 0; for (const block of this.blocks.values()) count += block.members.size; return count; }
  /** Every block's merged mesh now. */
  get meshes(): readonly Mesh[] { return [...this.blocks.values()].flatMap(block => block.merged === null ? [] : [block.merged]); }
  /** The first block's merged mesh now (null while no member draws): a ground within one block draws as this one mesh. */
  get mesh(): Mesh | null { return this.meshes[0] ?? null; }

  /** the 250 m block a tile draws in: its coarse corner's, else its bounds centre's in the parent's space */
  private blockOf(member: Member): string {
    let x: number, z: number;
    if (member.corner !== null) { x = member.corner.x; z = member.corner.z; }
    else {
      const geometry = member.mesh.geometry; if (geometry.boundingBox === null) geometry.computeBoundingBox();
      const centre = geometry.boundingBox?.getCenter(new Vector3()) ?? new Vector3();
      this.parent.updateWorldMatrix(true, false); member.mesh.updateWorldMatrix(true, false);
      centre.applyMatrix4(member.mesh.parent === null ? member.mesh.matrix : new Matrix4().copy(this.parent.matrixWorld).invert().multiply(member.mesh.matrixWorld));
      x = centre.x; z = centre.z;
    }
    const size = this.grouping === 'cell' ? HALF * 2 : BLOCK;
    const cell = `${String(Math.floor((x + HALF) / size))},${String(Math.floor((z + HALF) / size))}`;
    if (this.grouping === 'quadrant') return cell;
    // A cell merge never drops a channel supplied by another quadrant.
    const layout = Object.entries(member.mesh.geometry.attributes).map(([name, attribute]) => `${name}:${String(attribute.itemSize)}:${String(attribute.normalized)}`).sort().join('|');
    return `${cell}|${layout}`;
  }

  private queue(block: Block): void {
    if (block.queued) return;
    block.queued = true;
    queueMicrotask(() => { block.queued = false; this.rebuildBlock(block); });
  }

  /** Rebuild every block now. */
  rebuild(): void { for (const block of this.blocks.values()) this.rebuildBlock(block); }

  /** Concatenate the block's members' triangles not in a hidden quadrant into one geometry, replacing its last one. */
  private rebuildBlock(block: Block): void {
    const old = block.merged;
    block.merged = null;
    if (old !== null) { old.removeFromParent(); old.geometry.dispose(); }
    const first = block.members.values().next().value; if (first === undefined) return;
    const names = Object.keys(first.mesh.geometry.attributes).filter(name => [...block.members.values()].every(member => member.mesh.geometry.hasAttribute(name))), parentInverse = new Matrix4(), toParent = new Matrix4();
    this.parent.updateWorldMatrix(true, false); parentInverse.copy(this.parent.matrixWorld).invert();
    // sized up front and filled from each member's kept arrays (G639: growing number arrays for the whole ground held a
    // 183 ms frame, and rebuilding all of it on every tile arrival still 78 ms, on a Nalati drive at phone 4x)
    const drawn = [...block.members.values()].filter(member => member.hidden.size < 4);
    const parts = drawn.map(member => {
      const geometry = member.mesh.geometry, position = geometry.getAttribute('position');
      member.mesh.updateWorldMatrix(true, false);
      if (member.mesh.parent === null) toParent.copy(member.mesh.matrix);
      else toParent.multiplyMatrices(parentInverse, member.mesh.matrixWorld);
      const transform = toParent.elements.join(',');
      const attributes = names.map(name => {
        const attribute = geometry.getAttribute(name);
        if (attribute.count !== position.count) throw new Error(`Ground merge member lacks ${name}`);
        const key = name === 'position' ? transform : '', known = member.attributes.get(name);
        if (known !== undefined && known.key === key && known.version === versionOf(attribute)) return known.values;
        const size = attribute.itemSize, out = new Float32Array(attribute.count * size);
        if (name === 'position') {
          // Vector3.applyMatrix4, inlined
          const e = toParent.elements, plain = plainFloats(position);
          for (let i = 0; i < attribute.count; i++) {
            const at = plain === null ? 0 : i * plain.stride + plain.offset;
            const x = plain === null ? position.getX(i) : plain.array[at] ?? 0, y = plain === null ? position.getY(i) : plain.array[at + 1] ?? 0;
            const z = plain === null ? position.getZ(i) : plain.array[at + 2] ?? 0, w = 1 / ((e[3] ?? 0) * x + (e[7] ?? 0) * y + (e[11] ?? 0) * z + (e[15] ?? 1));
            out[i * 3] = ((e[0] ?? 1) * x + (e[4] ?? 0) * y + (e[8] ?? 0) * z + (e[12] ?? 0)) * w;
            out[i * 3 + 1] = ((e[1] ?? 0) * x + (e[5] ?? 1) * y + (e[9] ?? 0) * z + (e[13] ?? 0)) * w;
            out[i * 3 + 2] = ((e[2] ?? 0) * x + (e[6] ?? 0) * y + (e[10] ?? 1) * z + (e[14] ?? 0)) * w;
          }
        } else {
          const plain = plainFloats(attribute);
          if (plain === null) for (let i = 0; i < attribute.count; i++) for (let c = 0; c < size; c++) out[i * size + c] = attribute.getComponent(i, c);
          else if (plain.stride === size && plain.offset === 0) out.set(plain.array.subarray(0, attribute.count * size));
          else for (let i = 0; i < attribute.count; i++) for (let c = 0; c < size; c++) out[i * size + c] = plain.array[i * plain.stride + plain.offset + c] ?? 0;
        }
        member.attributes.set(name, { key, version: versionOf(attribute), values: out });
        return out;
      });
      return { member, count: position.count, attributes, triangles: this.triangles(member) };
    });
    let vertices = 0, indices = 0;
    for (const part of parts) { vertices += part.count; indices += part.triangles.length; }
    if (indices === 0) return;
    const values = names.map(name => new Float32Array(vertices * first.mesh.geometry.getAttribute(name).itemSize)), index = vertices > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
    let base = 0, written = 0;
    for (const part of parts) {
      part.attributes.forEach((source, n) => { values[n]?.set(source, base * (source.length / Math.max(1, part.count))); });
      const triangles = part.triangles;
      for (let k = 0; k < triangles.length; k++) index[written++] = base + (triangles[k] ?? 0);
      base += part.count;
    }
    const geometry = new BufferGeometry();
    names.forEach((name, n) => { const out = values[n]; if (out !== undefined) geometry.setAttribute(name, new BufferAttribute(out, first.mesh.geometry.getAttribute(name).itemSize)); });
    geometry.setIndex(new BufferAttribute(index, 1));
    // G782: the block's bounds are the union of its members' kept bounds (each read once, when its positions change), not
    // two more passes over the whole merged array per rebuild; the sphere is the box's, which a flat ground tile fills
    const at = names.indexOf('position');
    if (at === -1) geometry.computeBoundingSphere();
    else {
      const box = new Box3();
      for (const part of parts) {
        const positions = part.attributes[at];
        if (positions === undefined) throw new Error('Ground merge member lacks its positions');
        if (part.member.bounds?.positions !== positions) part.member.bounds = { positions, box: new Box3().setFromArray(positions) };
        box.union(part.member.bounds.box);
      }
      geometry.boundingBox = box; geometry.boundingSphere = box.getBoundingSphere(new Sphere());
    }
    const mesh = new Mesh(geometry, this.material);
    mesh.name = this.name; mesh.castShadow = false; mesh.receiveShadow = true;
    // A merge has no per-tile scene groups. Publish only coarse members whose
    // kept indices actually contribute to this draw, after fine masking.
    mesh.userData['coarseTiles'] = parts.flatMap(part => part.member.corner === null || part.triangles.length === 0 ? [] : [{
      x: (part.member.corner.x + HALF) / COARSE, z: (part.member.corner.z + HALF) / COARSE, visible: true,
    }]);
    this.onRebuild?.(mesh);
    this.parent.add(mesh); block.merged = mesh;
  }

  /** The member's kept triangles (its own vertex numbers), kept until its index or hidden quadrants change. */
  private triangles(member: Member): Uint32Array {
    const geometry = member.mesh.geometry, position = geometry.getAttribute('position'), source = geometry.getIndex();
    const key = [...member.hidden].sort((x, y) => x - y).join(','), version = (source?.version ?? 0) * 65536 + versionOf(position);
    if (member.triangles !== null && member.triangles.key === key && member.triangles.version === version) return member.triangles.values;
    const count = source === null ? position.count : source.count, at = (k: number): number => source === null ? k : source.getX(k);
    const kept = new Uint32Array(count - count % 3);
    let written = 0;
    for (let t = 0; t + 2 < count; t += 3) {
      const a = at(t), b = at(t + 1), c = at(t + 2);
      if (member.corner !== null && member.hidden.size > 0) {
        const cx = (position.getX(a) + position.getX(b) + position.getX(c)) / 3 - member.corner.x, cz = (position.getZ(a) + position.getZ(b) + position.getZ(c)) / 3 - member.corner.z;
        if (member.hidden.has((cz >= COARSE / 2 ? 2 : 0) + (cx >= COARSE / 2 ? 1 : 0))) continue;
      }
      kept[written++] = a; kept[written++] = b; kept[written++] = c;
    }
    const values = kept.slice(0, written);
    member.triangles = { key, version, values };
    return values;
  }
}

const merges = new WeakMap<Object3D, Map<Material, GroundMerge>>();
/** The one merge of `material` under `parent` (made on first use; each block empties itself as its last member leaves). */
export function groundMerge(parent: Object3D, material: Material, name: string, grouping: 'quadrant' | 'cell' = 'quadrant'): GroundMerge {
  let byMaterial = merges.get(parent);
  if (byMaterial === undefined) { byMaterial = new Map(); merges.set(parent, byMaterial); }
  let merge = byMaterial.get(material);
  if (merge === undefined) { merge = new GroundMerge(parent, material, name, undefined, grouping); byMaterial.set(material, merge); }
  if (merge.grouping !== grouping) throw new Error('Ground merge grouping changed for its material');
  return merge;
}
