import { expect, test } from 'vitest';
import { followRing } from './tileDriver';

// Tile streaming T6: the creature ring follows the viewer's tile; an animal outside it sleeps.
test('the creature ring keeps the 5 x 5 around the viewer and follows a jump', () => {
  const follow = followRing();                            // the 5 x 5
  const atSpawn = follow({ x: 0, z: -235 });
  expect(atSpawn(0, -200)).toBe(true);                    // the viewer's own tile
  expect(atSpawn(100, -120)).toBe(true);                  // two tiles out
  expect(atSpawn(0, 100)).toBe(false);                    // the far side of the cell
  const atKing = follow({ x: 128, z: -30 });              // a jump 3 m inside a far tile moves the ring at once
  expect(atKing(140, -20)).toBe(true);
  expect(atKing(0, -235)).toBe(false);
});
