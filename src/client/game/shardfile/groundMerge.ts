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
 *
 * SHARD-SOURCE AP8: static props and fine terrain tiles merge the same way (`propMerge`): one view mesh per material,
 * receive flag and render order per 250 m block and vertex layout, normals and tangents turned with their positions, so a
 * view draws a material once across tiles. The merged mesh never casts: a member that casts keeps casting itself from
 * SHADOW_LAYER (the shadow pass only, `castShadow` still its tile's shadow disc), so each light's cascades cull it as before.
 */
import { Box3, BufferAttribute, BufferGeometry, InterleavedBufferAttribute, Matrix3, Matrix4, Mesh, Sphere, Vector3, type Material, type Object3D } from 'three';
import { buildTier } from '@wildshard/engine/core/tier';
import type { Scope } from '@wildshard/engine/app/scope';
import { MERGED_COPY, MERGED_PROGRAM, MERGED_VIEW, SHADOW_LAYER } from '@wildshard/engine/core/shadowLayer';
import { ownedArray, ownedCopy, type OwnedLabel } from '@wildshard/engine/core/ownedBuffer';

/** EM6: each member's transformed arrays, kept so a rebuild only rewrites what moved */
const MERGE_ARRAYS: OwnedLabel = { owner: 'engine/ground-merge', asset: 'member-arrays', kind: 'geometry-cpu' };

const HALF = 250, COARSE = 125, BLOCK = 250;
/** DF10 (mini-df10b): the channels three's program keys on (presence or size), which a region merge never pads */
const KEYED_CHANNELS: ReadonlySet<string> = new Set(['position', 'normal', 'tangent', 'uv', 'uv1', 'uv2', 'uv3', 'color']);
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
type GeometryAttribute = BufferAttribute | InterleavedBufferAttribute;

function writeAttributes(output: Float32Array, offset: number, attribute: GeometryAttribute, name: string,
  transform: Matrix4, rotation: Matrix3 | null): void {
  const { itemSize: size, count } = attribute, plain = plainFloats(attribute);
  if (name === 'position') {
    const e = transform.elements;
    for (let i = 0; i < count; i++) {
      const end = offset + i * 3, at = plain === null ? 0 : i * plain.stride + plain.offset;
      const x = plain === null ? attribute.getX(i) : plain.array[at] ?? 0, y = plain === null ? attribute.getY(i) : plain.array[at + 1] ?? 0;
      const z = plain === null ? attribute.getZ(i) : plain.array[at + 2] ?? 0;
      const w = 1 / ((e[3] ?? 0) * x + (e[7] ?? 0) * y + (e[11] ?? 0) * z + (e[15] ?? 1));
      output[end] = ((e[0] ?? 1) * x + (e[4] ?? 0) * y + (e[8] ?? 0) * z + (e[12] ?? 0)) * w;
      output[end + 1] = ((e[1] ?? 0) * x + (e[5] ?? 1) * y + (e[9] ?? 0) * z + (e[13] ?? 0)) * w;
      output[end + 2] = ((e[2] ?? 0) * x + (e[6] ?? 0) * y + (e[10] ?? 1) * z + (e[14] ?? 0)) * w;
    }
  } else if (rotation !== null) {
    const v = new Vector3();
    for (let i = 0; i < count; i++) {
      v.set(attribute.getComponent(i, 0), attribute.getComponent(i, 1), attribute.getComponent(i, 2)).applyMatrix3(rotation).normalize();
      const end = offset + i * size;
      output[end] = v.x; output[end + 1] = v.y; output[end + 2] = v.z;
      if (size === 4) output[end + 3] = attribute.getComponent(i, 3);
    }
  } else if (plain === null) {
    for (let i = 0; i < count; i++) for (let c = 0; c < size; c++) output[offset + i * size + c] = attribute.getComponent(i, c);
  } else if (plain.stride === size && plain.offset === 0) {
    output.set(plain.array.subarray(0, count * size), offset);
  } else {
    for (let i = 0; i < count; i++) for (let c = 0; c < size; c++) output[offset + i * size + c] = plain.array[i * plain.stride + plain.offset + c] ?? 0;
  }
}
interface Member {
  readonly mesh: Mesh; readonly corner: { readonly x: number; readonly z: number } | null; hidden: ReadonlySet<number>;
  /** this tile's attributes in the parent's space (position under its transform `key`), and its kept triangles */
  readonly attributes: Map<string, Cached<Float32Array>>; triangles: Cached<Uint32Array> | null;
  /** G782: the bounds of its parent-space positions, kept with their input and transform. */
  bounds: { readonly source: GeometryAttribute; readonly key: string; readonly version: number; readonly box: Box3 } | null;
}
interface Block { readonly members: Map<Mesh, Member>; merged: Mesh | null; queued: boolean }

/** How members group into blocks: `quadrant` 250 m blocks (a ground's channels are those every member has), `cell` the
 *  500 m cell by vertex layout, `block` 250 m blocks by vertex layout (props: a member never loses a channel), `region`
 *  (DF10) the 500 m cell by vertex layout, turned as props are. */
export type MergeGrouping = 'quadrant' | 'cell' | 'block' | 'region';

export class GroundMerge {
  private readonly blocks = new Map<string, Block>();
  private readonly cacheChannels = buildTier() !== 'phone';
  /** `onRebuild`: each new merged mesh, before it draws (its shadow flags, render order or a terrain's mesh slot) */
  /** `ignore`: channels the material never reads (DF10: a flat-shaded look's normals), left out of layouts and merges */
  private readonly parent: Object3D;
  private readonly material: Material;
  private readonly name: string;
  private readonly onRebuild: ((mesh: Mesh) => void) | undefined;
  readonly grouping: MergeGrouping;
  private readonly ignore: ReadonlySet<string>;
  constructor(parent: Object3D, material: Material, name: string, onRebuild?: (mesh: Mesh) => void, grouping: MergeGrouping = 'quadrant', ignore: ReadonlySet<string> = new Set()) {
    this.parent = parent; this.material = material; this.name = name; this.onRebuild = onRebuild; this.grouping = grouping; this.ignore = ignore;
    if (grouping !== 'quadrant' && grouping !== 'cell' && grouping !== 'block' && grouping !== 'region') throw new Error('Unknown ground merge grouping');
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
    const size = this.grouping === 'cell' || this.grouping === 'region' ? HALF * 2 : BLOCK;
    const cell = `${String(Math.floor((x + HALF) / size))},${String(Math.floor((z + HALF) / size))}`;
    if (this.grouping === 'quadrant') return cell;
    // A cell (or block) merge never drops a channel supplied by another member. DF10 (mini-df10b): a region merge keys only
    // the channels three's program keys on; a custom channel some members lack is filled as GL fills a missing attribute.
    const layout = Object.entries(member.mesh.geometry.attributes).filter(([name]) => !this.ignore.has(name) && (this.grouping !== 'region' || KEYED_CHANNELS.has(name))).map(([name, attribute]) => `${name}:${String(attribute.itemSize)}:${String(attribute.normalized)}`).sort().join('|');
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
    const members = [...block.members.values()], region = this.grouping === 'region';
    // a region merge carries every custom channel any member has (its widest size); the rest, the channels all share
    const names = region ? [...new Set(members.flatMap(member => Object.keys(member.mesh.geometry.attributes)))].filter(name => !this.ignore.has(name))
      : Object.keys(first.mesh.geometry.attributes).filter(name => !this.ignore.has(name) && members.every(member => member.mesh.geometry.hasAttribute(name)));
    const parentInverse = new Matrix4(), toParent = new Matrix4();
    this.parent.updateWorldMatrix(true, false); parentInverse.copy(this.parent.matrixWorld).invert();
    // Size the output first. On phone, fill its channels directly: keeping
    // transformed member channels would retain another copy beside the draw.
    const parts = [...block.members.values()].filter(member => member.hidden.size < 4).map(member => ({
      member, position: member.mesh.geometry.getAttribute('position'), triangles: this.triangles(member),
    }));
    let vertices = 0, indices = 0;
    for (const part of parts) { vertices += part.position.count; indices += part.triangles.length; }
    if (indices === 0) return;
    const channels = names.map(name => {
      const size = Math.max(...members.map(member => member.mesh.geometry.hasAttribute(name) ? member.mesh.geometry.getAttribute(name).itemSize : 0));
      return { name, size, values: new Float32Array(vertices * size) };
    });
    const index = vertices > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
    const box = new Box3();
    let base = 0, written = 0;
    for (const { member, position, triangles } of parts) {
      const geometry = member.mesh.geometry;
      member.mesh.updateWorldMatrix(true, false);
      if (member.mesh.parent === null) toParent.copy(member.mesh.matrix);
      else toParent.multiplyMatrices(parentInverse, member.mesh.matrixWorld);
      const transform = toParent.elements.join(',');
      // AP8: a prop's normals and tangents turn with it (a ground's channels copy as they are).
      const turned = (this.grouping === 'block' || this.grouping === 'region') && !isTranslation(toParent);
      const normal = turned ? new Matrix3().getNormalMatrix(toParent) : null;
      const tangent = turned ? new Matrix3().setFromMatrix4(toParent) : null;
      for (const { name, size: width, values } of channels) {
        if (!geometry.hasAttribute(name) || geometry.getAttribute(name).itemSize !== width) { fillDefault(values, base, position.count, width, geometry.hasAttribute(name) ? geometry.getAttribute(name) : null); continue; }
        const attribute = geometry.getAttribute(name), size = attribute.itemSize;
        if (attribute.count !== position.count) throw new Error(`Ground merge member lacks ${name}`);
        const rotation = size < 3 ? null : name === 'normal' ? normal : name === 'tangent' ? tangent : null;
        const key = name === 'position' || rotation !== null ? transform : '';
        const version = versionOf(attribute), offset = base * size;
        if (this.cacheChannels) {
          let cached = member.attributes.get(name);
          if (cached === undefined || cached.key !== key || cached.version !== version) {
            const data = ownedArray(Float32Array, attribute.count * size, MERGE_ARRAYS);
            writeAttributes(data, 0, attribute, name, toParent, rotation);
            cached = { key, version, values: data };
            member.attributes.set(name, cached);
          }
          values.set(cached.values, offset);
        } else writeAttributes(values, offset, attribute, name, toParent, rotation);
        if (name === 'position') {
          const previous = member.bounds;
          if (previous === null || previous.source !== position || previous.key !== transform || previous.version !== version) {
            member.bounds = { source: position, key: transform, version,
              box: new Box3().setFromArray(values.subarray(offset, offset + attribute.count * size)) };
          }
          if (member.bounds !== null) box.union(member.bounds.box);
        }
      }
      for (let k = 0; k < triangles.length; k++) index[written++] = base + (triangles[k] ?? 0);
      base += position.count;
    }
    const geometry = new BufferGeometry();
    for (const { name, size, values } of channels) geometry.setAttribute(name, new BufferAttribute(values, size));
    geometry.setIndex(new BufferAttribute(index, 1));
    geometry.boundingBox = box; geometry.boundingSphere = box.getBoundingSphere(new Sphere());
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
  private triangles(member: Member): Uint16Array | Uint32Array {
    const geometry = member.mesh.geometry, position = geometry.getAttribute('position'), source = geometry.getIndex();
    if ((member.corner === null || member.hidden.size === 0) && source !== null && !source.normalized) {
      const array = source.array;
      if ((array instanceof Uint16Array || array instanceof Uint32Array) && array.length >= source.count) {
        member.triangles = null;
        const count = source.count - source.count % 3;
        return array.length === count ? array : array.subarray(0, count);
      }
    }
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
    const values = ownedCopy(kept.subarray(0, written), MERGE_ARRAYS);
    member.triangles = { key, version, values };
    return values;
  }
}

/** A member's `count` vertices of a channel it lacks, or has narrower, as GL reads it: its own components, then (0, 0, 0, 1). */
function fillDefault(values: Float32Array, base: number, count: number, width: number, own: GeometryAttribute | null): void {
  const have = own === null ? 0 : Math.min(own.itemSize, width);
  for (let i = 0; i < count; i++) for (let c = 0; c < width; c++) values[(base + i) * width + c] = c < have && own !== null ? own.getComponent(i, c) : c === 3 ? 1 : 0;
}

/** a transform with no rotation or scale (its upper 3 x 3 the identity) */
function isTranslation(m: Matrix4): boolean {
  const e = m.elements;
  return e[0] === 1 && e[1] === 0 && e[2] === 0 && e[4] === 0 && e[5] === 1 && e[6] === 0 && e[8] === 0 && e[9] === 0 && e[10] === 1;
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

/** How a merged prop mesh draws: whether it receives shadow, its render order and (DF10) the members' shared render hook
 *  (each its own merge). */
export interface PropDraw { readonly receive: boolean; readonly order: number; readonly hook?: Mesh['onBeforeRender'];
  /** DF10: the whole 500 m cell per layout (`region`) instead of 250 m blocks, and channels its material never reads */
  readonly grouping?: 'block' | 'region'; readonly ignore?: readonly string[] }
const hookIds = new WeakMap<object, number>();
let nextHook = 0;
const hookKey = (hook: object | undefined): string => {
  if (hook === undefined) return '';
  let id = hookIds.get(hook); if (id === undefined) { id = ++nextHook; hookIds.set(hook, id); }
  return `|h${String(id)}`;
};
const propMerges = new WeakMap<Object3D, Map<Material, Map<string, GroundMerge>>>();
/** SHARD-SOURCE AP8: the one static prop merge of `material` drawn as `draw` under `parent`: 250 m blocks by vertex layout. */
export function propMerge(parent: Object3D, material: Material, draw: PropDraw): GroundMerge {
  let byMaterial = propMerges.get(parent);
  if (byMaterial === undefined) { byMaterial = new Map(); propMerges.set(parent, byMaterial); }
  let byDraw = byMaterial.get(material);
  if (byDraw === undefined) { byDraw = new Map(); byMaterial.set(material, byDraw); }
  const grouping = draw.grouping ?? 'block', ignore = [...draw.ignore ?? []].sort();
  const key = `${String(draw.receive)}|${String(draw.order)}${hookKey(draw.hook)}|${grouping}|${ignore.join(',')}`, hook = draw.hook;
  let merge = byDraw.get(key);
  if (merge === undefined) {
    merge = new GroundMerge(parent, material, MERGED_COPY, (mesh) => {
      mesh.castShadow = false; mesh.receiveShadow = draw.receive; mesh.renderOrder = draw.order;
      if (hook !== undefined) mesh.onBeforeRender = hook;
    }, grouping, new Set(ignore));
    byDraw.set(key, merge);
  }
  return merge;
}

/** AP8: `mesh` joins its merge for the view; it keeps drawing only into the shadow maps (SHADOW_LAYER) while it may cast.
 *  DF10: `hook`, a render hook that reads nothing of the mesh, is the merged mesh's too (members with another hook draw in
 *  another merge). */
export function mergeView(parent: Object3D, mesh: Mesh, material: Material, scope: Scope, hook?: Mesh['onBeforeRender'], region?: Pick<PropDraw, 'grouping' | 'ignore'>): void {
  if (mesh.material !== material) throw new Error('Prop merge member draws another material');
  propMerge(parent, material, { receive: mesh.receiveShadow, order: mesh.renderOrder, ...(hook === undefined ? {} : { hook }), ...region }).add(mesh, scope);
  // SHARD-SOURCE ss4d: still the World Explorer's to pick (explore/pick.ts reads this mark), though it draws on SHADOW_LAYER
  mesh.visible = true; mesh.layers.set(SHADOW_LAYER); mesh.userData[MERGED_VIEW] = true; mesh.userData[MERGED_PROGRAM] = [...region?.ignore ?? []];
  scope.onDispose(() => { mesh.userData[MERGED_VIEW] = false; Reflect.deleteProperty(mesh.userData, MERGED_PROGRAM); });
}
