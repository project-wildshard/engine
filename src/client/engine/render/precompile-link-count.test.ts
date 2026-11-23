import { expect, test } from 'vitest';
import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import type { ProgramLike } from '../boot/perflog';
import { linkedGl } from '../../../test/engine/linkedGl';
import { offscreenBakesHeld, withoutOffscreenBakes } from './offscreenPreparation';
import { runPrecompile, unbuiltObjects, type CompileJob } from './precompile';

// DL21: under the loader the resolve loop waited on one program while the GPU process linked the rest, counting those. DL21b
// (isolated path, opus-phone1): the loader now waits for a batch's links in a named chunk as it issues them, so the resolve
// after finds every program linked and moves one program a step.
test('under the loader an isolated batch links in a chunk before its resolves', async () => {
  const renderer: unknown = Object.create(WebGLRenderer.prototype);
  if (!(renderer instanceof WebGLRenderer)) throw new Error('Renderer missing');
  const geometry = new BoxGeometry(), materials = Array.from({ length: 4 }, () => new MeshBasicMaterial());
  const jobs: CompileJob[] = materials.map((material, i) => {
    const root = new Scene(); root.add(new Mesh(geometry, material));
    return { label: `material-${i}`, root, target: null, rt: null };
  });
  const programs: ProgramLike[] = [], byMaterial = new WeakMap<MeshBasicMaterial, ProgramLike[]>(), details: string[] = [];
  let frame = 0;
  const fields: Record<string, unknown> = {
    info: { programs, render: { frame: 0 } }, extensions: { has: (name: string) => name === 'KHR_parallel_shader_compile' },
    properties: { has: () => true, get: (material: MeshBasicMaterial) => ({ programs: new Map(byMaterial.get(material)?.map(program => [`linked-${program.id}`, program])) }) },
    getContext: linkedGl, getRenderTarget: () => null, setRenderTarget: () => undefined,
    compile: (root: Scene): void => {
      root.traverse(object => {
        if (!(object instanceof Mesh) || !(object.material instanceof MeshBasicMaterial)) return;
        const id = programs.length, issuedAt = frame;
        const program: ProgramLike = { type: 'test', name: `program-${id}`, cacheKey: `program-${id}`, usedTimes: 1, id, program: {},
          isReady: () => frame - issuedAt >= (id === 0 ? 12 : 4 + id), getUniforms: () => ({}) };
        programs.push(program); byMaterial.set(object.material, [program]);
      });
    },
  };
  for (const [key, value] of Object.entries(fields)) Reflect.set(renderer, key, value);
  await runPrecompile(renderer, new PerspectiveCamera(), jobs, materials.length, (_done, _total, detail) => { details.push(detail); }, [], () => true,
    true, () => { frame++; return Promise.resolve(); }, undefined, undefined, 6);
  expect(details.filter(detail => detail.includes('linking'))).toEqual(['4 materials · 4 / 4 batches · linking 4 · parallel']);
  // no resolve waits behind an unlinked program: none counts links landing behind it
  expect(details.filter(detail => / linked · /u.test(detail))).toEqual([]);
  // what the issue loop already settled is not resolved again; the rest resolve one by one, all linked
  expect(details.at(-1)).toMatch(/^(\d) \/ \1 programs resolved · parallel$/u);
});

test('a second pass looks only at what no pass has built', () => {
  const built = new MeshBasicMaterial(), fresh = new MeshBasicMaterial(), programs = new Map([[built, new Map([['linked', {}]])], [fresh, new Map()]]);
  const renderer: unknown = Object.create(WebGLRenderer.prototype);
  if (!(renderer instanceof WebGLRenderer)) throw new Error('Renderer missing');
  Reflect.set(renderer, 'properties', { has: () => true, get: (material: MeshBasicMaterial) => ({ programs: programs.get(material) }) });
  const unbuilt = unbuiltObjects(renderer), geometry = new BoxGeometry();
  expect(unbuilt(new Mesh(geometry, built))).toBe(false);
  expect(unbuilt(new Mesh(geometry, fresh))).toBe(true);
  expect(unbuilt(new Mesh(geometry, [built, fresh]))).toBe(true);
  expect(unbuilt(new Scene())).toBe(false);
});

test('a frame without bakes ends with its run, thrown or not', () => {
  withoutOffscreenBakes(() => { expect(offscreenBakesHeld()).toBe(true); });
  expect(() => { withoutOffscreenBakes(() => { throw new Error('a system failed'); }); }).toThrow('a system failed');
  expect(offscreenBakesHeld()).toBe(false);
});

// DL21: a boot batch's pass asked every unlinked program, a slice apiece on the Simulator (~20 ms each behind the GPU
// process's links), and showed its count only at the pass's end: 1-1.6 s on one count while links landed.
test('a batch link wait shows each link as it lands, across passes and inside one', async () => {
  const renderer: unknown = Object.create(WebGLRenderer.prototype);
  if (!(renderer instanceof WebGLRenderer)) throw new Error('Renderer missing');
  const geometry = new BoxGeometry(), materials = Array.from({ length: 4 }, () => new MeshBasicMaterial());
  const jobs: CompileJob[] = materials.map((material, i) => {
    const root = new Scene(); root.add(new Mesh(geometry, material));
    return { label: `material-${i}`, root, target: null, rt: null };
  });
  const programs: ProgramLike[] = [], byMaterial = new WeakMap<MeshBasicMaterial, ProgramLike[]>(), details: string[] = [];
  const fields: Record<string, unknown> = {
    info: { programs, render: { frame: 0 } }, extensions: { has: (name: string) => name === 'KHR_parallel_shader_compile' },
    properties: { has: () => true, get: (material: MeshBasicMaterial) => ({ programs: new Map(byMaterial.get(material)?.map(program => [`linked-${program.id}`, program])) }) },
    getContext: linkedGl, getRenderTarget: () => null, setRenderTarget: () => undefined,
    compile: (root: Scene): void => {
      root.traverse(object => {
        if (!(object instanceof Mesh) || !(object.material instanceof MeshBasicMaterial)) return;
        const id = programs.length;
        // two programs land in the first pass and two in the second, a slice apart inside each
        let asks = 0;
        const program: ProgramLike = { type: 'test', name: `program-${id}`, cacheKey: `program-${id}`, usedTimes: 1, id, program: {},
          isReady: () => ++asks > (id < 2 ? 0 : 1), getUniforms: () => ({}) };
        programs.push(program); byMaterial.set(object.material, [program]);
      });
    },
  };
  for (const [key, value] of Object.entries(fields)) Reflect.set(renderer, key, value);
  try {
    await runPrecompile(renderer, new PerspectiveCamera(), jobs, materials.length, (_done, _total, detail) => { details.push(detail); }, [], () => true,
      false, () => Promise.resolve(), undefined, undefined, 0);
    const counts = details.flatMap(detail => /^(\d+) \/ 4 programs linked · parallel/u.exec(detail)?.[1] ?? []).map(Number);
    // each landing shows once as it lands (a pass end repeats the last), and the count never goes back
    expect([...new Set(counts)]).toEqual([1, 2, 3, 4]);
    expect(counts.every((count, i) => i === 0 || count >= (counts[i - 1] ?? 0))).toBe(true);
  } finally { geometry.dispose(); for (const material of materials) material.dispose(); }
});
