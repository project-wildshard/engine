// @vitest-environment node
import { expect, test, vi } from 'vitest';
import { BufferAttribute, BufferGeometry, MeshLambertMaterial, PerspectiveCamera, Scene, SkinnedMesh, Texture } from 'three';
import { prepareCookedSkinUv } from './cookedSkinUv';
import { installCookedSkinUvBinding } from './drawHooks';
import type { Renderer } from './renderer';

const SAFARI = 'AppleWebKit/605.1.15 Safari/605.1.15';

function body(): BufferGeometry {
  return new BufferGeometry().setAttribute('uv', new BufferAttribute(new Float32Array([0.5, 0.25, 0.75, 1]), 2));
}

function drawn(renderer: Pick<Renderer, 'renderBufferDirect'>, mesh: SkinnedMesh, material: MeshLambertMaterial): void {
  renderer.renderBufferDirect(new PerspectiveCamera(), new Scene(), mesh.geometry, material, mesh, { start: 0, count: 3, materialIndex: 0 });
}

test('the first mapped draw refreshes a cooked WebKit UV binding without copying the channel', () => {
  const geometry = body(), uv = geometry.getAttribute('uv'), pixels = uv.array;
  const warm = new SkinnedMesh(geometry), live = new SkinnedMesh(geometry);
  const native = vi.fn<Renderer['renderBufferDirect']>(), renderer = { renderBufferDirect: native };
  const paint = new MeshLambertMaterial({ map: new Texture() });
  prepareCookedSkinUv(geometry);
  installCookedSkinUvBinding(renderer, SAFARI);

  drawn(renderer, warm, new MeshLambertMaterial());
  expect(Reflect.has(uv, 'data')).toBe(false);
  native.mockImplementationOnce(() => { throw new Error('draw failed'); });
  expect(() => drawn(renderer, warm, paint)).toThrow('draw failed');
  expect(Reflect.has(uv, 'data')).toBe(false);
  drawn(renderer, warm, paint);
  const binding: unknown = Reflect.get(uv, 'data');
  expect(binding).toBeDefined();
  drawn(renderer, live, paint);
  expect(geometry.getAttribute('uv')).toBe(uv);
  expect(uv.array).toBe(pixels);
  expect(Reflect.get(uv, 'data')).toBe(binding);
});

test('legacy and Chromium rigs keep their original UV binding', () => {
  const legacy = new SkinnedMesh(body()), cooked = new SkinnedMesh(body());
  const safari = { renderBufferDirect: vi.fn<Renderer['renderBufferDirect']>() };
  const chromium = { renderBufferDirect: vi.fn<Renderer['renderBufferDirect']>() };
  const paint = new MeshLambertMaterial({ map: new Texture() });
  prepareCookedSkinUv(cooked.geometry);
  installCookedSkinUvBinding(chromium, `${SAFARI} Chrome/130.0`);
  installCookedSkinUvBinding(safari, SAFARI);
  drawn(chromium, cooked, paint);
  drawn(safari, legacy, paint);
  expect(Reflect.has(cooked.geometry.getAttribute('uv'), 'data')).toBe(false);
  expect(Reflect.has(legacy.geometry.getAttribute('uv'), 'data')).toBe(false);
});
