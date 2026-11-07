import * as THREE from 'three';
import { ChangedBatchedMesh } from '../../render/changedTextureUploads';
import type { ColliderDesc } from '../registry';
import { canopyMapOf, placeForestSteps, TreeGrid, treeGridOf, type TreeInstance } from '../../../../shared/engine/world/forest/placement';
import { type TreeFactory, forestFade } from '../TreeFactory';
import { updateWind } from '../wind';
import type { SkyRig as Sky } from '../skyRig';
import { TIER_CONFIG } from '../../core/tier';


/**
 * The LOD bands dissolve instead of popping (E94): over the last FAR_FADE metres before FAR_DIST a tree is drawn as both
 * its lo cards + trunk and its impostor, dithered against each other (TreeFactory `forestFade`); the twigs dissolve out
 * over the last TWIG_FADE metres before TWIG_DIST (and so do their shadows).
 */
const FAR_FADE = 12, TWIG_FADE = 6;
/**
 * Metres: out to here a tree outside the view is still kept when its SHADOW can fall into the view (E94). Pine Hollow's
 * sun is 7° up, so a 25 m pine throws a 200 m shadow: turning round made the phone's culled trees 45–80 m behind you
 * drop their shadows into and out of the frame. The shadow is tested as three spheres along the sun's run on the ground.
 * The cascade's reach, capped at 110 m: phone 80 m; desktop 110 m = its KEEP_NEAR, i.e. unchanged.
 */
const CULL_FOV_PAD = 24;                    // degrees added to the camera FOV for the cull frustum

/**
 * The forest's LOD bands, for a tree model the shard places (E315 second pass: Pine Hollow's forest tree): near cards +
 * twigs to `hi`, lo cards to `far`, the impostor from `far` (dissolving in over the `fade` metres before it), the twigs
 * only within `twig` — the same distances the dissolve shaders are set to below.
 */
export const FOREST_BANDS: { readonly hi: number; readonly far: number; readonly twig: number; readonly fade: 12; } = { get hi() { return TIER_CONFIG.treeHiDist; }, get far() { return TIER_CONFIG.treeLoDist; }, get twig() { return TIER_CONFIG.treeTwigDist; }, fade: FAR_FADE } as const;

/**
 * A tree's trunk as the capsule it collides as (PHYSICS P3): its centre `y` above the tree's foot, half its straight
 * length and its radius (the placement's trunk radius: the species' trunk × scale + a margin), in metres. The forest's
 * own capsules (`colliderDescs`: Nalati's spruces, the navmesh bake) and the Pine Hollow tree model's (E315) are this one.
 */
export function trunkCapsule(t: { readonly height: number; readonly r: number }): { y: number; halfHeight: number; radius: number } {
  const h = Math.max(1, t.height);
  return { y: h / 2, halfHeight: Math.max(0.05, h / 2 - t.r), radius: t.r };
}

/**
 * Per-frame bucketing: every tree has one precomputed matrix; on move (> 1.5 m) or turn (> 3°) the
 * buckets are refilled with only the trees inside a padded view frustum (or within KEEP_NEAR), by
 * distance band: hi cards + twigs (near), lo cards, far impostor. Trunks follow the same near/far
 * split so the far half never enters a shadow pass on the phone tier.
 *
 * A shard whose trees are a model (`ChunkTrees.drawnBy: 'model'`, E315: Pine Hollow's forest tree) has `place` draw them
 * instead: the forest builds no meshes, and on every view change hands its view to the model's culler (`onViewChange`)
 * with its visibility test (`keeps`: in the padded frustum, near, or casting its shadow into view) — `place` owns the
 * bands (`FOREST_BANDS` on the model's LODs), the batches and their buffers. `drawItself` is the forest's own drawing.
 */
export class Forest {
  private readonly hiDist = TIER_CONFIG.treeHiDist;
  private readonly farDist = TIER_CONFIG.treeLoDist;
  private readonly twigDist = TIER_CONFIG.treeTwigDist;
  private readonly keepNear = Math.max(45, TIER_CONFIG.shadowFar * 0.5);
  private readonly shadowKeep = Math.min(TIER_CONFIG.shadowFar, 110);
  group: THREE.Group = new THREE.Group();
  trees: TreeInstance[] = [];
  private hi: THREE.InstancedMesh[] = [];
  private lo: THREE.InstancedMesh[] = [];
  private far: THREE.InstancedMesh[] = [];
  private trunks: THREE.InstancedMesh[] = [];
  private trunksFar: THREE.InstancedMesh[] = [];
  private twigs: THREE.InstancedMesh[] = [];
  private lastLodPos = new THREE.Vector3(1e9, 0, 0);
  private lastDir = new THREE.Vector3(0, 0, 0);
  /** the trees in 16 m cells (src/shared/engine/world/forest/placement.ts) */
  private grid = new TreeGrid();
  private mats!: Float32Array;   // 16 floats per tree
  private tints!: Float32Array;  // 3 floats per tree
  /** batched path (WEBGL_multi_draw): one BatchedMesh per material, one instance per tree, LOD = geometry id + visibility */
  private batched: { needles: THREE.BatchedMesh; far: THREE.BatchedMesh; bark: THREE.BatchedMesh; twigs: THREE.BatchedMesh; geoHi: number[]; geoLo: number[]; geoFar: number[]; geoTrunk: number[]; geoTrunkLo: number[] | null; geoTwig: number[] } | null = null;
  /** why the tree draw count is what it is — the perf meter / reports read this */
  readonly path: 'batched' | 'instanced';
  private frustum = new THREE.Frustum();
  private cullCam = new THREE.PerspectiveCamera();
  private projView = new THREE.Matrix4();
  private sphere = new THREE.Sphere();
  private viewDir = new THREE.Vector3();
  /** the sun's run on the ground: shadows fall along shadowDir (xz, unit), shadowRun m per m of height */
  private shadowDir = new THREE.Vector2(); private shadowRun = 0;
  private viewListeners: ((frustum: THREE.Frustum, viewer: THREE.Vector3) => void)[] = [];

  /** Called whenever the tree buckets are refilled (view moved > 1.5 m or turned > 3°), with the padded cull frustum. */
  onViewChange(fn: (frustum: THREE.Frustum, viewer: THREE.Vector3) => void): void { this.viewListeners.push(fn); this.lastLodPos.set(1e9, 0, 0); }

  readonly factory: TreeFactory;
  private sky: Sky;
  constructor(factory: TreeFactory, sky: Sky) {
    this.factory = factory;
    this.sky = sky;
    // G953: graph trees share the ordinary hardware batching path.
    this.path = factory.multiDraw ? 'batched' : 'instanced';
  }

  /** Soft canopy-density texture (for terrain darkening under trees, and grass thinning). */
  canopyMap!: THREE.DataTexture;

  /** 'model': the shard places its trees' model (`place`) and the forest draws nothing itself until `drawItself` */
  private drawnBy: 'self' | 'model' = 'self';
  /** its own meshes are built (`drawItself`) */
  private drawing = false;

  /**
   * `instances` (SHARD-PLATFORM G227): the trees as baked records (`decodeTreeRecords`) instead of placed from the level's
   * forest spec; everything after placement (bands, canopy map, colliders, the model's culler) is the same.
   */
  build(o: { readonly drawnBy?: 'self' | 'model'; readonly instances?: readonly TreeInstance[] } = {}): this {
    const steps = this.buildSteps(o);
    while (steps.next().done !== true) { /* every tree now */ }
    return this;
  }

  /** `build`, pausing whenever `due` says the task is over budget (SF67: the placement was one ~200 ms task at 4x CPU on
   *  Nalati); the same trees from the same stream */
  async buildSliced(o: { readonly drawnBy?: 'self' | 'model'; readonly instances?: readonly TreeInstance[] }, due: () => Promise<void> | null): Promise<this> {
    const steps = this.buildSteps(o);
    while (steps.next().done !== true) { const pause = due(); if (pause !== null) await pause; }
    return this;
  }

  private *buildSteps(o: { readonly drawnBy?: 'self' | 'model'; readonly instances?: readonly TreeInstance[] }): Generator<void, void> {
    this.drawnBy = o.drawnBy ?? 'self';
    if (o.instances === undefined) { const placed = yield* placeForestSteps(this.factory.variants); this.trees = placed.trees; this.grid = placed.grid; }
    else { this.trees = [...o.instances]; this.grid = treeGridOf(this.trees); }
    yield;
    const F = this.factory.fade;
    F.cards.value.set(this.farDist - FAR_FADE, this.farDist, 1); F.trunk.value.set(this.farDist - FAR_FADE, this.farDist, 1);
    F.far.value.set(this.farDist - FAR_FADE, this.farDist, -1); F.twigs.value.set(this.twigDist - TWIG_FADE, this.twigDist, 1);
    this.canopyMap = this.buildCanopyMap();
    yield;
    this.sky.setupMaterial(this.factory.barkMaterial);
    this.sky.setupMaterial(this.factory.needleMaterial);
    this.sky.setupMaterial(this.factory.twigMaterial);
    this.sky.setupMaterial(this.factory.farMaterial);
    if (this.drawnBy === 'self') this.drawItself();
  }

  /** who draws the trees: `'model'` until a shard that said so hands them to its model, or draws them itself after all */
  get drawer(): 'self' | 'model' { return this.drawing ? 'self' : this.drawnBy; }

  /**
   * The forest's own meshes: 4 BatchedMeshes (multi-draw) or 6 InstancedMeshes per variant, refilled per view change.
   * `build` calls it unless the shard's model draws the trees; a shard whose model can't (a build without its species
   * set's files) calls it before the first frame.
   */
  drawItself(): this {
    if (this.drawing) return this;
    this.drawing = true;
    this.mats = new Float32Array(this.trees.length * 16);
    this.tints = new Float32Array(this.trees.length * 3);
    this.trees.forEach((t, i) => {
      this.tmpQ.setFromAxisAngle(this.tmpP.set(0, 1, 0), t.rot);
      this.tmpM.compose(this.tmpP.set(t.x, t.y, t.z), this.tmpQ, this.tmpS.set(t.scale, t.scale, t.scale));
      this.tmpM.toArray(this.mats, i * 16);
      this.tints[i * 3] = t.tint.r; this.tints[i * 3 + 1] = t.tint.g; this.tints[i * 3 + 2] = t.tint.b;
    });
    if (this.trees.length === 0) return this; // nothing to draw: no instanced / batched meshes (a 0-instance BatchedMesh is not a thing)
    if (this.path === 'batched') { this.buildBatched(); return this; }
    this.factory.variants.forEach((v, vi) => {
      const count = this.trees.filter((t) => t.variant === vi).length;
      const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, shadow: boolean, depth?: THREE.Material, tint = true) => {
        const im = new THREE.InstancedMesh(geo, mat, count);
        im.castShadow = shadow; im.receiveShadow = true;
        if (depth) im.customDepthMaterial = depth;
        im.frustumCulled = false; // we do LOD bucketing + per-tree culling ourselves
        im.count = 0;
        if (tint) { im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3); im.instanceColor.setUsage(THREE.DynamicDrawUsage); }
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.group.add(im);
        return im;
      };
      this.trunks.push(mk(v.trunk, this.factory.barkMaterial, true, undefined, false));
      this.trunksFar.push(mk(v.trunkLo ?? v.trunk, this.factory.barkMaterial, TIER_CONFIG.loTreeShadows, undefined, false));
      this.hi.push(mk(v.cardsHi, this.factory.needleMaterial, true, this.factory.needleDepth));
      this.lo.push(mk(v.cardsLo, this.factory.needleMaterial, TIER_CONFIG.loTreeShadows, this.factory.needleDepth));
      this.far.push(mk(v.far, this.factory.farMaterial, false));
      const twigs = mk(v.twigs, this.factory.twigMaterial, true, this.factory.twigDepth);
      this.twigs.push(twigs);
    });
    return this;
  }

  /**
   * 4 BatchedMeshes (needles hi+lo, far impostor, bark, twigs) instead of 24 InstancedMeshes: 4 draws + 3 shadow
   * draws for the whole forest. Every tree owns one instance in each; a view change only flips geometry ids and
   * visibility. three culls each instance against the camera (and the shadow camera) itself.
   */
  private buildBatched() {
    const V = this.factory.variants, n = this.trees.length;
    const size = (geos: THREE.BufferGeometry[]) => geos.reduce((a, g) => ({ v: a.v + g.getAttribute('position').count, i: a.i + (g.index ? g.index.count : g.getAttribute('position').count) }), { v: 0, i: 0 });
    const mk = (geos: THREE.BufferGeometry[], mat: THREE.Material, shadow: boolean, depth?: THREE.Material) => {
      const { v, i } = size(geos);
      const bm = new ChangedBatchedMesh(n, v, i, mat);
      bm.castShadow = shadow; bm.receiveShadow = true;
      bm.sortObjects = false; bm.perObjectFrustumCulled = true;
      if (depth) bm.customDepthMaterial = depth;
      const ids = geos.map((g) => bm.addGeometry(g));
      this.group.add(bm);
      return { bm, ids };
    };
    const needles = mk([...V.map((v) => v.cardsHi), ...V.map((v) => v.cardsLo)], this.factory.needleMaterial, true, this.factory.needleDepth);
    // E142: the needle cards draw front to back (a crown is 16–32 alpha-tested card layers deep; a near crown's depth then
    // rejects the far ones' fragments before they shade). Same image — alpha test + depth write is order-free — and on the
    // M5 ruler (1206×2622) −0.08 ms at the stones, −0.12 ms in the old-growth for ~0.05 ms of CPU sort (918 trees)
    needles.bm.sortObjects = true;
    const far = mk(V.map((v) => v.far), this.factory.farMaterial, false);
    // the species set's trunks swap to their lo bark past treeHiDist (a second geometry per variant in the same batch)
    const trunkLo = V.some((v) => v.trunkLo !== undefined && v.trunkLo !== v.trunk);
    const bark = mk([...V.map((v) => v.trunk), ...(trunkLo ? V.map((v) => v.trunkLo ?? v.trunk) : [])], this.factory.barkMaterial, true);
    const twigs = mk(V.map((v) => v.twigs), this.factory.twigMaterial, true, this.factory.twigDepth);
    const m = new THREE.Matrix4();
    this.trees.forEach((t, i) => {
      m.fromArray(this.mats, i * 16);
      for (const { bm, ids } of [needles, far, bark, twigs]) {
        const gid = ids[t.variant];
        if (gid === undefined) throw new Error(`[forest] no geometry for tree variant ${t.variant}`);
        const id = bm.addInstance(gid);   // ids line up with tree index (one instance per tree, in order)
        bm.setMatrixAt(id, m); bm.setVisibleAt(id, false);
        if (bm !== bark.bm || this.factory.tintBark) bm.setColorAt(id, t.tint);
      }
    });
    this.batched = {
      needles: needles.bm, far: far.bm, bark: bark.bm, twigs: twigs.bm,
      geoHi: needles.ids.slice(0, V.length), geoLo: needles.ids.slice(V.length), geoFar: far.ids,
      geoTrunk: bark.ids.slice(0, V.length), geoTrunkLo: trunkLo ? bark.ids.slice(V.length) : null, geoTwig: twigs.ids,
    };
  }

  /** where the trees go: src/shared/engine/world/forest/placement.ts (pure, shared with the build's placement bake) */
  private buildCanopyMap() {
    const N = 256, data = canopyMapOf(this.trees, N);
    const tex = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.FloatType);
    tex.magFilter = tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }

  /** trees whose trunk might intersect a circle at (x,z) — for collision */
  nearby(x: number, z: number, radius = 2): TreeInstance[] { return this.grid.nearby(x, z, radius); }

  /** PHYSICS P3: the trunks as upright capsules (their radius, ground to crown) — src/shared/engine/physics/pieces.ts builds them. */
  colliderDescs(): ColliderDesc[] {
    return this.trees.map((t) => {
      const c = trunkCapsule(t);
      return { kind: 'capsule', x: t.x, y: t.y + c.y, z: t.z, halfHeight: c.halfHeight, radius: c.radius };
    });
  }

  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private tmpP = new THREE.Vector3();
  private tmpS = new THREE.Vector3();

  /**
   * Tree i, at ground distance² d2 from the viewer, is drawn from the view as it last changed: near (this.keepNear), in the
   * padded frustum, or — within this.shadowKeep — casting its shadow into it. The tree model's culler asks this
   * (`CullOptions.test`) when the forest hands it the view.
   */
  readonly keeps = (i: number, d2: number): boolean => {
    const t = this.trees[i];
    return t !== undefined && (this.resident === null || this.resident(t.x, t.z)) && (d2 <= (this.keepNear * this.keepNear) || this.seen(t, d2 <= (this.shadowKeep * this.shadowKeep)));
  };

  /** Tile streaming P3: from the viewer's position, which trees may draw at all (a resident tile ring); null: every tree. */
  private residency: ((viewer: THREE.Vector3) => (x: number, z: number) => boolean) | null = null;
  private resident: ((x: number, z: number) => boolean) | null = null;
  /**
   * Tile streaming P3 (G652): `follow(viewer)` answers which trees the model's culler may keep (`keeps`), by their own
   * coordinates; a new answer (the viewer crossed into another tile) refills the buckets. Null: every tree, as before.
   */
  setResidency(follow: ((viewer: THREE.Vector3) => (x: number, z: number) => boolean) | null): void {
    this.residency = follow; this.resident = null; this.lastLodPos.set(1e9, 0, 0);
  }

  /** in the padded view frustum — or, within this.shadowKeep (`shadows`), casting its shadow into it */
  private seen(t: TreeInstance, shadows: boolean): boolean {
    this.sphere.center.set(t.x, t.y + t.height * 0.5, t.z); this.sphere.radius = t.height * 0.6;
    if (this.frustum.intersectsSphere(this.sphere)) return true;
    if (!shadows || this.shadowRun <= 0) return false;
    const L = Math.min(t.height * this.shadowRun, this.shadowKeep); // the shadow's length on flat ground (the cascade crops the rest)
    this.sphere.radius = L / 6 + t.height * 0.2;
    for (let k = 1; k <= 5; k += 2) {
      this.sphere.center.set(t.x + this.shadowDir.x * L * k / 6, t.y + 1, t.z + this.shadowDir.y * L * k / 6);
      if (this.frustum.intersectsSphere(this.sphere)) return true;
    }
    return false;
  }

  /**
   * `viewer` is in the forest's own frame (its trees' coordinates). A forest whose group is drawn under an offset parent
   * (a grid region at its cell's render offset, G223) culls in that frame: the view frustum is carried into it by the
   * group's world matrix, and the shader's fade viewer is carried out of it. At the scene origin both are the identity.
   */
  update(dt: number, viewer: THREE.Vector3): void {
    // the ONE wind clock (wind.ts, PH-L6): pines, grass and undergrowth all read it. A shard with a forest has no palms
    // (Palms.update ticks it on Driftwood, whose factory is 'none' → 0 trees), so it advances exactly once a frame.
    if (this.trees.length > 0) updateWind(dt);
    const frame = this.group.matrixWorld;
    forestFade.uViewer.value.copy(viewer).applyMatrix4(frame); // the dissolve bands follow every frame; the buckets below only on a move / turn
    const cam = this.sky.viewCamera;
    cam.getWorldDirection(this.viewDir);
    const resident = this.residency === null ? null : this.residency(viewer), ring = resident !== this.resident;
    this.resident = resident;
    const moved = ring || viewer.distanceToSquared(this.lastLodPos) > 1.5 * 1.5;
    const turned = this.viewDir.dot(this.lastDir) < Math.cos(3 * Math.PI / 180);
    if (!moved && !turned) return;
    this.lastLodPos.copy(viewer); this.lastDir.copy(this.viewDir);

    // padded view frustum for culling (the sphere test below is generous already; the pad covers the shadow lead-in)
    const cc = this.cullCam;
    cc.fov = cam.fov + CULL_FOV_PAD; cc.aspect = cam.aspect; cc.near = cam.near; cc.far = cam.far;
    cc.updateProjectionMatrix();
    this.projView.multiplyMatrices(cc.projectionMatrix, cam.matrixWorldInverse).multiply(frame);
    this.frustum.setFromProjectionMatrix(this.projView);

    const hiD2 = this.hiDist * this.hiDist, farD2 = this.farDist * this.farDist, twD2 = this.twigDist * this.twigDist, keepD2 = this.keepNear * this.keepNear, shadowD2 = this.shadowKeep * this.shadowKeep;
    { // the sun (Driftwood's moves with its clock); below the horizon nothing casts
      const s = this.sky.sunDir, flat = Math.hypot(s.x, s.z);
      this.shadowRun = s.y > 0.01 && flat > 1e-4 ? flat / s.y : 0;
      if (flat > 1e-4) this.shadowDir.set(-s.x / flat, -s.z / flat);
    }
    // a model draws the trees: it culls them from this view, through `keeps`
    if (!this.drawing) { for (const fn of this.viewListeners) fn(this.frustum, viewer); return; }
    // the impostor from the start of the fade band (a 1.5 m move refills the buckets: the band is wider than that)
    const bandD2 = (this.farDist - FAR_FADE) * (this.farDist - FAR_FADE);
    if (this.batched) {
      const B = this.batched;
      for (let i = 0; i < this.trees.length; i++) {
        const t = this.trees[i];
        if (!t) continue;
        const dx = t.x - viewer.x, dz = t.z - viewer.z, d2 = dx * dx + dz * dz;
        const vis = d2 <= keepD2 || this.seen(t, d2 <= shadowD2);
        const near = d2 < hiD2, mid = d2 < farD2;
        if (vis && mid) B.needles.setGeometryIdAt(i, (near ? B.geoHi[t.variant] : B.geoLo[t.variant]) ?? 0);
        if (vis && mid && B.geoTrunkLo) B.bark.setGeometryIdAt(i, (near ? B.geoTrunk[t.variant] : B.geoTrunkLo[t.variant]) ?? 0);
        B.needles.setVisibleAt(i, vis && mid);
        B.bark.setVisibleAt(i, vis && mid);
        B.far.setVisibleAt(i, vis && d2 >= bandD2);
        B.twigs.setVisibleAt(i, vis && d2 < twD2);
      }
      for (const fn of this.viewListeners) fn(this.frustum, viewer);
      return;
    }
    const V = this.hi.length;
    const nHi = new Int32Array(V), nLo = new Int32Array(V), nFar = new Int32Array(V), nT = new Int32Array(V), nTF = new Int32Array(V), nTw = new Int32Array(V);
    const put = (list: THREE.InstancedMesh[], v: number, counts: Int32Array, i: number, tint: boolean) => {
      const m = list[v];
      if (!m) return;
      const idx = counts[v] ?? 0; counts[v] = idx + 1;
      (m.instanceMatrix.array as Float32Array).set(this.mats.subarray(i * 16, i * 16 + 16), idx * 16);
      if (tint && m.instanceColor) (m.instanceColor.array as Float32Array).set(this.tints.subarray(i * 3, i * 3 + 3), idx * 3);
    };
    for (let i = 0; i < this.trees.length; i++) {
      const t = this.trees[i];
      if (!t) continue;
      const dx = t.x - viewer.x, dz = t.z - viewer.z, d2 = dx * dx + dz * dz;
      if (d2 > keepD2 && !this.seen(t, d2 <= shadowD2)) continue;
      const v = t.variant;
      if (d2 < hiD2) {
        put(this.hi, v, nHi, i, true);
        put(this.trunks, v, nT, i, false);
        if (d2 < twD2) put(this.twigs, v, nTw, i, true);
      } else if (d2 < farD2) {
        put(this.lo, v, nLo, i, true);
        put(this.trunksFar, v, nTF, i, false);
      }
      if (d2 >= bandD2) put(this.far, v, nFar, i, true);
    }
    const commit = (list: THREE.InstancedMesh[], counts: Int32Array) => list.forEach((m, i) => {
      m.count = counts[i] ?? 0; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
    });
    commit(this.hi, nHi); commit(this.lo, nLo); commit(this.far, nFar); commit(this.trunks, nT); commit(this.trunksFar, nTF); commit(this.twigs, nTw);
    for (const fn of this.viewListeners) fn(this.frustum, viewer);
  }
}
