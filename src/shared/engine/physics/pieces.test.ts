import { expect, test } from 'vitest';
import { fixtureBytes } from '../../../test/engine/nativeBytes';
import { loadRapier } from './rapier';
import { Physics } from './Physics';
import { addPiece } from './pieces';
import { tagOf } from './surface';
import type { Piece } from '../../../client/engine/world/registry';

test('box descriptor reuse preserves every native collider, pose, shape and material owner', async () => {
  const R = await loadRapier(Uint8Array.from(fixtureBytes(new URL('../../../../node_modules/@dimforge/rapier3d-simd/rapier_wasm3d_bg.wasm', import.meta.url))));
  const physics = new Physics(R);
  const row = (id: string, x: number, yaw?: number): Piece => ({ id, name: id, file: 'fixture', category: 'props', surface: 'stone',
    colliders: [{ kind: 'box', x, y: 2, z: 3, hx: 1, hy: 2, hz: 3, ...(yaw === undefined ? {} : { yaw }) }] });
  try {
    const a = row('a', 1, Math.PI / 2), b = row('b', 10), c = row('c', 20);
    const first = addPiece(physics, a).colliders[0], second = addPiece(physics, b).colliders[0];
    if (first === undefined || second === undefined) throw new Error('Missing original native collider');
    expect(second.shape).not.toBe(first.shape);
    expect(first.rotation().y).toBeCloseTo(Math.SQRT1_2);
    expect(second.rotation()).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    first.setHalfExtents({ x: 4, y: 5, z: 6 });
    const third = addPiece(physics, c).colliders[0];
    if (third === undefined) throw new Error('Missing repeated native collider');
    expect(physics.world.colliders.len()).toBe(3);
    expect(second.halfExtents()).toEqual({ x: 1, y: 2, z: 3 });
    expect(third.halfExtents()).toEqual({ x: 1, y: 2, z: 3 });
    expect(third.translation()).toEqual({ x: 20, y: 2, z: 3 });
    expect(tagOf(second)).toEqual({ material: 'stone', owner: b });
    expect(tagOf(third)).toEqual({ material: 'stone', owner: c });
  } finally { physics.dispose(); }
});
