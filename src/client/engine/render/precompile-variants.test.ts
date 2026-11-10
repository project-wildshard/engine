import { expect, test, vi } from 'vitest';
import { Bone, BoxGeometry, InstancedMesh, Mesh, MeshBasicMaterial, MeshDepthMaterial, MeshStandardMaterial, PerspectiveCamera, Scene, Skeleton, SkinnedMesh, WebGLRenderer, type Material } from 'three';
import { LINK_WAIT_MS, runPrecompile, sceneJobs, shadowJobs } from './precompile';
import type { ProgramLike } from '../boot/perflog';
import { noteFrameDrawn, setBuildHeld } from '../../../shared/engine/core/framePacing';
import { SHADOW_LAYER } from '../core/shadowLayer';
import { linkedGl } from '../../../test/engine/linkedGl';
import { compileClassicGraph } from './graph/glslMaterial';

test('preparation retains both shadow-receiver variants of a shared material', () => {
  const scene = new Scene(), geometry = new BoxGeometry(), material = new MeshStandardMaterial();
  const plain = new Mesh(geometry, material), receiver = new Mesh(geometry, material), duplicate = new Mesh(geometry, material);
  receiver.receiveShadow = true;
  scene.add(plain, receiver, duplicate);
  const { jobs, materials } = sceneJobs(scene, null);
  const copies = jobs.flatMap(job => job.root.children);
  expect(materials).toBe(1);
  expect(copies).toHaveLength(2);
  expect(copies.map(copy => copy.receiveShadow)).toEqual([false, true]);
  expect(scene.children).toEqual([plain, receiver, duplicate]);
  expect(plain.receiveShadow).toBe(false); expect(receiver.receiveShadow).toBe(true);
  geometry.dispose(); material.dispose();
});

test.each([1, 6])('material-array preparation keeps at most %i program units per job', per => {
  const scene = new Scene(), geometry = new BoxGeometry();
  const materials = Array.from({length: 4}, () => new MeshStandardMaterial());
  const plain = new Mesh(geometry, materials), receiver = new Mesh(geometry, [...materials]);
  receiver.receiveShadow = true; scene.add(plain, receiver);
  const prepared = sceneJobs(scene, null, per), inventory: {material: Material; receiver: boolean}[] = [];
  try {
    expect(prepared.materials).toBe(materials.length);
    for (const job of prepared.jobs) {
      const units: Material[] = [];
      job.root.traverse(object => {
        if (!(object instanceof Mesh)) return;
        expect(object.geometry).toBe(geometry);
        const value: unknown = object.material, list: readonly unknown[] = Array.isArray(value) ? value : [value];
        for (const material of list) {
          if (!(material instanceof MeshStandardMaterial)) throw new Error('Missing prepared material');
          units.push(material); inventory.push({material, receiver: object.receiveShadow});
        }
      });
      expect(units.length).toBeLessThanOrEqual(per);
    }
    expect(inventory).toEqual([false, true].flatMap(value => materials.map(material => ({material, receiver: value}))));
    expect(plain.material).toBe(materials); expect(receiver.material).toEqual(materials);
    expect(scene.children).toEqual([plain, receiver]);
  } finally {geometry.dispose(); for (const material of materials) material.dispose();}
});

test.each([{cancel: false, held: false}, {cancel: true, held: false}, {cancel: false, held: true}, {cancel: true, held: true}])(
  'a slow material array crosses drawn barriers (cancel $cancel, held $held)', async ({cancel, held}) => {
  const renderer: unknown = Object.create(WebGLRenderer.prototype);
  if (!(renderer instanceof WebGLRenderer)) throw new Error('Missing renderer');
  const scene = new Scene(), geometry = new BoxGeometry();
  const materials = Array.from({length: 4}, () => new MeshBasicMaterial());
  const original = new Mesh(geometry, materials); scene.add(original);
  let now = 1000, frame = 0, current = true;
  const issued: {material: Material; frame: number}[] = [];
  const costs: number[] = [], clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  const fields: Record<string, unknown> = {
    info: {programs: [], render: {frame: 0}}, extensions: {has: () => false},
    properties: {get: () => ({}), has: () => false}, getContext: linkedGl, getRenderTarget: () => null, setRenderTarget: () => undefined,
    compile: (root: Scene): void => {
      const start = now;
      root.traverse(object => {
        if (!(object instanceof Mesh)) return;
        const value: unknown = object.material, list: readonly unknown[] = Array.isArray(value) ? value : [value];
        for (const material of list) {
          if (!(material instanceof MeshBasicMaterial)) throw new Error('Missing compile material');
          issued.push({material, frame}); now += 12;
        }
      });
      costs.push(now - start);
    },
  };
  for (const [key, value] of Object.entries(fields)) Reflect.set(renderer, key, value);
  noteFrameDrawn(now, now, 30); setBuildHeld(held);
  try {
    const warm = runPrecompile(renderer, new PerspectiveCamera(), sceneJobs(scene, null, 1).jobs, materials.length,
      undefined, [], () => current, true, () => {
        frame++; now = 1000 + frame * (1000 / 30); noteFrameDrawn(now, now, 30);
        if (cancel) current = false;
        return Promise.resolve();
      });
    await (cancel ? expect(warm).rejects.toThrow('Shader warm-up owner left') : warm);
    const expected = cancel ? materials.slice(0, 1) : materials;
    expect(costs).toEqual(expected.map(() => 12));
    expect(issued).toEqual(expected.map((material, index) => ({material, frame: index})));
    expect(original.material).toBe(materials); expect(original.parent).toBe(scene);
  } finally {setBuildHeld(false); clock.mockRestore(); noteFrameDrawn(Number.NEGATIVE_INFINITY); geometry.dispose(); for (const material of materials) material.dispose();}
});

test('a shadow-only piece gets its shadow depth job but no view program (G743)', () => {
  const scene = new Scene(), geometry = new BoxGeometry(), material = new MeshStandardMaterial();
  const view = new Mesh(geometry, material), piece = new Mesh(geometry, material);
  piece.receiveShadow = true; piece.castShadow = true; piece.layers.set(SHADOW_LAYER);
  scene.add(view, piece);
  const copies = sceneJobs(scene, null).jobs.flatMap(job => job.root.children);
  expect(copies).toHaveLength(1);
  expect(copies[0]?.receiveShadow).toBe(false);
  expect(shadowJobs(scene, null).flatMap(job => job.root.children).length).toBeGreaterThan(0);
  geometry.dispose(); material.dispose();
});

test('preparation compiles a hidden level and its shadow depth: compile walks visible objects only', () => {
  const scene = new Scene(), geometry = new BoxGeometry(), material = new MeshStandardMaterial();
  const level = new InstancedMesh(geometry, material, 4);
  level.count = 0; level.visible = false; level.castShadow = true;
  scene.add(level);
  const copies = [...sceneJobs(scene, null).jobs, ...shadowJobs(scene, null)].flatMap(job => job.root.children);
  expect(copies.filter(copy => copy instanceof InstancedMesh).map(copy => copy.visible)).toEqual([true, true]);
  expect(level.visible).toBe(false);
  level.dispose(); geometry.dispose(); material.dispose();
});

test('preparation covers distinct skin array lengths without splitting instance counts', () => {
  const scene = new Scene(), geometry = new BoxGeometry(), material = new MeshStandardMaterial();
  const first = new SkinnedMesh(geometry, material), second = new SkinnedMesh(geometry, material);
  first.bind(new Skeleton([new Bone(), new Bone()]));
  second.bind(new Skeleton([new Bone(), new Bone(), new Bone()]));
  const small = new InstancedMesh(geometry, material, 3), large = new InstancedMesh(geometry, material, 5);
  scene.add(first, second, small, large);
  const { jobs } = sceneJobs(scene, null);
  const copies = jobs.flatMap(job => job.root.children);
  expect(copies).toHaveLength(3);
  expect(copies.filter((copy): copy is SkinnedMesh => copy instanceof SkinnedMesh).map(copy => copy.skeleton.bones.length)).toEqual([2, 3]);
  expect(copies.filter(copy => copy instanceof InstancedMesh)).toHaveLength(1);
  first.skeleton.dispose(); second.skeleton.dispose(); small.dispose(); large.dispose();
  geometry.dispose(); material.dispose();
});

test('preparation retains a specialized instanced constructor', () => {
  class PresentationInstances extends InstancedMesh { readonly presentation = true; }
  const scene = new Scene(), geometry = new BoxGeometry(), material = new MeshStandardMaterial();
  const original = new PresentationInstances(geometry, material, 2); scene.add(original);
  try {
    const copy = sceneJobs(scene, null).jobs[0]?.root.children[0];
    if (!(copy instanceof PresentationInstances)) throw new Error('Specialized compile stand-in lost its constructor');
    expect(copy.presentation).toBe(true);
    expect(copy.instanceMatrix).not.toBe(original.instanceMatrix);
    copy.dispose();
  } finally { original.dispose(); geometry.dispose(); material.dispose(); }
});

test('shadow preparation compiles the depth variant a registered shadow draw substitutes (sp-o289)', () => {
  const scene = new Scene(), geometry = new BoxGeometry(), moving = new MeshStandardMaterial(), still = new MeshStandardMaterial();
  const a = new Mesh(geometry, moving), b = new Mesh(geometry, moving), c = new Mesh(geometry, still);
  for (const mesh of [a, b, c]) mesh.castShadow = true;
  scene.add(a, b, c);
  const variant = new MeshBasicMaterial(), stocks: MeshDepthMaterial[] = [];
  const resolve = (source: Material, stock: MeshDepthMaterial): Material | null => {
    if (source !== moving) return null;
    stocks.push(stock); variant.side = stock.side; return variant;
  };
  const jobs = shadowJobs(scene, null, 6, undefined, resolve);
  const prepared = jobs.filter(job => job.prepare !== undefined);
  expect(prepared).toHaveLength(1);
  const copy = prepared[0]?.root.children[0];
  if (!(copy instanceof Mesh)) throw new Error('graph depth job has no caster');
  variant.side = 0; prepared[0]?.prepare?.();
  expect(copy.material).toBe(variant);
  expect(variant.side).toBe(stocks.at(-1)?.side);
  // the still material keeps a stock depth caster
  expect(jobs.flatMap(job => job.root.children).some(child => child instanceof Mesh && child.material instanceof MeshDepthMaterial)).toBe(true);
  for (const job of jobs) job.dispose?.();
  geometry.dispose(); moving.dispose(); still.dispose(); variant.dispose();
});

test.each([[false, true], [true, true], [true, false]] as const)(
  'preparation preserves issue and discovery (parallel %s, immediately ready %s)', async (parallel, immediate) => {
    const renderer: unknown = Object.create(WebGLRenderer.prototype);
    if (!(renderer instanceof WebGLRenderer)) throw new Error('Missing renderer');
    const geometry = new BoxGeometry(), material = new MeshBasicMaterial(), scene = new Scene();
    scene.add(new Mesh(geometry, material));
    let frame = 0;
    const events: { operation: string; frame: number }[] = [], acquired: ProgramLike[] = [], programs = new Map<string, ProgramLike>();
    const program: ProgramLike = { name: 'fixture', type: 'basic', cacheKey: 'fixture', id: 1, usedTimes: 1, program: {},
      isReady: () => immediate || frame > 0, getUniforms: () => { events.push({ operation: 'resolve', frame }); } };
    const diagnostics = { checkShaderErrors: true };
    const fields: Record<string, unknown> = {
      info: { programs: acquired, render: { frame: 0 } }, extensions: { has: () => parallel }, debug: diagnostics,
      properties: { get: () => ({ programs }), has: () => true }, getContext: linkedGl, getRenderTarget: () => null, setRenderTarget: () => undefined,
      compile: () => { events.push({ operation: 'issue', frame }); acquired.push(program); programs.set('fixture', program); },
    };
    for (const [key, value] of Object.entries(fields)) Reflect.set(renderer, key, value);
    try {
      await runPrecompile(renderer, new PerspectiveCamera(), sceneJobs(scene, null).jobs, 1, undefined, [], () => true, true,
        () => { frame++; return Promise.resolve(); });
      expect(events.map(event => event.operation)).toEqual(['issue', 'resolve']);
      expect(events[0]?.frame).toBe(0);
      expect(events[1]?.frame).toBe(parallel && !immediate ? 1 : 0);
      expect(diagnostics.checkShaderErrors).toBe(true);
    } finally { geometry.dispose(); material.dispose(); }
  });

test.each([false, true])('ordinary boot resolves an unreported parallel completion without skipping native refusal (failure %s)', async failure => {
  const renderer: unknown = Object.create(WebGLRenderer.prototype);
  if (!(renderer instanceof WebGLRenderer)) throw new Error('Missing renderer');
  const geometry = new BoxGeometry(), material = new MeshBasicMaterial(), scene = new Scene();
  scene.add(new Mesh(geometry, material));
  const acquired: ProgramLike[] = [], programs = new Map<string, ProgramLike>();
  let now = 1000, current = true, resolved = 0;
  const nativeFailure = new Error('Original native link refusal');
  const program: ProgramLike = { name: 'unreported-link', type: 'basic', cacheKey: 'unreported-link', id: 1, usedTimes: 1, program: {},
    isReady: () => false, getUniforms: () => { resolved++; if (failure) throw nativeFailure; return {}; } };
  const diagnostics = { checkShaderErrors: true };
  const fields: Record<string, unknown> = {
    info: { programs: acquired, render: { frame: 0 } }, extensions: { has: () => true }, debug: diagnostics,
    properties: { get: () => ({ programs }), has: () => true }, getContext: linkedGl, getRenderTarget: () => null, setRenderTarget: () => undefined,
    compile: () => { acquired.push(program); programs.set('unreported-link', program); },
  };
  for (const [key, value] of Object.entries(fields)) Reflect.set(renderer, key, value);
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  try {
    const warm = runPrecompile(renderer, new PerspectiveCamera(), sceneJobs(scene, null).jobs, 1, undefined, [], () => current, false,
      () => { now += 1000; if (now > 4 * LINK_WAIT_MS) current = false; return Promise.resolve(); });
    await (failure ? expect(warm).rejects.toBe(nativeFailure) : warm);
    expect(current).toBe(true);
    expect(resolved).toBe(1);
    expect(diagnostics.checkShaderErrors).toBe(true);
    expect(acquired).toEqual([program]);
    expect(scene.children).toHaveLength(1);
  } finally { clock.mockRestore(); geometry.dispose(); material.dispose(); }
});

test.each([
  { cap: 30, draw: 28, compile: 2, resolve: 3, isolate: true, pauses: 2, expected: [0, 0, 1, 1] },
  { cap: 60, draw: 4, compile: 1, resolve: 1, isolate: true, pauses: 2, expected: [0, 0, 1, 1] },
  { cap: 60, draw: 4, compile: 1, resolve: 1, isolate: false, pauses: 1, expected: [0, 0, 1, 1] },
  { cap: 30, draw: 28, compile: 23, resolve: 7, isolate: true, pauses: 4, expected: [0, 1, 2, 3] },
])('compile and link share the remaining $cap Hz frame budget ($compile ms compile, isolate $isolate)', async ({ cap, draw, compile, resolve, isolate, pauses, expected }) => {
  const renderer: unknown = Object.create(WebGLRenderer.prototype);
  if (!(renderer instanceof WebGLRenderer)) throw new Error('Missing renderer');
  const geometry = new BoxGeometry(), a = new MeshBasicMaterial(), b = new MeshBasicMaterial(), scene = new Scene();
  scene.add(new Mesh(geometry, a), new Mesh(geometry, b));
  let frame = 0, now = 1000 + draw;
  const events: number[] = [], acquired: ProgramLike[] = [], programs = new Map<Material, Map<string, ProgramLike>>();
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  const fields: Record<string, unknown> = {
    info: { programs: acquired, render: { frame: 0 } }, extensions: { has: () => true },
    properties: { get: (material: Material) => ({ programs: programs.get(material) }), has: () => true },
    getContext: linkedGl, getRenderTarget: () => null, setRenderTarget: () => undefined,
    compile: (root: Scene) => {
      events.push(frame); now += compile;
      root.traverse(object => {
        if (!(object instanceof Mesh) || !(object.material instanceof MeshBasicMaterial)) return;
        const program: ProgramLike = { name: 'paced', type: 'basic', cacheKey: String(acquired.length), id: acquired.length,
          usedTimes: 1, program: {}, isReady: () => true, getUniforms: () => { events.push(frame); now += resolve; } };
        acquired.push(program); programs.set(object.material, new Map([['paced', program]]));
      });
    },
  };
  for (const [key, value] of Object.entries(fields)) Reflect.set(renderer, key, value);
  noteFrameDrawn(now, 1000, cap);
  try {
    await runPrecompile(renderer, new PerspectiveCamera(), sceneJobs(scene, null, 1).jobs, 2, undefined, [], () => true, isolate,
      () => { frame++; now = 1000 + frame * (1000 / cap) + draw; noteFrameDrawn(now, 1000 + frame * (1000 / cap), cap); return Promise.resolve(); });
    expect(events).toEqual(expected);
    expect(frame).toBe(pauses);
    expect(acquired).toHaveLength(2);
  } finally { clock.mockRestore(); noteFrameDrawn(Number.NEGATIVE_INFINITY); geometry.dispose(); a.dispose(); b.dispose(); }
});

test.each([
  { query: 20, resolve: 7, cancel: false, held: false },
  { query: 0, resolve: 20, cancel: false, held: false },
  { query: 20, resolve: 7, cancel: true, held: false },
  { query: 20, resolve: 20, cancel: false, held: true },
  { query: 20, resolve: 20, cancel: true, held: true },
  { query: 0, resolve: 0, cancel: false, held: true },
])('slow native queries separate readiness from first-use resolution (query $query, resolve $resolve, cancel $cancel, held $held)', async ({ query, resolve, cancel, held }) => {
  const renderer: unknown = Object.create(WebGLRenderer.prototype);
  if (!(renderer instanceof WebGLRenderer)) throw new Error('Missing renderer');
  const geometry = new BoxGeometry(), material = new MeshStandardMaterial(), scene = new Scene();
  scene.add(new Mesh(geometry, material));
  let now = 1000, frame = 0, current = true;
  const events: { kind: string; frame: number }[] = [];
  const program: ProgramLike = { name: 'slow-driver', type: 'standard', cacheKey: 'slow-driver', id: 1, usedTimes: 1, program: {},
    isReady: () => { events.push({ kind: 'query', frame }); now += query; return true; },
    getUniforms: () => { events.push({ kind: 'resolve', frame }); now += resolve; } };
  const programs = new Map<string, ProgramLike>();
  const fields: Record<string, unknown> = {
    info: { programs: [program], render: { frame: 0 } }, extensions: { has: () => true },
    properties: { get: () => ({ programs }), has: () => true }, getRenderTarget: () => null, setRenderTarget: () => undefined,
    getContext: linkedGl,
    compile: () => { programs.set('slow-driver', program); },
  };
  for (const [key, value] of Object.entries(fields)) Reflect.set(renderer, key, value);
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  noteFrameDrawn(now, now, 60); setBuildHeld(held);
  try {
    const warm = runPrecompile(renderer, new PerspectiveCamera(), sceneJobs(scene, null, 1).jobs, 1, undefined, [], () => current, true,
      () => { frame++; now += 16; noteFrameDrawn(now, now, 60); if (cancel) current = false; return Promise.resolve(); }, undefined, undefined, 6);
    if (cancel) { await expect(warm).rejects.toThrow('Shader warm-up owner left'); expect(events.map(event => event.kind)).toEqual(['query']); }
    else {
      await warm;
      expect(events.map(event => event.kind)).toEqual(['query', 'resolve']);
      if (query > 0) expect(events[1]?.frame).toBeGreaterThan(events[0]?.frame ?? -1);
      else expect(events[1]?.frame).toBe(events[0]?.frame);
    }
  } finally { setBuildHeld(false); clock.mockRestore(); noteFrameDrawn(Number.NEGATIVE_INFINITY); geometry.dispose(); material.dispose(); }
});

test('every colourless instanced twin of a colour-reading graph takes its white colours before its key (DL23)', () => {
  // Nine's instanced architecture: the first twin's stand-in made only that twin white, the second kept the colourless
  // key the first had left, and drew colourless at its first parked draw, linking that program there
  const scene = new Scene(), geometry = new BoxGeometry();
  const { material } = compileClassicGraph({ version: 1, kind: 'material', model: 'unlit',
    nodes: { t: { op: 'instanceColour' }, c: { op: 'varying', in: ['t'] } }, stages: { surface: { colour: 'c' } }, effectState: { fog: false } });
  const twins = [new InstancedMesh(geometry, material, 2), new InstancedMesh(geometry, material, 3)];
  for (const twin of twins) scene.add(twin);
  try {
    const clones = sceneJobs(scene, null).jobs.flatMap(job => job.root.children);
    expect(twins.map(twin => twin.instanceColor?.count)).toEqual([2, 3]);
    expect(clones).toHaveLength(1);
    expect(clones[0]).toBeInstanceOf(InstancedMesh);
    expect(clones.every(clone => clone instanceof InstancedMesh && clone.instanceColor !== null)).toBe(true);
  } finally { for (const twin of twins) twin.dispose(); geometry.dispose(); material.dispose(); }
});
