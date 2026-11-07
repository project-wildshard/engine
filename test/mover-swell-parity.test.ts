import { expect, test } from 'vitest';
import { seaDamp, WAVES } from '@wildshard/engine/world/waves';
import { swellDriver } from '@wildshard/sharddev/movers';

test('the author swell driver damps and rows as the engine sea does', () => {
  for (const depth of [-1, 0, 0.1, 0.42, 0.75, 1.1, 1.5, 3, 40]) expect(swellDriver(depth).damping).toBe(seaDamp(depth));
  expect(swellDriver(1).waves).toEqual(WAVES);
});
