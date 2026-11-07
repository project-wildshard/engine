/** Client-only riding straps; never imported by simulation poses. The Explorer's reins card is baked from the same ribbon. */
import * as THREE from 'three';
import type { Animal } from '@wildshard/engine/entities/AnimalView';
import type { Scope } from '@wildshard/engine/app/scope';
import { painterlyMaterial } from '@wildshard/engine/world/painterly';
import { ReinPresentationSchema, type ReinPresentationRows, type ReinRibbonRows, type ReinRibbonFrame } from '@wildshard/format/riding';
import { parse } from 'valibot';

function rgb(value: readonly number[]): [number, number, number] {
  const [r, g, b] = value;
  if (value.length !== 3 || r === undefined || g === undefined || b === undefined || !value.every(Number.isFinite)) throw new Error('Invalid rein colour');
  return [r, g, b];
}

const _w = new THREE.Vector3(), _b = new THREE.Vector3(), _e = new THREE.Vector3(), _p = new THREE.Vector3();
const _t = new THREE.Vector3(), _s = new THREE.Vector3(), _down = new THREE.Vector3(), _q = new THREE.Quaternion();
const _k0 = new THREE.Vector3(), _k1 = new THREE.Vector3(), _k2 = new THREE.Vector3(), _k3 = new THREE.Vector3(), _head = new THREE.Vector3();
const _crest = new THREE.Vector3(), _leftW = new THREE.Vector3(), _upW = new THREE.Vector3(0, 1, 0), _muzzle = new THREE.Vector3();

/** a uniform Catmull-Rom point (or its tangent) between p1 and p2 at t, into `out` */
function catmull(out: THREE.Vector3, p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, t: number, tangent: boolean): THREE.Vector3 {
  const t2 = t * t, t3 = t2 * t;
  const f = (a: number, b: number, c: number, d: number): number => tangent
    ? 0.5 * ((-a + c) + 2 * (2 * a - 5 * b + 4 * c - d) * t + 3 * (-a + 3 * b - 3 * c + d) * t2)
    : 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return out.set(f(p0.x, p1.x, p2.x, p3.x), f(p0.y, p1.y, p2.y, p3.y), f(p0.z, p1.z, p2.z, p3.z));
}

/** Client-only paired, vertex-coloured straps; the caller owns the returned geometry and material. */
export function buildReinsRibbon(rows: ReinRibbonRows): { mesh: THREE.Mesh; pos: Float32Array; attr: THREE.BufferAttribute } {
  if (!Number.isInteger(rows.span) || rows.span < 1 || rows.span > 64 || !Number.isFinite(rows.halfWidth) || rows.halfWidth <= 0) throw new Error('Invalid rein dimensions');
  const SEG = rows.span * 3;
  const LEATHER = new THREE.Color(...rgb(rows.colour)), LEATHER_EDGE = new THREE.Color(...rgb(rows.edge));
  const verts = 2 * (SEG + 1) * 2;
  const pos = new Float32Array(verts * 3);
  const nrm = new Float32Array(verts * 3), col = new Float32Array(verts * 3), idx: number[] = [];
  for (let v = 0; v < verts; v++) {
    nrm[v * 3 + 2] = 1;
    const c = v % 2 === 0 ? LEATHER_EDGE : LEATHER;
    col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b;
  }
  for (let r = 0; r < 2; r++) {
    const o = r * (SEG + 1) * 2;
    for (let i = 0; i < SEG; i++) { const a = o + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  const attr = new THREE.BufferAttribute(pos, 3);
  attr.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('position', attr);
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  return { mesh: new THREE.Mesh(g, painterlyMaterial(null, { ...rows.paint, side: THREE.DoubleSide })), pos, attr };
}

/** Fill one strap along six camera-space anchors, including the two phantom endpoints. */
export function fillRein(pos: Float32Array, r: number, K: readonly THREE.Vector3[], rows: ReinRibbonRows): void {
  const SPAN = rows.span, SEG = SPAN * 3;
  const o = r * (SEG + 1) * 2;
  for (let i = 0; i <= SEG; i++) {
    const span = Math.min(2, Math.floor(i / SPAN)), t = (i - span * SPAN) / SPAN;
    const p0 = K[span], p1 = K[span + 1], p2 = K[span + 2], p3 = K[span + 3];
    if (p0 === undefined || p1 === undefined || p2 === undefined || p3 === undefined) continue;
    catmull(_p, p0, p1, p2, p3, t, false);
    catmull(_t, p0, p1, p2, p3, t, true);
    // a flat strap turned to the eye: its width across the tangent and the line of sight
    _s.crossVectors(_t, _p).normalize().multiplyScalar(rows.halfWidth);
    const k = (o + i * 2) * 3;
    pos[k] = _p.x + _s.x; pos[k + 1] = _p.y + _s.y; pos[k + 2] = _p.z + _s.z;
    pos[k + 3] = _p.x - _s.x; pos[k + 4] = _p.y - _s.y; pos[k + 5] = _p.z - _s.z;
  }
}

/** Client-only camera projection. All mount observations and appearance are numeric rows. */
export class ReinRibbon {
  readonly group: THREE.Group = new THREE.Group();
  private readonly pos: Float32Array;
  private readonly posAttr: THREE.BufferAttribute;
  private readonly ribbon: THREE.Mesh;
  /** 1 = in the hands, 0 = dropped on the withers (eased) */
  private held = 1;

  constructor(private readonly camera: THREE.PerspectiveCamera, private readonly rows: ReinRibbonRows, scope?: Scope) {
    const { mesh, pos, attr } = buildReinsRibbon(rows);
    this.pos = pos; this.posAttr = attr; this.ribbon = mesh;
    this.ribbon.frustumCulled = false; this.ribbon.castShadow = false; this.ribbon.receiveShadow = false;
    this.ribbon.raycast = () => undefined;   // never in an aim ray / pick
    this.group.add(this.ribbon);
    this.group.name = 'reins';
    this.group.visible = false;
    camera.add(this.group);
    scope?.own(mesh.geometry);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) scope?.own(material);
    scope?.onDispose(() => { this.group.removeFromParent(); });
  }

  update(dt: number, frame: ReinRibbonFrame | null): void {
    if (frame === null) { this.group.visible = false; this.held = 1; return; }
    this.group.visible = true;
    const cam = this.camera, rows = this.rows;
    cam.updateMatrixWorld();
    this.held += ((frame.drop ? 0 : 1) - this.held) * Math.min(1, dt * rows.heldRate);
    const toCam = cam.matrixWorldInverse;
    _crest.fromArray(frame.crest); _head.fromArray(frame.head); _muzzle.fromArray(frame.muzzle);
    _w.fromArray(frame.withers).applyMatrix4(toCam);
    cam.getWorldQuaternion(_q).invert();
    _down.set(0, -1, 0).applyQuaternion(_q);
    _leftW.set(Math.cos(frame.yaw), 0, -Math.sin(frame.yaw));
    const tanF = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    for (let r = 0; r < 2; r++) {
      const side = r === 0 ? 1 : -1;   // r 0 = the horse's left rein (on the screen's left: the view looks along the horse)
      // the bit: back from the muzzle toward the head bone, out to this side of the mouth
      _b.copy(_muzzle).lerp(_head, rows.bit.back).addScaledVector(_leftW, side * rows.bit.out).applyMatrix4(toCam);
      // the hand: under the frame on this side, or the withers when the hands let go
      _e.set(-side * rows.hand.x * rows.hand.depth * tanF * cam.aspect, rows.hand.y * rows.hand.depth * tanF, -rows.hand.depth).lerp(_w, 1 - this.held);
      // the neck's flank, then under the jowl — out on this side; dropped, the neck point sinks onto the neck
      _k1.copy(_crest).addScaledVector(_upW, -rows.neck.down).addScaledVector(_leftW, side * rows.neck.out).applyMatrix4(toCam).addScaledVector(_down, (1 - this.held) * rows.droppedSag);
      _k2.copy(_head).addScaledVector(_upW, -rows.jowl.down).addScaledVector(_leftW, side * rows.jowl.out).applyMatrix4(toCam);
      _k0.copy(_e).multiplyScalar(2).sub(_k1);           // phantom ends: the path leaves the hand and meets the bit straight
      _k3.copy(_b).multiplyScalar(2).sub(_k2);
      fillRein(this.pos, r, [_k0, _e, _k1, _k2, _b, _k3], rows);
    }
    this.posAttr.needsUpdate = true;
  }
}

const _anchorMatrix = new THREE.Matrix4(), _anchorPoint = new THREE.Vector3();
/** Client-only strap projection from native skeleton weights and declared
 * anchor roles. The actor keeps its pose; no content sampler or hook binds. */
export class MountedReins {
  private readonly ribbon: ReinRibbon;
  private readonly rows: ReinPresentationRows;
  private readonly frame: ReinRibbonFrame = { yaw: 0, drop: false, head: [0, 0, 0], crest: [0, 0, 0], muzzle: [0, 0, 0], withers: [0, 0, 0] };
  private readonly muzzleLocal = new WeakMap<Animal, THREE.Vector3>();
  get group(): THREE.Group { return this.ribbon.group; }
  constructor(camera: THREE.PerspectiveCamera, input: unknown, scope?: Scope) { this.rows=parse(ReinPresentationSchema,input);this.ribbon = new ReinRibbon(camera, this.rows, scope); }
  /** the muzzle in the head bone's frame: of the vertices the head bone moves most, the one farthest from it (bind pose:
   *  bone⁻¹ · bindMatrix · v) — found in the actor's admitted mesh */
  private muzzleOf(a: Animal): THREE.Vector3 | null {
    const rows = this.rows;
    const hit = this.muzzleLocal.get(a);
    if (hit !== undefined) return hit;
    const mesh = a.mesh, sk = mesh.skeleton, head = sk.getBoneByName(rows.anchors.head);
    if (head === undefined) return null;   // missing declared anchor
    const hi = sk.bones.indexOf(head), inv = sk.boneInverses[hi];
    if (inv === undefined) return null;
    const g = mesh.geometry, pos = g.getAttribute('position'), si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight');
    _anchorMatrix.multiplyMatrices(inv, mesh.bindMatrix);
    let best: THREE.Vector3 | null = null, bd = -1;
    for (let i = 0; i < pos.count; i++) {
      let w = 0;
      for (let c = 0; c < 4; c++) if (si.getComponent(i, c) === hi) w += sw.getComponent(i, c);
      if (w < rows.anchors.minWeight) continue;
      _anchorPoint.fromBufferAttribute(pos, i).applyMatrix4(_anchorMatrix);
      const d = _anchorPoint.lengthSq();
      if (d > bd) { bd = d; best = (best ?? new THREE.Vector3()).copy(_anchorPoint); }
    }
    if (best === null) return null;
    this.muzzleLocal.set(a, best);
    return best;
  }

  update(dt: number, actor: Animal | null, on: boolean, drop: boolean): void {
    const rows = this.rows;
    if (!on || actor === null) { this.ribbon.update(dt, null); return; }
    const muzzle = this.muzzleOf(actor), skeleton = actor.mesh.skeleton;
    const head = skeleton.getBoneByName(rows.anchors.head), crest = skeleton.getBoneByName(rows.anchors.crest), body = skeleton.getBoneByName(rows.anchors.body);
    if (muzzle === null || head === undefined || crest === undefined || body === undefined) { this.ribbon.group.visible = false; return; }
    actor.mesh.updateMatrixWorld(true);
    const frame = this.frame; frame.drop = drop; frame.yaw = actor.yaw;
    _anchorPoint.setFromMatrixPosition(head.matrixWorld).toArray(frame.head);
    _anchorPoint.setFromMatrixPosition(crest.matrixWorld).toArray(frame.crest);
    _anchorPoint.copy(muzzle).applyMatrix4(head.matrixWorld).toArray(frame.muzzle);
    _anchorPoint.fromArray(rows.anchors.withers).applyMatrix4(body.matrixWorld).toArray(frame.withers);
    this.ribbon.update(dt, frame);
  }
}
