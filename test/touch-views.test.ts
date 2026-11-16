// oxlint-disable-next-line import/no-nodejs-modules -- The page's half runs the shipped physics module.
import { readFileSync } from 'node:fs';
import { Group } from 'three';
import { afterEach, expect, test } from 'vitest';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { Scope } from '../src/shared/engine/app/scope';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { Physics } from '../src/shared/engine/physics/Physics';
import { floorBelow } from '../src/shared/engine/physics/query';
import { installDataCellBodies, installDataPageBodies } from '../src/client/game/shardfile/touchViews';
import { moverLookKey, wirePage } from '../src/client/game/shardfile/wirePage';

// meta SHARD-SOURCE SS9c: a touchable crate stands on the page where the wire's pose (the server's body) puts it, and its
// named panel is drawn there; a grid cell's stand-in takes the wire only once the feet enter the cell.
afterEach(() => { wirePage.movers.clear(); wirePage.moverLooks.clear(); });
const row = { id: 'yard.crate', panel: 'crate', at: { x: 4, y: 0.4, z: -3 }, yaw: 0.5, shape: { cuboid: { x: 0.4, y: 0.4, z: 0.4 } }, material: 'wood' } as const;
const source = { props: { version: 1, family: 'scene', tiles: [], panels: [{ id: 'crate', file: '0'.repeat(64), visible: true }], models: [], far: null, colliders: [], textures: [], bodies: [row] } } as unknown as Pick<Shardfile, 'props'>;
const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
const moved = { position: { x: 6, y: 0.4, z: -2 }, euler: { x: 0, y: 1.1, z: 0 }, enabled: true };

test('a page\'s crate stands where the wire poses it, and its panel is drawn there', () => {
  const physics = new Physics(rapier), scope = new Scope('page'), panel = new Group();
  expect(installDataPageBodies(source, { physics, scope, panels: new Map([['crate', panel]]) })).toBe(1);
  physics.step();
  expect(floorBelow(physics, 4, -3, 5, 10)).toBeCloseTo(0.8, 3);
  wirePage.movers.get('yard.crate')?.pose(moved, {});
  physics.step();
  expect(floorBelow(physics, 6, -2, 5, 10)).toBeCloseTo(0.8, 3);
  expect(floorBelow(physics, 4, -3, 5, 10)).toBeUndefined();
  // the panel is baked at the rest; its drawn transform is the wire's pose times the rest's inverse
  expect(panel.position.x).toBeCloseTo(6 - (4 * Math.cos(0.6) - 3 * Math.sin(0.6)), 3);
  expect(panel.rotation.y).toBeCloseTo(0.6, 4);
  scope.dispose();
  expect(wirePage.movers.has('yard.crate')).toBe(false);
});

test('a grid cell\'s crate takes the wire once claimed, and poses the cell\'s drawn panel', () => {
  const physics = new Physics(rapier), scope = new Scope('cell'), seen: number[] = [];
  wirePage.moverLooks.set(moverLookKey('cell-a', 'yard.crate'), { pose: (pose) => { seen.push(pose.position.x); } });
  const cell = installDataCellBodies(source, { physics, scope }, 'cell-a');
  if (cell === null) throw new Error('no bodies');
  expect(wirePage.movers.has('yard.crate')).toBe(false);
  cell.claim();
  wirePage.movers.get('yard.crate')?.pose(moved, {});
  physics.step();
  expect(floorBelow(physics, 6, -2, 5, 10)).toBeCloseTo(0.8, 3);
  expect(seen).toEqual([6]);
  // the cell goes: its drawn look keeps the id
  scope.dispose();
  expect(wirePage.movers.get('yard.crate')).toBe(wirePage.moverLooks.get(moverLookKey('cell-a', 'yard.crate')));
  expect(installDataCellBodies({ props: null } as unknown as Pick<Shardfile, 'props'>, { physics, scope: new Scope('empty') }, 'cell-b')).toBeNull();
});
