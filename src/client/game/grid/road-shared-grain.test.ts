import {expect, test} from 'vitest';
import {DataArrayTexture, DataTexture, Group} from 'three';
import {Scope} from '@wildshard/engine/app/scope';
import {installPlatformRoad} from './roadLookPlatform';
import {RoadMapShare} from './roadResources';
import type {PlatformRenderAdmission, PlatformRenderBytePlan} from './renderResidency';

test('ring-first halves borrow one grain upload until the last half retires', () => {
  const maps = new RoadMapShare(), grain = new DataArrayTexture(new Uint8Array(4), 1, 1, 1);
  let disposed = 0; grain.addEventListener('dispose', () => { disposed++; });
  maps.hold('road.deck-grain', grain);
  for (const id of ['road.asphalt', 'road.junctions']) maps.hold(id, new DataTexture(new Uint8Array(4), 1, 1));
  const first = new Scope('first half'), second = new Scope('second half'), plans: PlatformRenderBytePlan[] = [];
  const build = (scope: Scope): void => {
    const admission: PlatformRenderAdmission = {allocate: (plan, factory) => { plans.push(plan); return factory(scope.child(plan.id)); }};
    installPlatformRoad({maps, scope, admission, strips: [], pitch: 562.5, scene: new Group(), plans: new Map(), voidFloor: false,
      home: {instance: 'test', slug: 'test', cell: [0, 0], origin: {x: 0, y: 0, z: 0}},
      signs: layout => new Uint8Array(layout.width * layout.height * 2),
      layout: {segments: [], junctions: [], signs: [], lights: [], holes: [],
        rail: {minX: 0, maxX: 0, minZ: 0, maxZ: 0}, edge: {minX: 0, maxX: 0, minZ: 0, maxZ: 0}}});
  };
  try {
    build(first); build(second);
    expect(plans.filter(plan => plan.id === 'road.deck').every(plan => plan.gpuBytes === 0)).toBe(true);
    maps.release('road.deck-grain', grain); // release the original owner's count
    first.dispose(); expect(disposed).toBe(0);
    second.dispose(); expect(disposed).toBe(1);
    expect(maps.has('road.deck-grain')).toBe(false);
  } finally { first.dispose(); second.dispose(); }
});
