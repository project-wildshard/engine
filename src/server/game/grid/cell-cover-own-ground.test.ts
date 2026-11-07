import { expect, test } from 'vitest';
import { cellCoverPort } from '../../../client/game/grid/cellCover';

// G784 / D189: a world that draws its whole cell's ground itself hides the coarse root at once; one whose ground is the
// coarse tiles keeps them until their replacement is ready (Pine went white when every entered cell hid at once)
test('own-ground covers hide at once; tile-ground covers wait for their replacement', () => {
  const roots = new Map([['own', { visible: true }], ['tiles', { visible: true }]]);
  let replaced = false;
  const port = cellCoverPort(id => roots.get(id), () => replaced);
  const releaseOwn = port.cover('own', true), releaseTiles = port.cover('tiles');
  expect(roots.get('own')?.visible).toBe(false);
  expect(roots.get('tiles')?.visible).toBe(true);
  replaced = true; port.refresh();
  expect(roots.get('tiles')?.visible).toBe(false);
  // a refresh before replacement never brings an own-ground root back
  replaced = false; port.refresh();
  expect(roots.get('own')?.visible).toBe(false);
  expect(roots.get('tiles')?.visible).toBe(true);
  releaseOwn(); releaseTiles();
  expect(roots.get('own')?.visible).toBe(true);
  expect(roots.get('tiles')?.visible).toBe(true);
  // a later tile-ground entry of the same cell does not inherit the earlier own-ground cover
  port.cover('own');
  expect(roots.get('own')?.visible).toBe(true);
});
