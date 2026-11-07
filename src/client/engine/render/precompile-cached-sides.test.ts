import { expect, test, vi } from 'vitest';
import { BackSide, BoxGeometry, DoubleSide, FrontSide, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, WebGLRenderer, type Side } from 'three';
import type { ProgramLike } from '../boot/perflog';
import { noteFrameDrawn, setBuildHeld } from '../../../shared/engine/core/framePacing';
import { linkedGl } from '../../../test/engine/linkedGl';
import { runPrecompile, setWarmUpHeld, type CompileJob } from './precompile';

async function faces(options: { readonly held?: boolean; readonly cost?: number; readonly custom?: boolean; readonly fresh?: boolean }) {
  const renderer: unknown = Object.create(WebGLRenderer.prototype);
  if (!(renderer instanceof WebGLRenderer)) throw new Error('Missing renderer');
  const geometry = new BoxGeometry(), material = new MeshBasicMaterial({ transparent: true, side: DoubleSide });
  const root = new Scene(); root.add(new Mesh(geometry, material));
  const programs: ProgramLike[] = [], bySide = new Map<Side, ProgramLike>();
  let now = 1000, frame = 0, cost = 0, uniforms = 0, cached = 0;
  const issued: { readonly side: Side; readonly frame: number }[] = [];
  const fields: Record<string, unknown> = {
    info: { programs, render: { frame: 0 } }, extensions: { has: () => true },
    properties: { has: () => true, get: () => ({ programs: bySide }) },
    getContext: linkedGl, getRenderTarget: () => null, setRenderTarget: () => undefined,
    compile: (): void => {
      issued.push({ side: material.side, frame }); now += cost;
      if (!bySide.has(material.side)) {
        const id = programs.length;
        const program: ProgramLike = { id, type: 'test', name: `face-${id}`, cacheKey: `face-${id}`, usedTimes: 1, program: {},
          isReady: () => true, getUniforms: () => { uniforms++; return {}; } };
        bySide.set(material.side, program); programs.push(program);
      }
    },
  };
  for (const [key, value] of Object.entries(fields)) Reflect.set(renderer, key, value);
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  const pause = (): Promise<void> => {
    expect(material.side).toBe(DoubleSide);
    frame++; now = 1000 + frame * (1000 / 30); noteFrameDrawn(now, now, 30); return Promise.resolve();
  };
  const job = (side: Side): CompileJob => ({ label: 'face', root, target: null, rt: null, materialSide: { material, side },
    ...(options.custom === true ? { prepare: (): void => undefined } : {}) });
  try {
    noteFrameDrawn(now, now, 30); setBuildHeld(true); setWarmUpHeld(true);
    await runPrecompile(renderer, new PerspectiveCamera(), [job(BackSide), job(FrontSide)], 1, undefined, [], () => true, true, pause);
    expect(uniforms).toBe(2); expect(programs).toHaveLength(2);
    if (options.fresh === true) bySide.clear();
    now = 1000; frame = 0; issued.length = 0; cost = options.cost ?? 3;
    noteFrameDrawn(now, now, 30); setBuildHeld(options.held !== false); setWarmUpHeld(options.held !== false);
    const jobs = Array.from({ length: 9 }, (_, i) => job(i % 2 === 0 ? BackSide : FrontSide));
    await runPrecompile(renderer, new PerspectiveCamera(), jobs, 1, undefined, [], () => true, true, pause, undefined,
      (phase, _ms, units) => { if (phase === 'cached-compile') cached = units; }, 6);
    expect(material.side).toBe(DoubleSide); expect(material.version).toBe(11);
    return { issued, uniforms, programs: programs.length, cached };
  } finally { setBuildHeld(false); setWarmUpHeld(false); noteFrameDrawn(Number.NEGATIVE_INFINITY); clock.mockRestore(); geometry.dispose(); material.dispose(); }
}

test('already resolved faces share only the held native budget without another first-use query', async () => {
  const result = await faces({});
  expect(result.issued.map(row => row.frame)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1]);
  expect(result.issued.map(row => row.side)).toEqual([BackSide, FrontSide, BackSide, FrontSide, BackSide, FrontSide, BackSide, FrontSide, BackSide]);
  expect(result.cached).toBe(9); expect(result.uniforms).toBe(2); expect(result.programs).toBe(2);
});

test('moving frames keep the explicit face slice', async () => {
  const result = await faces({ held: false });
  expect(result.issued.map(row => row.frame)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4]); expect(result.cached).toBe(0);
});

test('slow cached faces remain separate native units', async () => {
  const result = await faces({ cost: 12 });
  expect(result.issued.map(row => row.frame)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]); expect(result.cached).toBe(0);
});

test('custom face preparation remains unknown native work', async () => {
  const result = await faces({ custom: true });
  expect(result.issued.map(row => row.frame)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4]); expect(result.cached).toBe(0);
});

test('a replaced physical face program still resolves its own first use', async () => {
  const result = await faces({ fresh: true });
  expect(result.uniforms).toBe(4); expect(result.programs).toBe(4); expect(result.cached).toBeLessThan(9);
});
