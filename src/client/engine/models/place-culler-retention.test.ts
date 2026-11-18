// @vitest-environment happy-dom
import { test } from 'vitest';
import { BoxGeometry, Matrix4, MeshStandardMaterial, PerspectiveCamera } from 'three';
import { realGc } from '../../../test/engine/realGc';
import { defineModel, modelContext } from './model';
import { place, type Placed } from './place';

const NAME = 'a culled placed model lets the placements it was drawn from go';

// MEMORY-GATES MG9: a placed model's culler lives as long as the model. Its closures held the draw's whole frame, and with it
// every copy's placement and pose (Pine Hollow's 22,250 floor-cover copies and 918 trees: about 20 MB of JS heap at control).
test(NAME, async () => {
  await realGc('src/client/engine/models/place-culler-retention.test.ts', NAME, async (collect) => {
    const ctx = modelContext(null);
    Object.assign(ctx, { renderer: { extensions: { has: (name: string) => name === 'WEBGL_multi_draw' } } });
    const material = new MeshStandardMaterial(), geometry = new BoxGeometry(1, 1, 1);
    const model = defineModel({ id: 'test/culler-retention', name: 'Culler retention', category: 'props', pipeline: 'code', file: 'src/client/engine/models/place-culler-retention.test.ts',
      defaults: {}, build: () => [{ geometry, material }], lods: [{ from: 10, build: () => [{ geometry, material }] }] });
    const camera = new PerspectiveCamera(60, 1, 0.1, 1000); camera.updateMatrixWorld(true);
    for (const draw of ['instanced', 'batched'] as const) {
      const made = ((): { placed: Placed; ref: WeakRef<object> } => {
        const placements = Array.from({ length: 8 }, (_, i) => ({ x: i * 3, y: 0, z: -20, matrix: new Matrix4().makeTranslation(i * 3, 0, -20) }));
        return { placed: place(model, placements, { ctx, draw, registry: null, cull: {} }), ref: new WeakRef(placements) };
      })();
      made.placed.cull(camera);
      await collect(made.ref);
      made.placed.cull(camera); // the model and its culler outlive the collection
    }
    material.dispose(); geometry.dispose();
  });
});
