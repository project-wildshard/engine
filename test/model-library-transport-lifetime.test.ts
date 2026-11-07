import { expect, test } from 'vitest';
import { BoxGeometry, Mesh, MeshStandardMaterial, type Object3D } from 'three';
import { rebindGeometry } from '@wildshard/engine/app/cachedAssets';
import { realGc } from '@wildshard/engine/test/realGc';
import { createRigLoader } from '@wildshard/engine/anim/rigParser';
import { createModelLibrary } from '@wildshard/engine/game/plugin/geometry';
import { staticGlb } from '../src/sharddev/bake/glb';

const isMesh = (node: Object3D): node is Mesh => node instanceof Mesh;

const name = 'hero model caches release consumed GLTF transport with the scene alive';
test(name, async () => {
  await realGc('test/model-library-transport-lifetime.test.ts', name, async collect => {
    const references: { file: WeakRef<object>; parser: WeakRef<object>; bin: WeakRef<object>; wire: WeakRef<object> }[] = [];
    let reads = 0;
    const read = async (url: string) => {
      expect(url).toBe('hero.glb'); reads++;
      const geometry = new BoxGeometry(1, 2, 3), material = new MeshStandardMaterial({ color: 0x345678 });
      const bytes = staticGlb([{ name: 'hero', geometry, material, nativeAttributes: true }]);
      geometry.dispose(); material.dispose();
      const file = await createRigLoader().parseBytesAsync(bytes, '');
      const bin: unknown = await file.parser.getDependency('buffer', 0);
      if (!(bin instanceof ArrayBuffer)) throw new Error('Missing native GLB buffer');
      references.push({ file: new WeakRef(file), parser: new WeakRef(file.parser), bin: new WeakRef(bin), wire: new WeakRef(bytes.buffer) });
      return file;
    };
    const library = createModelLibrary<never, 'hero'>({ meshes: [], meshUrls: {}, hd: ['hero'],
      hdUrls: { hero: 'hero.glb' }, hdLooks: {}, aoFloor: 1 }, 'lifetime', {}, read);
    const meshes = (root: Object3D): Mesh[] => {
      const found: Mesh[] = []; root.traverse(node => { if (isMesh(node)) found.push(node); }); return found;
    };
    await library.preload();
    const first = library.hd('hero', { size: 2, by: 'height' });
    if (first === null) throw new Error('Missing hero copy');
    const firstMesh = meshes(first)[0];
    if (firstMesh === undefined || !(firstMesh.material instanceof MeshStandardMaterial)) throw new Error('Missing hero mesh');
    const positions = Array.from(firstMesh.geometry.getAttribute('position').array);
    try {
      const refs = references[0];
      if (refs === undefined) throw new Error('Missing loader references');
      await collect(refs.file); await collect(refs.parser); await collect(refs.bin); await collect(refs.wire);
      rebindGeometry(firstMesh.geometry);
      await library.preload(); expect(reads).toBe(1);
      const second = library.hd('hero', { size: 2, by: 'height' });
      if (second === null) throw new Error('Missing repeated hero');
      const secondMesh = meshes(second)[0];
      expect(secondMesh?.geometry).toBe(firstMesh.geometry);
      expect(secondMesh?.material).toBe(firstMesh.material);
      expect(Array.from(firstMesh.geometry.getAttribute('position').array)).toEqual(positions);
      expect(firstMesh.material.color.getHex()).toBe(0x345678);
      expect(firstMesh.material.roughness).toBe(0.85); expect(firstMesh.material.metalness).toBe(0);
      firstMesh.geometry.dispose();
      expect(library.hd('hero', { size: 2, by: 'height' })).toBeNull();
      await library.preload(); expect(reads).toBe(2);
      const replacement = library.hd('hero', { size: 2, by: 'height' });
      if (replacement === null) throw new Error('Missing replacement hero');
      const replacementMesh = meshes(replacement)[0];
      if (replacementMesh === undefined) throw new Error('Missing replacement geometry');
      expect(replacementMesh.geometry).not.toBe(firstMesh.geometry);
      firstMesh.geometry.dispose(); // A retired predecessor cannot evict its replacement.
      expect(library.hd('hero', { size: 2, by: 'height' })).not.toBeNull();
      replacementMesh.geometry.dispose();
      for (const material of Array.isArray(replacementMesh.material) ? replacementMesh.material : [replacementMesh.material]) material.dispose();
    } finally { firstMesh.geometry.dispose(); firstMesh.material.dispose(); }
  });
});

const retiredName = 'live hero resources release a retired library reader context';
test(retiredName, async () => {
  await realGc('test/model-library-transport-lifetime.test.ts', retiredName, async collect => {
    async function prepare() {
      const context = { bytes: new Uint8Array(1024 * 1024), reads: 0 };
      const read = (url: string) => {
        expect(url).toBe('hero.glb'); context.reads++; context.bytes[0] = context.reads;
        const geometry = new BoxGeometry(1, 2, 3), material = new MeshStandardMaterial({ color: 0x345678 });
        const bytes = staticGlb([{ name: 'hero', geometry, material, nativeAttributes: true }]);
        geometry.dispose(); material.dispose();
        return createRigLoader().parseBytesAsync(bytes, '');
      };
      const library = createModelLibrary<never, 'hero'>({ meshes: [], meshUrls: {}, hd: ['hero'],
        hdUrls: { hero: 'hero.glb' }, hdLooks: {}, aoFloor: 1 }, 'retired lifetime', {}, read);
      await library.preload(); expect(context.reads).toBe(1);
      const scene = library.hd('hero', { size: 2, by: 'height' });
      if (scene === null) throw new Error('Missing live hero');
      return { scene, library: new WeakRef(library), reader: new WeakRef(read),
        context: new WeakRef(context), backing: new WeakRef(context.bytes.buffer) };
    }
    const live = await prepare(), meshes: Mesh[] = [];
    live.scene.traverse(node => { if (isMesh(node)) meshes.push(node); });
    const mesh = meshes[0];
    if (mesh === undefined || !(mesh.material instanceof MeshStandardMaterial)) throw new Error('Missing live hero mesh');
    const positions = Array.from(mesh.geometry.getAttribute('position').array);
    try {
      await collect(live.library); await collect(live.reader);
      await collect(live.context); await collect(live.backing);
      expect(Array.from(mesh.geometry.getAttribute('position').array)).toEqual(positions);
      expect(mesh.material.color.getHex()).toBe(0x345678);
      expect(mesh.material.roughness).toBe(0.85); expect(mesh.material.metalness).toBe(0);
      expect(live.scene.children.length).toBeGreaterThan(0);
    } finally { mesh.geometry.dispose(); mesh.material.dispose(); }
  });
});
