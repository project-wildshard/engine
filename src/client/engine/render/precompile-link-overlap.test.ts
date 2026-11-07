import { expect, test, vi } from 'vitest';
import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import type { ProgramLike } from '../boot/perflog';
import { noteFrameDrawn, setBuildHeld } from '../../../shared/engine/core/framePacing';
import { linkedGl } from '../../../test/engine/linkedGl';
import { runPrecompile, setWarmUpHeld, type CompileJob } from './precompile';

interface Event { readonly kind: 'compile' | 'ready' | 'uniforms'; readonly id: number; readonly frame: number; readonly cost: number }
async function issue(options: { compileMs: number; queryMs: number; readyMs?: number; misses?: number; cancel?: boolean;
  shared?: boolean; initialMs?: number; initialPrograms?: number; failure?: Error; held?: boolean }) {
  const renderer: unknown = Object.create(WebGLRenderer.prototype);
  if (!(renderer instanceof WebGLRenderer)) throw new Error('Renderer missing');
  const geometry = new BoxGeometry(), materials = Array.from({ length: 8 }, () => new MeshBasicMaterial());
  const jobs: CompileJob[] = materials.map((material, i) => {
    const root = new Scene(); root.add(new Mesh(geometry, material));
    return { label: `material-${i}`, root, target: null, rt: null };
  });
  const programs: ProgramLike[] = [], byMaterial = new WeakMap<MeshBasicMaterial, ProgramLike[]>(), events: Event[] = [];
  let now = 1000, frame = 0, current = true, cancelAt = -1, pendingAfterIssue = -1, cachedDuringIssue = 0;
  const record = (kind: Event['kind'], id: number, cost: number): void => { events.push({ kind, id, frame, cost }); now += cost; };
  const fields: Record<string, unknown> = {
    info: { programs, render: { frame: 0 } }, extensions: { has: (name: string) => name === 'KHR_parallel_shader_compile' },
    properties: { has: () => true, get: (material: MeshBasicMaterial) => {
      const variants = byMaterial.get(material);
      return { programs: new Map(variants?.map(program => [`linked-${program.id}`, program])) };
    } }, getContext: linkedGl, getRenderTarget: () => null, setRenderTarget: () => undefined,
    compile: (root: Scene): void => {
      root.traverse(object => {
        if (!(object instanceof Mesh) || !(object.material instanceof MeshBasicMaterial)) return;
        const shared = options.shared === true ? programs[0] : undefined;
        if (shared !== undefined) { record('compile', shared.id, options.compileMs); byMaterial.set(object.material, [shared]); return; }
        const material = object.material, count = programs.length === 0 ? options.initialPrograms ?? 1 : 1, variants: ProgramLike[] = [];
        for (let variant = 0; variant < count; variant++) {
          const id = programs.length;
          let misses = options.misses ?? 0;
          const program: ProgramLike = { type: 'test', name: `program-${id}`, cacheKey: `program-${id}`, usedTimes: 1, id,
            program: {}, isReady: () => { record('ready', id, options.readyMs ?? 0); return misses-- <= 0; },
            getUniforms: () => { record('uniforms', id, options.queryMs); if (options.failure !== undefined) throw options.failure; return {}; } };
          record('compile', id, options.initialMs ?? options.compileMs); programs.push(program); variants.push(program);
        }
        byMaterial.set(material, variants);
      });
    },
  };
  for (const [key, value] of Object.entries(fields)) Reflect.set(renderer, key, value);
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  const pause = (): Promise<void> => {
    frame++; now = 1000 + frame * (1000 / 30); noteFrameDrawn(now, now, 30);
    if (options.cancel === true && events.some(event => event.kind === 'uniforms')) { current = false; cancelAt = events.length; }
    return Promise.resolve();
  };
  try {
    noteFrameDrawn(now, now, 30); setBuildHeld(options.held !== false); setWarmUpHeld(options.held !== false);
    const warming = runPrecompile(renderer, new PerspectiveCamera(), jobs, materials.length, undefined, [], () => current,
      true, pause, undefined, (phase, _ms, units) => { if (phase === 'link') pendingAfterIssue = units;
        if (phase === 'cached-compile') cachedDuringIssue = units; }, 6);
    if (options.failure !== undefined) await expect(warming).rejects.toBe(options.failure);
    else await (options.cancel === true ? expect(warming).rejects.toThrow('Shader warm-up owner left') : warming);
    expect(materials.every(material => material.side === 0 && material.version === 0)).toBe(true);
    return { events, pendingAfterIssue, cancelAt, cachedDuringIssue };
  } finally {
    setBuildHeld(false); setWarmUpHeld(false); noteFrameDrawn(Number.NEGATIVE_INFINITY); clock.mockRestore();
    geometry.dispose(); for (const material of materials) material.dispose();
  }
}

test('ready first-use queries overlap issuance instead of all waiting in the tail', async () => {
  const result = await issue({ compileMs: 2, queryMs: 1 });
  expect(result.pendingAfterIssue).toBeLessThan(8);
  const firstUse = result.events.findIndex(event => event.kind === 'uniforms');
  const lastIssue = result.events.reduce((last, event, i) => event.kind === 'compile' ? i : last, -1);
  expect(firstUse).toBeGreaterThanOrEqual(0); expect(firstUse).toBeLessThan(lastIssue);
  expect(result.events.filter(event => event.kind === 'uniforms').map(event => event.id).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  for (const frame of new Set(result.events.map(event => event.frame))) {
    expect(result.events.filter(event => event.frame === frame && event.kind === 'uniforms').length).toBeLessThanOrEqual(4);
    expect(result.events.filter(event => event.frame === frame && event.kind === 'compile').length).toBeLessThanOrEqual(4);
  }
});

test.each([{ compileMs: 12, queryMs: 12 }, { compileMs: 12, queryMs: 12, readyMs: 12 }])(
  'slow native units keep their completed-draw separation: %o', async options => {
    const result = await issue(options), slow = result.events.filter(event => event.cost >= 6);
    expect(slow.length).toBeGreaterThanOrEqual(16);
    expect(new Set(slow.map(event => event.frame)).size).toBe(slow.length);
    expect(result.events.filter(event => event.kind === 'uniforms')).toHaveLength(8);
  });

test('unfinished links remain mandatory even when they cannot overlap issue', async () => {
  const result = await issue({ compileMs: 2, queryMs: 1, misses: 1 });
  expect(result.events.filter(event => event.kind === 'uniforms').map(event => event.id).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
});

test.each([false, true])('a slow readiness query keeps its new frame remainder (held %s)', async held => {
  const result = await issue({ compileMs: 2, queryMs: 1, readyMs: 12, held });
  const firstUse = result.events.find(event => event.kind === 'uniforms');
  const secondCompile = result.events.find(event => event.kind === 'compile' && event.id === 1);
  expect(firstUse?.frame).toBe(1); expect(secondCompile?.frame).toBe(held ? 1 : 2);
  const slow = result.events.filter(event => event.cost >= 6);
  expect(new Set(slow.map(event => event.frame)).size).toBe(slow.length);
  expect(result.events.filter(event => event.kind === 'uniforms')).toHaveLength(8);
});

test('a capped multi-program job retains a nested completed frame without exceeding its fresh caps', async () => {
  const result = await issue({ compileMs: .5, queryMs: 1, readyMs: 12, initialPrograms: 4 });
  const firstUse = result.events.find(event => event.kind === 'uniforms');
  expect(firstUse?.frame).toBe(1);
  // The remainder serves the next mandatory readiness query. Its slow query
  // then owes another completed draw before the next compile can start.
  expect(result.events.find(event => event.kind === 'ready' && event.id === 1)?.frame).toBe(firstUse?.frame);
  expect(result.events.find(event => event.kind === 'compile' && event.id === 4)?.frame).toBe(2);
  for (const frame of new Set(result.events.map(event => event.frame))) {
    expect(result.events.filter(event => event.frame === frame && event.kind === 'compile').length).toBeLessThanOrEqual(4);
    expect(result.events.filter(event => event.frame === frame && event.kind === 'uniforms').length).toBeLessThanOrEqual(4);
    expect(result.events.filter(event => event.frame === frame && event.cost >= 6).length).toBeLessThanOrEqual(1);
  }
  expect(result.events.filter(event => event.kind === 'uniforms')).toHaveLength(11);
});

test('owner cancellation during a link fence admits no following compile', async () => {
  const result = await issue({ compileMs: 12, queryMs: 12, cancel: true });
  expect(result.cancelAt).toBeGreaterThan(0); expect(result.events.length).toBe(result.cancelAt);
  expect(result.events.filter(event => event.kind === 'compile').length).toBeLessThan(8);
});

test.each([{ queryMs: 1, frame: 1 }, { queryMs: 12, frame: 2 }])(
  'completed queries retain the held budget for cached jobs: %o', async ({ queryMs, frame }) => {
    const result = await issue({ compileMs: 3, initialMs: 12, queryMs, shared: true });
    expect(result.events.filter(event => event.kind === 'compile').map(event => event.frame)).toEqual([0, frame, frame, frame, frame, frame, frame, frame]);
    expect(result.events.filter(event => event.kind === 'uniforms')).toHaveLength(1);
    expect(result.cachedDuringIssue).toBe(7);
  });

test('a first-use refusal retains its exact error and admits no following job', async () => {
  const result = await issue({ compileMs: 2, queryMs: 1, failure: new Error('Exact first-use refusal') });
  expect(result.events.filter(event => event.kind === 'compile')).toHaveLength(1);
  expect(result.events.filter(event => event.kind === 'uniforms')).toHaveLength(1);
});
