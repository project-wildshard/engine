import { expect, test, vi } from 'vitest';
import { BackSide, BoxGeometry, DoubleSide, FrontSide, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, WebGLRenderer, type Side } from 'three';
import { runPrecompile, sceneJobs } from './precompile';
import { noteFrameDrawn, setBuildHeld } from '../../../shared/engine/core/framePacing';
import { linkedGl } from '../../../test/engine/linkedGl';

test.each([{ cost: 12, cancel: false, singleAfter: false }, { cost: 12, cancel: true, singleAfter: false },
  { cost: 0, cancel: false, singleAfter: false }, { cost: 12, cancel: false, singleAfter: true }])(
  'two-sided preparation separates native face units (cost $cost, cancel $cancel, singleAfter $singleAfter)', async ({ cost, cancel, singleAfter }) => {
  const renderer: unknown = Object.create(WebGLRenderer.prototype);
  if (!(renderer instanceof WebGLRenderer)) throw new Error('Missing renderer');
  const scene = new Scene(), geometry = new BoxGeometry();
  const material = new MeshBasicMaterial({ transparent: true, side: DoubleSide });
  const original = new Mesh(geometry, material); scene.add(original);
  let now = 1000, frame = 0, current = true;
  const issued: { side: Side; frame: number }[] = [], costs: number[] = [];
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  const fields: Record<string, unknown> = {
    info: { programs: [], render: { frame: 0 } }, extensions: { has: () => false },
    properties: { get: () => ({}), has: () => false }, getContext: linkedGl, getRenderTarget: () => null, setRenderTarget: () => undefined,
    compile: (root: Scene): void => {
      const start = now;
      root.traverse(object => {
        if (!(object instanceof Mesh) || !(object.material instanceof MeshBasicMaterial)) return;
        const borrowed = object.material, prior = borrowed.side;
        const sides = borrowed.transparent && prior === DoubleSide && !borrowed.forceSinglePass ? [BackSide, FrontSide] : [prior];
        for (const side of sides) {
          if (prior === DoubleSide && sides.length === 2) { borrowed.side = side; borrowed.needsUpdate = true; }
          issued.push({ side, frame }); now += cost;
        }
        borrowed.side = prior;
      });
      costs.push(now - start);
    },
  };
  for (const [key, value] of Object.entries(fields)) Reflect.set(renderer, key, value);
  noteFrameDrawn(now, now, 30); setBuildHeld(true);
  try {
    const warm = runPrecompile(renderer, new PerspectiveCamera(), sceneJobs(scene, null, 1).jobs, 1,
      undefined, [], () => current, true, () => {
        expect(material.side).toBe(DoubleSide); expect(material.forceSinglePass).toBe(frame > 0 && singleAfter);
        frame++; now = 1000 + frame * (1000 / 30); noteFrameDrawn(now, now, 30);
        if (singleAfter && frame === 1) { material.forceSinglePass = true; material.needsUpdate = true; }
        if (cancel) current = false;
        return Promise.resolve();
      });
    await (cancel ? expect(warm).rejects.toThrow('Shader warm-up owner left') : warm);
    expect(issued).toEqual(cancel ? [{ side: BackSide, frame: 0 }]
      : [{ side: BackSide, frame: 0 }, { side: singleAfter ? DoubleSide : FrontSide, frame: cost === 0 ? 0 : 1 }]);
    expect(costs).toEqual(cancel ? [cost] : [cost, cost]);
    expect(material.version).toBe(cancel ? 1 : 2);
    expect(material.side).toBe(DoubleSide); expect(material.transparent).toBe(true);
    expect(original.material).toBe(material); expect(original.parent).toBe(scene);
  } finally { setBuildHeld(false); clock.mockRestore(); noteFrameDrawn(Number.NEGATIVE_INFINITY); geometry.dispose(); material.dispose(); }
});

test('forced single-pass materials retain their original one-program job', () => {
  const geometry = new BoxGeometry(), material = new MeshBasicMaterial({ transparent: true, side: DoubleSide, forceSinglePass: true });
  const scene = new Scene(), mesh = new Mesh(geometry, material); scene.add(mesh);
  try {
    const { jobs, materials } = sceneJobs(scene, null, 6);
    expect(materials).toBe(1); expect(jobs).toHaveLength(1);
    expect(jobs[0]?.materialSide).toBeUndefined();
    expect(material.side).toBe(DoubleSide); expect(material.forceSinglePass).toBe(true); expect(material.version).toBe(0);
  } finally { geometry.dispose(); material.dispose(); }
});

test.each([BackSide, FrontSide])('failed side %i restores the borrowed material before rejection', async side => {
  const renderer: unknown = Object.create(WebGLRenderer.prototype);
  if (!(renderer instanceof WebGLRenderer)) throw new Error('Missing renderer');
  const geometry = new BoxGeometry(), material = new MeshBasicMaterial({ transparent: true, side: DoubleSide });
  const scene = new Scene(); scene.add(new Mesh(geometry, material));
  const failure = new Error('native compile refused');
  const fields: Record<string, unknown> = {
    info: { programs: [] }, extensions: { has: () => false }, properties: { get: () => ({}), has: () => false },
    getContext: linkedGl, getRenderTarget: () => null, setRenderTarget: () => undefined,
    compile: (): void => { if (material.side === side) throw failure; },
  };
  for (const [key, value] of Object.entries(fields)) Reflect.set(renderer, key, value);
  try {
    await expect(runPrecompile(renderer, new PerspectiveCamera(), sceneJobs(scene, null, 1).jobs, 1,
      undefined, [], () => true, false, () => Promise.resolve())).rejects.toBe(failure);
    expect(material.side).toBe(DoubleSide); expect(material.forceSinglePass).toBe(false);
    expect(material.transparent).toBe(true);
  } finally { geometry.dispose(); material.dispose(); }
});
