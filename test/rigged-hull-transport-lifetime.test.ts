import { afterEach, expect, test, vi } from 'vitest';
import { Bone, BoxGeometry, BufferGeometry, BufferAttribute, Mesh, MeshStandardMaterial, Skeleton, SkinnedMesh, Uint16BufferAttribute, Float32BufferAttribute } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { realGc } from '@wildshard/engine/test/realGc';
import { createRigLoader } from '@wildshard/engine/anim/rigParser';
import { rebindGeometry } from '@wildshard/engine/app/cachedAssets';
import { riggedHulls } from '@wildshard/engine/game/looks/riggedHulls';
import { staticGlb } from '../src/sharddev/bake/glb';

afterEach(() => { vi.restoreAllMocks(); });

const name = 'live hull copies release consumed GLTF parser and source geometry';
test(name, async () => {
  await realGc('test/rigged-hull-transport-lifetime.test.ts', name, async collect => {
    const refs: { file: WeakRef<object>; parser: WeakRef<object>; bin: WeakRef<object>; wire: WeakRef<object>; source: WeakRef<object> }[] = [];
    let reads = 0;
    const mock = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async url => {
      expect(url).toBe('/hull.glb'); reads++;
      const geometry = new BoxGeometry(1, 2, 3), material = new MeshStandardMaterial({ color: 0x345678 });
      const bytes = staticGlb([{ name: 'source', geometry, material, nativeAttributes: true }]);
      geometry.dispose(); material.dispose();
      const file = await createRigLoader().parseBytesAsync(bytes, '');
      const source = file.scene.getObjectByName('source');
      if (!(source instanceof Mesh)) throw new Error('Missing parsed source mesh');
      const parsedGeometry: unknown = source.geometry;
      if (!(parsedGeometry instanceof BufferGeometry)) throw new Error('Missing parsed geometry');
      const position: unknown = parsedGeometry.getAttribute('position');
      if (!(position instanceof BufferAttribute)) throw new Error('Missing parsed positions');
      const count = position.count;
      parsedGeometry.setAttribute('skinIndex', new Uint16BufferAttribute(new Uint16Array(count * 4), 4));
      const weights = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) weights[i * 4] = 1;
      parsedGeometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4));
      const bone = new Bone(); bone.name = 'body'; bone.position.y = 2;
      const skin = new SkinnedMesh(parsedGeometry, source.material);
      skin.add(bone); skin.bind(new Skeleton([bone])); file.scene.add(skin);
      const bin: unknown = await file.parser.getDependency('buffer', 0);
      if (!(bin instanceof ArrayBuffer)) throw new Error('Missing parsed GLB backing');
      refs.push({ file: new WeakRef(file), parser: new WeakRef(file.parser), bin: new WeakRef(bin),
        wire: new WeakRef(bytes.buffer), source: new WeakRef(parsedGeometry) });
      return file;
    });
    const family = riggedHulls({ label: 'lifetime', rigs: ['body'], hulls: { 'bird:adult': 'body' } },
      { files: { body: '/hull.glb' }, coats: {} });
    await family.preload();
    const live = await family.load('body'), positions = Array.from(live.geometry.getAttribute('position').array);
    mock.mockClear(); // Vitest's result log must not be the owner under test.
    try {
      const first = refs[0];
      if (first === undefined) throw new Error('Missing parsed references');
      await collect(first.file); await collect(first.parser); await collect(first.bin);
      await collect(first.wire); await collect(first.source);
      expect(live.joints.map(joint => [joint.name, joint.pos.toArray()])).toEqual([['body', [0, 2, 0]]]);
      expect(Array.from(live.geometry.getAttribute('position').array)).toEqual(positions);
      expect(Array.from(live.geometry.getAttribute('skinWeight').array).filter((_, i) => i % 4 === 0)).toEqual(Array.from({ length: 24 }, () => 1));
      expect(live.geometry.getAttribute('color').array).toEqual(new Float32Array(72).fill(1));
      rebindGeometry(live.geometry); expect(await family.load('body')).toBe(live); expect(reads).toBe(1);
      expect(family.skin('bird', 'adult', [{ name: 'body', parent: null, pos: [0, 0, 0] }])?.geometry).toBe(live.geometry);
      live.geometry.dispose();
      const next = await family.load('body'); expect(reads).toBe(2); expect(next).not.toBe(live);
      expect(Array.from(next.geometry.getAttribute('position').array)).toEqual(positions);
      live.geometry.dispose(); expect(await family.load('body')).toBe(next);
      next.geometry.dispose();
    } finally { live.geometry.dispose(); }
  });
});
