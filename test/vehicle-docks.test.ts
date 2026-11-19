// oxlint-disable-next-line import/no-nodejs-modules -- Runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { Physics } from '../src/shared/engine/physics/Physics';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { actRoutes } from '../src/shared/engine/sim/actRoutes';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { serverInputFiles } from '../src/shared/game/shardfile/serverSkinRigs';
import type { ShardFolder } from '../src/shared/game/shardfile/shardFolder';
import { dockedShard, shardVehicles } from '../src/shared/game/shardfile/shardVehicles';
import { carryPrompt } from '../src/shared/game/shardfile/wirePrompts';
import { createShardfileSim } from '../src/server/game/plugin/simulation';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { openCellWorld } from '../src/server/host/standalone/cellWorld';
import { SaveStore } from '../src/shared/engine/saves/store';
import { installDataPageMovers } from '../src/client/game/shardfile/dataPageMovers';
import { installDataCellMovers } from '../src/client/game/grid/dataCellMovers';
import { installClientMoverOwners } from '../src/client/game/shardfile/clientMoverOwners';
import { bindResidentWorldScope } from '../src/client/game/shardfile/runtimePagePresentation';
import type { ShardContext } from '../src/client/game/plugin/context';
import type { installFollowedMovers } from '../src/client/game/plugin/followedMovers';
import { GAMEPLAY_SLICE } from './fixtures/gameplaySlice';
import { vehiclesExampleFolder } from './fixtures/vehiclesExample';

// MIRROR-SALT-ZONE MSZ6: the engine reads a product's `world/vehicles` (format 0.53.0) on every install path the
// GRID-CELL-PARITY audit names: the one-shard page, the scene client plan, the grid data cell and the dedicated cell server.
// Until MSZ8's vehicle runtime, each dock runs as the steer carry these paths already drive (format `vehicleCarryMovers`),
// so each path finds the example's two kinds by their docks: the buggy's and the land-sail's own prompts and hulls.
const DOCKS = [['yard.buggy', 'Drive the buggy'], ['line.sail', 'Board the land-sail']] as const;
const boards = (prompts: readonly { readonly label: string }[]): string[] => prompts.map(row => row.label).filter(label => DOCKS.some(([, board]) => board === label));
const docksOf = (rows: readonly { readonly id: string }[]): string[] => rows.map(row => row.id).filter(id => DOCKS.some(([dock]) => dock === id));

let folder: ReturnType<typeof vehiclesExampleFolder>, product: ShardFolder, rapier: Rapier, assets: Map<string, Uint8Array>;
beforeAll(async () => {
  folder = vehiclesExampleFolder();
  product = await loadHeadlessFolder(folder.directory);
  rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing the example output');
  assets = new Map(serverInputFiles(descriptor.index.files, product.shardfile).map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${folder.directory}/${file.path}`))]));
});
afterAll(() => { folder.dispose(); });
const quest = { fact: () => undefined, coins: () => undefined };

test('the loader admits the section: two kinds, each with its dock', () => {
  const vehicles = shardVehicles(product.shardfile);
  expect(vehicles.kinds.map(kind => [kind.id, kind.seats.length])).toEqual([['salt.buggy', 2], ['salt.land-sail', 1]]);
  expect(vehicles.docks.map(dock => [dock.id, dock.kind])).toEqual([['yard.buggy', 'salt.buggy'], ['line.sail', 'salt.land-sail']]);
  // after the product's own movers, as steer carries numbered on from its last mover entity (sharddev starts at 9101)
  const own = product.shardfile.movers, docked = dockedShard(product.shardfile), next = Math.max(9101, ...own.map(row => row.entity + 1));
  expect(docked.movers.slice(0, own.length)).toEqual(own);
  expect(docked.movers.slice(own.length).map(row => [row.id, row.driver?.kind, row.entity])).toEqual([['yard.buggy', 'steer', next], ['line.sail', 'steer', next + 1]]);
  expect(dockedShard(docked)).toBe(docked);
  expect(dockedShard(product.shardfile)).toBe(docked);
});

describe('each install path finds both docks', () => {
  test('one-shard page: the room steps them and the page follows them', () => {
    const sim = createShardfileSim(product.shardfile, assets, { rapier, quest });
    try {
      expect(boards(sim.movers?.ridePrompts() ?? [])).toEqual(DOCKS.map(([, board]) => board));
      expect(DOCKS.map(([dock]) => sim.movers?.pose(dock).position.z)).toEqual([20, 20]);
    } finally { sim.dispose(); }
    const scope = new Scope('page'), movers = installDataPageMovers(product.shardfile, { physics: new Physics(rapier), scope });
    try {
      expect(docksOf(movers?.data ?? [])).toEqual(DOCKS.map(([dock]) => dock));
      expect(boards(movers?.ridePrompts() ?? [])).toEqual(DOCKS.map(([, board]) => board));
    } finally { scope.dispose(); }
  });

  test('scene client plan: the plan\'s mover owners follow them beside its bound movers', async () => {
    const scope = new Scope('entered'), resident = new Scope('resident');
    bindResidentWorldScope(scope, resident);
    const plan = { has: (name: string) => product.has(name as never), section: (name: string) => (name === 'world/movers' ? { movers: [] } : product.section(name as never)), shardfile: product.shardfile };
    const ctx = { scope, game: { runtime: { world: {} } }, product: plan } as unknown as ShardContext;
    let given: Parameters<typeof installFollowedMovers>[2] | undefined;
    const install = ((_ctx, _world, options) => { given = options; return {} as ReturnType<typeof installFollowedMovers>; }) as typeof installFollowedMovers;
    try {
      await installClientMoverOwners(ctx, { system: 'vehicles', bindings: [] }, install);
      expect(docksOf(given?.data ?? [])).toEqual(DOCKS.map(([dock]) => dock));
      expect(DOCKS.map(([dock]) => given?.hulls?.get(dock)?.length)).toEqual([1, 1]);
    } finally { scope.dispose(); resident.dispose(); }
  });

  test('grid data cell: the cell\'s movers hold them and offer their prompts', () => {
    const scope = new Scope('cell'), cell = installDataCellMovers(product.shardfile, { physics: new Physics(rapier), scope }, 'vehicles-cell');
    try {
      expect(docksOf(cell?.movers.data ?? [])).toEqual(DOCKS.map(([dock]) => dock));
      expect(boards(cell?.movers.ridePrompts() ?? [])).toEqual(DOCKS.map(([, board]) => board));
    } finally { scope.dispose(); }
  });

  test('dedicated cell server: the cell claims each dock\'s board prompt', async () => {
    const cell = await openCellWorld({ instance: 'vehicles-cell' }, { shard: product.shardfile, product, assets, rapier } as never, undefined,
      { saves: new SaveStore({ local: null, session: null }), lone: true, pageless: true });
    try {
      const claims = actRoutes(cell.host).claims;
      expect(DOCKS.map(([dock]) => [claims.has(carryPrompt(dock, 0)), claims.has(carryPrompt(dock, 1))])).toEqual([[true, true], [true, true]]);
    } finally { cell.dispose(); }
  });
});

test('a product with no vehicles loads as before', async () => {
  const plain = await loadHeadlessFolder(GAMEPLAY_SLICE);
  expect(shardVehicles(plain.shardfile).docks).toEqual([]);
  expect(dockedShard(plain.shardfile)).toBe(plain.shardfile);
});
