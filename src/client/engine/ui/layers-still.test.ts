import { expect, test } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { UiLayers } from './layers';

test('FC3: a glass screen holds the world still while its scope lives, and primes one frame when the hold starts', () => {
  const layers = new UiLayers(), root = new Scope('fixture');
  let primed = 0;
  layers.onStill = () => { primed += 1; };
  expect(layers.still).toBe(false);
  const journal = root.child('journal'), shop = root.child('shop');
  layers.holdStill(journal);
  layers.holdStill(journal);
  expect(layers.still).toBe(true);
  layers.holdStill(shop);
  expect(primed).toBe(1); // a second glass screen over the first draws no new frame
  journal.dispose();
  expect(layers.still).toBe(true);
  shop.dispose();
  expect(layers.still).toBe(false);
  layers.holdStill(root.child('board'));
  expect(primed).toBe(2);
  root.dispose(); // a cell that leaves with the panel open releases the world
  expect(layers.still).toBe(false);
  const gone = new Scope('gone'); gone.dispose();
  layers.holdStill(gone);
  expect(layers.still).toBe(false);
});

test('retiring a world releases its capture callback instead of retaining the world driver',()=>{
  const layers=new UiLayers(),world=new Scope('world-capture');let captures=0;
  layers.bindStill(world,()=>{captures++;});world.dispose();expect(layers.onStill).toBeUndefined();
  const panel=new Scope('panel');layers.holdStill(panel);expect(captures).toBe(0);panel.dispose();
});

test('an old world retirement cannot erase the replacement world capture port',()=>{
  const layers=new UiLayers(),old=new Scope('old-world'),next=new Scope('next-world');let captures=0;
  layers.bindStill(old,()=>{throw new Error('old capture');});layers.bindStill(next,()=>{captures++;});old.dispose();
  const panel=new Scope('new-panel');layers.holdStill(panel);expect(captures).toBe(1);panel.dispose();next.dispose();expect(layers.onStill).toBeUndefined();
});
