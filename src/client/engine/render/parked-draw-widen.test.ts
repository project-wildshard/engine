import { afterEach, expect, test, vi } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PCFShadowMap, PerspectiveCamera, Scene, WebGLRenderTarget, type Camera, type Object3D, type Vector4, type WebGLRenderTarget as Target } from 'three';
import { warmParkedDraws, type ParkedDrawRenderer, type ParkedDrawWiden } from './parkedDraws';

const isMesh = (object: Object3D): object is Mesh => object instanceof Mesh;
afterEach(() => { vi.restoreAllMocks(); });

/** A hidden root of `count` meshes, each with its own material, so a one-material budget plans one slice per mesh; with
 *  `copies`, one material and a geometry each (copies a widened draw may merge: they build no new program). */
function fixture(count: number, copies = false) {
  const scene = new Scene(), camera = new PerspectiveCamera(), root = new Group(), geometry = new BoxGeometry(), shared = new MeshBasicMaterial();
  root.visible = false; scene.add(camera, root);
  const meshes = Array.from({ length: count }, () => { const mesh = new Mesh(copies ? new BoxGeometry() : geometry, copies ? shared : new MeshBasicMaterial()); root.add(mesh); return mesh; });
  const target = new WebGLRenderTarget(8, 8), draws: number[] = [];
  let current: Target | null = null, scissorTest = false;
  const renderer: ParkedDrawRenderer = {
    render: (world: Object3D, view: Camera) => { let n = 0; world.traverseVisible(object => { if (isMesh(object) && object.layers.test(view.layers)) n++; }); draws.push(n); },
    shadowMap: { autoUpdate: true, needsUpdate: false, type: PCFShadowMap },
    getRenderTarget: () => current, setRenderTarget: value => { current = value as Target | null; },
    getActiveCubeFace: () => 0, getActiveMipmapLevel: () => 0,
    getScissor: (value: Vector4) => value.set(0, 0, 8, 8), setScissor: () => undefined,
    getScissorTest: () => scissorTest, setScissorTest: (value: boolean) => { scissorTest = value; },
  };
  return { scene, camera, root, meshes, target, renderer, draws, dispose: (): void => { target.dispose(); geometry.dispose(); shared.dispose(); for (const mesh of meshes) { mesh.material.dispose(); mesh.geometry.dispose(); } } };
}
/** Each pause is one completed frame, `frames[i]` ms after the previous one (the last repeats). */
function frames(intervals: readonly number[]): () => Promise<void> {
  let now = 1000, at = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  return () => { now += intervals[Math.min(at++, intervals.length - 1)] ?? 0; return Promise.resolve(); };
}
const widen: ParkedDrawWiden = { max: 8, frameMs: 35, bytes: 64 * 1024 * 1024 };

test('without a widen every planned slice keeps its own completed frame', async () => {
  const f = fixture(12);
  try {
    let pauses = 0;
    const drawn = await warmParkedDraws(f.renderer, f.scene, f.camera, f.target, f.root, () => true,
      () => { pauses++; return Promise.resolve(); }, { budget: { drawables: 1, newMaterials: 1 } });
    expect(drawn).toBe(12); expect(pauses).toBe(12); expect(f.draws).toEqual(Array.from({ length: 12 }, () => 1));
  } finally { f.dispose(); }
});

test('on-cadence frames widen the draw (1, 1, 2, 4, 8 slices), each frame one submission', async () => {
  const f = fixture(30, true);
  try {
    const pause = frames([20]);
    const drawn = await warmParkedDraws(f.renderer, f.scene, f.camera, f.target, f.root, () => true, pause,
      { budget: { drawables: 1, newMaterials: 1 }, widen });
    expect(drawn).toBe(30);
    // the first frame has no interval yet; then the width doubles per on-cadence frame up to the max
    expect(f.draws).toEqual([1, 1, 2, 4, 8, 8, 6]);
    expect(f.draws.reduce((sum, n) => sum + n, 0)).toBe(30);
  } finally { f.dispose(); }
});

test('a late frame halves the width, and the byte cap still bounds a merged draw', async () => {
  const f = fixture(20, true);
  try {
    const pause = frames([20, 20, 20, 60, 20]);
    await warmParkedDraws(f.renderer, f.scene, f.camera, f.target, f.root, () => true, pause, { budget: { drawables: 1, newMaterials: 1 }, widen });
    // widths 1 (no interval yet), 1, 2, 4; the 60 ms frame after the 4 halves it to 2
    expect(f.draws.slice(0, 5)).toEqual([1, 1, 2, 4, 2]);
    expect(f.draws.reduce((sum, n) => sum + n, 0)).toBe(20);
  } finally { f.dispose(); }
  const g = fixture(10, true);
  try {
    // a box's buffers are a few KiB each: a cap of one box's bytes keeps every draw at one slice
    const pause = frames([20]);
    await warmParkedDraws(g.renderer, g.scene, g.camera, g.target, g.root, () => true, pause,
      { budget: { drawables: 1, newMaterials: 1 }, widen: { ...widen, bytes: 1 } });
    expect(g.draws).toEqual(Array.from({ length: 10 }, () => 1));
  } finally { g.dispose(); }
});

test('D12: a slice that builds a new program never joins a widened draw', async () => {
  const f = fixture(12);
  try {
    // every mesh has its own material: on-cadence frames would widen, but each slice brings a new program
    await warmParkedDraws(f.renderer, f.scene, f.camera, f.target, f.root, () => true, frames([20]), { budget: { drawables: 1, newMaterials: 1 }, widen });
    expect(f.draws).toEqual(Array.from({ length: 12 }, () => 1));
  } finally { f.dispose(); }
});
