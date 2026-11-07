import { expect, test, vi } from 'vitest';
import { BoxGeometry, BufferAttribute, BufferGeometry, DirectionalLight, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, PCFShadowMap, PerspectiveCamera, PointLight, Scene, Vector4, WebGLRenderer, WebGLRenderTarget, type Camera, type Material, type Object3D } from 'three';
import { Scope } from '../../../shared/engine/app/scope';
import { bindConstructionEnvironment, withOwner } from '../../../shared/engine/app/ownership';
import { ViewmodelRoot } from '../render/viewmodel';
import { warmParkedDraws, type ParkedDrawBudget, type ParkedDrawRenderer } from '../render/parkedDraws';
import { prepareSceneRoots } from '../render/precompile';
import { SHADOW_LAYER } from '../core/shadowLayer';

/** The slicing rules at one native unit a slice (the WebKit live budget before G782 raised it to two, D152). */
const ONE_UNIT: ParkedDrawBudget = { drawables: 8, newMaterials: 1, newBindings: 1, bufferBytes: 256 * 1024 };

const isMesh = (object: Object3D): object is Mesh => object instanceof Mesh;

test('resident construction routes camera models to its runtime child stage across awaits', async () => {
  const page = new Scope('page'), resident = page.child('resident'), runtime = resident.child('runtime');
  const models = new ViewmodelRoot(), stage = models.stage(runtime), leave = bindConstructionEnvironment(resident, () => () => undefined);
  const staticModel = new Group(), yieldedModel = new Group(), roadModel = new Group();
  try {
    withOwner(resident, () => { models.add(staticModel); });
    await Promise.resolve(); models.add(yieldedModel);
    withOwner(page, () => { models.add(roadModel); });
    expect(staticModel.parent).toBe(stage); expect(yieldedModel.parent).toBe(stage);
    expect(roadModel.parent).toBe(models); expect(stage.visible).toBe(false);
    runtime.dispose(); expect(stage.parent).toBeNull(); expect(roadModel.parent).toBe(models);
  } finally { leave(); page.dispose(); }
});

function fixture() {
  const scope = new Scope('prepared-kit'), scene = new Scene(), camera = new PerspectiveCamera(), models = new ViewmodelRoot();
  camera.add(models); scene.add(camera);
  const stage = models.stage(scope), geometry = new BoxGeometry(), material = new MeshBasicMaterial({ transparent: true });
  const weapons = [new Group(), new Group()];
  const alternate = material.clone();
  const parts = weapons.map((weapon, index) => { const mesh = new Mesh(geometry, index === 0 ? material : alternate); weapon.add(mesh); weapon.visible = false; return mesh; });
  const hidden = new Mesh(geometry, material); hidden.visible = false; weapons[0]?.add(hidden);
  withOwner(scope, () => { models.add(...weapons); });
  const target = new WebGLRenderTarget(8, 8), prior = new WebGLRenderTarget(3, 3), scissor = new Vector4(1, 2, 3, 4);
  let current: WebGLRenderTarget | null = prior;
  let scissorTest = false;
  const draws: Mesh[][] = [];
  const render = vi.fn((world: Object3D, view: Camera) => {
    const visible: Mesh[] = [];
    world.traverseVisible(object => { if (isMesh(object) && object.layers.test(view.layers)) visible.push(object); });
    draws.push(visible);
    expect(current).toBe(target); expect(target.scissor.toArray()).toEqual([0, 0, 1, 1]); expect(target.scissorTest).toBe(true);
  });
  const renderer: ParkedDrawRenderer = {
    render, shadowMap: { autoUpdate: true, needsUpdate: false, type: PCFShadowMap },
    getRenderTarget: () => current, setRenderTarget: value => {
      if (value === target) current = target;
      else if (value === prior) current = prior;
      else if (value === null) current = null;
      else throw new Error('Unexpected preparation target');
    },
    getActiveCubeFace: () => 0, getActiveMipmapLevel: () => 0,
    getScissor: value => value.copy(scissor), setScissor: () => undefined,
    getScissorTest: () => scissorTest, setScissorTest: value => { scissorTest = value; },
  };
  const restored = (): void => {
    expect(stage.visible).toBe(false); expect(weapons.map(weapon => weapon.visible)).toEqual([false, false]);
    expect(hidden.visible).toBe(false); expect(current).toBe(prior); expect(target.scissorTest).toBe(false);
    expect(parts.map(part => part.layers.mask)).toEqual([1, 1]);
    expect(parts.every(part => !part.frustumCulled)).toBe(true);
  };
  const dispose = (): void => { scope.dispose(); target.dispose(); prior.dispose(); geometry.dispose(); material.dispose(); alternate.dispose(); };
  return { scope, models, stage, scene, camera, renderer, target, draws, parts, hidden, render, restored, dispose };
}

test('parked camera equipment draws in paced slices without revealing hidden detail or changing live flags', async () => {
  const f = fixture();
  try {
    expect(f.models.staged(f.scope)).toBe(f.stage);
    let pauses = 0;
    const progress: number[][] = [];
    const drawn = await warmParkedDraws(f.renderer, f.scene, f.camera, f.target, f.stage, () => true,
      () => { pauses++; f.restored(); return Promise.resolve(); }, { revealChildren: true, budget: { drawables: 1, newMaterials: 1 },
        onProgress: (done, total) => { f.restored(); progress.push([done, total]); } });
    expect(progress).toEqual([[0, 2], [1, 2], [2, 2]]);
    expect(drawn).toBe(2); expect(pauses).toBe(2); expect(f.draws).toEqual(f.parts.map(part => [part]));
    f.restored();
    f.scope.dispose(); expect(f.models.staged(f.scope)).toBeUndefined();
  } finally { f.dispose(); }
});

test('ordinary parked roots retain hidden children and cancellation stops before the next equipment draw', async () => {
  const f = fixture();
  try {
    // G743: a hidden child's pipeline is warmed with its ancestors shown for that draw only; its flags are restored after
    expect(await warmParkedDraws(f.renderer, f.scene, f.camera, f.target, f.stage, () => true, () => Promise.resolve())).toBe(2);
    f.restored();
    const before = f.draws.length;
    let live = true;
    await expect(warmParkedDraws(f.renderer, f.scene, f.camera, f.target, f.stage, () => live,
      () => { f.restored(); return Promise.resolve(); }, { revealChildren: true, budget: { drawables: 1, newMaterials: 1 },
        onProgress: done => { f.restored(); if (done === 1) live = false; } })).rejects.toThrow('owner left');
    expect(f.draws.length - before).toBe(1); f.restored();
  } finally { f.dispose(); }
});

test('a failed equipment draw restores every live visibility before returning', async () => {
  const f = fixture(), error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    f.render.mockImplementation(() => { throw new Error('driver failed'); });
    expect(await warmParkedDraws(f.renderer, f.scene, f.camera, f.target, f.stage, () => true, () => Promise.resolve(), { revealChildren: true })).toBe(0);
    f.restored();
  } finally { error.mockRestore(); f.dispose(); }
});

test('camera equipment borrows the parked world lighting without drawing its world geometry', async () => {
  const f = fixture(), world = new Group(), light = new PointLight(), geometry = new BoxGeometry(), material = new MeshBasicMaterial();
  const mesh = new Mesh(geometry, material); world.add(light, mesh); world.visible = false; f.scene.add(world);
  const original = f.render.getMockImplementation();
  if (original === undefined) throw new Error('Missing renderer fixture');
  f.render.mockImplementation((scene, camera) => {
    expect(world.visible).toBe(true); expect(light.layers.test(camera.layers)).toBe(true);
    original(scene, camera);
  });
  try {
    await warmParkedDraws(f.renderer, f.scene, f.camera, f.target, f.stage, () => true,
      () => { expect(world.visible).toBe(false); expect(light.layers.mask).toBe(1); f.restored(); return Promise.resolve(); },
      { revealChildren: true, lightingRoot: world });
    expect(f.draws.flat()).not.toContain(mesh); expect(f.draws.flat()).toEqual(f.parts);
    expect(world.visible).toBe(false); expect(light.layers.mask).toBe(1);
  } finally { f.dispose(); geometry.dispose(); material.dispose(); }
});

test('the warming view never clones camera equipment or prepares unused material copies', async () => {
  const f = fixture(), clone = vi.spyOn(f.models, 'clone').mockImplementation(() => { throw new Error('Unexpected camera subtree clone'); });
  const render = f.render.getMockImplementation();
  if (render === undefined) throw new Error('Missing renderer fixture');
  f.render.mockImplementation((scene, view) => {
    expect(view).toBeInstanceOf(PerspectiveCamera);
    expect(view.projectionMatrix.equals(f.camera.projectionMatrix)).toBe(true);
    expect(view.children).toHaveLength(0); render(scene, view);
  });
  try {
    expect(await warmParkedDraws(f.renderer, f.scene, f.camera, f.target, f.stage, () => true,
      () => Promise.resolve(), { revealChildren: true })).toBe(2);
    expect(clone).not.toHaveBeenCalled(); f.restored();
  } finally { clone.mockRestore(); f.dispose(); }
});

test.each([false, true])('static bounds prepare in painted CPU slices before any native draw (cancel=%s)', async cancel => {
  const f = fixture(), first = f.parts[0];
  if (first === undefined) throw new Error('Missing parked fixture part');
  const source = new BufferGeometry(), positions = new Float32Array(65538 * 3);
  for (let i = 0; i < positions.length; i++) positions[i] = Math.sin(i) * 10;
  source.setAttribute('position', new BufferAttribute(positions, 3));
  const geometry = first.geometry.copy(source), expected = geometry.clone();
  source.dispose(); expected.computeBoundingSphere();
  let clock = 0, current = true, boundsPauses = 0;
  const time = vi.spyOn(performance, 'now').mockImplementation(() => { clock += 7; return clock; });
  try {
    const pending = warmParkedDraws(f.renderer, f.scene, f.camera, f.target, f.stage, () => current, () => {
      f.restored();
      if (f.draws.length === 0) { boundsPauses++; if (cancel) current = false; }
      return Promise.resolve();
    }, { revealChildren: true });
    if (cancel) {
      await expect(pending).rejects.toThrow('bounds owner left');
      expect(geometry.boundingSphere).toBeNull(); expect(f.draws).toEqual([]);
    } else {
      expect(await pending).toBe(2); expect(boundsPauses).toBeGreaterThan(1);
      expect(geometry.boundingSphere).toEqual(expected.boundingSphere);
      expect(geometry.boundingBox).toBeNull();
      const position: unknown = geometry.getAttribute('position');
      if (!(position instanceof BufferAttribute)) throw new Error('Missing parked position');
      expect(position.array).toEqual(positions);
    }
  } finally { time.mockRestore(); expected.dispose(); f.dispose(); }
});

test.each([false, true])('static instance spheres publish exactly after sliced scans (cancel=%s)', async cancel => {
  const f = fixture(), geometry = new BoxGeometry(), material = new MeshBasicMaterial();
  const mesh = new InstancedMesh(geometry, material, 2048), oracle = new InstancedMesh(geometry, material, 2048), matrix = new Matrix4();
  for (let i = 0; i < mesh.count; i++) mesh.setMatrixAt(i, matrix.makeTranslation(i * 2, i % 7, -i));
  oracle.instanceMatrix = mesh.instanceMatrix; oracle.computeBoundingSphere(); f.stage.add(mesh);
  let current = true, boundsPauses = 0, clock = 0;
  const time = vi.spyOn(performance, 'now').mockImplementation(() => { clock += 7; return clock; });
  try {
    const pending = warmParkedDraws(f.renderer, f.scene, f.camera, f.target, f.stage, () => current, () => {
      f.restored();
      if (f.draws.length === 0) { boundsPauses++; if (cancel) current = false; }
      return Promise.resolve();
    }, { revealChildren: true });
    if (cancel) { await expect(pending).rejects.toThrow('bounds owner left'); expect(mesh.boundingSphere).toBeNull(); expect(f.draws).toEqual([]); }
    else { expect(await pending).toBe(3); expect(boundsPauses).toBeGreaterThan(1); expect(mesh.boundingSphere).toEqual(oracle.boundingSphere); }
  } finally { time.mockRestore(); mesh.dispose(); oracle.dispose(); geometry.dispose(); material.dispose(); f.dispose(); }
});

test('streamed roots compile without exposing or drawing them', async () => {
  const f = fixture(), root = new Group(), geometry = new BoxGeometry(), material = new MeshBasicMaterial(), alternate = material.clone();
  const first = new Mesh(geometry, material), second = new Mesh(geometry, alternate), hidden = new Mesh(geometry, material);
  hidden.visible = false; root.add(first, second, hidden);
  const renderer: unknown = Object.create(WebGLRenderer.prototype);
  if (!(renderer instanceof WebGLRenderer)) throw new Error('Missing renderer');
  for (const [key, value] of Object.entries({ ...f.renderer, info: { programs: [] }, extensions: { has: () => false },
    properties: { get: () => ({}), has: () => false }, compile: () => undefined, initTexture: () => undefined })) Reflect.set(renderer, key, value);
  const current = true;
  const prepare = () => prepareSceneRoots(renderer, f.camera, f.scene, f.target, [root], () => current, () => {
    // A root unpublished by detachment must remain invisible between warm slices.
    expect(root.visible).toBe(root.parent === null); expect(hidden.visible).toBe(false); f.restored();
    return Promise.resolve();
  });
  try {
    await prepare();
    expect(f.draws).toEqual([]);
    expect(root.parent).toBeNull(); expect(root.visible).toBe(true); expect(hidden.visible).toBe(false);
    expect([first.layers.mask, second.layers.mask]).toEqual([1, 1]); f.restored();
  } finally { f.dispose(); geometry.dispose(); material.dispose(); alternate.dispose(); }
});

test('first-draw census ignores a hidden retained world and its shadow targets', async () => {
  const f = fixture(), kept = new Group(), light = new DirectionalLight(), target = new WebGLRenderTarget(8, 8);
  kept.visible = false; light.castShadow = true; light.shadow.map = target; kept.add(light); f.scene.add(kept);
  const mapSize = light.shadow.mapSize.toArray();
  const first = f.parts[0]; if (first === undefined) throw new Error('Missing fixture mesh');
  let layerReads = 0;
  for (let index = 0; index < 64; index++) {
    const part = new Mesh(first.geometry, first.material);
    const layers = part.layers;
    Object.defineProperty(part, 'layers', { get: () => { layerReads++; return layers; } });
    kept.add(part);
  }
  const render = f.render.getMockImplementation();
  if (render === undefined) throw new Error('Missing renderer fixture');
  f.render.mockImplementation((scene, camera) => {
    expect(light.shadow.map).toBe(target); expect(light.shadow.mapSize.toArray()).toEqual(mapSize);
    render(scene, camera);
  });
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    expect(await warmParkedDraws(f.renderer, f.scene, f.camera, f.target, f.stage, () => true,
      () => Promise.resolve(), { revealChildren: true, budget: { drawables: 1, newMaterials: 1 } })).toBe(2);
    expect(layerReads).toBe(0); expect(error).not.toHaveBeenCalled();
    expect(f.draws.flat()).toEqual(f.parts); f.restored();
  } finally { error.mockRestore(); target.dispose(); f.dispose(); }
});

test('first-draw census observes visibility and shadow casters changed between slices', async () => {
  const f = fixture(), peer = new Group(), light = new DirectionalLight(), target = new WebGLRenderTarget(8, 8);
  const first = f.parts[0]; if (first === undefined) throw new Error('Missing fixture mesh');
  const caster = new Mesh(first.geometry, first.material); caster.layers.set(SHADOW_LAYER); caster.castShadow = true;
  light.castShadow = true; light.shadow.map = target; peer.add(light, caster); peer.visible = false; f.scene.add(peer);
  let calls = 0;
  const render = f.render.getMockImplementation();
  if (render === undefined) throw new Error('Missing renderer fixture');
  f.render.mockImplementation((scene, camera) => {
    if (calls === 0) expect(light.shadow.map).toBe(target);
    else {
      expect(light.shadow.map).not.toBe(target); expect(light.layers.test(camera.layers)).toBe(true);
      expect(caster.layers.mask).toBe(0);
    }
    calls++; render(scene, camera);
  });
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    expect(await warmParkedDraws(f.renderer, f.scene, f.camera, f.target, f.stage, () => true,
      () => { expect(light.shadow.map).toBe(target); expect(light.layers.mask).toBe(1); expect(caster.layers.mask).toBe(1 << SHADOW_LAYER);
        peer.visible = true; return Promise.resolve(); }, { revealChildren: true, budget: { drawables: 1, newMaterials: 1 } })).toBe(2);
    expect(calls).toBe(2); expect(error).not.toHaveBeenCalled(); expect(f.draws.flat()).toEqual(f.parts); f.restored();
  } finally { error.mockRestore(); target.dispose(); f.dispose(); }
});


test('live preparation submits one drawable per pause and preserves every material', async () => {
  const f = fixture();
  try {
    const seen = new Set<Material>();
    const drawn = await warmParkedDraws(f.renderer, f.scene, f.camera, f.target, f.stage, () => true,
      () => { f.restored(); return Promise.resolve(); }, { revealChildren: true, budget: ONE_UNIT });
    for (const batch of f.draws) {
      const fresh = new Set(batch.flatMap(mesh => Array.isArray(mesh.material) ? mesh.material : [mesh.material]).filter(material => !seen.has(material)));
      expect(batch).toHaveLength(1); expect(fresh.size).toBeLessThanOrEqual(1);
      for (const material of fresh) seen.add(material);
    }
    expect(drawn).toBe(2); expect(f.draws.flat()).toEqual(f.parts); f.restored();
  } finally { f.dispose(); }
});
