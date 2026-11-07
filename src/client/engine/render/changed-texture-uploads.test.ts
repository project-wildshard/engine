import { expect, test, vi } from 'vitest';
import { BatchedMesh, Bone, BoxGeometry, BufferGeometry, DataTexture, Group, Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, Skeleton, type Texture, type TextureSource, WebGLRenderer } from 'three';
import type { Renderer } from './renderer';
import { ChangedBatchedMesh, trackPaletteTexture, trackSkeletonTextureUploads } from './changedTextureUploads';
import { installTextureUploadEvents, onceTextureUploaded, type TextureUploadRenderer } from './textureUploadEvents';
import { drawHooks } from './drawHooks';

function words(texture: DataTexture): Uint32Array {
  const data = texture.image.data;
  if (data === null) throw new Error('Missing palette bytes');
  return new Uint32Array(data.buffer, data.byteOffset, data.byteLength / 4);
}
/** Native r186 source/texture completion order, without a GL/context fake. */
function driver(initial: DataTexture) {
  const rows = new WeakMap<object, { __version?: number }>(), gpu = new WeakMap<TextureSource<unknown>, Uint32Array>();
  const get = (object: unknown): { __version?: number } => {
    if (typeof object !== 'object' || object === null) throw new Error('Missing native property owner');
    let row = rows.get(object); if (row === undefined) { row = {}; rows.set(object, row); } return row;
  };
  const state = { texture: initial, uploads: 0, fail: false };
  const upload = function upload(this: TextureUploadRenderer): void {
    const texture = state.texture, source = texture.source;
    this.properties.get(texture);
    if (state.fail) throw new Error('native draw failure');
    if (!gpu.has(source) || get(source).__version !== source.version) {
      if (source.dataReady) { gpu.set(source, words(texture).slice()); state.uploads++; }
      get(source).__version = source.version; texture.onUpdate?.(texture);
    }
    get(texture).__version = texture.version;
  };
  const renderer: TextureUploadRenderer & Pick<Renderer, 'renderBufferDirect'> = {
    properties: { get }, initTexture: upload, render: () => undefined, renderBufferDirect: upload,
  };
  installTextureUploadEvents(renderer);
  const camera = new PerspectiveCamera(), scene = new Scene(), geometry = new BufferGeometry(), material = new MeshBasicMaterial(), mesh = new Mesh(geometry, material);
  return { state, renderer, gpu,
    draw: () => { renderer.renderBufferDirect(camera, scene, geometry, material, mesh, { start: 0, count: 3, materialIndex: 0 }); },
    dispose: () => { geometry.dispose(); material.dispose(); },
  };
}

test('unchanged words skip Source revisions while Texture versions and exact changed bits remain native', () => {
  const texture = new DataTexture(new Float32Array(16), 2, 2), source = texture.source, uuid = source.uuid;
  const d = driver(texture), random = vi.spyOn(Math, 'random');
  try {
    trackPaletteTexture(texture); trackPaletteTexture(texture);
    expect(random).not.toHaveBeenCalled(); expect(texture.source).toBe(source); expect(source.uuid).toBe(uuid);
    texture.needsUpdate = true; d.draw(); const version = texture.version, revision = source.version;
    for (let frame = 0; frame < 30; frame++) { texture.needsUpdate = true; d.draw(); }
    expect(texture.version).toBe(version + 30); expect(source.version).toBe(revision); expect(d.state.uploads).toBe(1);
    for (const bits of [0x80000000, 0x7fc00001, 0x7fc00002]) {
      words(texture)[0] = bits; texture.needsUpdate = true; d.draw();
      expect(d.gpu.get(source)).toEqual(words(texture));
    }
    expect(d.state.uploads).toBe(4); expect(drawHooks(d.renderer).uploads).toBeUndefined();
  } finally { random.mockRestore(); d.dispose(); texture.dispose(); }
});

test('pending writes, failed native draws and replacement storage cannot be mistaken for an uploaded image', () => {
  const texture = new DataTexture(new Uint32Array(4), 2, 2), d = driver(texture);
  try {
    trackPaletteTexture(texture); texture.needsUpdate = true; d.draw();
    words(texture)[0] = 2; texture.needsUpdate = true;
    words(texture)[0] = 3; texture.needsUpdate = true; d.state.fail = true;
    expect(() => { d.draw(); }).toThrow('native draw failure'); expect(d.state.uploads).toBe(1);
    expect(drawHooks(d.renderer).uploads).toBeTypeOf('function');
    d.state.fail = false; texture.needsUpdate = true; d.draw(); expect(d.gpu.get(texture.source)?.[0]).toBe(3);
    words(texture)[0] = 0; texture.needsUpdate = true; d.draw(); expect(d.gpu.get(texture.source)?.[0]).toBe(0);
    texture.image = { data: new Uint32Array([9, 8, 7, 6]), width: 2, height: 2 };
    texture.needsUpdate = true; d.draw(); expect(d.gpu.get(texture.source)).toEqual(words(texture));
    expect(d.state.uploads).toBe(4);
  } finally { d.dispose(); texture.dispose(); }
});

test('existing upload callbacks and allocation-only sources retain native invalidation and receiver', () => {
  const texture = new DataTexture(new Uint32Array(4), 2, 2), d = driver(texture);
  const callback = vi.fn(function uploaded(this: DataTexture, actual: Texture): void { expect(this).toBe(texture); expect(actual).toBe(texture); });
  try {
    texture.onUpdate = callback; trackPaletteTexture(texture);
    for (let i = 0; i < 3; i++) { texture.needsUpdate = true; d.draw(); }
    expect(texture.onUpdate).toBe(callback); expect(callback).toHaveBeenCalledTimes(3); expect(d.state.uploads).toBe(3);
    texture.onUpdate = null; texture.source.dataReady = false; texture.needsUpdate = true; d.draw();
    texture.source.dataReady = true; texture.needsUpdate = true; d.draw(); expect(d.state.uploads).toBe(4);
  } finally { d.dispose(); texture.dispose(); }
});

test('adding a callback after a cached upload retains each native copy before the callback mutates data', () => {
  const texture = new DataTexture(new Uint32Array(4), 2, 2), d = driver(texture);
  const callback = vi.fn((actual: Texture) => {
    expect(actual).toBe(texture); words(texture)[0] = (words(texture)[0] ?? 0) + 1;
  });
  try {
    trackPaletteTexture(texture); texture.needsUpdate = true; d.draw();
    texture.onUpdate = callback;
    for (let frame = 0; frame < 3; frame++) {
      const before = words(texture).slice(); texture.needsUpdate = true; d.draw();
      expect(d.gpu.get(texture.source)).toEqual(before);
    }
    expect(texture.onUpdate).toBe(callback); expect(callback).toHaveBeenCalledTimes(3); expect(d.state.uploads).toBe(4);
    texture.onUpdate = null; texture.needsUpdate = true; d.draw();
    const uploads = d.state.uploads; texture.needsUpdate = true; d.draw(); expect(d.state.uploads).toBe(uploads);
  } finally { d.dispose(); texture.dispose(); }
});

test('a source with its own revision policy keeps that exact setter and every original request', () => {
  const texture = new DataTexture(new Uint32Array(4), 2, 2), d = driver(texture), source = texture.source;
  Object.defineProperty(source, 'needsUpdate', { configurable: true, get(): undefined { return undefined; }, set(value: unknown): void {
    if (value === true) source.version += 2;
  } });
  const descriptor = Object.getOwnPropertyDescriptor(source, 'needsUpdate');
  try {
    trackPaletteTexture(texture);
    expect(Object.getOwnPropertyDescriptor(source, 'needsUpdate')).toEqual(descriptor);
    for (let frame = 0; frame < 3; frame++) { texture.needsUpdate = true; d.draw(); }
    expect(source.version).toBe(6); expect(d.state.uploads).toBe(3);
  } finally { d.dispose(); texture.dispose(); }
});

function indirect(batch: BatchedMesh): DataTexture {
  const texture: unknown = Reflect.get(batch, '_indirectTexture');
  if (!(texture instanceof DataTexture)) throw new Error('Missing native indirect table');
  return texture;
}
function drawList(batch: BatchedMesh): unknown[] {
  return ['_multiDrawCount', '_multiDrawStarts', '_multiDrawCounts'].map(key => {
    const value: unknown = Reflect.get(batch, key);
    return value instanceof Int32Array || value instanceof Uint32Array ? Array.from(value) : value;
  });
}

test('native batch culling/order, repeated camera passes, visibility and capacity replacement stay exact', () => {
  const material = new MeshBasicMaterial(), geometry = new BoxGeometry(), native = new BatchedMesh(4, 24, 36, material), tracked = new ChangedBatchedMesh(4, 24, 36, material);
  const scene = new Scene(), camera = new PerspectiveCamera(70, 1, .1, 100), d = driver(indirect(tracked));
  const renderer: unknown = Object.create(WebGLRenderer.prototype);
  if (!(renderer instanceof WebGLRenderer)) throw new Error('Missing native renderer port');
  try {
    for (const batch of [native, tracked]) {
      const key = batch.addGeometry(geometry);
      for (const z of [-5, -10, 5]) batch.setMatrixAt(batch.addInstance(key), new Matrix4().makeTranslation(0, 0, z));
      batch.updateMatrixWorld(true);
    }
    for (let frame = 0; frame < 16; frame++) {
      camera.rotation.y = frame < 4 ? 0 : frame < 8 ? Math.PI : 0; camera.updateMatrixWorld(true);
      for (const batch of [native, tracked]) {
        if (frame === 5) batch.setVisibleAt(1, false);
        if (frame === 8) { batch.setInstanceCount(9); batch.setVisibleAt(1, true); }
        batch.onBeforeRender(renderer, scene, camera, batch.geometry, material, new Group());
      }
      expect(drawList(tracked)).toEqual(drawList(native)); expect(words(indirect(tracked))).toEqual(words(indirect(native)));
      d.state.texture = indirect(tracked); d.draw(); expect(d.gpu.get(indirect(tracked).source)).toEqual(words(indirect(native)));
    }
    expect(d.state.uploads).toBeLessThan(16); expect(d.state.uploads).toBeGreaterThan(1);
  } finally { native.dispose(); tracked.dispose(); geometry.dispose(); material.dispose(); d.dispose(); }
});

test('PF13: a sorted batch culls for the shadow camera unsorted, the native unsorted cull exactly, and the view keeps its sort', () => {
  const material = new MeshBasicMaterial(), geometry = new BoxGeometry(), native = new BatchedMesh(4, 24, 36, material), tracked = new ChangedBatchedMesh(4, 24, 36, material);
  const camera = new PerspectiveCamera(70, 1, .1, 100);
  const renderer: unknown = Object.create(WebGLRenderer.prototype);
  if (!(renderer instanceof WebGLRenderer)) throw new Error('Missing native renderer port');
  try {
    for (const batch of [native, tracked]) {
      const key = batch.addGeometry(geometry);
      // far to near along the view: a distance sort reverses them
      for (const z of [-30, -20, -10, 50]) batch.setMatrixAt(batch.addInstance(key), new Matrix4().makeTranslation(0, 0, z));
      batch.perObjectFrustumCulled = true; batch.updateMatrixWorld(true);
    }
    camera.updateMatrixWorld(true);
    native.sortObjects = false; tracked.sortObjects = true;
    native.onBeforeShadow(renderer, new Scene(), camera, camera, native.geometry, material, new Group());
    tracked.onBeforeShadow(renderer, new Scene(), camera, camera, tracked.geometry, material, new Group());
    expect(drawList(tracked)).toEqual(drawList(native)); expect(words(indirect(tracked)).slice(0, 3)).toEqual(Uint32Array.from([0, 1, 2]));
    expect(tracked.sortObjects).toBe(true);
    tracked.onBeforeRender(renderer, new Scene(), camera, tracked.geometry, material, new Group());
    expect(words(indirect(tracked)).slice(0, 3)).toEqual(Uint32Array.from([2, 1, 0]));
  } finally { native.dispose(); tracked.dispose(); geometry.dispose(); material.dispose(); }
});

test('far palettes match every native Float32 word through frozen poses, motion and data bones', () => {
  const bones = [new Bone(), new Bone()], native = new Skeleton(bones), tracked = trackSkeletonTextureUploads(new Skeleton(bones));
  native.computeBoneTexture(); tracked.computeBoneTexture();
  const texture = tracked.boneTexture;
  if (texture === null) throw new Error('Missing palette');
  const d = driver(texture);
  try {
    for (let frame = 0; frame < 60; frame++) {
      const first = bones[0], data = bones[1];
      if (first === undefined || data === undefined) throw new Error('Missing bone');
      first.matrixWorld.makeRotationY(Math.floor(frame / 3) * .1); data.matrixWorld.elements[0] = Math.floor(frame / 10);
      native.update(); tracked.update(); d.draw();
      expect(tracked.boneMatrices).toEqual(native.boneMatrices); expect(d.gpu.get(texture.source)).toEqual(words(texture));
      expect(texture.version).toBe(native.boneTexture?.version);
    }
    expect(d.state.uploads).toBeLessThan(30);
  } finally { native.dispose(); tracked.dispose(); d.dispose(); }
});

test('completion is armed only while pending and follows ownership, retirement and memory in nested draws', () => {
  const texture = new DataTexture(new Uint32Array(4), 2, 2), d = driver(texture), events: string[] = [];
  const hooks = drawHooks(d.renderer);
  let nested = false;
  hooks.ownership = (draw, ...args) => {
    events.push(nested ? 'nested-owner' : 'owner');
    if (!nested) {
      nested = true;
      try { d.draw(); } finally { nested = false; }
    }
    draw(...args); events.push(nested ? 'nested-release' : 'release');
  };
  hooks.retire = complete => { expect(complete).toBe(true); events.push('retire'); };
  hooks.memory = () => { events.push(nested ? 'nested-memory' : 'memory'); };
  try {
    expect(hooks.uploads).toBeUndefined();
    onceTextureUploaded(texture, () => { events.push('uploaded'); }); texture.needsUpdate = true; d.draw();
    expect(events).toEqual(['owner', 'nested-owner', 'nested-release', 'nested-memory', 'uploaded', 'release', 'retire', 'memory']);
    expect(hooks.uploads).toBeUndefined();
    hooks.material = () => null; events.length = 0;
    onceTextureUploaded(texture, () => { events.push('unexpected'); }); texture.needsUpdate = true; d.draw();
    expect(events).toEqual(['memory']); expect(d.state.uploads).toBe(1);
  } finally { d.dispose(); texture.dispose(); }
});
