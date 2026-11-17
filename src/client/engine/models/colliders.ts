/**
 * A placement's pose, and a model's own-space colliders carried to it (E306, ./model.ts step 2): the model owns its
 * colliders in its own space; `place` turns them into world-space `ColliderDesc`s per copy. Engine-neutral data, as
 * everywhere else: src/shared/engine/physics/pieces.ts makes the Rapier colliders.
 */
import * as THREE from 'three';
import { placeCollider as placeFormatCollider, poseOf as poseOfFormat, readColliderRows as readFormatColliderRows, type Pose as FormatPose } from '@wildshard/format/colliders';
import type { Material as SurfaceMaterial } from '../../../shared/engine/physics/surface';
import type { ColliderDesc } from '../world/registry';
import type { Placement } from './model';

/** Decode fresh registry descriptors from serialized facts (format's law, SDK-SPLIT SP5b). Callers explicitly admit shape
 * kinds and surfaces; absent surfaces stay absent, unless requireSurface is true. No physics objects are created here.
 * At most 65,536 rows and 6,000,000 values per geometry lane are admitted; indices must fit Uint32. */
export function readColliderRows(rows: readonly unknown[], policy: {
  readonly kinds: readonly ColliderDesc['kind'][];
  readonly surfaces: readonly SurfaceMaterial[];
  readonly requireSurface?: boolean;
}): ColliderDesc[] {
  return readFormatColliderRows(rows, policy);
}

/** one copy's transform: the matrix, and its rotation and uniform scale taken apart once */
export interface Pose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly matrix: THREE.Matrix4;
  readonly quat: THREE.Quaternion;
  readonly scale: number;
  /** no rotation at all (the colliders keep their own yaw exactly) */
  readonly upright: boolean;
}

/** each `poseOf` pose's format twin (its matrix as numbers), so placing many colliders at one pose converts it once; a pose
 *  made elsewhere converts on each call */
const twins = new WeakMap<Pose, FormatPose>();
function twinOf(pose: Pose): FormatPose {
  return twins.get(pose) ?? { x: pose.x, y: pose.y, z: pose.z, matrix: Float64Array.from(pose.matrix.elements), quat: { x: pose.quat.x, y: pose.quat.y, z: pose.quat.z, w: pose.quat.w }, scale: pose.scale, upright: pose.upright };
}

/** The pose of a placement: scale, yaw, lean X, lean Z, then the position (or its matrix); format's law (SDK-SPLIT SP5b). */
export function poseOf(pl: Placement<object>): Pose {
  const twin = poseOfFormat({ x: pl.x, y: pl.y, z: pl.z, ...(pl.yaw === undefined ? {} : { yaw: pl.yaw }), ...(pl.leanX === undefined ? {} : { leanX: pl.leanX }),
    ...(pl.leanZ === undefined ? {} : { leanZ: pl.leanZ }), ...(pl.scale === undefined ? {} : { scale: pl.scale }), ...(pl.matrix === undefined ? {} : { matrix: pl.matrix.elements }) });
  const pose: Pose = { x: twin.x, y: twin.y, z: twin.z, matrix: new THREE.Matrix4().fromArray(twin.matrix), quat: new THREE.Quaternion(twin.quat.x, twin.quat.y, twin.quat.z, twin.quat.w), scale: twin.scale, upright: twin.upright };
  twins.set(pose, twin);
  return pose;
}

/**
 * A copy's geometry posed into the world the way the old builders did it, step by step (scale, rotateY, rotateX,
 * rotateZ, translate) — so a merged model is bit-identical to the loop it replaced. A `matrix` placement applies once.
 */
export function poseGeometry(g: THREE.BufferGeometry, pl: Placement<object>): void {
  if (pl.matrix !== undefined) { g.applyMatrix4(pl.matrix); return; }
  if (pl.scale !== undefined && pl.scale !== 1) g.scale(pl.scale, pl.scale, pl.scale);
  if (pl.yaw !== undefined) g.rotateY(pl.yaw);
  if (pl.leanX !== undefined) g.rotateX(pl.leanX);
  if (pl.leanZ !== undefined) g.rotateZ(pl.leanZ);
  g.translate(pl.x, pl.y, pl.z);
}

/** one own-space collider at a copy's pose, in world space (format's law, SDK-SPLIT SP5b) */
export function placeCollider(d: ColliderDesc, pose: Pose): ColliderDesc {
  return placeFormatCollider(d, twinOf(pose));
}

/**
 * `{ kind: 'drawn-hull' }` for a copy whose geometry is already posed in the world (the merged path): the hull of the
 * vertices it draws, relative to its placement's position — exactly what the old builders registered.
 */
export function drawnHullWorld(geos: readonly THREE.BufferGeometry[], pose: Pose): ColliderDesc {
  let n = 0;
  for (const g of geos) n += g.getAttribute('position').count;
  const pts = new Float32Array(n * 3);
  let o = 0;
  for (const g of geos) {
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++, o++) { pts[o * 3] = p.getX(i) - pose.x; pts[o * 3 + 1] = p.getY(i) - pose.y; pts[o * 3 + 2] = p.getZ(i) - pose.z; }
  }
  return { kind: 'hull', x: pose.x, y: pose.y, z: pose.z, points: pts };
}

/** `{ kind: 'drawn-hull' }` for a copy drawn from own-space geometry (instanced / batched / single): scaled, turned by `rot` */
export function drawnHullOwn(geos: readonly THREE.BufferGeometry[], pose: Pose): ColliderDesc {
  let n = 0;
  for (const g of geos) n += g.getAttribute('position').count;
  const pts = new Float32Array(n * 3);
  let o = 0;
  for (const g of geos) {
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++, o++) { pts[o * 3] = p.getX(i) * pose.scale; pts[o * 3 + 1] = p.getY(i) * pose.scale; pts[o * 3 + 2] = p.getZ(i) * pose.scale; }
  }
  const q = pose.quat;
  return { kind: 'hull', x: pose.x, y: pose.y, z: pose.z, points: pts, ...(pose.upright ? {} : { rot: { x: q.x, y: q.y, z: q.z, w: q.w } }) };
}
