import { expect, test } from 'vitest';
import { Group } from 'three';
import type { Placed } from '@wildshard/engine/models/place';
import { fixedDraws } from './fixedDraws';
import { Scope } from '@wildshard/engine/app/scope';
import { CollectionCatalogue } from './collectionDisplay';
import { SceneHandles } from '../shardfile/sceneHandles';
import { entryOwner, lateEntryOwner, lendEntryOwner, publishEntryOwner } from '../../../shared/game/shardfile/entryOwners';

test('entry ids resolve only their concrete kind and exact construction owner', () => {
  const owner = new Scope('construction'), other = new Scope('another cell');
  const object = new Group(), scenes = new SceneHandles();
  try {
    publishEntryOwner(owner, 'object', 'world.root', object);
    publishEntryOwner(owner, 'scenes', 'world.root', scenes);
    expect(entryOwner(owner, 'object', 'world.root')).toBe(object);
    expect(entryOwner(owner, 'scenes', 'world.root')).toBe(scenes);
    expect(() => entryOwner(other, 'object', 'world.root')).toThrow('Missing live');
    expect(() => entryOwner(owner, 'chain', 'world.root')).toThrow('Missing live');
    expect(() => publishEntryOwner(owner, 'object', 'world.root', object)).toThrow('Duplicate');
    expect(() => publishEntryOwner(owner, 'object', '../world', object)).toThrow('Invalid');
    expect(() => lendEntryOwner(other, owner, 'object', 'world.root')).toThrow('ancestor');
  } finally { other.dispose(); owner.dispose(); }
});

test('re-entered loans leave original resources alive and remove resident cleanup registrations', () => {
  const resident = new Scope('resident'), object = new Group();
  publishEntryOwner(resident, 'object', 'world.root', object);
  const baseline = resident.census.disposers;
  try {
    for (let visit = 0; visit < 4; visit++) {
      const entered = resident.child('entered');
      const beforeLoan = resident.census.disposers;
      lendEntryOwner(entered, resident, 'object', 'world.root');
      expect(entryOwner(entered, 'object', 'world.root')).toBe(object);
      expect(resident.census.disposers).toBe(beforeLoan + 2);
      entered.dispose();
      expect(() => entryOwner(entered, 'object', 'world.root')).toThrow('ended');
      expect(entryOwner(resident, 'object', 'world.root')).toBe(object);
      expect(resident.census.disposers).toBe(baseline);
    }
  } finally { resident.dispose(); }
});

test('a transitive loan cannot outlive its original construction owner', () => {
  const resident = new Scope('resident'), entered = resident.child('entered'), nested = entered.child('nested');
  const object = new Group();
  publishEntryOwner(resident, 'object', 'world.root', object);
  lendEntryOwner(entered, resident, 'object', 'world.root');
  lendEntryOwner(nested, entered, 'object', 'world.root');
  expect(entryOwner(nested, 'object', 'world.root')).toBe(object);
  expect(() => lendEntryOwner(entered, resident, 'object', 'world.root')).toThrow('Duplicate');
  expect(() => lendEntryOwner(resident, resident, 'object', 'world.root')).toThrow('ancestor');
  resident.dispose();
  expect(() => entryOwner(nested, 'object', 'world.root')).toThrow('ended');
  expect(() => publishEntryOwner(resident, 'object', 'late', object)).toThrow('ended');
  expect(resident.census.disposers).toBe(0);
});


test('a collection loan preserves the actual catalogue and its fixed geometry owner', () => {
  const resident = new Scope('collection construction'), entered = resident.child('quest');
  const catalogue = new CollectionCatalogue('fixture-collection', new Map());
  try {
    publishEntryOwner(resident, 'collection', 'keepsakes', catalogue);
    lendEntryOwner(entered, resident, 'collection', 'keepsakes');
    expect(entryOwner(entered, 'collection', 'keepsakes')).toBe(catalogue);
    entered.dispose();
    expect(entryOwner(resident, 'collection', 'keepsakes')).toBe(catalogue);
  } finally { resident.dispose(); }
});


test('world metadata loans retain their original instances through re-entry', () => {
  const resident = new Scope('world construction');
  const placed: readonly Placed[] = [];
  const anchors = { door: { x: 1, y: 2, z: 3, yaw: 0.5 } };
  const floor = (x: number, z: number): number | undefined => x >= 0 && z >= 0 ? 2 : undefined;
  const draws = fixedDraws({ slug: 'fixture-harbour', file: () => Promise.reject(new Error('No decode during lending')) },
    [{ slot: 'figure', file: 'figure.glb', channels: [] }]);
  publishEntryOwner(resident, 'placed', 'hut', placed);
  publishEntryOwner(resident, 'site', 'hut', anchors);
  publishEntryOwner(resident, 'floor', 'hut', floor);
  publishEntryOwner(resident, 'fixed-draws', 'world.draws', draws);
  const baseline = resident.census.disposers;
  try {
    for (let visit = 0; visit < 2; visit++) {
      const entered = resident.child('world borrower');
      for (const kind of ['placed', 'site', 'floor'] as const) lendEntryOwner(entered, resident, kind, 'hut');
      lendEntryOwner(entered, resident, 'fixed-draws', 'world.draws');
      expect(entryOwner(entered, 'placed', 'hut')).toBe(placed);
      expect(entryOwner(entered, 'site', 'hut')).toBe(anchors);
      expect(entryOwner(entered, 'floor', 'hut')).toBe(floor);
      expect(entryOwner(entered, 'floor', 'hut')(1, 1)).toBe(2);
      expect(entryOwner(entered, 'floor', 'hut')(-1, 1)).toBeUndefined();
      expect(entryOwner(entered, 'fixed-draws', 'world.draws')).toBe(draws);
      expect(draws.ready).toBe(false);
      entered.dispose();
      expect(resident.census.disposers).toBe(baseline);
      expect(entryOwner(resident, 'fixed-draws', 'world.draws')).toBe(draws);
    }
    const entered = resident.child('last borrower');
    lendEntryOwner(entered, resident, 'site', 'hut');
    resident.dispose();
    expect(() => entryOwner(entered, 'site', 'hut')).toThrow('ended');
  } finally { resident.dispose(); }
});


test('a late loan waits for its exact kind and scope, and retains the original lifetime', () => {
  const owner = new Scope('late construction'), other = new Scope('other construction');
  const entered = owner.child('late entered'), object = new Group();
  try {
    const read = lateEntryOwner(entered, 'object', 'world.late');
    expect(() => read()).toThrow('Missing live entry owner');
    publishEntryOwner(other, 'object', 'world.late', new Group());
    expect(() => read()).toThrow('Missing live entry owner');
    publishEntryOwner(owner, 'object', 'world.late', object);
    expect(() => read()).toThrow('Missing live entry owner');
    lendEntryOwner(entered, owner, 'object', 'world.late');
    expect(read()).toBe(object); expect(read()).toBe(object);
    expect(() => publishEntryOwner(entered, 'object', 'world.late', new Group())).toThrow('Duplicate');
    const retire = owner.disposeSteps(); retire.next();
    expect(() => read()).toThrow(/ended|Missing live/u);
    for (const step of retire) void step;
  } finally { owner.dispose(); other.dispose(); }
});

test('a late loan cannot start after its borrower begins retirement', () => {
  const owner = new Scope('late unconsumed'), read = lateEntryOwner(owner, 'object', 'world.late');
  owner.dispose();
  expect(() => read()).toThrow('ended');
});
