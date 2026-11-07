import { expect, test } from 'vitest';
import { BufferAttribute, BufferGeometry, Mesh } from 'three';
import { realGc } from '@wildshard/engine/test/realGc';
import { FigureCatalogue } from './figureCatalogue';
import { SceneHandles } from '../shardfile/sceneHandles';

const name = 'a live figure material releases its retired catalogue and scene handles';
test(name, async () => {
  await realGc('src/client/game/models/figure-material-lifetime.test.ts', name, async collect => {
    async function prepare() {
      const handles = new SceneHandles({ setupMaterial: () => undefined });
      const storage = new ArrayBuffer(1024 * 1024), geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(new Float32Array(storage, 0, 9), 3));
      handles.publish('unrelated-world-geometry', geometry);
      const catalogue = new FigureCatalogue();
      await catalogue.admit({ material: { name: 'figure', roughness: .4, metalness: 0 }, figures: {} }, handles);
      const material = catalogue.material(handles), mesh = new Mesh(new BufferGeometry(), material);
      expect(catalogue.material(handles)).toBe(material);
      return { mesh, catalogue: new WeakRef(catalogue), handles: new WeakRef(handles),
        geometry: new WeakRef(geometry), backing: new WeakRef(storage) };
    }
    const live = await prepare();
    try {
      await collect(live.catalogue); await collect(live.handles);
      await collect(live.geometry); await collect(live.backing);
      expect(live.mesh.material).toMatchObject({ name: 'figure', vertexColors: true, roughness: .4, metalness: 0 });
    } finally { live.mesh.geometry.dispose(); live.mesh.material.dispose(); }
  });
});

test('live catalogues share materials and replace a retired one without predecessor eviction', async () => {
  let setups = 0;
  const handles = new SceneHandles({ setupMaterial: () => { setups++; } }), catalogue = new FigureCatalogue();
  await catalogue.admit({ material: { name: 'figure', roughness: .4, metalness: 0 }, figures: {} }, handles);
  const first = catalogue.material(handles);
  expect(catalogue.material(handles)).toBe(first); expect(setups).toBe(1);
  first.dispose();
  const next = catalogue.material(handles);
  expect(next).not.toBe(first); expect(setups).toBe(2);
  first.dispose(); expect(catalogue.material(handles)).toBe(next);
  expect(next).toMatchObject({ name: 'figure', vertexColors: true, roughness: .4, metalness: 0 });
  next.dispose();
});
