import { expect, test } from 'vitest';
import { ownFarView } from '../src/cook/game/shardCook';

// SF4: a fence shard's phone whole set carries the zone's own far view, which the grid reads outside the fence.
test("a zone's own far view, and nothing else, rides a fence shard's phone whole set", () => {
  for (const file of ['far.json', 'far.glb', 'far-impostor.png']) expect(ownFarView(`/assets/driftwood-isle/baked/${file}`, 'driftwood-isle')).toBe(true);
  expect(ownFarView('/assets/driftwood-isle/baked/far.json', '_driftwood-isle')).toBe(true);
  expect(ownFarView('/assets/driftwood-isle/baked/near.glb', 'driftwood-isle')).toBe(false);
  expect(ownFarView('/assets/far-reach/baked/far.glb', 'driftwood-isle')).toBe(false);
  expect(ownFarView('/assets/baked/driftwood-isle/far.glb', 'driftwood-isle')).toBe(false);
});
