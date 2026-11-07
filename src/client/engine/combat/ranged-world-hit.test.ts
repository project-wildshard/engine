// oxlint-disable-next-line import/no-nodejs-modules -- Real query behaviour uses the shipped Rapier binary.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { app } from '../app/runtime';
import { worldHit as pageHit } from './view/ranged';
import { Physics } from '../../../shared/engine/physics/Physics';
import { loadRapier } from '../../../shared/engine/physics/rapier';
import { addPiece } from '../../../shared/engine/physics/pieces';
import { castSegment, worldHit } from '../../../shared/engine/physics/query';
import { WorldRegistry } from '../world/registry';

test('page and native shot sweeps pass edge strips in order and return the same world contact', async () => {
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const physics = new Physics(rapier), registry = new WorldRegistry(), previous = app.physics;
  registry.onAdd(piece => { addPiece(physics, piece); });
  for (const z of [2, 4, 7]) registry.add({ id: `wall-${z}`, name: 'Query wall', category: 'buildings', file: 'query-fixture',
    colliderOwner: `wall-${z}`, colliders: [{ kind: 'box', x: 0, y: 1, z, hx: 2, hy: 2, hz: 0.1, surface: z === 7 ? 'wood' : 'edge' }] });
  const from = { x: 0, y: 1, z: 0 }, to = { x: 0, y: 1, z: 10 };
  try {
    app.physics = physics; physics.step();
    expect(castSegment(physics, from, to)?.material).toBe('edge');
    for (const radius of [0, 0.03]) {
      const native = worldHit(physics, from, to, radius), page = pageHit(from, to, radius);
      expect(native?.owner).toBe('wall-7');
      expect(page?.owner).toBe(native?.owner);
      expect(page?.point).toEqual(native?.point);
      expect(page?.distance).toBe(native?.distance);
      expect(page?.collider.handle).toBe(native?.collider.handle);
    }
    app.physics = null;
    expect(pageHit(from, to, 0)).toBeNull();
  } finally { app.physics = previous; registry.retire(); physics.dispose(); }
});
