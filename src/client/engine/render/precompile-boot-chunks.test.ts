import { expect, test, vi } from 'vitest';
import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import type { ProgramLike } from '../boot/perflog';
import { noteFrameDrawn } from '../../../shared/engine/core/framePacing';
import { linkedGl } from '../../../test/engine/linkedGl';
import { BOOT_LINK_CHUNK, runPrecompile, type CompileJob } from './precompile';

// DL21b: a boot warm-up under a loading card (parallel links, no live pacing) waits for its links a chunk at a time as it
// issues them, so the card names each chunk as it lands instead of one batch that WebKit reports only once it is whole.
test('DL21b: a boot warm-up links its programs in named chunks as it issues them', async () => {
  const renderer: unknown = Object.create(WebGLRenderer.prototype);
  if (!(renderer instanceof WebGLRenderer)) throw new Error('Renderer missing');
  const geometry = new BoxGeometry(), materials = Array.from({ length: 20 }, () => new MeshBasicMaterial());
  const jobs: CompileJob[] = materials.map((material, i) => {
    const root = new Scene(); root.add(new Mesh(geometry, material));
    return { label: `material-${i}`, root, target: null, rt: null };
  });
  const programs: ProgramLike[] = [], byMaterial = new WeakMap<MeshBasicMaterial, ProgramLike[]>();
  const events: string[] = [], details: string[] = [];
  let now = 1000, frame = 0;
  const fields: Record<string, unknown> = {
    info: { programs, render: { frame: 0 } }, extensions: { has: (name: string) => name === 'KHR_parallel_shader_compile' },
    properties: { has: () => true, get: (material: MeshBasicMaterial) => ({ programs: new Map(byMaterial.get(material)?.map(p => [`linked-${p.id}`, p])) }) },
    getContext: linkedGl, getRenderTarget: () => null, setRenderTarget: () => undefined,
    compile: (root: Scene): void => {
      root.traverse(object => {
        if (!(object instanceof Mesh) || !(object.material instanceof MeshBasicMaterial)) return;
        const id = programs.length;
        // WebKit's GPU process: a link reports done only a frame after it is asked
        let misses = 1;
        const program: ProgramLike = { type: 'test', name: `program-${id}`, cacheKey: `program-${id}`, usedTimes: 1, id, program: {},
          isReady: () => { const ready = misses-- <= 0; if (ready) events.push(`ready ${id}`); return ready; }, getUniforms: () => ({}) };
        events.push(`compile ${id}`); programs.push(program); byMaterial.set(object.material, [program]);
      });
    },
  };
  for (const [key, value] of Object.entries(fields)) Reflect.set(renderer, key, value);
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  // a loading card: no world frame is presented while it warms
  const pause = (): Promise<void> => { frame++; now = 1000 + frame * (1000 / 30); return Promise.resolve(); };
  try {
    noteFrameDrawn(Number.NEGATIVE_INFINITY);
    await runPrecompile(renderer, new PerspectiveCamera(), jobs, materials.length, (_done, _total, detail) => { details.push(detail); }, [], () => true, false, pause);
    // every program of a chunk reports linked before the next chunk is issued
    const at = (event: string): number => events.indexOf(event);
    for (let id = 0; id < BOOT_LINK_CHUNK; id++) expect(at(`ready ${id}`)).toBeLessThan(at(`compile ${BOOT_LINK_CHUNK}`));
    for (let id = BOOT_LINK_CHUNK; id < 2 * BOOT_LINK_CHUNK; id++) expect(at(`ready ${id}`)).toBeLessThan(at(`compile ${2 * BOOT_LINK_CHUNK}`));
    // the last, short chunk is waited on too
    expect(details.filter(detail => detail.includes('linking'))).toEqual([
      `20 materials · ${BOOT_LINK_CHUNK} / 20 batches · linking ${BOOT_LINK_CHUNK} · parallel`,
      `20 materials · ${2 * BOOT_LINK_CHUNK} / 20 batches · linking ${BOOT_LINK_CHUNK} · parallel`,
      `20 materials · 20 / 20 batches · linking ${20 - 2 * BOOT_LINK_CHUNK} · parallel`]);
  } finally {
    noteFrameDrawn(Number.NEGATIVE_INFINITY); clock.mockRestore();
    geometry.dispose(); for (const material of materials) material.dispose();
  }
});
