import { expect, test, vi } from 'vitest';
import { BufferGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, Texture } from 'three';
import { Scope } from '../../../shared/engine/app/scope';
import { AssetService } from './assets';
import { ownSceneTree } from './sceneOwnership';
import { MemoryAttribution } from '../../../shared/engine/core/memoryAttribution';
import { ownPostSampler, UploadOwnership } from '../render/uploadOwnership';
import type { Renderer } from '../render/renderer';

function fixture() {
  const page = new Scope('page'), assets = new AssetService(), ledger = new MemoryAttribution();
  const texture = new Texture(), native = {}, bytes = 143_748;
  ledger.allocation(native, 'gpu', 'texture', bytes);
  texture.addEventListener('dispose', () => { ledger.release(native, 'gpu'); });
  const properties = { has: () => false, get: (object: unknown) => object, remove: () => undefined, update: () => undefined, dispose: () => undefined };
  const renderer = { properties, render: () => undefined, compile: () => new Set(),
    renderBufferDirect: (): void => { properties.get(texture); } } satisfies Pick<Renderer, 'properties' | 'render' | 'compile' | 'renderBufferDirect'>;
  const observer = new UploadOwnership(page, assets); observer.attach(renderer);
  const material = new MeshBasicMaterial({ map: texture }), geometry = new BufferGeometry(), mesh = new Mesh(geometry, material);
  // The renderer double's compile returns programs; the observer still traverses this real scene.
  const compileScene = (scene: Scene): void => { Reflect.apply(renderer.compile, renderer, [scene, new PerspectiveCamera()]); };
  const drawMesh = (object: Mesh): void => { Reflect.apply(renderer.renderBufferDirect, renderer,
    [new PerspectiveCamera(), new Scene(), object.geometry, object.material, object, { start: 0, count: 0, materialIndex: 0 }]); };
  return { page, assets, ledger, texture, bytes, mesh, compileScene, drawMesh,
    dispose: (): void => { page.dispose(); geometry.dispose(); material.dispose(); } };
}

for (const path of ['draw', 'compile'] as const) test(`unowned post ${path} preserves a resident LUT's retirement`, () => {
  const f = fixture(), resident = f.page.child('BackdropLayer'), disposed = vi.fn<() => void>();
  ownPostSampler(f.texture, resident); f.texture.addEventListener('dispose', disposed);
  try {
    if (path === 'draw') f.drawMesh(f.mesh); else f.compileScene(new Scene().add(f.mesh));
    expect(f.ledger.summary().totals.gpu).toBe(f.bytes);
    resident.dispose();
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(f.ledger.summary().totals.gpu).toBe(0);
    expect(f.page.disposed).toBe(false);
  } finally { f.dispose(); }
});

test('explicit live consumers keep a shared sampler until both retire', () => {
  const f = fixture(), first = f.page.child('first'), second = f.page.child('second');
  ownPostSampler(f.texture, first); ownSceneTree(new Group().add(f.mesh), second, f.assets);
  try {
    f.drawMesh(f.mesh); first.dispose();
    expect(f.ledger.summary().totals.gpu).toBe(f.bytes);
    second.dispose(); expect(f.ledger.summary().totals.gpu).toBe(0);
  } finally { f.dispose(); }
});

test('fallback owns a genuinely unowned upload until the page retires', () => {
  const f = fixture(), disposed = vi.fn<() => void>(); f.texture.addEventListener('dispose', disposed);
  try {
    f.drawMesh(f.mesh);
    expect(f.ledger.summary().totals.gpu).toBe(f.bytes);
    expect(disposed).not.toHaveBeenCalled();
    f.page.dispose(); expect(disposed).toHaveBeenCalledTimes(1);
    expect(f.ledger.summary().totals.gpu).toBe(0);
  } finally { f.dispose(); }
});
