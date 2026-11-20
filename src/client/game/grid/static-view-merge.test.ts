// @vitest-environment happy-dom
// meta DRIFTWOOD-FPS DF10 (mini-df10): a region's still set pieces drawn one view mesh per material; a member that moves
// or hides draws on its own again.
import { expect, test } from 'vitest';
import { BufferAttribute, BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, ShaderMaterial, Texture } from 'three';
import { gpuOnlyAttributes } from '@wildshard/engine/core/gpuOnly';
import { Scope } from '@wildshard/engine/app/scope';
import { SHADOW_LAYER } from '@wildshard/engine/core/shadowLayer';
import { installStaticViewMerge, primeStaticMerges, NO_VIEW_MERGE, mergeableMaterial, mergeableMesh, staticMerge, STATIC_MERGE_DEFAULT, STATIC_MERGE_PHONE_LOW, SWEEP_STEPS } from './staticViewMerge';
import { propMerge } from '../shardfile/groundMerge';

const tri = (x: number): BufferGeometry => new BufferGeometry().setAttribute('position', new Float32BufferAttribute([x, 0, 0, x + 1, 0, 0, x, 0, 1], 3));

test('a saved boolean wins; unset, phone Low takes its own default', () => {
  expect(staticMerge(true)).toBe(true);
  expect(staticMerge(false, true)).toBe(false);
  expect(staticMerge(null, true)).toBe(STATIC_MERGE_PHONE_LOW);
  expect(staticMerge(undefined, false)).toBe(STATIC_MERGE_DEFAULT);
});

test('only plain opaque meshes on a world-space material merge', () => {
  const basic = new MeshBasicMaterial();
  expect(mergeableMaterial(basic)).toBe('any');
  expect(mergeableMaterial(new MeshBasicMaterial({ transparent: true }))).toBeNull();
  expect(mergeableMaterial(new ShaderMaterial())).toBeNull();
  const graph = (readsModelSpace: boolean, movesVertices: boolean): object => Object.assign(new ShaderMaterial(), { isGraphShaderMaterial: true, readsModelSpace, movesVertices });
  expect(mergeableMaterial(graph(true, false))).toBeNull();
  expect(mergeableMaterial(graph(false, false))).toBe('any');
  expect(mergeableMaterial(graph(false, true))).toBe('translation');
  const lit = Object.assign(new ShaderMaterial({ uniforms: { lightMap: { value: new Texture() } } }), { isGraphShaderMaterial: true, readsModelSpace: false, movesVertices: false });
  expect(mergeableMaterial(lit)).toBeNull(); // a sampled texture keeps a graph off the merge
  const env = Object.assign(new ShaderMaterial({ uniforms: { envMap: { value: new Texture() }, dfgLUT: { value: new Texture() } } }), { isGraphShaderMaterial: true, readsModelSpace: false, movesVertices: false });
  expect(mergeableMaterial(env)).toBe('any'); // the scene's lighting textures do not
  const baked = new MeshBasicMaterial(); baked.userData[NO_VIEW_MERGE] = true;
  expect(mergeableMaterial(baked)).toBeNull();
  expect(mergeableMesh(new Mesh(tri(0), basic))).toBe(true);
  const hooked = new Mesh(tri(0), basic); hooked.onBeforeRender = function onBeforeRender() { /* reads the mesh */ };
  expect(mergeableMesh(hooked)).toBe(false);
  const shared = new Mesh(tri(0), basic); shared.onBeforeRender = () => undefined;
  expect(mergeableMesh(shared)).toBe(true);
  const ranged = new Mesh(tri(0), basic); ranged.geometry.setDrawRange(0, 1);
  expect(mergeableMesh(ranged)).toBe(false);
  const gpu = new Mesh(tri(0), basic); gpu.geometry.setAttribute('color', new Float32BufferAttribute([1, 1, 1, 1, 1, 1, 1, 1, 1], 3));
  gpuOnlyAttributes(gpu.geometry, 'test');
  expect(mergeableMesh(gpu)).toBe(false); // its colours leave the CPU at upload: a merge would copy nothing (black)
  const released = new Mesh(tri(0), basic); released.geometry.setAttribute('color', new Float32BufferAttribute([1, 1, 1, 1, 1, 1, 1, 1, 1], 3));
  const colour = released.geometry.getAttribute('color'); if (!(colour instanceof BufferAttribute)) throw new Error('no colour');
  colour.array = colour.array.slice(0, 0);
  expect(mergeableMesh(released)).toBe(false);
});

test('still meshes sharing a material merge after a sweep; a moved one leaves for good; off ends every merge', async () => {
  const scope = new Scope('region'), root = new Group(), material = new MeshBasicMaterial(), lone = new MeshBasicMaterial();
  const pieces = [0, 10, 20].map(x => { const mesh = new Mesh(tri(x), material); root.add(mesh); return mesh; });
  const single = new Mesh(tri(30), lone); root.add(single);
  const checks: (() => void)[] = [];
  let on = true;
  const census = installStaticViewMerge(root, scope, check => { checks.push(check); }, () => on);
  const sweep = (): void => { for (let i = 0; i < SWEEP_STEPS; i++) for (const check of checks) check(); };
  const merged = (): Mesh | null => propMerge(root, material, { receive: false, order: 0, grouping: 'region', ignore: [] }).mesh;
  try {
    sweep();
    expect(census().members).toBe(0); // first sight: still for a whole sweep before it joins
    sweep();
    expect(census().members).toBe(3);
    await Promise.resolve(); // the merge rebuilds on a microtask
    expect(merged()?.geometry.getIndex()?.count).toBe(9);
    expect(pieces.map(mesh => mesh.layers.isEnabled(SHADOW_LAYER))).toEqual([true, true, true]);
    expect(single.layers.mask).toBe(1); // nothing to share its material
    const [moved] = pieces; if (moved === undefined) throw new Error('no piece');
    moved.position.x = 5; moved.updateMatrixWorld(true);
    sweep();
    expect(census().members).toBe(2);
    expect(moved.layers.mask).toBe(1);
    sweep(); sweep();
    expect(census().members).toBe(2); // never again
    on = false; document.dispatchEvent(new Event('ws:pixels'));
    expect(census().members).toBe(0);
    expect(pieces.map(mesh => mesh.layers.mask)).toEqual([1, 1, 1]);
  } finally { scope.dispose(); }
});

test('a member hidden under the root leaves its merge', () => {
  const scope = new Scope('region'), root = new Group(), set = new Group(), material = new MeshBasicMaterial();
  root.add(set);
  for (const x of [0, 10]) set.add(new Mesh(tri(x), material));
  const checks: (() => void)[] = [];
  const census = installStaticViewMerge(root, scope, check => { checks.push(check); }, () => true);
  const sweep = (): void => { for (let i = 0; i < SWEEP_STEPS; i++) for (const check of checks) check(); };
  try {
    sweep(); sweep();
    expect(census().members).toBe(2);
    set.visible = false;
    sweep();
    expect(census().members).toBe(0);
  } finally { scope.dispose(); }
});

test('the loading prime merges every mergeable mesh at once and builds the merged mesh; a primed mover leaves unrefused', async () => {
  const scope = new Scope('region'), root = new Group(), material = new MeshBasicMaterial();
  const pieces = [0, 10, 20].map(x => { const mesh = new Mesh(tri(x), material); root.add(mesh); return mesh; });
  const checks: (() => void)[] = [];
  let on = false;
  const census = installStaticViewMerge(root, scope, check => { checks.push(check); }, () => on);
  const sweep = (): void => { for (let i = 0; i < SWEEP_STEPS; i++) for (const check of checks) check(); };
  try {
    expect(await primeStaticMerges()).toBe(0); // the slot off: nothing
    on = true; document.dispatchEvent(new Event('ws:pixels'));
    expect(await primeStaticMerges()).toBe(3);
    expect(census().members).toBe(3);
    expect(propMerge(root, material, { receive: false, order: 0, grouping: 'region', ignore: [] }).mesh?.geometry.getIndex()?.count).toBe(9);
    const [moved] = pieces; if (moved === undefined) throw new Error('no piece');
    moved.position.x = 5; moved.updateMatrixWorld(true);
    sweep();
    expect(census().members).toBe(2);
    expect(moved.layers.mask).toBe(1);
    sweep(); sweep(); // primed, so not refused: still again, it rejoins
    expect(census().members).toBe(3);
    moved.position.x = 6; moved.updateMatrixWorld(true);
    sweep(); sweep(); sweep();
    expect(census().members).toBe(2); // a member past its first sweep that moves is refused, as any
  } finally { scope.dispose(); }
  expect(await primeStaticMerges()).toBe(0); // a disposed view leaves the prime
});
