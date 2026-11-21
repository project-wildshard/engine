import { expect, test } from 'vitest';
import type { GeneratedStrip } from '@wildshard/engine/sim/strips';
import { collisionStrips } from '../src/shared/game/grid/collisionStrips';

test('DF11: collision strips keep the exact native buffers and placement, never colours or seam features', () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), indices = new Uint32Array([0, 1, 2]), colours = new Float32Array(9);
  const strip: GeneratedStrip = {
    id: 'gap.x.0', mesh: { origin: { x: 4, z: -2 }, positions, indices, colours },
    features: [{ kind: 'floor', firstIndex: 0, indexCount: 3, side: 0, from: 0, to: 1, bottom: 0, top: 0 }] as unknown as GeneratedStrip['features'],
    turnIn: { at: 0, widths: [2, 0] } as unknown as NonNullable<GeneratedStrip['turnIn']>,
    duplicates: [{ instance: 'a', mesh: { origin: { x: 1, z: 1 }, positions, indices, colours } }],
  };
  const [copy] = collisionStrips([strip]);
  expect(copy).toEqual({ id: 'gap.x.0', turnIn: strip.turnIn, mesh: { origin: { x: 4, z: -2 }, positions, indices },
    duplicates: [{ instance: 'a', mesh: { origin: { x: 1, z: 1 }, positions, indices } }] });
  expect(copy?.mesh.positions).toBe(positions); expect(copy?.duplicates[0]?.mesh.indices).toBe(indices);
  expect(Object.keys(copy ?? {})).not.toContain('features');
});
