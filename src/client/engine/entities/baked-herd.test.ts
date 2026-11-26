import { expect, test } from 'vitest';
import { Bone, BufferAttribute, BufferGeometry, Euler, Float32BufferAttribute, Group, Matrix4, MeshStandardMaterial, Quaternion, Skeleton, SkinnedMesh, Vector3, type WebGLProgramParametersWithUniforms, type WebGLRenderer } from 'three';
import { PATCH_ORDER, patchShader } from '../render/shaderPatches';
import { BakedHerd, GaitRecorder, bakeGait, bakedMaterial, bakedPosition, type GaitPose } from './bakedHerd';

/** A deer-sized quadruped: a 7-bone spine along +z and four 3-bone legs (19 bones, 20 with the head), 8 vertices per
 *  bone, half of them shared with the parent; under a moved, turned root and a scaled mesh node, as a GLB scene is. */
function quadruped(): { root: Group; mesh: SkinnedMesh } {
  const bones: Bone[] = [], parents: number[] = [];
  const add = (parent: number, x: number, y: number, z: number): number => {
    const b = new Bone(); b.position.set(x, y, z); bones[parent]?.add(b); bones.push(b); parents.push(parent); return bones.length - 1;
  };
  const spine = [add(-1, 0, 1.1, -0.6)];
  for (let i = 0; i < 6; i++) spine.push(add(spine[i] ?? 0, 0, 0, 0.22));
  add(spine[6] ?? 0, 0, 0.25, 0.2);
  for (const [at, side] of [[1, 1], [1, -1], [5, 1], [5, -1]] as const) {
    let p = add(spine[at] ?? 0, side * 0.15, -0.1, 0);
    for (let k = 0; k < 2; k++) p = add(p, 0, -0.4, 0);
  }
  const root = new Group(); root.position.set(5, 0, 3); root.rotation.y = 0.7;
  const rig = bones[0]; if (rig === undefined) throw new Error('no root bone');
  root.add(rig); root.updateMatrixWorld(true);
  const pos: number[] = [], idx: number[] = [], wt: number[] = [], world = new Vector3();
  bones.forEach((b, i) => {
    b.getWorldPosition(world); world.applyMatrix4(new Matrix4().copy(root.matrixWorld).invert());
    for (let k = 0; k < 8; k++) {
      pos.push(world.x + 0.08 * Math.cos(k), world.y + 0.08 * Math.sin(k), world.z + 0.05 * (k % 2));
      const p = parents[i] ?? -1, shared = k % 2 === 0 && p >= 0;
      idx.push(i, shared ? p : 0, 0, 0); wt.push(shared ? 0.5 : 1, shared ? 0.5 : 0, 0, 0);
    }
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(pos.map((v) => v / 1.25), 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(new Float32Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geometry.setAttribute('skinIndex', new BufferAttribute(new Uint16Array(idx), 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(wt, 4));
  const mesh = new SkinnedMesh(geometry, new MeshStandardMaterial());
  mesh.scale.setScalar(1.25);
  root.add(mesh); root.updateMatrixWorld(true);
  mesh.bind(new Skeleton(bones));
  return { root, mesh };
}

/** The bench's stand-in gait (src/scripts/creature-bench/bench.ts). */
const HZ = 1.6;
const gait: GaitPose = (bones, rest, t) => {
  const e = new Euler(), r = new Quaternion();
  for (let i = 1; i < bones.length; i++) {
    const b = bones[i], q = rest[i];
    if (b !== undefined && q !== undefined) b.quaternion.copy(q).multiply(r.setFromEuler(e.set(0.35 * Math.sin(t * HZ * Math.PI * 2 + i * 0.7), 0, 0)));
  }
};

/** Every vertex as three skins it live at `t`, in the root's space, beside the baked herd's at the same time. */
function worstGap(root: Group, mesh: SkinnedMesh, t: number, bake: ReturnType<typeof bakeGait>): number {
  const rest = mesh.skeleton.bones.map((b) => b.quaternion.clone());
  gait(mesh.skeleton.bones, rest, t); root.updateMatrixWorld(true); mesh.skeleton.update();
  const toRoot = new Matrix4().copy(root.matrixWorld).invert().multiply(mesh.matrixWorld);
  const live = new Vector3(), baked = new Vector3();
  let worst = 0;
  for (let v = 0; v < mesh.geometry.getAttribute('position').count; v++) {
    mesh.applyBoneTransform(v, live.fromBufferAttribute(mesh.geometry.getAttribute('position'), v)).applyMatrix4(toRoot);
    worst = Math.max(worst, live.distanceTo(bakedPosition(bake, mesh.geometry, v, t / bake.seconds, baked)));
  }
  mesh.skeleton.bones.forEach((b, i) => { const q = rest[i]; if (q !== undefined) b.quaternion.copy(q); });
  return worst;
}

test('a baked frame skins every vertex where the live rig does', () => {
  const { root, mesh } = quadruped();
  const bake = bakeGait(mesh, gait, { frames: 32, seconds: 1 / HZ });
  expect(bake.bones).toBe(20);
  expect(bake.texture.image.width).toBe(80);
  expect(bake.texture.image.height).toBe(32);
  for (const f of [0, 7, 19, 31]) expect(worstGap(root, mesh, (f / 32) / HZ, bake)).toBeLessThan(1e-4);
});

test('between baked frames the herd stays within 0.1 m of the live pose (no pop at the switch)', () => {
  const { root, mesh } = quadruped();
  const bake = bakeGait(mesh, gait, { frames: 32, seconds: 1 / HZ });
  let worst = 0;
  for (let f = 0; f < 32; f++) worst = Math.max(worst, worstGap(root, mesh, ((f + 0.5) / 32) / HZ, bake));
  expect(worst).toBeGreaterThan(0);
  expect(worst).toBeLessThan(0.1);
});

test('the bake leaves the skeleton at rest', () => {
  const { mesh } = quadruped();
  const before = mesh.skeleton.bones.map((b) => b.quaternion.clone());
  bakeGait(mesh, gait, { frames: 8, seconds: 1 });
  mesh.skeleton.bones.forEach((b, i) => { expect(b.quaternion.equals(before[i] ?? new Quaternion())).toBe(true); });
});

test('thirty deer are one instanced mesh with its own depth material, and freeing it keeps the source', () => {
  const { mesh } = quadruped();
  const herd = new BakedHerd(mesh.geometry, bakeGait(mesh, gait, { frames: 16, seconds: 1 / HZ }), 32, new MeshStandardMaterial());
  for (let i = 0; i < 30; i++) herd.place(i, new Vector3(i * 2.6, 0, -60), 0.3, 1, i / 30);
  herd.update(1.25);
  expect(herd.mesh.count).toBe(30);
  expect(herd.uniforms.bakeCycles.value).toBeCloseTo(1.25 * HZ);
  expect(herd.mesh.boundingSphere?.radius ?? 0).toBeGreaterThan(30);
  expect(herd.mesh.customDepthMaterial).toBeDefined();
  expect(herd.mesh.geometry.getAttribute('bakePhase').getX(29)).toBeCloseTo(29 / 30);
  herd.dispose();
  expect(mesh.geometry.getAttribute('position').count).toBe(160);
  expect(mesh.geometry.getAttribute('skinIndex')).toBeDefined();
});

test('the baked material swaps the skinning chunks after the material\'s own patch, under its own program key', () => {
  const source = new MeshStandardMaterial();
  patchShader(source, 'test-look', PATCH_ORDER.material, (shader) => { shader.vertexShader += '\n// source patch'; });
  const uniforms = { bakeTex: { value: bakeGait(quadruped().mesh, gait, { frames: 4, seconds: 1 }).texture }, bakeFrames: { value: 4 }, bakeCycles: { value: 0 } };
  const baked = bakedMaterial(source, uniforms);
  const shader = { uniforms: {}, vertexShader: '#include <skinning_pars_vertex>\n#include <skinbase_vertex>\n#include <skinnormal_vertex>\n#include <skinning_vertex>', fragmentShader: '' } as unknown as WebGLProgramParametersWithUniforms;
  baked.onBeforeCompile(shader, {} as WebGLRenderer);
  expect(shader.vertexShader).toContain('mat4 bakeM');
  expect(shader.vertexShader).toContain('transformed = (bakeM * vec4(transformed, 1.0)).xyz;');
  expect(shader.vertexShader).toContain('// source patch');
  expect(Object.keys(shader.uniforms)).toEqual(['bakeTex', 'bakeFrames', 'bakeCycles']);
  expect(baked.customProgramCacheKey()).toContain('baked-herd');
});

test('a gait recorded from the live rig, slot by slot at its phase, is the bake of the same poser', () => {
  const { root, mesh } = quadruped();
  const baked = bakeGait(mesh, gait, { frames: 16, seconds: 1 / HZ });
  const recorder = new GaitRecorder(mesh.skeleton.bones.length, 16);
  const rest = mesh.skeleton.bones.map((b) => b.quaternion.clone());
  // the rig walks on: phases arrive out of order and repeat; each slot keeps its first sample
  for (const f of [3, 0, 3, 15, 7, ...Array.from({ length: 16 }, (_, k) => k)]) {
    const phase = f / 16 + 1e-6;
    if (!recorder.wants(phase + 2)) continue;
    expect(recorder.done).toBe(false);
    gait(mesh.skeleton.bones, rest, phase / HZ); root.updateMatrixWorld(true);
    recorder.record(mesh, root, phase + 2);
  }
  expect(recorder.done).toBe(true);
  expect(recorder.wants(0.5)).toBe(false);
  const recorded = recorder.bake(1 / HZ);
  let worst = 0;
  recorded.data.forEach((v, i) => { worst = Math.max(worst, Math.abs(v - (baked.data[i] ?? 0))); });
  expect(worst).toBeLessThan(1e-4);
  expect(() => new GaitRecorder(3, 4).record(mesh, root, 0)).toThrow(/another skeleton/u);
});
