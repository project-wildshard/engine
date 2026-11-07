/**
 * Per-copy culling and LOD for placed models (E306 / E315): the one implementation of what Culling.ts's
 * CulledInstances / CulledBatch, Nine Dragon's InstanceCuller and the crowd's LOD buckets each did by hand.
 *
 * Every culler works only when the view changed (the camera's view-projection compared with the last one) and
 * allocates nothing while it runs: its matrices, bounds and counts are typed arrays made once, at `place` time.
 *   · InstancedCull — per copy: range, angular size, padded frustum; its LOD level by distance; its matrix copied into
 *     that level's shared instance buffer (one buffer per variant and level, shared by the level's parts)
 *   · CelledCopiesCull — `cells`: the same buffers filled a cell of copies at a time (the forest floor's ~22 000)
 *   · BatchedCull   — the same decisions on a BatchedMesh: visibility and geometry id per copy, set only on change
 *   · CellCull      — merged cells: a whole cell's level (or nothing) by its distance
 *   · SetCull       — `lodBy: 'set'`: every copy at the level of the copy nearest the eye (one draw per level; three
 *     culls each level's mesh as a whole, per camera)
 *   · WeldCull      — a weld's bands (./weld.ts, E347): tagged objects shown (or casting) by their copy's or unit's
 *     distance, and the instanced copies each unit hosts rewritten when the unit crosses its detail band
 *
 * What a shard's hand-rolled culler did differently is data on the call (M2, Pine Hollow), never a branch here:
 * `view` (its own padded frustum and eye, e.g. the forest's), `frustum: false` (range and LOD only; three culls per
 * camera), `flat` (distances on the ground), `from: 'origin'` (measured from the placement, not the bounds' centre),
 * `radiusBias` (a big copy switches later), `step` (re-chosen only once the eye moved that far), `bounds: 'sphere'`.
 */
import * as THREE from 'three';

/** when copies are dropped (all optional: none = only the frustum and the LODs) */
export interface CullOptions {
  /** metres: no copy is drawn past it */
  readonly far?: number;
  /** metres: copies this near are always drawn, in view or not (their shadows fall into view) */
  readonly keepNear?: number;
  /** radians: a copy smaller than this on screen (radius / distance) is not drawn */
  readonly minAngular?: number;
  /**
   * A view the shard hands in instead of the camera: it calls back with its frustum (padded, say) and eye whenever it
   * changed — Pine Hollow's forest (`Forest.onViewChange`) drives its props' copies this way. Default: the camera, once a
   * frame through `cullPlaced`.
   */
  readonly view?: CullView;
  /** false: no per-copy frustum test, range and LOD only — three culls each batched instance (or the whole instanced set) per camera, shadow cameras included */
  readonly frustum?: boolean;
  /** distances on the ground (x, z), not in 3D */
  readonly flat?: boolean;
  /** where a copy's distance is measured from: its bounds' centre (default) or its placement's point */
  readonly from?: 'bounds' | 'origin';
  /** a copy's distance less this fraction of its bounding radius (the crags' 0.5: a big copy keeps its detail longer) */
  readonly radiusBias?: number;
  /** with `frustum: false`: the copies are re-chosen only once the eye has moved more than this (metres) */
  readonly step?: number;
  /** 'set': every copy takes the level of the copy nearest the eye (a set switches together: one draw per level) */
  readonly lodBy?: 'copy' | 'set';
  /** a copy's bounding sphere: around its world box (default) or its parts' own bounding sphere, posed (`'sphere'`) */
  readonly bounds?: 'box' | 'sphere';
  /**
   * instanced: the copies bucketed once into `size`-metre squares by their placement point (`CelledCopiesCull`: Pine
   * Hollow's forest floor, ~22 000 copies in ~250 cells). A view tests each cell's sphere — its ground square, its copies'
   * height span, `pad` metres of a copy's own reach — for range and frustum, then writes the passing cells' copies that are
   * within `far` themselves, in cell order. Distances on the ground; `keepNear` / `minAngular` / `radiusBias` don't apply.
   */
  readonly cells?: { readonly size: number; readonly pad: number };
  /**
   * metres: the copies cast shadows the camera may not see them cast — a copy out of the camera's view is still drawn
   * while a shadow-casting cascade's frustum (the place context's sky, taken as each choice starts) meets its sphere grown
   * by this much; the camera's test is grown the same (the frusta are a frame old): a cove's palms and crags
   */
  readonly casters?: number;
  /**
   * the shard's own visibility test in place of the frustum / `keepNear` / `minAngular` one: copy i at distance² d2 (on
   * the ground when `flat`) is drawn when it says so. It reads the shard's view as it last changed — Pine Hollow's forest
   * keeps a tree out of view while its long low-sun shadow can still fall into view (E94). `far` and the LODs still apply.
   * With `cells` it filters after the cell and range tests (a tile ring over a forest floor, tile streaming P4)
   */
  readonly test?: (i: number, d2: number) => boolean;
  /**
   * the copies that may draw at all (a placement drawn as one set over a ring of streamed tiles: its resident tiles'
   * copies), before every other test; a new `version` re-chooses with the camera still (a tile attached or retired).
   * Instanced copies only (`InstancedCull`).
   */
  readonly resident?: { readonly has: (i: number) => boolean; readonly version: () => number };
}

/** metres: the square a culler buckets its copies in (`Chooser.begin`), and the fewest copies it buckets */
const CELL = 24, CELL_MIN = 64;

/** a view that tells its cullers when it changed (`CullOptions.view`) */
interface CullView {
  onViewChange: (fn: (frustum: THREE.Frustum, eye: THREE.Vector3) => void) => void;
}

/** metres: an eye shift under this (no turn, no zoom) keeps the copies chosen for the last view (`View.changed`) */
const EYE_JITTER = 0.02;
/** Legacy camera-driven instance thresholds. The padded view covers turns and translation between choices. */
const VIEW_MARGIN = 7 * Math.PI / 180, VIEW_TURN = 3.5 * Math.PI / 360, VIEW_MOVE = 1;
/**
 * QD8: the padded views re-choose at their own thresholds, VIEW_MOVE and VIEW_TURN times 1 to 1.875 in eight steps, each
 * view's frustum margin its own move: walking crossed one shared metre every ~233 ms, and every culler re-chose on that one
 * frame (+6.7 ms at phone 4x, the walk's p95); spread, they fall out of step. The padding's VIEW_MARGIN covers the
 * widest turn. A pose held still settles to the same choice.
 */
const VIEW_SPREAD = 8;
let views = 0;
/** FC16: the camera whose world matrix the caller brought up to date for this pass of every culler (`cullFresh`) */
let freshCamera: THREE.Camera | null = null;
/** the current `cullFresh` pass (0: none yet) */
let passStamp = 0;
/**
 * Run `pass` with `camera`'s own world matrix brought up to date once: each culler's view reads it without updating it again
 * (Nine: every placed culler updated the camera's matrix every frame, 0.14 ms at phone 4x). Nothing in a pass moves it.
 */
export function cullFresh(camera: THREE.Camera, pass: () => void): void {
  camera.updateWorldMatrix(false, false);
  freshCamera = camera; passStamp++;
  try { pass(); } finally { freshCamera = null; }
}

/** a camera's pose as a pass saw it: its world matrix and projection, and a version bumped when either differs */
interface Pose { pass: number; version: number; readonly world: Float64Array; readonly projection: Float64Array }
const poses = new WeakMap<THREE.Camera, Pose>();
let lastPosed: THREE.Camera | null = null, lastPose: Pose | null = null;
/**
 * The pose version of `camera` in this pass, compared once a pass however many cullers ask: a view that saw the same version
 * last time sees exactly the inputs it last decided on, and stays unchanged without comparing them again (Nine: the placed
 * cullers re-compared the held camera's matrices every frame, 0.17 ms at P5 phone 4x).
 */
function poseVersion(camera: THREE.Camera): number {
  let pose = camera === lastPosed ? lastPose : poses.get(camera);
  if (pose === undefined || pose === null) {
    pose = { pass: -1, version: 0, world: new Float64Array(16), projection: new Float64Array(16) };
    poses.set(camera, pose);
  }
  lastPosed = camera; lastPose = pose;
  if (pose.pass === passStamp) return pose.version;
  const w = camera.matrixWorld.elements, p = camera.projectionMatrix.elements;
  let same = pose.pass !== -1;
  for (let i = 0; same && i < 16; i++) same = pose.world[i] === w[i] && pose.projection[i] === p[i];
  if (!same) { pose.version++; pose.world.set(w); pose.projection.set(p); }
  pose.pass = passStamp;
  return pose.version;
}
/**
 * The eye and turn of `camera` at pose `version`, derived once a pass however many cullers ask (Nine P5, phone 4x: the
 * standing camera's sway bumps the version every frame, and each placed culler re-derived both from the same matrix,
 * ~0.1 ms). `version` -1 (outside a pass): derived for the caller alone.
 */
const derivedEye = new THREE.Vector3(), derivedTurn = new THREE.Quaternion(), _eyeScratch = new THREE.Vector3();
let derivedCamera: THREE.Camera | null = null, derivedVersion = -1, derivedTurned = false;
function eyeAt(camera: THREE.Camera, version: number, out: THREE.Vector3): THREE.Vector3 {
  if (version === -1 || camera !== derivedCamera || version !== derivedVersion) {
    derivedCamera = version === -1 ? null : camera; derivedVersion = version; derivedTurned = false;
    derivedEye.setFromMatrixPosition(camera.matrixWorld);
  }
  return out.copy(derivedEye);
}
function turnAt(camera: THREE.Camera, version: number, out: THREE.Quaternion): THREE.Quaternion {
  eyeAt(camera, version, _eyeScratch);
  if (!derivedTurned || version === -1) { derivedTurn.setFromRotationMatrix(camera.matrixWorld); derivedTurned = version !== -1; }
  return out.copy(derivedTurn);
}

/** the two world matrices' rotation-and-scale parts are exactly equal */
function sameTurn(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[4] === b[4] && a[5] === b[5] && a[6] === b[6] && a[8] === b[8] && a[9] === b[9] && a[10] === b[10];
}

/** the view a culler last worked for; `changed` is true (and it updates) when the camera moved */
class View {
  readonly frustum = new THREE.Frustum();
  readonly eye = new THREE.Vector3();
  private readonly pv = new THREE.Matrix4();
  private readonly last = new THREE.Matrix4();
  private readonly inv = new THREE.Matrix4();
  private primed = false;
  /** the camera's world matrix and projection the copies were last chosen for */
  private readonly held = new THREE.Matrix4();
  private readonly projection = new THREE.Matrix4();
  private readonly lastEye = new THREE.Vector3();
  private readonly step: number;
  private readonly buffered: boolean;
  private readonly turn = new THREE.Quaternion();
  private readonly lastTurn = new THREE.Quaternion();
  private readonly widened = new THREE.Matrix4();
  private readonly expanded = new THREE.Sphere();
  private margin = 0;
  /** this view's move (metres) and turn (cos of half its angle) thresholds when padded (VIEW_SPREAD) */
  private readonly move: number;
  private readonly turnLimit: number;
  /** the camera and its pose version (`poseVersion`) this view last decided for, inside a `cullFresh` pass */
  private seen: THREE.Camera | null = null;
  private seenVersion = -1;
  /** `step` > 0: only a move of the eye past it counts (a culler with no frustum test ignores turning) */
  constructor(step = 0, buffered = false) {
    this.step = step;
    this.buffered = buffered;
    const spread = buffered ? 1 + (views++ % VIEW_SPREAD) / VIEW_SPREAD : 1;
    this.move = VIEW_MOVE * spread;
    this.turnLimit = Math.cos(VIEW_TURN * spread);
  }
  changed(camera: THREE.Camera): boolean {
    // the camera's own world matrix only: `updateMatrixWorld` also walked its children (the held weapon's whole viewmodel)
    // once per culler per frame (G639: ~1.4 ms a Signal Dunes drive frame at phone 4x); the render updates them itself
    if (camera !== freshCamera) camera.updateWorldMatrix(false, false);
    // inside a pass, a camera this view already decided for at the same pose: every branch below would return false
    const version = freshCamera === null ? -1 : poseVersion(camera);
    if (version !== -1 && this.primed && camera === this.seen && version === this.seenVersion) return false;
    this.seen = version === -1 ? null : camera; this.seenVersion = version;
    if (this.step > 0) {
      eyeAt(camera, version, this.eye);
      if (this.primed && this.eye.distanceToSquared(this.lastEye) <= this.step * this.step) return false;
      this.primed = true;
      this.lastEye.copy(this.eye);
      return true;
    }
    // Only camera-driven perspective instances hold a widened view. Handed views,
    // orthographic cameras and distance-only cullers keep their original contracts.
    const padded = this.buffered && camera instanceof THREE.PerspectiveCamera && camera.view === null
      && camera.projectionMatrix.elements[8] === 0 && camera.projectionMatrix.elements[9] === 0;
    if (padded) {
      eyeAt(camera, version, this.eye);
      turnAt(camera, version, this.turn);
      if (this.primed && this.projection.equals(camera.projectionMatrix)
        && this.eye.distanceToSquared(this.lastEye) <= this.move * this.move
        && Math.abs(this.turn.dot(this.lastTurn)) >= this.turnLimit) return false;
      this.primed = true; this.lastEye.copy(this.eye); this.lastTurn.copy(this.turn);
      this.held.copy(camera.matrixWorld); this.projection.copy(camera.projectionMatrix);
      this.widened.copy(camera.projectionMatrix);
      const e = this.widened.elements;
      e[0] = 1 / Math.tan(Math.min(1.5, Math.atan(1 / e[0]) + VIEW_MARGIN));
      e[5] = 1 / Math.tan(Math.min(85 * Math.PI / 180, Math.atan(1 / e[5]) + VIEW_MARGIN));
      this.inv.copy(camera.matrixWorld).invert();
      this.pv.multiplyMatrices(this.widened, this.inv);
      this.frustum.setFromProjectionMatrix(this.pv); this.margin = this.move;
      return true;
    }
    this.margin = 0;
    // A camera that only shifts by under EYE_JITTER (a standing player's controller settles by tenths of a millimetre every
    // frame) keeps the copies chosen for its last view: every copy test is skipped, and no frustum plane moves by more
    // than EYE_JITTER from the one they were chosen for. A turn, a zoom or a real move re-chooses at once.
    const m = camera.matrixWorld.elements, held = this.held.elements;
    if (this.primed && this.projection.equals(camera.projectionMatrix) && sameTurn(m, held)) {
      const dx = m[12] - held[12], dy = m[13] - held[13], dz = m[14] - held[14];
      if (dx * dx + dy * dy + dz * dz <= EYE_JITTER * EYE_JITTER) return false;
    }
    this.inv.copy(camera.matrixWorld).invert();
    this.pv.multiplyMatrices(camera.projectionMatrix, this.inv);
    if (this.primed && this.pv.equals(this.last)) return false;
    this.primed = true;
    this.last.copy(this.pv);
    this.held.copy(camera.matrixWorld);
    this.projection.copy(camera.projectionMatrix);
    this.frustum.setFromProjectionMatrix(this.pv);
    this.eye.setFromMatrixPosition(camera.matrixWorld);
    return true;
  }
  /** a view handed in (`CullOptions.view`) */
  use(frustum: THREE.Frustum, eye: THREE.Vector3): void {
    this.frustum.copy(frustum);
    this.eye.copy(eye);
    this.margin = 0;
  }
  /** the casting cascades' frusta for this choice (`CullOptions.casters`) */
  readonly shadows: THREE.Frustum[] = [];
  /** the sphere is in the camera's view or a casting cascade's */
  sees(sphere: THREE.Sphere): boolean {
    this.expanded.copy(sphere); this.expanded.radius += this.margin;
    return this.frustum.intersectsSphere(this.expanded) || this.shadows.some((f) => f.intersectsSphere(sphere));
  }
}

/** Shared copy-selection maths: which level (or -1: not drawn) copy i takes from this view. */
class Chooser {
  private readonly sphere = new THREE.Sphere();
  /** squared start of each level's dissolve band (`ModelLod.fade`): from there the level before it is drawn with it; ∞ without one */
  private readonly fade2: Float64Array;
  private readonly test: ((i: number, d2: number) => boolean) | null;
  private readonly resident: ((i: number) => boolean) | null;
  /** the distance² of the copy the last `level` call chose for (`also` and a part's `until` read it) */
  d2 = 0;
  private readonly far2: number;
  private readonly keep2: number;
  private readonly ang2: number;
  /** squared start distance of each level (level 0 starts at 0) */
  private readonly from2: Float32Array;
  /** `radiusBias`: the levels' start distances and the range, compared with the biased distance itself */
  private readonly from: Float64Array;
  private readonly far: number;
  private readonly flat: boolean;
  private readonly bias: number;
  private readonly frustum: boolean;
  private readonly pad: number;
  private readonly bounds: Float32Array | Float64Array;
  private readonly origins: Float32Array | Float64Array | null;
  /** `origins`: x, y, z per copy to measure from (`from: 'origin'`), else the bounds' centres; `fades`: each level's `fade` */
  constructor(from: readonly number[], o: CullOptions, bounds: Float32Array | Float64Array, origins: Float32Array | Float64Array | null = null, fades: readonly number[] = []) {
    this.bounds = bounds;
    this.origins = origins;
    this.fade2 = Float64Array.from(from, (d, l) => { const f = fades[l] ?? 0; return l > 0 && f > 0 ? (d - f) * (d - f) : Number.POSITIVE_INFINITY; });
    this.test = o.test ?? null;
    this.resident = o.resident?.has ?? null;
    this.from2 = Float32Array.from(from, (d) => d * d);
    this.from = Float64Array.from(from);
    this.far = o.far ?? Number.POSITIVE_INFINITY;
    this.far2 = o.far === undefined ? Number.POSITIVE_INFINITY : o.far * o.far;
    this.keep2 = (o.keepNear ?? 0) ** 2;
    this.ang2 = (o.minAngular ?? 0) ** 2;
    this.flat = o.flat === true;
    this.bias = o.radiusBias ?? 0;
    this.frustum = o.frustum !== false;
    this.pad = o.casters ?? 0;
  }
  /** copy i's distance² from the eye (on the ground when `flat`) */
  dist2(i: number, eye: THREE.Vector3): number {
    const c = this.origins ?? this.bounds, k = this.origins ? 3 : 4;
    const dx = (c[i * k] ?? 0) - eye.x, dy = this.flat ? 0 : (c[i * k + 1] ?? 0) - eye.y, dz = (c[i * k + 2] ?? 0) - eye.z;
    return dx * dx + dy * dy + dz * dz;
  }
  /** the level at a distance² (the copy's own radius for `radiusBias`); -1 past the range */
  levelAt(d2: number, r: number): number {
    if (this.bias !== 0) {
      const d = Math.sqrt(d2) - r * this.bias;
      if (d > this.far) return -1;
      let l = this.from.length - 1;
      while (l > 0 && d < (this.from[l] ?? 0)) l--;
      return l;
    }
    if (d2 > this.far2) return -1;
    let l = this.from2.length - 1;
    while (l > 0 && d2 < (this.from2[l] ?? 0)) l--;
    return l;
  }
  /**
   * G639: the copies bucketed once into `CELL`-metre squares by their measure point, each square with a box round its
   * copies' spheres (grown by `pad`) and one round their measure points. As a choice begins, a square wholly past the
   * range, or past `keepNear` and out of view, is marked, and `level` rejects its copies without their own tests (a Nine
   * Dragon drive re-chose every copy every frame). Exact: a copy's sphere lies in its square's box, so a box out of every
   * frustum puts the copy out too, and the points' box bounds each copy's distance from below. Off with a `test` or a
   * `radiusBias`, and for few copies.
   */
  private cellOf: Uint32Array | null = null;
  private runEnd = new Uint32Array(0);
  private cellBoxes: THREE.Box3[] = [];
  private cellPoints = new Float64Array(0);
  private skip = new Uint8Array(0);
  private readonly cellSphere = new THREE.Sphere();
  begin(view: View): void {
    const count = this.bounds.length / 4;
    if (this.test !== null || this.bias !== 0 || count < CELL_MIN) return;
    if (this.cellOf === null) this.bucket(count);
    const points = this.cellPoints, eye = view.eye;
    for (let c = 0; c < this.cellBoxes.length; c++) {
      const at = c * 6;
      const dx = Math.max(0, (points[at] ?? 0) - eye.x, eye.x - (points[at + 3] ?? 0)), dz = Math.max(0, (points[at + 2] ?? 0) - eye.z, eye.z - (points[at + 5] ?? 0));
      const dy = this.flat ? 0 : Math.max(0, (points[at + 1] ?? 0) - eye.y, eye.y - (points[at + 4] ?? 0)), d2 = dx * dx + dy * dy + dz * dz;
      let out = d2 > this.far2;
      if (!out && this.frustum && d2 > this.keep2) { this.cellBoxes[c]?.getBoundingSphere(this.cellSphere); out = !view.sees(this.cellSphere); }
      this.skip[c] = out ? 1 : 0;
    }
  }
  private bucket(count: number): void {
    const c = this.origins ?? this.bounds, k = this.origins ? 3 : 4, b = this.bounds, keys = new Map<string, number>(), cellOf = new Uint32Array(count);
    const boxes: THREE.Box3[] = [], points: number[] = [];
    for (let i = 0; i < count; i++) {
      const px = c[i * k] ?? 0, py = c[i * k + 1] ?? 0, pz = c[i * k + 2] ?? 0, key = `${String(Math.floor(px / CELL))},${String(Math.floor(pz / CELL))}`;
      let cell = keys.get(key);
      if (cell === undefined) { cell = boxes.length; keys.set(key, cell); boxes.push(new THREE.Box3()); points.push(px, py, pz, px, py, pz); }
      cellOf[i] = cell;
      const x = b[i * 4] ?? 0, y = b[i * 4 + 1] ?? 0, z = b[i * 4 + 2] ?? 0, r = (b[i * 4 + 3] ?? 0) + this.pad;
      boxes[cell]?.expandByPoint(this.sphere.center.set(x - r, y - r, z - r)).expandByPoint(this.sphere.center.set(x + r, y + r, z + r));
      const at = cell * 6;
      points[at] = Math.min(points[at] ?? px, px); points[at + 1] = Math.min(points[at + 1] ?? py, py); points[at + 2] = Math.min(points[at + 2] ?? pz, pz);
      points[at + 3] = Math.max(points[at + 3] ?? px, px); points[at + 4] = Math.max(points[at + 4] ?? py, py); points[at + 5] = Math.max(points[at + 5] ?? pz, pz);
    }
    this.cellOf = cellOf; this.cellBoxes = boxes; this.cellPoints = Float64Array.from(points); this.skip = new Uint8Array(boxes.length);
    // Skip rejected contiguous cell runs without reordering any kept copies.
    this.runEnd = new Uint32Array(count);
    for (let i = count - 1; i >= 0; i--) this.runEnd[i] = cellOf[i] === cellOf[i + 1] ? this.runEnd[i + 1] ?? count : i + 1;
  }
  next(first: number): number {
    let i = first;
    while (this.cellOf !== null && i < this.cellOf.length && this.skip[this.cellOf[i] ?? 0] === 1) i = this.runEnd[i] ?? i + 1;
    return i;
  }
  level(i: number, view: View): number {
    if (this.resident !== null && !this.resident(i)) return -1;
    if (this.cellOf !== null && this.skip[this.cellOf[i] ?? 0] === 1) return -1;
    const b = this.bounds, x = b[i * 4] ?? 0, y = b[i * 4 + 1] ?? 0, z = b[i * 4 + 2] ?? 0, r = b[i * 4 + 3] ?? 0;
    const d2 = this.dist2(i, view.eye);
    this.d2 = d2;
    if (this.bias === 0 && d2 > this.far2) return -1;
    if (this.test !== null) { if (!this.test(i, d2)) return -1; }
    else if (this.frustum && d2 > this.keep2) {
      if (this.ang2 > 0 && r * r < this.ang2 * d2) return -1;
      this.sphere.center.set(x, y, z); this.sphere.radius = r + this.pad;
      if (!view.sees(this.sphere)) return -1;
    }
    return this.levelAt(d2, r);
  }
  /** the next level when the last copy chosen stands in its dissolve band (drawn with level `l`), else -1 */
  also(l: number): number {
    const n = l + 1;
    return this.bias === 0 && n < this.fade2.length && this.d2 >= (this.fade2[n] ?? Number.POSITIVE_INFINITY) ? n : -1;
  }
}

/** mark a buffer's drawn prefix for upload with a reused range object (three clears `updateRanges` after the upload) */
function upload(a: THREE.InstancedBufferAttribute, range: { start: number; count: number }, start: number, end: number): void {
  if (a.updateRanges.includes(range)) {
    const last = Math.max(range.start + range.count, end);
    range.start = Math.min(range.start, start); range.count = last - range.start;
  } else { range.start = start; range.count = end - start; a.updateRanges.push(range); }
  a.needsUpdate = true;
}

/** one variant's one level: the instance buffer its parts share, and those parts */
export interface InstancedSink {
  readonly matrix: THREE.InstancedBufferAttribute;
  readonly color: THREE.InstancedBufferAttribute | null;
  readonly meshes: readonly THREE.InstancedMesh[];
  /** metres: its parts' `until` — a copy is written only while nearer (a detail band inside the level) */
  readonly until?: number;
}

/**
 * The instance buffers of a place call, grouped per (variant, level): `groups[v * levels + l]` are variant v's level l's
 * sinks (usually one; a part with an `until` has its own). Filled copy by copy, then committed once per choice.
 */
class Sinks {
  private readonly flat: InstancedSink[] = [];
  /** group g's sinks are `flat[members[first[g] … first[g + 1])]`: a sink several groups share (variants drawing one
   *  shape at a level) is one entry, its copies counted together */
  private readonly first: Uint32Array;
  private readonly members: Uint32Array;
  /** each group's copy scale (1: as placed), or null when no group scales */
  private readonly scales: Float32Array | null;
  private readonly counts: Int32Array;
  private readonly changed: Int32Array;
  private readonly changedEnd: Int32Array;
  private readonly colorChanged: Int32Array;
  private readonly colorEnd: Int32Array;
  private readonly until2: Float64Array;
  /** each sink's upload ranges, reused (only the drawn prefix of a buffer goes to the GPU; nothing allocated per update) */
  private readonly ranges: readonly { matrix: { start: number; count: number }; color: { start: number; count: number } }[];
  private readonly matrices: Float32Array;
  private readonly colors: Float32Array | null;
  constructor(groups: readonly (readonly InstancedSink[])[], matrices: Float32Array, colors: Float32Array | null, scales: Float32Array | null = null) {
    this.matrices = matrices;
    this.colors = colors;
    this.scales = scales;
    this.first = new Uint32Array(groups.length + 1);
    const index = new Map<InstancedSink, number>(), members: number[] = [];
    groups.forEach((g, k) => {
      this.first[k] = members.length;
      for (const sink of g) {
        let at = index.get(sink);
        if (at === undefined) { at = this.flat.length; index.set(sink, at); this.flat.push(sink); }
        members.push(at);
      }
    });
    this.first[groups.length] = members.length;
    this.members = Uint32Array.from(members);
    this.counts = new Int32Array(this.flat.length);
    this.changed = new Int32Array(this.flat.length); this.changedEnd = new Int32Array(this.flat.length);
    this.colorChanged = new Int32Array(this.flat.length); this.colorEnd = new Int32Array(this.flat.length);
    this.until2 = Float64Array.from(this.flat, (x) => (x.until === undefined ? Number.POSITIVE_INFINITY : x.until * x.until));
    this.ranges = this.flat.map(() => ({ matrix: { start: 0, count: 0 }, color: { start: 0, count: 0 } }));
  }
  reset(): void {
    this.counts.fill(0); this.changed.fill(-1); this.changedEnd.fill(0);
    this.colorChanged.fill(-1); this.colorEnd.fill(0);
  }
  /** copy i, at distance² d2, into group g's sinks */
  put(i: number, g: number, d2: number): void {
    const m = this.matrices, c = this.colors, k = this.scales?.[g] ?? 1;
    for (let at = this.first[g] ?? 0; at < (this.first[g + 1] ?? 0); at++) {
      const s = this.members[at] ?? 0;
      if (d2 >= (this.until2[s] ?? Number.POSITIVE_INFINITY)) continue;
      const sink = this.flat[s];
      if (!sink) continue;
      const n = this.counts[s] ?? 0, dst = sink.matrix.array as Float32Array;
      // a scaled group (another variant's shape at this copy's size) scales the basis about the copy's origin
      for (let j = 0, a = i * 16, d = n * 16; j < 16; j++) {
        const value = Math.fround((m[a + j] ?? 0) * (j < 12 ? k : 1)), offset = d + j;
        if (!Object.is(dst[offset], value)) {
          dst[offset] = value; if (this.changed[s] === -1) this.changed[s] = offset; this.changedEnd[s] = offset + 1;
        }
      }
      if (c && sink.color) {
        const cd = sink.color.array as Float32Array;
        for (let j = 0; j < 3; j++) {
          const value = c[i * 3 + j] ?? 1, offset = n * 3 + j;
          if (!Object.is(cd[offset], value)) {
            cd[offset] = value; if (this.colorChanged[s] === -1) this.colorChanged[s] = offset; this.colorEnd[s] = offset + 1;
          }
        }
      }
      this.counts[s] = n + 1;
    }
  }
  commit(): void {
    for (let s = 0; s < this.flat.length; s++) {
      const sink = this.flat[s];
      if (!sink) continue;
      const n = this.counts[s] ?? 0;
      for (const mesh of sink.meshes) { mesh.count = n; mesh.visible = n > 0; }
      if (n === 0) continue;
      const r = this.ranges[s];
      if (r) {
        const start = this.changed[s] ?? -1, colorStart = this.colorChanged[s] ?? -1;
        if (start >= 0) upload(sink.matrix, r.matrix, start, this.changedEnd[s] ?? start);
        if (sink.color && colorStart >= 0) upload(sink.color, r.color, colorStart, this.colorEnd[s] ?? colorStart);
      }
    }
  }
}

/** the view a culler reads: the camera's (re-chosen when it changed, or moved past `step`) or one handed in */
const viewFor = (o: CullOptions, buffered = false): View => new View(o.frustum === false ? o.step ?? 0 : 0, buffered && o.frustum !== false);

export class InstancedCull {
  private readonly view: View;
  /** `CullOptions.resident`'s version, and the one the copies were last chosen at */
  private readonly resident: (() => number) | null;
  private chosen = 0;
  /** FC12: a view handed in (`CullOptions.view`) drives the choice; `update` then only follows the resident tiles */
  private readonly viewDriven: boolean;
  private handed = false;
  /** the casting cascades' frusta, read as each choice starts (`CullOptions.casters`) */
  private readonly casting: () => readonly THREE.Frustum[];
  private readonly chooser: Chooser;
  private readonly sinks: Sinks;
  private readonly levels: number;
  private readonly variantOf: Uint16Array;
  /**
   * `groups[v * levels + l]` are variant v's level l's sinks (empty: a level that draws nothing); `variantOf[i]` copy i's
   * variant; `matrices` 16 floats per copy; `colors` 3 per copy or null; `bounds` x, y, z, r per copy (world); `origins`
   * x, y, z per copy (`from: 'origin'`); `fades` each level's dissolve band (a copy in it is drawn at both levels);
   * `scales` each group's copy scale (variants sharing a level's sinks at their own sizes), null: none scales
   */
  constructor(
    groups: readonly (readonly InstancedSink[])[], levels: number, variantOf: Uint16Array,
    matrices: Float32Array, colors: Float32Array | null, bounds: Float32Array, from: readonly number[], o: CullOptions,
    origins: Float32Array | Float64Array | null = null, fades: readonly number[] = [], casting: () => readonly THREE.Frustum[] = () => [],
    scales: Float32Array | null = null,
  ) {
    this.casting = casting;
    this.levels = levels;
    this.variantOf = variantOf;
    this.view = viewFor(o, true);
    this.chooser = new Chooser(from, o, bounds, origins, fades);
    this.sinks = new Sinks(groups, matrices, colors, scales);
    this.resident = o.resident?.version ?? null;
    this.viewDriven = o.view !== undefined;
  }

  update(camera: THREE.Camera): void {
    const version = this.resident?.() ?? 0;
    // FC12: a handed-in view's culler re-chooses here only when its resident tiles changed, from the view it was last given
    if (this.viewDriven) { if (this.handed && version !== this.chosen) { this.chosen = version; this.choose(); } return; }
    const moved = this.view.changed(camera);
    if (moved || version !== this.chosen) { this.chosen = version; this.choose(); }
  }

  /** a view handed in (`CullOptions.view`) */
  updateWith(frustum: THREE.Frustum, eye: THREE.Vector3): void {
    this.view.use(frustum, eye);
    this.handed = true; this.chosen = this.resident?.() ?? 0;
    this.choose();
  }

  private choose(): void {
    const ch = this.chooser, sinks = this.sinks;
    this.view.shadows.length = 0; this.view.shadows.push(...this.casting());
    ch.begin(this.view);
    sinks.reset();
    for (let i = ch.next(0); i < this.variantOf.length; i = ch.next(i + 1)) {
      const l = ch.level(i, this.view);
      if (l < 0) continue;
      const base = (this.variantOf[i] ?? 0) * this.levels, a = ch.also(l);
      sinks.put(i, base + l, ch.d2);
      if (a >= 0) sinks.put(i, base + a, ch.d2);
    }
    sinks.commit();
  }
}

/**
 * `cells`: instanced copies bucketed into squares once (what Culling.ts's CelledInstances did for the forest floor); a
 * view change tests the cells, then copies the passing cells' copies (by their own range) into their variant's and
 * level's buffer. Cells keep the order their first copy came in; a cell's copies keep placement order.
 */
export class CelledCopiesCull {
  private readonly view: View;
  private readonly sphere = new THREE.Sphere();
  private readonly sinks: Sinks;
  /** per cell: centre x, y, z, radius (float64: the sphere tests as the old culler made them) */
  private readonly cells: Float64Array;
  /** cell c's copies are `order[start[c] … start[c + 1])` */
  private readonly start: Uint32Array;
  private readonly order: Uint32Array;
  private readonly far: number;
  /** `CullOptions.test`, after the cell and range tests: a copy it refuses is not drawn (a tile ring, say) */
  private readonly test: ((i: number, d2: number) => boolean) | null;
  private readonly from2: Float32Array;
  private readonly levels: number;
  private readonly variantOf: Uint16Array;
  private readonly origins: Float32Array;
  /** `origins`: each copy's placement point (x, y, z), float32 */
  constructor(
    groups: readonly (readonly InstancedSink[])[], levels: number, variantOf: Uint16Array,
    matrices: Float32Array, colors: Float32Array | null, origins: Float32Array,
    from: readonly number[], o: CullOptions & { readonly cells: { readonly size: number; readonly pad: number } },
  ) {
    this.levels = levels;
    this.variantOf = variantOf;
    this.origins = origins;
    this.view = viewFor(o, true);
    this.sinks = new Sinks(groups, matrices, colors);
    this.far = o.far ?? Number.POSITIVE_INFINITY;
    this.test = o.test ?? null;
    this.from2 = Float32Array.from(from, (d) => d * d);
    const { size, pad } = o.cells, n = origins.length / 3;
    const buckets = new Map<string, number[]>();
    for (let i = 0; i < n; i++) {
      const k = `${Math.floor((origins[i * 3] ?? 0) / size)},${Math.floor((origins[i * 3 + 2] ?? 0) / size)}`;
      let b = buckets.get(k);
      if (!b) buckets.set(k, (b = []));
      b.push(i);
    }
    this.cells = new Float64Array(buckets.size * 4);
    this.start = new Uint32Array(buckets.size + 1);
    this.order = new Uint32Array(n);
    let c = 0, at = 0;
    for (const [k, idx] of buckets) {
      const [ix = 0, iz = 0] = k.split(',').map(Number);
      let ymin = Number.POSITIVE_INFINITY, ymax = Number.NEGATIVE_INFINITY;
      for (const i of idx) { const y = origins[i * 3 + 1] ?? 0; if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
      this.cells.set([(ix + 0.5) * size, (ymin + ymax) * 0.5, (iz + 0.5) * size, Math.hypot(size * 0.5, (ymax - ymin) * 0.5, size * 0.5) + pad], c * 4);
      this.start[c] = at;
      for (const i of idx) this.order[at++] = i;
      c++;
    }
    this.start[c] = at;
  }

  update(camera: THREE.Camera): void {
    if (this.view.changed(camera)) this.choose();
  }

  /** a view handed in (`CullOptions.view`) */
  updateWith(frustum: THREE.Frustum, eye: THREE.Vector3): void {
    this.view.use(frustum, eye);
    this.choose();
  }

  private choose(): void {
    const sinks = this.sinks, p = this.origins, e = this.view.eye;
    const far = this.far, max2 = far * far, cells = this.cells, from2 = this.from2;
    sinks.reset();
    for (let c = 0; c + 1 < this.start.length; c++) {
      const cx = cells[c * 4] ?? 0, cz = cells[c * 4 + 2] ?? 0, r = cells[c * 4 + 3] ?? 0;
      const dx = cx - e.x, dz = cz - e.z;
      if (dx * dx + dz * dz > (far + r) * (far + r)) continue;
      this.sphere.center.set(cx, cells[c * 4 + 1] ?? 0, cz); this.sphere.radius = r;
      if (!this.view.sees(this.sphere)) continue;
      for (let j = this.start[c] ?? 0; j < (this.start[c + 1] ?? 0); j++) {
        const i = this.order[j] ?? 0;
        const ex = (p[i * 3] ?? 0) - e.x, ez = (p[i * 3 + 2] ?? 0) - e.z, d2 = ex * ex + ez * ez;
        if (d2 > max2 || (this.test !== null && !this.test(i, d2))) continue;
        let l = from2.length - 1;
        while (l > 0 && d2 < (from2[l] ?? 0)) l--;
        sinks.put(i, (this.variantOf[i] ?? 0) * this.levels + l, d2);
      }
    }
    sinks.commit();
  }
}

/** What a batched culler drives per instance: which geometry it draws and whether it draws (a BatchedMesh, or an
 *  instanced set packing each geometry's copies into its own InstancedMesh). */
export interface BatchSink {
  readonly setGeometryIdAt: (instance: number, geometry: number) => unknown;
  readonly setVisibleAt: (instance: number, visible: boolean) => unknown;
}

/** a copy's instance in one batch, and the geometry id each of its levels draws (-1: none at that level) */
export interface BatchedSlot {
  readonly mesh: BatchSink;
  readonly instance: number;
  /** per level: the geometry id, -1 when this material draws nothing at that level */
  readonly geometry: Int32Array;
  /** per level: the squared `until` of what it draws there (∞: none), or null when no level has one */
  readonly until2: Float64Array | null;
}

export class BatchedCull {
  private readonly view: View;
  private readonly chooser: Chooser;
  /** the level each slot draws now (-1: hidden), so only changes touch the batch */
  private readonly shown: Int8Array;
  private readonly slots: readonly BatchedSlot[];
  private readonly start: Uint32Array;
  /** `slots` are grouped per copy: copy i owns slots [start[i], start[i + 1]); `fades` each level's dissolve band */
  constructor(slots: readonly BatchedSlot[], start: Uint32Array, bounds: Float32Array | Float64Array, from: readonly number[], o: CullOptions,
    origins: Float32Array | Float64Array | null = null, fades: readonly number[] = []) {
    this.slots = slots;
    this.start = start;
    this.view = viewFor(o);
    this.chooser = new Chooser(from, o, bounds, origins, fades);
    this.shown = new Int8Array(slots.length).fill(-2);
  }

  update(camera: THREE.Camera): void {
    if (this.view.changed(camera)) this.choose();
  }

  /** a view handed in (`CullOptions.view`) */
  updateWith(frustum: THREE.Frustum, eye: THREE.Vector3): void {
    this.view.use(frustum, eye);
    this.choose();
  }

  /** what a slot draws at level l for a copy at distance² d2: its geometry id, or -1 (none there, or past its `until`) */
  private static at(slot: BatchedSlot, l: number, d2: number): number {
    const g = slot.geometry[l] ?? -1;
    return g >= 0 && slot.until2 !== null && d2 >= (slot.until2[l] ?? Number.POSITIVE_INFINITY) ? -1 : g;
  }

  private choose(): void {
    const ch = this.chooser;
    for (let i = 0; i + 1 < this.start.length; i++) {
      const l = ch.level(i, this.view), a = l < 0 ? -1 : ch.also(l), d2 = ch.d2;
      for (let k = this.start[i] ?? 0; k < (this.start[i + 1] ?? 0); k++) {
        const slot = this.slots[k];
        if (!slot) continue;
        // its level's geometry; in a dissolve band, the next level's when it has none at this one (the forest's impostor)
        let g = l < 0 ? -1 : BatchedCull.at(slot, l, d2);
        if (g < 0 && a >= 0) g = BatchedCull.at(slot, a, d2);
        if (this.shown[k] === g) continue;
        if (g < 0) slot.mesh.setVisibleAt(slot.instance, false);
        else { slot.mesh.setGeometryIdAt(slot.instance, g); slot.mesh.setVisibleAt(slot.instance, true); }
        this.shown[k] = g;
      }
    }
  }
}

/** merged cells: each cell's level objects; the nearest level whose distance the cell's centre has passed is shown */
export class CellCull {
  private readonly view: View;
  private readonly shown: Int8Array;
  private readonly from2: Float32Array;
  private readonly far2: number;
  private readonly cells: readonly (readonly (THREE.Object3D | null)[])[];
  private readonly centres: Float32Array;
  /** `cells[c]` = its levels (null: that level draws nothing); `centres` x, y, z per cell */
  constructor(cells: readonly (readonly (THREE.Object3D | null)[])[], centres: Float32Array, from: readonly number[], o: CullOptions) {
    this.cells = cells;
    this.centres = centres;
    this.view = viewFor(o);
    this.shown = new Int8Array(cells.length).fill(-2);
    this.from2 = Float32Array.from(from, (d) => d * d);
    this.far2 = o.far === undefined ? Number.POSITIVE_INFINITY : o.far * o.far;
  }

  update(camera: THREE.Camera): void {
    if (this.view.changed(camera)) this.choose();
  }

  /** a view handed in (`CullOptions.view`) */
  updateWith(frustum: THREE.Frustum, eye: THREE.Vector3): void {
    this.view.use(frustum, eye);
    this.choose();
  }

  private choose(): void {
    const e = this.view.eye;
    for (let c = 0; c < this.cells.length; c++) {
      const dx = (this.centres[c * 3] ?? 0) - e.x, dy = (this.centres[c * 3 + 1] ?? 0) - e.y, dz = (this.centres[c * 3 + 2] ?? 0) - e.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      let l = -1;
      if (d2 <= this.far2) { l = this.from2.length - 1; while (l > 0 && d2 < (this.from2[l] ?? 0)) l--; }
      if (this.shown[c] === l) continue;
      this.shown[c] = l;
      const levels = this.cells[c] ?? [];
      for (let k = 0; k < levels.length; k++) { const o = levels[k]; if (o) o.visible = k === l; }
    }
  }
}

/**
 * `lodBy: 'set'`: every copy of a place call at the level of the copy nearest the eye — each (variant, level)'s mesh
 * holds all its copies (written once) and is shown or hidden as a whole, and three culls it per camera by its bounds.
 * One draw per level, as a hand-rolled set LOD (Pine Hollow's TRELLIS hero props) did it.
 */
export class SetCull {
  private readonly view: View;
  private readonly chooser: Chooser;
  private shown = -2;
  private readonly levels: readonly (readonly THREE.Object3D[])[];
  private readonly n: number;
  /** `levels[l]` = the meshes of level l (every variant's); `bounds` x, y, z, r per copy; `origins` x, y, z per copy (`from: 'origin'`) */
  constructor(levels: readonly (readonly THREE.Object3D[])[], n: number, bounds: Float32Array, from: readonly number[], o: CullOptions, origins: Float32Array | Float64Array | null = null) {
    this.levels = levels;
    this.n = n;
    this.view = viewFor(o);
    this.chooser = new Chooser(from, o, bounds, origins);
    this.show(0); // as built: the full model, until the first view says otherwise
  }

  update(camera: THREE.Camera): void {
    if (this.view.changed(camera)) this.choose();
  }

  /** a view handed in (`CullOptions.view`) */
  updateWith(frustum: THREE.Frustum, eye: THREE.Vector3): void {
    this.view.use(frustum, eye);
    this.choose();
  }

  private choose(): void {
    let best = Number.POSITIVE_INFINITY, at = -1;
    for (let i = 0; i < this.n; i++) { const d2 = this.chooser.dist2(i, this.view.eye); if (d2 < best) { best = d2; at = i; } }
    this.show(at < 0 ? -1 : this.chooser.levelAt(best, 0));
  }

  private show(l: number): void {
    if (l === this.shown) return;
    this.shown = l;
    this.levels.forEach((meshes, k) => { for (const m of meshes) m.visible = k === l; });
  }
}

/**
 * `draw: 'single'`: the parts of a copy tagged `userData.until` (metres) are drawn only while the camera is nearer than
 * that to the copy's origin — a building's detail set (its iron, cloth and glass) and its far set, dropped with distance
 * as Pine Hollow's cabins and landmarks did by hand. Checked when the view changed; only a crossing touches `visible`.
 */
export class UntilCull {
  private readonly view = new View();
  private readonly shown: Int8Array;
  private readonly parts: readonly THREE.Object3D[];
  private readonly until: Float32Array;
  private readonly copyOf: Uint32Array;
  private readonly origins: Float32Array;
  /** `parts[k]` is shown while the eye is within `until[k]` of copy `copyOf[k]`, whose origin is `origins[3 × copy …]` */
  constructor(parts: readonly THREE.Object3D[], until: Float32Array, copyOf: Uint32Array, origins: Float32Array) {
    this.parts = parts;
    this.until = until;
    this.copyOf = copyOf;
    this.origins = origins;
    this.shown = new Int8Array(parts.length).fill(-1);
  }

  update(camera: THREE.Camera): void {
    if (!this.view.changed(camera)) return;
    const e = this.view.eye, o = this.origins;
    for (let k = 0; k < this.parts.length; k++) {
      const c = this.copyOf[k] ?? 0, u = this.until[k] ?? 0;
      const dx = (o[c * 3] ?? 0) - e.x, dy = (o[c * 3 + 1] ?? 0) - e.y, dz = (o[c * 3 + 2] ?? 0) - e.z;
      const on = dx * dx + dy * dy + dz * dz < u * u ? 1 : 0;
      if (this.shown[k] === on) continue;
      this.shown[k] = on;
      const part = this.parts[k];
      if (part) part.visible = on === 1;
    }
  }
}

/** instanced copies drawn by their host (./weld.ts: the props a weld's buildings set about) */
export interface HostedSet {
  /** one mesh per part, with room for every copy; three culls each by its bounding sphere, remade on every refresh */
  readonly meshes: readonly THREE.InstancedMesh[];
  /** the copies per host, in placement order: the host's unit (an index into the culler's units) and their matrices (16 floats each) */
  readonly lists: readonly { readonly unit: number; readonly matrices: Float32Array }[];
}

/**
 * A weld's bands (./weld.ts, E347): each tagged object drawn only while the eye is within its `until` of its origin (its
 * copy's root, or its unit's root for the unit's meshes), or casting only from its `castFrom`; and each unit's detail band,
 * which the copies its copies host follow — their meshes rewritten (every host within the band, in order) when a unit
 * crosses it. Checked when the view changed; only a crossing touches an object or a mesh.
 */
export class WeldCull {
  private readonly view = new View();
  private readonly shown: Int8Array;
  private readonly unitOn: Int8Array;
  private readonly hosted: { set: HostedSet; dirty: boolean }[] = [];
  private pending = false;
  private readonly objects: readonly THREE.Object3D[];
  private readonly reach2: Float64Array;
  private readonly cast: Uint8Array;
  private readonly at: Uint32Array;
  private readonly origins: Float64Array;
  private readonly units: Uint32Array;
  private readonly detail2: Float64Array;
  /**
   * `objects[k]` is shown while the eye is within √`reach2[k]` of origin `at[k]` (`cast[k]` 1: casts a shadow only from that
   * far instead); `origins` x, y, z per origin; unit u's origin is `units[u]` and its detail band √`detail2[u]`
   */
  constructor(
    objects: readonly THREE.Object3D[], reach2: Float64Array, cast: Uint8Array,
    at: Uint32Array, origins: Float64Array, units: Uint32Array, detail2: Float64Array,
  ) {
    this.objects = objects;
    this.reach2 = reach2;
    this.cast = cast;
    this.at = at;
    this.origins = origins;
    this.units = units;
    this.detail2 = detail2;
    this.shown = new Int8Array(objects.length).fill(-1);
    this.unitOn = new Int8Array(units.length).fill(-1);
  }

  /** copies hosted by this weld's units: drawn from the next update on (as the units' bands stand then) */
  host(set: HostedSet): void { this.hosted.push({ set, dirty: true }); this.pending = true; }

  private d2(origin: number): number {
    const o = this.origins, e = this.view.eye;
    const dx = (o[origin * 3] ?? 0) - e.x, dy = (o[origin * 3 + 1] ?? 0) - e.y, dz = (o[origin * 3 + 2] ?? 0) - e.z;
    return dx * dx + dy * dy + dz * dz;
  }

  update(camera: THREE.Camera): void {
    const changed = this.view.changed(camera);
    if (!changed && !this.pending) return;
    this.pending = false;
    for (let k = 0; k < this.objects.length; k++) {
      const d2 = this.d2(this.at[k] ?? 0), within = d2 < (this.reach2[k] ?? 0);
      const on = (this.cast[k] === 1 ? !within : within) ? 1 : 0;
      if (this.shown[k] === on) continue;
      this.shown[k] = on;
      const o = this.objects[k];
      if (!o) continue;
      if (this.cast[k] === 1) o.castShadow = on === 1; else o.visible = on === 1;
    }
    let flipped = false;
    for (let u = 0; u < this.units.length; u++) {
      const on = this.d2(this.units[u] ?? 0) < (this.detail2[u] ?? 0) ? 1 : 0;
      if (this.unitOn[u] !== on) { this.unitOn[u] = on; flipped = true; }
    }
    for (const h of this.hosted) {
      if (!flipped && !h.dirty) continue;
      h.dirty = false;
      for (const im of h.set.meshes) {
        const dst = im.instanceMatrix.array as Float32Array;
        let n = 0;
        for (const l of h.set.lists) if (this.unitOn[l.unit] === 1) { dst.set(l.matrices, n * 16); n += l.matrices.length / 16; }
        im.count = n; im.visible = n > 0;
        if (n === 0) continue;
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
      }
    }
  }
}
