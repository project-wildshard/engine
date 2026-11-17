import * as THREE from 'three';
import { PATCH_ORDER, patchShader } from '../render/shaderPatches';

/**
 * ONE-FORMAT CC54: the baked herd. Past the live-pose distance a species draws as ONE instanced mesh whose bones are not
 * posed on the CPU: one gait cycle is baked once into a float texture (row f = frame f, four texels per bone, each a
 * column of the bone's skin matrix), and the vertex stage skins every copy from it at its own phase. A herd of 30 is one
 * draw, one shadow draw inside the cascade, and no per-animal bone upload (CC53: the skinned herd's cost was its draws).
 *
 * A baked matrix takes a vertex of the geometry to the creature's root space, posed: R⁻¹ · M · B⁻¹ · bone · bone⁻¹₀ · B,
 * with R the rig root's world matrix, M the mesh's, B its bind matrix — three's skinning for either bind mode, so an
 * instance matrix (position, yaw, scale) is all a copy needs. Between baked frames the shader blends the two nearest
 * frames' matrices, as `bakedPosition` (the CPU mirror the tests read) does.
 */
export interface GaitBake {
  /** RGBA float, (bones × 4) × frames */
  readonly texture: THREE.DataTexture;
  readonly data: Float32Array;
  readonly frames: number;
  readonly bones: number;
  /** one cycle's length at rate 1 */
  readonly seconds: number;
}

/** Poses `bones` (rest quaternions alongside) at `t` seconds into the cycle. */
export type GaitPose = (bones: readonly THREE.Bone[], rest: readonly THREE.Quaternion[], t: number) => void;

const rootOf = (o: THREE.Object3D): THREE.Object3D => { let r = o; while (r.parent !== null) r = r.parent; return r; };

const _rootInv = new THREE.Matrix4(), _head = new THREE.Matrix4(), _bone = new THREE.Matrix4();
/** Frame `f` of `data` from `mesh`'s bones as they stand now (world matrices current), in `root`'s space. */
function writeFrame(mesh: THREE.SkinnedMesh, root: THREE.Object3D, data: Float32Array, f: number): void {
  const { bones, boneInverses } = mesh.skeleton, count = bones.length;
  _rootInv.copy(root.matrixWorld).invert();
  // R⁻¹ · M · B⁻¹, then per bone · bone · bone⁻¹₀ · B
  _head.multiplyMatrices(_rootInv, mesh.matrixWorld).multiply(mesh.bindMatrixInverse);
  for (let b = 0; b < count; b++) {
    const bone = bones[b], inverse = boneInverses[b];
    if (bone === undefined || inverse === undefined) continue;
    _bone.multiplyMatrices(_head, bone.matrixWorld).multiply(inverse).multiply(mesh.bindMatrix);
    data.set(_bone.elements, (f * count + b) * 16);
  }
}

function bakeOf(data: Float32Array, bones: number, frames: number, seconds: number): GaitBake {
  const texture = new THREE.DataTexture(data, bones * 4, frames, THREE.RGBAFormat, THREE.FloatType);
  texture.minFilter = texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return { texture, data, frames, bones, seconds };
}

/** Bake one cycle of `pose` on `mesh`'s own skeleton; the skeleton is left at its rest pose. */
export function bakeGait(mesh: THREE.SkinnedMesh, pose: GaitPose, opts: { readonly frames: number; readonly seconds: number }): GaitBake {
  const { frames, seconds } = opts, { bones } = mesh.skeleton;
  const rest = bones.map((b) => b.quaternion.clone()), root = rootOf(mesh);
  const data = new Float32Array(bones.length * 16 * frames);
  for (let f = 0; f < frames; f++) {
    pose(bones, rest, (f / frames) * seconds);
    root.updateMatrixWorld(true);
    writeFrame(mesh, root, data, f);
  }
  bones.forEach((b, i) => { const q = rest[i]; if (q !== undefined) b.quaternion.copy(q); });
  root.updateMatrixWorld(true);
  return bakeOf(data, bones.length, frames, seconds);
}

/**
 * A bake made from a live rig as its own poser walks it (CC54b): each frame slot is filled the first time the rig is
 * posed at that gait phase (0..1), in the rig's own space, until every slot holds one. A herd then shows a far animal
 * at its own phase, so the switch from its rig shows the same pose (to the interpolation between two slots).
 */
export class GaitRecorder {
  private readonly data: Float32Array;
  private readonly filled: Uint8Array;
  private left: number;
  readonly bones: number;
  readonly frames: number;
  constructor(bones: number, frames: number) {
    this.bones = bones;
    this.frames = frames;
    this.data = new Float32Array(bones * 16 * frames);
    this.filled = new Uint8Array(frames);
    this.left = frames;
  }
  get done(): boolean { return this.left === 0; }
  /** the slot `phase` falls in, if it is still empty (the caller then brings the rig's world matrices up to date) */
  wants(phase: number): boolean {
    const f = Math.floor((phase - Math.floor(phase)) * this.frames) % this.frames;
    return this.filled[f] === 0;
  }
  /** Fill `phase`'s slot from `mesh` (bones current) in `root`'s space; true once every slot is filled. */
  record(mesh: THREE.SkinnedMesh, root: THREE.Object3D, phase: number): boolean {
    if (mesh.skeleton.bones.length !== this.bones) throw new Error('GaitRecorder: a rig with another skeleton');
    const f = Math.floor((phase - Math.floor(phase)) * this.frames) % this.frames;
    if (this.filled[f] === 0) { writeFrame(mesh, root, this.data, f); this.filled[f] = 1; this.left--; }
    return this.done;
  }
  /** the finished bake; a cycle's `seconds` only scales a herd's own clock (a recorded herd is driven by phase) */
  bake(seconds = 1): GaitBake {
    if (!this.done) throw new Error('GaitRecorder: frames still empty');
    return bakeOf(this.data, this.bones, this.frames, seconds);
  }
}

const _a = new THREE.Matrix4(), _b = new THREE.Matrix4(), _s = new THREE.Matrix4();
const skinAt = (bake: GaitBake, frame: number, joints: readonly number[], weights: readonly number[], out: THREE.Matrix4): THREE.Matrix4 => {
  const e = out.elements; e.fill(0);
  for (let k = 0; k < 4; k++) {
    const w = weights[k] ?? 0, j = joints[k] ?? 0;
    if (w === 0) continue;
    const o = (frame * bake.bones + j) * 16;
    for (let c = 0; c < 16; c++) e[c] = (e[c] ?? 0) + w * (bake.data[o + c] ?? 0);
  }
  return out;
};

/** The CPU mirror of the shader: vertex `v` of `geometry` in root space, `cycles` into the gait (time / seconds · rate + phase). */
export function bakedPosition(bake: GaitBake, geometry: THREE.BufferGeometry, v: number, cycles: number, target: THREE.Vector3): THREE.Vector3 {
  const joints = geometry.getAttribute('skinIndex'), weights = geometry.getAttribute('skinWeight'), position = geometry.getAttribute('position');
  const j = [joints.getX(v), joints.getY(v), joints.getZ(v), joints.getW(v)], w = [weights.getX(v), weights.getY(v), weights.getZ(v), weights.getW(v)];
  const f = (cycles - Math.floor(cycles)) * bake.frames, f0 = Math.floor(f) % bake.frames, f1 = (f0 + 1) % bake.frames, a = f - Math.floor(f);
  skinAt(bake, f0, j, w, _a); skinAt(bake, f1, j, w, _b);
  for (let c = 0; c < 16; c++) _s.elements[c] = (_a.elements[c] ?? 0) * (1 - a) + (_b.elements[c] ?? 0) * a;
  return target.fromBufferAttribute(position, v).applyMatrix4(_s);
}

const PARS = /* glsl */ `
uniform highp sampler2D bakeTex;
uniform float bakeFrames;
uniform float bakeCycles;
attribute vec2 bakePhase;
#ifndef USE_SKINNING
attribute vec4 skinIndex;
attribute vec4 skinWeight;
#endif
mat4 bakeBone(float bone, int frame) {
  int x = int(bone) * 4;
  return mat4(texelFetch(bakeTex, ivec2(x, frame), 0), texelFetch(bakeTex, ivec2(x + 1, frame), 0),
    texelFetch(bakeTex, ivec2(x + 2, frame), 0), texelFetch(bakeTex, ivec2(x + 3, frame), 0));
}
mat4 bakeSkin(int frame) {
  return skinWeight.x * bakeBone(skinIndex.x, frame) + skinWeight.y * bakeBone(skinIndex.y, frame)
    + skinWeight.z * bakeBone(skinIndex.z, frame) + skinWeight.w * bakeBone(skinIndex.w, frame);
}
`;
const BASE = /* glsl */ `
float bakeF = fract(bakeCycles * bakePhase.y + bakePhase.x) * bakeFrames;
float bakeF0 = floor(bakeF);
int bakeI0 = int(bakeF0), bakeI1 = int(mod(bakeF0 + 1.0, bakeFrames));
mat4 bakeM = bakeSkin(bakeI0) * (1.0 - (bakeF - bakeF0)) + bakeSkin(bakeI1) * (bakeF - bakeF0);
`;

/** The uniforms every material of one bake shares: the texture, its frame count and the herd's clock (in cycles). */
export interface BakeUniforms { readonly bakeTex: THREE.IUniform<THREE.Texture>; readonly bakeFrames: THREE.IUniform<number>; readonly bakeCycles: THREE.IUniform<number> }

/** `material` (a fresh one the herd owns: the factory's, set up as a rig's) skins from the bake: its skinning chunks
 *  swapped, after its own patches, under a program key of its own. */
export function bakedMaterial<M extends THREE.Material>(material: M, uniforms: BakeUniforms): M {
  patchShader(material, 'baked-herd', PATCH_ORDER.decorate, (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <skinning_pars_vertex>', `#include <skinning_pars_vertex>\n${PARS}`)
      .replace('#include <skinbase_vertex>', `#include <skinbase_vertex>\n${BASE}`)
      .replace('#include <skinnormal_vertex>', '#include <skinnormal_vertex>\nobjectNormal = (bakeM * vec4(objectNormal, 0.0)).xyz;')
      .replace('#include <skinning_vertex>', '#include <skinning_vertex>\ntransformed = (bakeM * vec4(transformed, 1.0)).xyz;');
  }, { key: (before) => `${before}|baked-herd` });
  return material;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);

/** One species' far herd: `capacity` copies of `source`'s geometry skinned from `bake`, one draw (and one shadow draw). */
export class BakedHerd {
  readonly mesh: THREE.InstancedMesh;
  readonly uniforms: BakeUniforms;
  private readonly phase: THREE.InstancedBufferAttribute;
  private readonly bake: GaitBake;
  private dirty = true;

  /** `source`: the rig's skinned geometry (shared, not copied); `materials`: fresh ones for the herd to own (one, or one
   *  per source group as the rig draws them). */
  constructor(source: THREE.BufferGeometry, bake: GaitBake, capacity: number, materials: THREE.Material | THREE.Material[]) {
    this.bake = bake;
    this.uniforms = { bakeTex: { value: bake.texture }, bakeFrames: { value: bake.frames }, bakeCycles: { value: 0 } };
    const geometry = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, attribute);
    geometry.setIndex(source.index);
    for (const g of source.groups) geometry.addGroup(g.start, g.count, g.materialIndex);
    this.phase = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
    geometry.setAttribute('bakePhase', this.phase);
    if (source.boundingSphere === null) source.computeBoundingSphere();
    geometry.boundingSphere = source.boundingSphere?.clone() ?? null;
    const baked = Array.isArray(materials) ? materials.map((m) => bakedMaterial(m, this.uniforms)) : bakedMaterial(materials, this.uniforms);
    this.mesh = new THREE.InstancedMesh(geometry, baked, capacity);
    this.mesh.count = 0;
    this.mesh.castShadow = true;
    this.mesh.customDepthMaterial = bakedMaterial(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), this.uniforms);
  }

  get capacity(): number { return this.phase.count; }

  /** Copy `i` stands at `position` facing `yaw`, `scale`d, `phase` cycles into its gait, stepping at `rate` (0 holds it). */
  place(i: number, position: THREE.Vector3, yaw: number, scale: number, phase: number, rate = 1): void {
    this.placeMatrix(i, _m.compose(position, _q.setFromAxisAngle(UP, yaw), _v.setScalar(scale)), phase, rate);
  }

  /** Copy `i` drawn at `matrix` (a rig's own local matrix), `phase` cycles in, at `rate`, tinted `tint` if given. */
  placeMatrix(i: number, matrix: THREE.Matrix4, phase: number, rate: number, tint?: THREE.Color): void {
    this.mesh.setMatrixAt(i, matrix);
    if (tint !== undefined) { this.mesh.setColorAt(i, tint); if (this.mesh.instanceColor !== null) this.mesh.instanceColor.needsUpdate = true; }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.phase.setXY(i, phase, rate);
    this.phase.needsUpdate = true;
    if (i >= this.mesh.count) this.mesh.count = i + 1;
    this.dirty = true;
  }

  /** Draw only the first `n` copies. */
  setCount(n: number): void { if (n !== this.mesh.count) { this.mesh.count = n; this.dirty = true; } }

  /** The herd's clock: `t` seconds. */
  update(t: number): void {
    this.uniforms.bakeCycles.value = t / this.bake.seconds;
    if (this.dirty) { this.mesh.computeBoundingSphere(); this.dirty = false; }
  }

  /** Frees what the herd made; the source's attributes stay with the source (they are shared, not copied). */
  dispose(): void {
    const { geometry } = this.mesh;
    for (const name of Object.keys(geometry.attributes)) if (name !== 'bakePhase') geometry.deleteAttribute(name);
    geometry.setIndex(null);
    geometry.dispose();
    for (const m of Array.isArray(this.mesh.material) ? this.mesh.material : [this.mesh.material]) m.dispose();
    this.mesh.customDepthMaterial?.dispose();
    this.bake.texture.dispose();
  }
}
