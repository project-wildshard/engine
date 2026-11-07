import { textureUploadRenderer as uploadRenderer } from '../../../test/engine/textureUploadRenderer';
import { afterEach, expect, test, vi } from 'vitest';
import { BufferAttribute, BufferGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, SkinnedMesh, Texture } from 'three';
import { realGc } from '../../../test/engine/realGc';
import { installMemorySaver, releaseOnUpload } from './memorySaver';
import { installFrameCounter, renderCount } from './frameCounter';

class DecodedImage implements ImageBitmap {
  readonly width = 16;
  readonly height = 16;
  close(): void { /* The fixture owns no native bitmap. */ }
}

const globals = ['ImageBitmap', 'WebGL2RenderingContext'].map(key => ({ key, descriptor: Object.getOwnPropertyDescriptor(globalThis, key) }));
afterEach(() => {
  for (const { key, descriptor } of globals) {
    if (descriptor === undefined) Reflect.deleteProperty(globalThis, key);
    else Object.defineProperty(globalThis, key, descriptor);
  }
});


test('an uploaded live source releases its one-shot completion capture', async () => {
  await realGc('src/client/engine/render/memory-saver-lifetime.test.ts', 'an uploaded live source releases', async collect => {
    vi.stubGlobal('ImageBitmap', DecodedImage);
    vi.stubGlobal('WebGL2RenderingContext', EventTarget);
    const renderer = uploadRenderer(), texture = new Texture(new DecodedImage()), completed = { calls: 0, byte: 0 };
    installMemorySaver(renderer);
    try {
      const backing = (() => {
        const bytes = new Uint8Array(1024 * 1024);bytes[0] = 73;
        releaseOnUpload(texture.source, () => { completed.calls++;completed.byte = bytes[0] ?? 0; });
        renderer.initTexture(texture);
        return new WeakRef(bytes.buffer);
      })();
      expect(completed).toEqual({ calls: 1, byte: 73 });
      expect(texture.source.data).toEqual({ width: 16, height: 16 });
      await collect(backing);
      renderer.initTexture(texture);
      expect(completed.calls).toBe(1);
      expect(texture.source.data).toEqual({ width: 16, height: 16 });
    } finally { texture.dispose(); }
  });
});


const geometryGcName = 'consumed settle entries release geometry with a live renderer and younger pending work';
test(geometryGcName, async () => {
  await realGc('src/client/engine/render/memory-saver-lifetime.test.ts', geometryGcName, async collect => {
    vi.stubGlobal('WebGL2RenderingContext', EventTarget);
    const make = (younger: boolean) => {
      const renderer = uploadRenderer(), scene = new Scene(), camera = new PerspectiveCamera(), material = new MeshBasicMaterial();
      installFrameCounter(renderer); installMemorySaver(renderer);
      const sentinel = new SkinnedMesh(new BufferGeometry(), material);
      const draw = (geometry: BufferGeometry, object: Mesh): void => { renderer.renderBufferDirect(camera, scene, geometry, material, object, { start: 0, count: 0, materialIndex: 0 }); };
      const retired = (() => {
        const bytes = new Float32Array(256 * 1024), geometry = new BufferGeometry();
        bytes[0] = 73; geometry.setAttribute('position', new BufferAttribute(bytes.subarray(0, -1), 3));
        draw(geometry, new Mesh(geometry, material)); geometry.dispose();
        return { geometry: new WeakRef(geometry), backing: new WeakRef(bytes.buffer) };
      })();
      for (let frame = 0; frame < 200; frame++) renderer.render(scene, camera);
      const pending = younger ? new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array([1, 2, 3]), 3)) : undefined;
      if (pending !== undefined) draw(pending, new Mesh(pending, material));
      for (let frame = 200; frame < 240; frame++) renderer.render(scene, camera);
      // A skinned draw triggers settlement without adding another tracked geometry.
      draw(sentinel.geometry, sentinel);
      expect(renderCount(renderer)).toBe(240);
      return { renderer, retired, pending, close: () => { pending?.dispose(); sentinel.geometry.dispose(); material.dispose(); } };
    };
    const results = [make(false), make(true)];
    try {
      for (const result of results) {
        await collect(result.retired.geometry); await collect(result.retired.backing);
        expect(renderCount(result.renderer)).toBe(240);
        if (result.pending !== undefined) expect(result.pending.getAttribute('position').getX(0)).toBe(1);
      }
    } finally { for (const result of results) result.close(); }
  });
});


const pendingGcName = 'pending settle work borrows scene geometry without keeping retired meshes alive';
test(pendingGcName, async () => {
  await realGc('src/client/engine/render/memory-saver-lifetime.test.ts', pendingGcName, async collect => {
    vi.stubGlobal('WebGL2RenderingContext', EventTarget);
    const renderer = uploadRenderer(), scene = new Scene(), camera = new PerspectiveCamera(), material = new MeshBasicMaterial();
    installFrameCounter(renderer); installMemorySaver(renderer);
    const active = new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array([1, 2, 3]), 3));
    const survivor = new Mesh(active, material); scene.add(survivor);
    const draw = (geometry: BufferGeometry, object: Mesh): void => { renderer.renderBufferDirect(camera, scene, geometry, material, object, { start: 0, count: 0, materialIndex: 0 }); };
    const retired = (() => {
      const bytes = new Float32Array(256 * 1024), geometry = new BufferGeometry();
      bytes[0] = 73; geometry.setAttribute('position', new BufferAttribute(bytes.subarray(0, -1), 3));
      draw(geometry, new Mesh(geometry, material)); geometry.dispose();
      return { geometry: new WeakRef(geometry), backing: new WeakRef(bytes.buffer) };
    })();
    draw(active, survivor);
    try {
      // No render has aged either queue entry yet. The live scene is its own owner.
      await collect(retired.geometry); await collect(retired.backing);
      expect(renderCount(renderer)).toBe(0); expect(scene.children).toContain(survivor);
      const attribute = active.getAttribute('position');
      for (let frame = 0; frame < 240; frame++) renderer.render(scene, camera);
      draw(active, survivor);
      expect(renderCount(renderer)).toBe(240); expect(survivor.geometry).toBe(active);
      expect(active.getAttribute('position')).toBe(attribute); expect(attribute.getX(0)).toBe(1);
    } finally { scene.remove(survivor); active.dispose(); material.dispose(); }
  });
});
