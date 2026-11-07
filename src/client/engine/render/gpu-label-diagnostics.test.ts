import { afterEach, expect, test, vi } from 'vitest';
import { Bone, BufferGeometry, Camera, Mesh, MeshBasicMaterial, Scene, Skeleton, Texture, WebGLRenderTarget } from 'three';
import type { Renderer } from './renderer';
import { installGpuLabels, labelAsset } from './gpuLabels';
import { memoryAttribution } from '../../../shared/engine/core/memoryAttribution';
import { isDev, setDev } from '../core/devMode';

const initialDev = isDev(), initialWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
afterEach(() => {
  vi.restoreAllMocks();
  if (initialWindow === undefined) Reflect.deleteProperty(globalThis, 'window');
  else Object.defineProperty(globalThis, 'window', initialWindow);
  setDev(initialDev);
});
function fixture() {
  const records = new WeakMap<object, Record<string, unknown>>();
  const raw = (resource: unknown) => {
    if (resource === null || typeof resource !== 'object') throw new Error('Property resource must be an object');
    let row = records.get(resource);
    if (row === undefined) { row = {}; records.set(resource, row); }
    return row;
  };
  const renderer = { properties: { get: raw, has: (resource: unknown) => resource !== null && typeof resource === 'object' && records.has(resource) },
    render: vi.fn<Renderer['render']>(), compile: vi.fn<Renderer['compile']>(), compileAsync: vi.fn<Renderer['compileAsync']>(),
    renderBufferDirect: vi.fn<Renderer['renderBufferDirect']>() };
  return { renderer, raw };
}

test('public reads and draws bypass resource traversal and property proxies', () => {
  setDev(false);
  const { renderer, raw } = fixture(), render = renderer.render, draw = renderer.renderBufferDirect; installGpuLabels(renderer);
  const texture = new Texture(), material = new MeshBasicMaterial(), geometry = new BufferGeometry(), mesh = new Mesh(geometry, material);
  let reads = 0;
  Object.defineProperty(texture, 'image', { get: () => { reads++; throw new Error('public texture walk'); } });
  Object.defineProperty(raw(texture), '__webglTexture', { get: () => { reads++; return {}; } });
  Object.defineProperty(mesh, 'material', { get: () => { reads++; throw new Error('public draw walk'); } });
  const scene = new Scene(), camera = new Camera();
  expect(renderer.properties.get(texture)).toBe(raw(texture));
  renderer.render(scene, camera);
  renderer.renderBufferDirect(camera, scene, geometry, material, mesh, { start: 0, count: 0, materialIndex: 0 });
  expect(reads).toBe(0);
  expect(render).toHaveBeenCalledOnce(); expect(draw).toHaveBeenCalledOnce();
});

test('ordinary Developer draws leave labels to the scene census rather than walking each submission', () => {
  setDev(true);
  const { renderer } = fixture(); installGpuLabels(renderer);
  const geometry = new BufferGeometry(), material = new MeshBasicMaterial(), mesh = new Mesh(geometry, material);
  renderer.render(new Scene(), new Camera());
  Object.defineProperty(mesh, 'material', { get: () => { throw new Error('per-draw diagnostic walk'); } });
  expect(() => renderer.renderBufferDirect(new Camera(), new Scene(), geometry, material, mesh, { start: 0, count: 3, materialIndex: 0 })).not.toThrow();
});

test('an unchanged allocation is inspected once until its authored label changes', () => {
  setDev(true);
  const { renderer, raw } = fixture(), texture = new Texture(), handle = {};
  let reads = 0;
  Object.defineProperty(raw(texture), '__webglTexture', { get: () => { reads++; return handle; } });
  installGpuLabels(renderer);
  const first = renderer.properties.get(texture), inspected = reads;
  renderer.properties.get(texture); renderer.properties.get(texture);
  expect(inspected).toBeGreaterThan(0); expect(reads).toBe(inspected);
  labelAsset(texture, 'late-owner', 'late.ktx2');
  expect(renderer.properties.get(texture)).toBe(first); expect(reads).toBeGreaterThan(inspected);
});

test('Developer reuses the property proxy and retains authored handle labels', () => {
  setDev(true);
  const { renderer } = fixture(), texture = new Texture(), handle = {};
  installGpuLabels(renderer); labelAsset(texture, 'fixture-owner', 'same.ktx2');
  const label = vi.spyOn(memoryAttribution, 'label');
  const properties = renderer.properties.get(texture); properties['__webglTexture'] = handle;
  for (let i = 0; i < 2000; i++) expect(renderer.properties.get(texture)).toBe(properties);
  const labels = label.mock.calls.filter(call => call[0] === handle);
  expect(labels).toHaveLength(1);
  expect(labels[0]?.[1]).toEqual({ owner: 'fixture-owner', asset: 'same.ktx2/Texture', priority: 3 });
});

// only a texture's or a render target's properties ever hold a GL handle: a material's, a geometry's and an object's are
// three's own objects in Developer too (a proxy there ran every draw's property reads off JavaScriptCore's inline caches)
test('Developer proxies only the properties that hold GL handles', () => {
  setDev(true);
  const { renderer, raw } = fixture(), material = new MeshBasicMaterial(), geometry = new BufferGeometry(), mesh = new Mesh(geometry, material);
  installGpuLabels(renderer);
  expect(renderer.properties.get(material)).toBe(raw(material));
  expect(renderer.properties.get(geometry)).toBe(raw(geometry));
  expect(renderer.properties.get(mesh)).toBe(raw(mesh));
  const texture = new Texture(), target = new WebGLRenderTarget(2, 2);
  expect(renderer.properties.get(texture)).not.toBe(raw(texture));
  expect(renderer.properties.get(target)).not.toBe(raw(target));
  material.dispose(); geometry.dispose(); texture.dispose(); target.dispose();
});

test('Developer can be switched off and on without stale labels or changing raw properties', () => {
  setDev(false);
  const { renderer, raw } = fixture(), texture = new Texture(), handle = {};
  const label = vi.spyOn(memoryAttribution, 'label'); installGpuLabels(renderer);
  raw(texture)['__webglTexture'] = handle;
  expect(renderer.properties.get(texture)).toBe(raw(texture));
  setDev(true); labelAsset(texture, 'late-owner', 'late.ktx2');
  const properties = renderer.properties.get(texture);
  expect(properties).not.toBe(raw(texture));
  expect(label.mock.calls.some(call => call[0] === handle && call[1].owner === 'late-owner')).toBe(true);
  setDev(false); label.mockClear();
  const later = {}; properties['__webglTexture'] = later;
  expect(renderer.properties.get(texture)).toBe(raw(texture));
  expect(label.mock.calls.filter(call => call[0] === later)).toHaveLength(0);
  setDev(true); expect(renderer.properties.get(texture)).toBe(properties);
  expect(label.mock.calls.some(call => call[0] === later && call[1].asset === 'late.ktx2/Texture')).toBe(true);
  properties['__webglColorRenderbuffer'] = [{}];
  const buffers: unknown = properties['__webglColorRenderbuffer'];
  if (!Array.isArray(buffers)) throw new Error('Missing renderbuffers');
  setDev(false); label.mockClear(); const appended = {}; buffers.push(appended);
  expect(label.mock.calls.filter(call => call[0] === appended)).toHaveLength(0);
  setDev(true); renderer.properties.get(texture);
  expect(label.mock.calls.some(call => call[0] === appended && call[1].asset === 'late.ktx2/ColorRenderbuffer/1')).toBe(true);
});

test('sampled census works with Developer off and preserves nested renderbuffer roles', () => {
  setDev(false);
  const emitted = vi.fn(), register = vi.fn<(flush: () => void) => void>();
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: { __sc_label_gl: emitted, __sc_gl_sample_labels: true, __sc_gl_register_labels: register } });
  const { renderer } = fixture(); installGpuLabels(renderer);
  const target = new WebGLRenderTarget(4, 4), first = {}, second = {}, properties = renderer.properties.get(target);
  properties['__webglColorRenderbuffer'] = [first];
  const array: unknown = properties['__webglColorRenderbuffer'];
  if (!Array.isArray(array)) throw new Error('Missing renderbuffer array');
  array.push(second);
  expect(emitted.mock.calls.some(call => call[0] === first && call[2] === 'generated/render-target/4x4/ColorRenderbuffer/0')).toBe(true);
  expect(emitted.mock.calls.some(call => call[0] === second && call[2] === 'generated/render-target/4x4/ColorRenderbuffer/1')).toBe(true);
  expect(register).toHaveBeenCalledOnce();
  register.mock.calls[0]?.[0]();
  expect(renderer.properties.get(target)).toBe(properties);
  target.dispose();
});

test('bone texture allocation observes CPU storage only while diagnostics are enabled', () => {
  setDev(false); installGpuLabels(fixture().renderer);
  const buffer = vi.spyOn(memoryAttribution, 'buffer'), publicSkeleton = new Skeleton([new Bone()]);
  publicSkeleton.computeBoneTexture(); expect(buffer).not.toHaveBeenCalled();
  setDev(true);
  const devSkeleton = new Skeleton([new Bone()]); devSkeleton.computeBoneTexture();
  expect(buffer).toHaveBeenCalled(); publicSkeleton.dispose(); devSkeleton.dispose();
});


test('full census still emits an exact repeated handle label with Developer off', () => {
  setDev(false);
  const emitted = vi.fn();
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: { __sc_label_gl: emitted } });
  const { renderer } = fixture(), texture = new Texture(), handle = {};
  installGpuLabels(renderer); labelAsset(texture, 'census-owner', 'census.ktx2');
  renderer.render(new Scene(), new Camera());
  const properties = renderer.properties.get(texture); properties['__webglTexture'] = handle;
  emitted.mockClear();
  renderer.properties.get(texture); renderer.properties.get(texture);
  expect(emitted.mock.calls.filter(call => call[0] === handle)).toEqual([
    [handle, 'census-owner', 'census.ktx2/Texture', undefined],
    [handle, 'census-owner', 'census.ktx2/Texture', undefined],
  ]);
});
