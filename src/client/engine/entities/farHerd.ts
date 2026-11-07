import * as THREE from 'three';
import { SHADOW_LAYER } from '../core/shadowLayer';
import { markGpuOnly } from '../core/gpuOnly';
import { presenting } from '../../../shared/engine/core/framePacing';
import { trackSkeletonTextureUploads } from '../render/changedTextureUploads';

/**
 * The far herd: every animal past TIER_CONFIG.animalFarBatchDist drawn in ONE draw per model (a kind:variant: its own
 * coat), PINE-HOLLOW-REMASTER PH-P2. Past animalOneDrawDist a rig is already one draw (its whole body in its fur material,
 * Animal.setDrawLod), and ~100 of them at 150–400 m were 90–120 of the desktop's draws at the gate and the lookout. A batch
 * is a SkinnedMesh whose geometry is `cap` copies of the model's geometry, copy `s` skinned by bones `s·B … s·B + B − 1`
 * of one big skeleton; each frame the slots point at the far animals' own bones (the ones their rigs pose), so every animal keeps
 * its gait, its yaw, its scale and its death. The per-animal coat tint (AnimalFactory.instantiate: the fur material's
 * colour) is baked into the copy's vertex colours, which the fur shader multiplies by the same colour term — the
 * batch's material is the model's fur, patched and set up exactly as a rig's (one program, the rigs' own), in white.
 *
 * The math is three's attached-bind skinning: a rig draws Σ w · bone.matrixWorld · boneInverse · bindMatrix · v (its
 * model matrix and bindMatrixInverse cancel), so a batch at the origin with an identity bind matrix draws the same
 * world-space vertices. Rigs bound with a non-identity bind matrix, fading carcasses and thralls (their shader reads
 * the material colour) stay single rigs. A freed slot is skinned to a zero-scale bone (its triangles collapse to a
 * point); the slots are kept packed (the top member moves into a hole) and the draw range ends at the last one.
 *
 * Desktop (tier.ts animalHullBatch) also takes Pine Hollow's generated hulls at every distance: one group, no fur shells,
 * no draw LOD, so the batch is their pixels near as far. It takes members by bearing (begin), so a page can hold a few
 * rigs three's frustum test would have skipped (below the view's bottom edge); each page is frustum-culled per camera by a
 * sphere round its members, so a page holding only those is not drawn (a pond reflection still draws it where it shows).
 *
 * `{ shadow: true }` makes the shadow herd instead: the same batching for the animals that cast (within
 * animalShadowDist), drawn only into the sun's shadow maps (SHADOW_LAYER; its material is the model's fur, whose depth
 * variant is the rigs' own skinned depth program) — one shadow draw per hull per cascade instead of one per animal. It
 * carries only the attributes that program reads, and its bounding sphere follows its members, so a cascade that none of
 * them can shadow skips it (cascadeCull.ts).
 *
 * Paced (op-hitch47, `presenting()`): a model's members fill fixed pages of `PAGE_SLOTS`
 * slots, one draw each, and a herd opens at most one new page a drawn frame; a member with no room yet keeps drawing its own
 * rig (the same pixels) until a page has one. Unpaced, one batch a model grows as members arrive, as before. Pine Hollow's
 * entry frame took every far animal at once: the batches grew 8 → 12 → 18 … slots in one flush (each grow re-copies every
 * slot and repaints every member, 50-70 ms of main thread) and the next frame uploaded tens of MB of new batch geometry
 * (a 100-130 ms GPU-process frame on the desktop).
 */

/** A paced page's slots: a hull is ~7k vertices × ~80 bytes, so a page is ~9 MB of geometry, uploaded in its first frame. */
export const PAGE_SLOTS = 16;

/** what a batch needs from an animal */
export interface FarMember {
  readonly mesh: THREE.SkinnedMesh;
  /** the rig's fur colour (the per-animal tint): read live, a later tint (an overgrown coat's moss) follows */
  readonly tint: THREE.Color;
  /** what its slot's draw reads in place of the batch material's uniforms (≤ 16 numbers, a matrix's elements): the slot's
   *  data bone (`FAR_SLOT_DATA`), read when it takes a slot and on a re-tint. PF7b: a coat family's layer, sheen, rim… */
  readonly slotData?: readonly number[];
}

/**
 * A batch whose members carry `slotData` gives each slot a data bone after the skinning bones: a bone off the scene graph
 * whose world matrix is the member's data (so the skeleton's bone texture, already per page and per draw, carries it), and
 * each vertex the index of its slot's (`aSlotData`, static). The material reads it in its vertex stage as
 * `getBoneMatrix( aSlotData )` (three's skinning lookup).
 */
export const FAR_SLOT_DATA = 'aSlotData';

/**
 * The attributes the shadow herd keeps: the depth pass's (position, skinning) and the ones its program is keyed on — the
 * depth material takes the caster material's map (WebGLShadowMap.getDepthMaterial), so the rigs' skinned depth program
 * reads uv; the same attributes and the model's own fur keep it the rigs' program, not a new one
 */
const SHADOW_ATTRS = new Set(['position', 'normal', 'uv', 'skinIndex', 'skinWeight']);

const _idle = new THREE.Bone();
_idle.scale.setScalar(0);
_idle.updateMatrixWorld(true);
const _ident = new THREE.Matrix4();
const _v = new THREE.Vector3();

class FarBatch {
  readonly mesh: THREE.SkinnedMesh;
  private readonly bones: number;
  private readonly verts: number;
  private readonly indices: number;
  private cap = 0;
  private owners: (FarMember | null)[] = [];
  private readonly slotOf = new Map<FarMember, number>();
  private pending: FarMember[] = [];
  /** members added this frame that hold no slot yet (`room`) */
  private admitted = 0;
  private readonly seen = new Set<FarMember>();
  /** per slot: the tint its colours were written with (r, g, b), in doubles: a float32 copy of the Color's doubles never
   *  compares equal, and every member repainted its slot every frame (a third of Pine Hollow's gate frame, SF22d) */
  private tints = new Float64Array(0);
  /** the members' bounds this frame (each batch's culling sphere) */
  private readonly bounds = new THREE.Box3();
  private readonly sphere = new THREE.Sphere();

  private readonly src: THREE.BufferGeometry;
  private readonly shadow: boolean;
  /** each slot has a data bone (FAR_SLOT_DATA) */
  private readonly slotted: boolean;
  constructor(src: THREE.BufferGeometry, material: THREE.Material, bones: number, shadow: boolean, cap = 8, slotted = false) {
    this.src = src;
    this.shadow = shadow;
    this.slotted = slotted && !shadow;
    this.bones = bones;
    this.verts = src.getAttribute('position').count;
    const index = src.getIndex();
    this.indices = index === null ? this.verts : index.count;
    this.mesh = new THREE.SkinnedMesh(new THREE.BufferGeometry(), material);
    this.mesh.name = shadow ? 'herd-shadow' : 'far-herd';
    // a sphere round its members, per camera: the manager's cull is by azimuth (so a pond reflection keeps its far animals),
    // and a view batch holding only members off the screen's bottom or behind a hill no longer draws (PF7: Pine's ten coat
    // models drew 10 batches at the gate for 4 models in view)
    this.mesh.frustumCulled = true;
    this.mesh.castShadow = shadow;   // the view batch: past animalShadowDist, no animal casts there
    this.mesh.receiveShadow = !shadow;
    if (shadow) this.mesh.layers.set(SHADOW_LAYER);
    this.mesh.matrixAutoUpdate = false;
    this.mesh.raycast = () => { /* never a hit target: the rigs' hitboxes are */ };
    // never left null: SkinnedMesh.computeBoundingSphere would skin every slot on the CPU (the boot's precompile clones, a
    // frustum test) — and the view batch's CPU copies are gone after upload
    // (the view batch's stays infinite until its first members, so the entry warm-up's draw of an empty page uploads it)
    this.mesh.boundingSphere = shadow ? this.sphere : new THREE.Sphere(new THREE.Vector3(), Infinity);
    this.mesh.boundingBox = new THREE.Box3(new THREE.Vector3(-Infinity, -Infinity, -Infinity), new THREE.Vector3(Infinity, Infinity, Infinity));
    this.mesh.visible = false; // until its first members
    this.grow(cap);
  }

  /** Shown with a one-index draw range until its first flush: the next render that reaches it (the entry warm-up's parked
   *  draws) uploads its buffers and draws nothing (one index is no triangle, and an empty page's bones are a zero-scale
   *  point); an empty range would skip the draw before three binds, and so uploads, the index (~10 MB of Pine's pages
   *  then went up 325 ms after activate). `flush` hides it again while it has no members. */
  uploadEmpty(): void { this.mesh.geometry.setDrawRange(0, 1); this.mesh.visible = true; }

  /** Whether `m` holds a slot (from an earlier frame). */
  has(m: FarMember): boolean { return this.slotOf.has(m); }

  /** Slots a new member may still take this frame without a grow: every slot held last frame stays reserved until `flush`. */
  room(): number { return this.cap - this.slotOf.size - this.admitted; }

  add(m: FarMember, position: THREE.Vector3, radius: number): void {
    if (this.pending.length === 0) this.bounds.makeEmpty();
    this.pending.push(m);
    if (!this.slotOf.has(m)) this.admitted++;
    this.bounds.expandByPoint(_v.set(position.x - radius, position.y - radius, position.z - radius));
    this.bounds.expandByPoint(_v.set(position.x + radius, position.y + radius * 2, position.z + radius));
  }

  /** place this frame's members: a member keeps its slot while it stays; new ones take the lowest free slot */
  flush(): void {
    const seen = this.seen;
    seen.clear();
    for (const m of this.pending) seen.add(m);
    for (let s = 0; s < this.cap; s++) {
      const o = this.owners[s];
      if (o !== null && o !== undefined && !seen.has(o)) this.free(s);
    }
    // one grow to fit every newcomer (op-hitch47): growing a step per newcomer re-copied every slot each time
    let free = 0;
    for (const o of this.owners) if (o === null) free++;
    if (this.admitted > free) this.grow(Math.max(Math.ceil(this.cap * 1.5), this.cap + this.admitted - free));
    this.admitted = 0;
    for (const m of this.pending) {
      const at = this.slotOf.get(m);
      if (at !== undefined) {
        const t = m.tint, k = at * 3;
        if (!this.shadow && (this.tints[k] !== t.r || this.tints[k + 1] !== t.g || this.tints[k + 2] !== t.b)) this.paint(at, m); // re-tinted
        continue;
      }
      let s = this.owners.indexOf(null);
      if (s < 0) { s = this.cap; this.grow(Math.ceil(this.cap * 1.5)); }
      this.assign(s, m);
    }
    if (this.pending.length > 0) this.mesh.boundingSphere = this.bounds.getBoundingSphere(this.sphere);
    this.pending = [];
    // keep the slots packed (the draw range skins every slot up to the last used one): the highest member moves down
    for (let lo = 0, hi = this.cap - 1; ; lo++, hi--) {
      while (lo < this.cap && this.owners[lo] !== null) lo++;
      while (hi >= 0 && this.owners[hi] === null) hi--;
      const m = this.owners[hi];
      if (lo >= hi || m === null || m === undefined) break;
      this.free(hi);
      this.assign(lo, m);
    }
    let last = -1;
    for (let s = this.cap - 1; s >= 0; s--) if (this.owners[s] !== null) { last = s; break; }
    this.mesh.geometry.setDrawRange(0, (last + 1) * this.indices);
    this.mesh.visible = last >= 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.skeleton.dispose();
  }

  private free(s: number): void {
    const o = this.owners[s];
    if (o !== null && o !== undefined) this.slotOf.delete(o);
    this.owners[s] = null;
    const bones = this.mesh.skeleton.bones;
    for (let j = 0; j < this.bones; j++) bones[s * this.bones + j] = _idle;
  }

  private assign(s: number, m: FarMember): void {
    this.owners[s] = m;
    this.slotOf.set(m, s);
    const sk = this.mesh.skeleton, rig = m.mesh.skeleton, B = this.bones;
    for (let j = 0; j < B; j++) {
      sk.bones[s * B + j] = rig.bones[j] ?? _idle;
      const inv = sk.boneInverses[s * B + j], rigInv = rig.boneInverses[j];
      if (inv !== undefined && rigInv !== undefined) inv.copy(rigInv);
    }
    if (!this.shadow) this.paint(s, m);
  }

  /** the tint: the source's vertex colours × the rig's fur colour (the batch's material is white) */
  private paint(s: number, m: FarMember): void {
    const t = m.tint;
    this.tints[s * 3] = t.r; this.tints[s * 3 + 1] = t.g; this.tints[s * 3 + 2] = t.b;
    const col = this.mesh.geometry.getAttribute('color');
    const srcCol = this.src.getAttribute('color');
    if (col instanceof THREE.BufferAttribute && col.array instanceof Float32Array) {
      const n = srcCol.itemSize, base = s * this.verts;
      for (let i = 0; i < this.verts; i++) {
        col.setXYZ(base + i, srcCol.getX(i) * t.r, srcCol.getY(i) * t.g, srcCol.getZ(i) * t.b);
        if (n === 4) col.setW(base + i, srcCol.getW(i));
      }
      col.addUpdateRange(base * n, this.verts * n);
      col.needsUpdate = true;
    }
    const data = this.slotted ? this.mesh.skeleton.bones[this.cap * this.bones + s] : undefined;
    if (data !== undefined) { const e = data.matrixWorld.elements; e.fill(0); m.slotData?.forEach((v, i) => { if (i < 16) e[i] = v; }); }
  }

  /** (re)build the geometry and the skeleton for `cap` slots, keeping every member in its slot */
  private grow(cap: number): void {
    const { src, verts, indices, bones: B } = this;
    const g = new THREE.BufferGeometry();
    for (const [name, a] of Object.entries(src.attributes)) {
      if (this.shadow && !SHADOW_ATTRS.has(name)) continue;
      if (!(a instanceof THREE.BufferAttribute)) throw new Error(`farHerd: attribute '${name}' is interleaved`);
      const n = a.itemSize;
      if (name === 'skinIndex') {
        const arr = new Uint16Array(cap * verts * n);
        for (let s = 0; s < cap; s++) for (let i = 0; i < verts * n; i++) arr[s * verts * n + i] = (a.array[i] ?? 0) + s * B;
        g.setAttribute(name, new THREE.BufferAttribute(arr, n));
      } else if (name === 'color') {
        g.setAttribute(name, new THREE.BufferAttribute(new Float32Array(cap * verts * n), n).setUsage(THREE.DynamicDrawUsage)); // filled per slot (assign), repainted on a re-tint
      } else {
        const Ctor = a.array.constructor as new (length: number) => THREE.TypedArray;
        const arr = new Ctor(cap * verts * n);
        for (let s = 0; s < cap; s++) arr.set(a.array, s * verts * n);
        g.setAttribute(name, new THREE.BufferAttribute(arr, n, a.normalized));
      }
    }
    if (this.slotted) {
      // each slot's vertices point at its data bone, after the cap × B skinning bones
      const at = new Float32Array(cap * verts);
      for (let s = 0; s < cap; s++) at.fill(cap * B + s, s * verts, (s + 1) * verts);
      g.setAttribute(FAR_SLOT_DATA, new THREE.BufferAttribute(at, 1));
    }
    const idx = new Uint32Array(cap * indices);
    // the source index read once as plain numbers, each slot then an offset copy (getX a slot an index was most of a
    // page's build: G639, the far herd's pages in Pine's desktop entry frames)
    const srcIdx = src.getIndex(), base = new Uint32Array(indices);
    for (let i = 0; i < indices; i++) base[i] = srcIdx === null ? i : srcIdx.getX(i);
    for (let s = 0; s < cap; s++) { const at = s * indices, shift = s * verts; for (let i = 0; i < indices; i++) idx[at + i] = (base[i] ?? 0) + shift; }
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    if (!this.shadow) {
      // the view batch's static buffers (all but the colours, which each new member rewrites) live on the GPU only: tens of
      // MB of copies on the desktop. A lost context reloads the page (gpuOnly.ts) instead of restoring in place.
      for (const [name, a] of Object.entries(g.attributes)) if (name !== 'color' && a instanceof THREE.BufferAttribute) a.onUpload(release);
      g.getIndex()?.onUpload(release);
    }
    const bones: THREE.Bone[] = [], inverses: THREE.Matrix4[] = [];
    for (let i = 0; i < cap * B; i++) { bones.push(_idle); inverses.push(new THREE.Matrix4()); }
    // the slots' data bones: off the scene graph, their world matrix written by `paint`, never by an update
    if (this.slotted) for (let s = 0; s < cap; s++) { const d = new THREE.Bone(); d.matrixAutoUpdate = false; d.matrixWorldAutoUpdate = false; bones.push(d); inverses.push(new THREE.Matrix4()); }
    const old = this.mesh.geometry, oldSkeleton = this.cap > 0 ? this.mesh.skeleton : null;
    this.mesh.geometry = g;
    this.mesh.bind(trackSkeletonTextureUploads(new THREE.Skeleton(bones, inverses)), _ident);
    old.dispose();
    oldSkeleton?.dispose();
    const owners = this.owners;
    this.cap = cap;
    this.tints = new Float64Array(cap * 3);
    this.owners = Array.from({ length: cap }, (): FarMember | null => null);
    this.slotOf.clear();
    for (const [s, o] of owners.entries()) if (o !== null) this.assign(s, o);
  }
}

const _dir = new THREE.Vector3();

/** BufferAttribute.onUpload: drop the CPU copy (the count stays; nothing reads it again) */
function release(this: THREE.BufferAttribute): void {
  const Ctor = this.array.constructor as new (length: number) => THREE.TypedArray;
  this.array = new Ctor(0);
}

export class FarHerd<M extends FarMember = FarMember> {
  readonly group: THREE.Group = new THREE.Group();
  /** per batch key (keyOf): its pages, or null when it cannot be batched (no material / no vertex colours) */
  private readonly batches = new Map<object, FarPages | null>();
  /** pages opened since the last `end` while paced (at most one a frame) */
  private opened = 0;
  /** members moved to an earlier page this frame (PF13: at most one a frame, `pageFor`) */
  private moved = 0;
  /** the view's azimuth / pitch and its half-width at the horizon (rad), from begin(); cull = false: every far animal */
  private cull = false;
  private yaw = 0;
  private halfW = 0;
  private readonly eye = new THREE.Vector3();

  private readonly materialFor: (m: M) => THREE.Material | null;
  private readonly opts: { shadow?: boolean; keyOf?: (m: M) => object; pageSlots?: () => number };
  /**
   * `materialFor(m)` is m's model's white fur (AnimalFactory.farMaterial), made once per model; null = never batched
   */
  /**
   * `opts.keyOf`: what one batch holds — the view herd's is the member's model (a variant: its own coat atlas on a hull
   * geometry the species' other variants share), the shadow herd's the geometry (depth is the same whatever the coat)
   */
  /** `opts.pageSlots`: a paced page's slots, read as a page opens (default PAGE_SLOTS; the phone's are smaller, PF7b) */
  constructor(materialFor: (m: M) => THREE.Material | null, opts: { shadow?: boolean; keyOf?: (m: M) => object; pageSlots?: () => number } = {}) {
    this.materialFor = materialFor;
    this.opts = opts;
    this.group.name = opts.shadow === true ? 'herd-shadow' : 'far-herd';
  }

  /**
   * Start a frame. `camera`: the view; a far animal outside its horizontal field of view (+ a margin) is not drawn at all,
   * as three's frustum test would not draw its rig. The test is by azimuth only — a far animal's reflection in the pond
   * sits at its own bearing — and is off when the view pitches past 25° (then the horizon's edges are not a vertical
   * line). Without a camera every far animal is drawn.
   */
  begin(camera: THREE.PerspectiveCamera | null): void {
    this.cull = false;
    if (camera === null) return;
    camera.getWorldDirection(_dir);
    const pitch = Math.asin(THREE.MathUtils.clamp(_dir.y, -1, 1));
    if (Math.abs(pitch) > THREE.MathUtils.degToRad(25)) return;
    camera.getWorldPosition(this.eye);
    this.yaw = Math.atan2(_dir.x, _dir.z);
    const tanHalfV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / camera.zoom;
    // the horizon's half-width, widened by 1 / cos(pitch) (a pitched view's horizon row spans more azimuth) and 8° of margin
    this.halfW = Math.atan((tanHalfV * camera.aspect) / Math.cos(pitch)) + THREE.MathUtils.degToRad(8);
    this.cull = true;
  }

  /**
   * `m` joined the herd's world (its rig spawned): make sure its batch key has a page slot for every member reserved so
   * far, opened now rather than when the member first goes far. A page opened in play uploads ~9 MB in its first frame;
   * Pine Hollow's entry opened one a frame right after `activate` (~75 MB in 3 s on the desktop), and a busy GPU process
   * (that entry's own pipeline builds) blocked one of those uploads for 1.1-1.8 s (sp-x1's desktop floor 466c98bac7, mine
   * on 450c424db8). A page opened here is drawn once with an empty range, so the entry warm-up's parked draws upload it
   * before the region shows; its first members only write their colours.
   */
  reserve(m: M): void {
    const b = this.pagesOf(m);
    if (b === null || b.reserved.has(m)) return;
    b.reserved.add(m); b.reservedCount++;
    const slots = this.pageSlots();
    const wanted = Math.ceil(b.reservedCount / slots);
    while (b.pages.length < wanted) {
      const page = new FarBatch(b.src, b.material, b.bones, this.opts.shadow === true, slots, b.slotted);
      page.uploadEmpty();
      b.pages.push(page); this.group.add(page.mesh);
    }
  }

  /** `m` left the herd's world: its reservation goes (the pages stay, for the members reserved after it) */
  unreserve(m: M): void {
    const b = this.pagesOf(m);
    if (b === null || !b.reserved.has(m)) return;
    b.reserved.delete(m); b.reservedCount--;
  }

  /** true = `m` is drawn by (or culled with) the far herd this frame: hide its rig. false = draw the rig itself */
  take(m: M, position: THREE.Vector3, radius: number): boolean {
    const b = this.pagesOf(m);
    if (b === null) return false;
    if (this.cull) {
      const dx = position.x - this.eye.x, dz = position.z - this.eye.z;
      const d = Math.hypot(dx, dz);
      let da = Math.abs(Math.atan2(dx, dz) - this.yaw);
      if (da > Math.PI) da = 2 * Math.PI - da;
      if (d > radius && da - Math.asin(Math.min(1, radius / d)) > this.halfW) return true; // outside the view: not drawn
    }
    const page = this.pageFor(b, m);
    if (page === null) return false;
    page.add(m, position, radius);
    return true;
  }

  private pageSlots(): number { return Math.max(1, Math.floor(this.opts.pageSlots?.() ?? PAGE_SLOTS)); }

  /** `m`'s batch key's pages (made on first use); null = it cannot be batched (a bound rig, no material or colours) */
  private pagesOf(m: M): FarPages | null {
    const mesh = m.mesh;
    if (mesh.bindMode !== THREE.AttachedBindMode || !mesh.bindMatrix.equals(_ident)) return null;
    const key = this.opts.keyOf?.(m) ?? mesh.geometry;
    let b = this.batches.get(key);
    if (b === undefined) {
      const shadow = this.opts.shadow === true;
      const mat = shadow || mesh.geometry.hasAttribute('color') ? this.materialFor(m) : null;
      b = mat === null ? null : { src: mesh.geometry, material: mat, bones: mesh.skeleton.bones.length, slotted: !shadow && m.slotData !== undefined, pages: [], pageOf: new WeakMap(), reserved: new WeakSet(), reservedCount: 0 };
      if (b !== null && !shadow) markGpuOnly('the far herd');
      this.batches.set(key, b);
    }
    return b;
  }

  /** The page `m` draws in this frame: its own, else one with room, else a new one; null = no room this frame (paced). */
  private pageFor(b: FarPages, m: M): FarBatch | null {
    const held = b.pageOf.get(m);
    if (held?.has(m) === true) {
      // PF13: a member that stays in view keeps its page, so a family whose members came and went drew from two half-empty
      // pages (Pine's cabins: 8 + 2 slots, one draw more). One member a frame moves to an earlier page with room, so the
      // family gathers and its last page empties; the member draws the same pixels from its new slot (its bones, tint, data)
      if (this.moved >= 1) return held;
      const at = b.pages.indexOf(held), lower = b.pages.findIndex((p, k) => k < at && p.room() > 0);
      const to = b.pages[lower];
      if (to === undefined) return held;
      this.moved++;
      b.pageOf.set(m, to);
      return to;
    }
    let page = b.pages.find((p) => p.room() > 0);
    if (page === undefined) {
      // A late frame must not grow a bounded page as if it were a loading-screen batch.
      const paced = presenting(), last = b.pages.at(-1);
      if (!paced && last !== undefined) page = last; // unpaced: the batch grows to fit in `flush`, as it always did
      else if (paced && this.opened >= 1) return null; // a page a frame: the rig draws itself until there is room
      else {
        const shadow = this.opts.shadow === true;
        const slots = paced ? this.pageSlots() : 8;
        page = new FarBatch(b.src, b.material, b.bones, shadow, slots, b.slotted);
        b.pages.push(page); this.group.add(page.mesh);
        if (paced) this.opened++;
      }
    }
    b.pageOf.set(m, page);
    return page;
  }

  end(): void {
    for (const b of this.batches.values()) for (const page of b?.pages ?? []) page.flush();
    this.opened = 0; this.moved = 0;
  }

  /** The draws the herd holds (its pages), for tests and the budget readouts. */
  pageCount(): number { let n = 0; for (const b of this.batches.values()) n += b?.pages.length ?? 0; return n; }

  dispose(): void { for (const b of this.batches.values()) for (const page of b?.pages ?? []) page.dispose(); this.batches.clear(); }
}

/** One batch key's pages: the source every page copies, and which page each member last took. */
interface FarPages {
  readonly src: THREE.BufferGeometry;
  readonly material: THREE.Material;
  readonly bones: number;
  /** its members carry slot data (a coat family's batch, PF7b) */
  readonly slotted: boolean;
  readonly pages: FarBatch[];
  readonly pageOf: WeakMap<FarMember, FarBatch>;
  /** the members `reserve` counted (each once) */
  readonly reserved: WeakSet<FarMember>;
  reservedCount: number;
}
