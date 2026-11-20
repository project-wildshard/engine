import { expect, test } from 'vitest';
import { frameCost } from './frameCost';

test('the update meter names unbucketed work and books split systems once', () => {
  frameCost.begin();
  frameCost.section('world', 0.75);
  frameCost.system('world.scenery', 1.25);
  frameCost.section('audio', 0.25);
  frameCost.system('main.frame', 1);
  frameCost.sectionOther('grid.road tiles', 0.5);
  frameCost.system('game.grid.frame', 0.75);
  frameCost.system('engine.network', 0.75);
  frameCost.system('engine.network', 0.5);
  frameCost.other('phase scheduling', 0.5);
  frameCost.end(33, 4.75, 5, 33);
  const { buckets, otherParts } = frameCost.snapshot();
  expect(buckets.world).toBe(1.25);
  expect(buckets.audio).toBe(0.25);
  expect(buckets.other).toBe(3.25);
  expect([...otherParts]).toEqual([['main.frame', 0.75], ['grid.road tiles', 0.5], ['game.grid.frame', 0.25], ['engine.network', 1.25], ['phase scheduling', 0.5]]);
});
