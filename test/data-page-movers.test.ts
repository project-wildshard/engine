// oxlint-disable-next-line import/no-nodejs-modules -- The page's half runs the shipped product and physics module.
import { readFileSync } from 'node:fs';
import { Group } from 'three';
import { afterEach, expect, test } from 'vitest';
import { hasDeclaredClientPage } from '@wildshard/format/runtimeBinds';
import { Scope } from '../src/shared/engine/app/scope';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { Physics } from '../src/shared/engine/physics/Physics';
import { floorBelow } from '../src/shared/engine/physics/query';
import { installDataPageMovers } from '../src/client/game/shardfile/dataPageMovers';
import { wirePage } from '../src/client/game/shardfile/wirePage';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { GAMEPLAY_SLICE } from './fixtures/gameplaySlice';

// TEMPLATE-E2E TC-E5c: Mossgate's one-shard page (the retired Template's zone-alone address, no client plan) built no collider for its lift, so a
// player stood under it as it rose; a grid cell had one (TC-E5b). The page's movers now stand in its physics, posed off the wire.
const LIFT = 'template.lift';
afterEach(() => { wirePage.movers.clear(); });

test('a one-shard data page\'s lift stands where the wire poses it, and poses its panel', { timeout: 60_000 }, async () => {
  const shard = (await loadHeadlessFolder(GAMEPLAY_SLICE)).shardfile;
  expect(hasDeclaredClientPage(shard)).toBe(false); // the plain data path: no client plan installs its movers
  const lift = shard.movers.find(row => row.id === LIFT);
  if (lift === undefined) throw new Error('Template rev 8 ships its lift');
  const physics = new Physics(await loadRapier(readFileSync('public/assets/physics/rapier.wasm'))), scope = new Scope('page');
  const panel = new Group(), { x, z } = lift.at;
  panel.position.set(x, lift.at.y, z);
  installDataPageMovers(shard, { physics, scope, panels: new Map([[LIFT, panel]]) });
  physics.step();
  const rest = floorBelow(physics, x, z, lift.at.y + 20, 40);
  expect(rest).toBeDefined();

  const up = { position: { x, y: lift.at.y + 3, z }, euler: { ...lift.euler }, enabled: true };
  wirePage.movers.get(LIFT)?.pose(up, {});
  physics.step();
  expect(floorBelow(physics, x, z, lift.at.y + 20, 40)).toBeCloseTo((rest ?? 0) + 3, 2);
  expect(panel.position.y).toBeCloseTo(lift.at.y + 3, 4);

  // the page goes: its views leave the wire, and no row poses a freed body
  scope.dispose();
  expect(wirePage.movers.has(LIFT)).toBe(false);
  physics.dispose();
});
