// oxlint-disable-next-line import/no-nodejs-modules -- The page's half runs the shipped product and physics module.
import { readFileSync } from 'node:fs';
import { afterEach, expect, test } from 'vitest';
import { hasDeclaredClientPage } from '@wildshard/format/runtimeBinds';
import { lowerMoverMotion } from '@wildshard/format/moverMotion';
import { parseMovers } from '@wildshard/format/movers';
import { Scope } from '../src/shared/engine/app/scope';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { Physics } from '../src/shared/engine/physics/Physics';
import { floorBelow } from '../src/shared/engine/physics/query';
import type { MoverPose } from '@wildshard/format/moverPose';
import { installDataCellMovers } from '../src/client/game/grid/dataCellMovers';
import { moverLookKey, wirePage } from '../src/client/game/shardfile/wirePage';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { builtFolder } from '../src/test/game/builtFolder';

// TEMPLATE-E2E TC-E5b: a plain data shard (Mossgate, no client plan) in a live grid cell had no mover collider on the page, so
// its lift drew rising and nobody could ride it. The cell's movers now stand in its physics, posed off the wire's rows, and the
// same row poses the lift's drawn look.
const LIFT = 'template.lift';
afterEach(() => { wirePage.movers.clear(); wirePage.moverLooks.clear(); });
const at = (y: number): MoverPose => ({ position: { x: 4, y, z: 4 }, euler: { x: 0, y: 0, z: 0 }, enabled: true });

test('a data cell\'s lift stands where the wire poses it, and poses its look', { timeout: 60_000 }, async () => {
  const shard = (await loadHeadlessFolder(builtFolder('_template'))).shardfile;
  // Template rev 8 ships its own lift (TC-M4b); this test drives a fixed one of the same id, so it takes the product's place.
  const others = shard.movers.filter(mover => mover.id !== LIFT);
  expect(hasDeclaredClientPage(shard)).toBe(false); // the plain data path: no client plan installs its movers
  const rest = { at: { x: 4, y: 0, z: 4 }, euler: { x: 0, y: 0, z: 0 } };
  const motion = { driver: { kind: 'track' }, trigger: { kind: 'shared', field: 101, equals: 1 },
    track: { clip: 'rise', duration: 1, loop: 'once', speed: 1, times: [0, 1], position: [[0, 0, 0], [0, 3, 0]] } };
  const movers = parseMovers([{ id: LIFT, entity: 9001, kind: 'platform', ...rest, enabled: true,
    boxes: [{ x: 0, y: 0, z: 0, hx: 1, hy: 0.1, hz: 1, rot: { x: 0, y: 0, z: 0, w: 1 } }], ...lowerMoverMotion(motion, rest), ...motion, execution: 'native' }]);
  const physics = new Physics(await loadRapier(readFileSync('public/assets/physics/rapier.wasm'))), scope = new Scope('cell');
  const looked: number[] = [], look = { pose: (pose: MoverPose) => { looked.push(pose.position.y); } };
  wirePage.moverLooks.set(moverLookKey('cell', LIFT), look); wirePage.movers.set(LIFT, look); // the neighbour panel drew first
  const cell = installDataCellMovers({ movers: [...others, ...movers] }, { physics, scope }, 'cell');
  expect(wirePage.movers.get(LIFT)).toBe(look); // not the wire's until the feet enter
  cell?.claim();
  physics.step();
  expect(floorBelow(physics, 4, 4, 10, 20)).toBeCloseTo(0.1, 2);

  wirePage.movers.get(LIFT)?.pose(at(3), {});
  physics.step();
  expect(floorBelow(physics, 4, 4, 10, 20)).toBeCloseTo(3.1, 2);
  expect(looked).toEqual([3]);

  // a replay's deck: its collider stands at `at` at once
  wirePage.movers.get(LIFT)?.place?.(at(1), at(2));
  expect(floorBelow(physics, 4, 4, 10, 20)).toBeCloseTo(1.1, 2);

  // the cell goes: the look alone takes the wire back, and no row poses a freed body
  scope.dispose();
  expect(wirePage.movers.get(LIFT)).toBe(look);
  expect(() => { wirePage.movers.get(LIFT)?.pose(at(0), {}); }).not.toThrow();
  physics.dispose();

  // two copies of one product name the same lift: the rows pose the one the feet entered, and its own look
  const rapier = physics.R, a = { physics: new Physics(rapier), scope: new Scope('a') }, b = { physics: new Physics(rapier), scope: new Scope('b') };
  const seen: string[] = [];
  for (const id of ['a', 'b']) wirePage.moverLooks.set(moverLookKey(id, LIFT), { pose: () => { seen.push(id); } });
  const rows = { movers: [...others, ...movers] }, cellA = installDataCellMovers(rows, a, 'a'), cellB = installDataCellMovers(rows, b, 'b');
  cellA?.claim(); // admitted after A, B never takes A's rows
  wirePage.movers.get(LIFT)?.pose(at(3), {}); a.physics.step(); b.physics.step();
  expect(floorBelow(a.physics, 4, 4, 10, 20)).toBeCloseTo(3.1, 2);
  expect(floorBelow(b.physics, 4, 4, 10, 20)).toBeCloseTo(0.1, 2);
  expect(seen).toEqual(['a']);
  cellB?.claim(); b.scope.dispose(); // B goes while it holds the id: its look is gone too, so the id leaves the wire
  a.scope.dispose(); a.physics.dispose(); b.physics.dispose();
});
