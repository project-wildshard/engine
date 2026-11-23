// oxlint-disable-next-line import/no-nodejs-modules -- Runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { Physics } from '../src/shared/engine/physics/Physics';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { actRoutes } from '../src/shared/engine/sim/actRoutes';
import { shardRows } from '../src/shared/engine/sim/shardRows';
import type { Interactable } from '../src/shared/engine/world/interact/types';
import { pickPrompt } from '../src/shared/engine/world/interact/prompts';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { serverInputFiles } from '../src/shared/game/shardfile/serverSkinRigs';
import type { ShardFolder } from '../src/shared/game/shardfile/shardFolder';
import { shardVehicles } from '../src/shared/game/shardfile/shardVehicles';
import { vehicleHulls } from '@wildshard/format/vehicleHulls';
import { playerVehicle, vehicleDockPrompt, vehicleLeavePrompt, vehicleSeatPrompt } from '../src/shared/game/shardfile/wirePrompts';
import { createShardfileSim, prepareShardfileSimRestore } from '../src/server/game/plugin/simulation';
import { createSimHost } from '../src/server/engine/sim';
import { VehicleRuntime } from '../src/server/game/plugin/vehicleRuntime';
import { snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { questBooks } from '../src/shared/engine/quest/players';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { openCellWorld } from '../src/server/host/standalone/cellWorld';
import { SaveStore } from '../src/shared/engine/saves/store';
import { installDataPageMovers } from '../src/client/game/shardfile/dataPageMovers';
import { dressCellVehicles, installDataCellMovers } from '../src/client/game/grid/dataCellMovers';
import { vehicleDress } from '../src/client/game/plugin/vehicleFx';
import { Group, type Object3D } from 'three';
import { cellRidePrompts } from '../src/client/game/grid/dataCellRides';
import { installClientMoverOwners } from '../src/client/game/shardfile/clientMoverOwners';
import { bindResidentWorldScope } from '../src/client/game/shardfile/runtimePagePresentation';
import { wirePage } from '../src/client/game/shardfile/wirePage';
import type { ShardContext } from '../src/client/game/plugin/context';
import type { installFollowedMovers } from '../src/client/game/plugin/followedMovers';
import { FollowedVehicles, type VehicleDress } from '../src/client/game/plugin/followedVehicles';
import { GAMEPLAY_SLICE } from './fixtures/gameplaySlice';
import { SIM_LEVEL } from './fixtures/sim-level/level';
import { vehiclesExampleFolder } from './fixtures/vehiclesExample';

// MIRROR-SALT-ZONE MSZ6, MSZ9b: the engine reads a product's `world/vehicles` (format 0.53.0) on every install path the
// GRID-CELL-PARITY audit names: the one-shard page, the scene client plan, the grid data cell and the dedicated cell server.
// Each server path runs the docks in `VehicleRuntime` (the shared land-sail out at once, its row on the wire; the buggy's player
// dock claimed by its prompt), and each page path follows them with `FollowedVehicles`, offering the dock's and the seats' prompts.
const SAIL = 'line.sail', BUGGY = 'yard.buggy', DOCKS = [BUGGY, SAIL];
const MINE = playerVehicle(BUGGY, 'actor.player');
/** The prompts in reach of `feet` (as the page's picker reads them): their wire ids and labels. */
const shown = (prompts: readonly Interactable[], feet = { x: -6, z: 20 }): (readonly [string | undefined, string])[] => prompts
  .filter(row => { const radius = row.radius; return radius > 0 && Math.hypot(row.position.x - feet.x, row.position.z - feet.z) <= radius; }).map(row => [row.wireId, row.label] as const);
/** The page's follower as the wire syncs it: the land-sail's row out, no seat taken, this player at the buggy's dock. */
function synced(vehicles: FollowedVehicles | null | undefined): FollowedVehicles {
  if (vehicles === null || vehicles === undefined) throw new Error('No followed vehicles');
  vehicles.sync([`script:${SAIL}`], 'actor.player', { x: -6, z: 20 });
  return vehicles;
}
const followed = (key: string): FollowedVehicles | undefined => wirePage.vehicles.get(key) as FollowedVehicles | undefined;

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

test('the loader admits the section: two kinds, each with its dock, and no mover stands for one', () => {
  const vehicles = shardVehicles(product.shardfile);
  expect(vehicles.kinds.map(kind => [kind.id, kind.seats.length])).toEqual([['salt.buggy', 2], ['salt.land-sail', 1]]);
  expect(vehicles.docks.map(dock => [dock.id, dock.kind, dock.per])).toEqual([[BUGGY, 'salt.buggy', 'player'], [SAIL, 'salt.land-sail', 'shared']]);
  expect(product.shardfile.movers.some(row => DOCKS.includes(row.id))).toBe(false);
  expect(DOCKS.some(dock => vehicleHulls(product.shardfile).has(dock))).toBe(false);
});

test('a quest flag unlocks a vehicle dock for its owner only', () => {
  const host = createSimHost({ ...SIM_LEVEL, entities: [], ground: { size: 120, height: 0 } }, { rapier });
  const scope = new Scope('reward-dock');
  const original = shardVehicles(product.shardfile);
  const dock = original.docks.find(row => row.id === BUGGY);
  if (dock === undefined) throw new Error('Missing example buggy dock');
  const id = 'reward.buggy', flag = 'reward.dock.earned';
  const gated = { kinds: original.kinds, docks: [{ ...dock, id, requiresFlag: flag }] };
  const server = new VehicleRuntime(gated, { physics: () => host.physics, stick: () => undefined });
  const page = new FollowedVehicles(gated, { physics: new Physics(rapier), scope });
  try {
    server.bind(host);
    const player = leadPlayer(host);
    const books = questBooks(host), guest = 'another-player';
    host.addPlayer(guest);
    books.claim([flag]);
    const feet = { x: dock.at[0], z: dock.at[2] };
    const prompt = vehicleDockPrompt(id);
    page.sync([], player.id, feet);
    expect(shown(page.prompts(), feet)).toEqual([]);
    player.position.set(...dock.at);
    actRoutes(host).claims.get(prompt)?.(player.id);
    expect(server.ids()).toEqual([]);

    books.of(player.id).flags.set(flag);
    const progress = books.progressOf(player.id, -1);
    page.sync([], player.id, feet, new Set(progress?.flags));
    expect(shown(page.prompts(), feet)).toEqual([[prompt, 'Drive the buggy']]);
    expect(books.progressOf(guest, -1)?.flags).not.toContain(flag);
    const second = host.players.get(guest);
    if (second === undefined) throw new Error('Missing guest');
    second.position.set(...dock.at);
    actRoutes(host).claims.get(prompt)?.(guest);
    expect(server.ids()).toEqual([]);
    actRoutes(host).claims.get(prompt)?.(player.id);
    expect(server.seatOf(player.id)?.vehicle).toBe(playerVehicle(id, player.id));
  } finally { server.dispose(); scope.dispose(); host.dispose(); }
});

describe('each install path finds both docks\' vehicles', () => {
  test('one-shard page: the room runs them in VehicleRuntime and the page follows them', () => {
    const sim = createShardfileSim(product.shardfile, assets, { rapier, quest });
    try {
      const vehicles = sim.vehicles; if (vehicles === null) throw new Error('No vehicle runtime');
      expect(vehicles.ids()).toEqual([SAIL]);
      expect(vehicles.prompts().map(row => row.id)).toEqual([vehicleSeatPrompt(SAIL, 0), vehicleDockPrompt(BUGGY)]);
      expect(vehicles.pose(SAIL).position).toEqual({ x: 6, y: 0, z: 20 });
      expect(shardRows(sim.host).bodies.has(`script:${SAIL}`)).toBe(true);
      expect(sim.movers?.data.some(row => DOCKS.includes(row.id)) ?? false).toBe(false);
    } finally { sim.dispose(); }
    const scope = new Scope('page'), prompts: Interactable[] = [];
    installDataPageMovers(product.shardfile, { physics: new Physics(rapier), scope, prompts });
    try {
      const vehicles = synced(followed('page'));
      expect(vehicles.dockIds()).toEqual(DOCKS);
      expect(vehicles.ids()).toEqual([SAIL]);
      expect(shown(prompts)).toEqual([[vehicleDockPrompt(BUGGY), 'Drive the buggy']]);
      // meta MSZ43: the page picks from the eye, 1.7 m up; a dock's prompt at its ground point showed only from 1.8 m off, so
      // it hangs at the driver's seat height and shows from 2.3 m, inside the server's 2.5 m claim
      const dock = prompts.find(row => row.wireId === vehicleDockPrompt(BUGGY)), at = dock?.position;
      if (dock === undefined || at === undefined) throw new Error('No dock prompt');
      expect(at.y).toBeGreaterThan(0.5);
      expect(pickPrompt([dock], { x: at.x + 2.3, y: 1.7, z: at.z }, null)).toBe(dock);
    } finally { scope.dispose(); }
    expect(wirePage.vehicles.has('page')).toBe(false);
  });

  test('scene client plan: the plan\'s mover owners follow them beside its bound movers', async () => {
    const scope = new Scope('entered'), resident = new Scope('resident'), interactables: Interactable[] = [];
    bindResidentWorldScope(scope, resident);
    const plan = { has: (name: string) => product.has(name as never), section: (name: string) => (name === 'world/movers' ? { movers: [] } : product.section(name as never)), shardfile: product.shardfile };
    const ctx = { scope, game: { runtime: { world: { physics: new Physics(rapier) }, interactables } }, product: plan } as unknown as ShardContext;
    const install = (() => ({}) as ReturnType<typeof installFollowedMovers>) as typeof installFollowedMovers;
    try {
      await installClientMoverOwners(ctx, { system: 'vehicles', bindings: [] }, install);
      const vehicles = synced(followed('scene'));
      expect(vehicles.dockIds()).toEqual(DOCKS);
      // the buggy's row arrives once this player asks for it, and its seats' prompts follow it
      vehicles.follow(MINE, { position: { x: -6, y: 0, z: 20 }, euler: { x: 0, y: 0, z: 0 }, enabled: true });
      vehicles.sync([`script:${SAIL}`, `script:${MINE}`], 'actor.player', { x: -6, z: 20 });
      expect(shown(interactables)).toEqual([[vehicleSeatPrompt(MINE, 0), 'Drive the buggy'], [vehicleSeatPrompt(MINE, 1), 'Ride in the buggy']]);
      // seated, only the way out shows
      vehicles.sync([`script:${SAIL}`, `script:${MINE}`, `state:vehicle.seat|${MINE}|0|actor.player`], 'actor.player', { x: -6, z: 20 });
      expect(shown(interactables)).toEqual([[vehicleLeavePrompt(MINE), 'Get out']]);
      // the buggy's row leaves (it despawned): its body goes
      vehicles.sync([`script:${SAIL}`], 'actor.player', { x: -6, z: 20 });
      expect(vehicles.ids()).toEqual([SAIL]);
    } finally { scope.dispose(); resident.dispose(); }
  });

  test('grid data cell: the cell follows them and offers their prompts once claimed', () => {
    const scope = new Scope('cell'), cell = installDataCellMovers(product.shardfile, { physics: new Physics(rapier), scope }, 'vehicles-cell');
    try {
      expect(wirePage.vehicles.has('grid')).toBe(false);
      cell?.claim();
      const vehicles = synced(followed('grid'));
      expect(vehicles).toBe(cell?.vehicles);
      expect(vehicles.dockIds()).toEqual(DOCKS);
      // beside the land-sail's seat: its board prompt, and not the buggy's dock 12 m off
      vehicles.sync([`script:${SAIL}`], 'actor.player', { x: 6, z: 21 });
      expect(shown(cellRidePrompts(cell ?? null), { x: 6, z: 21 })).toEqual([[vehicleSeatPrompt(SAIL, 0), 'Board the land-sail']]);
    } finally { scope.dispose(); }
  });

  // MSZ14c: a grid cell admits its physics (its followed vehicles) and draws its panels apart, in either order; before this its
  // vehicles had no look, so on the grid a vehicle was invisible. Whichever comes second dresses them, and a vehicle already
  // out takes its panel copy where its row stands; a follower that goes hides its looks, and one back shows the same copy.
  test('grid data cell: its vehicles take their look from its drawn panels, whichever arrives first', () => {
    const kinds = shardVehicles(product.shardfile).kinds, page = new Scope('cell-panels');
    const drawn = (root: Group): Object3D[] => root.children.filter(child => child.visible && !child.name.startsWith('vehicle-'));
    const panelsIn = (root: Group): Map<string, Object3D> => new Map(kinds.map(kind => { const panel = new Group(); panel.visible = false; root.add(panel); return [kind.panel, panel] as const; }));
    const dressed = (root: Group): VehicleDress => { const dress = vehicleDress(kinds, panelsIn(root), page); if (dress === null) throw new Error('No dress'); return dress; };
    try {
      const rootA = new Group(), first = new Scope('cell-a');
      expect(installDataCellMovers(product.shardfile, { physics: new Physics(rapier), scope: first }, 'cell-a')?.vehicles?.ids()).toContain(SAIL);
      dressCellVehicles('cell-a', dressed(rootA), page);
      expect(drawn(rootA)).toHaveLength(1); // the shared sail, out from the start, shows once the panels come
      first.dispose();
      expect(drawn(rootA)).toHaveLength(0);
      const again = new Scope('cell-a2');
      installDataCellMovers(product.shardfile, { physics: new Physics(rapier), scope: again }, 'cell-a');
      expect(drawn(rootA)).toHaveLength(1);
      expect(rootA.children.filter(child => !child.name.startsWith('vehicle-'))).toHaveLength(kinds.length + 1); // no second copy
      again.dispose();
      const rootB = new Group(), second = new Scope('cell-b');
      dressCellVehicles('cell-b', dressed(rootB), page);
      installDataCellMovers(product.shardfile, { physics: new Physics(rapier), scope: second }, 'cell-b');
      expect(drawn(rootB)).toHaveLength(1); // panels first: the follower takes them at once
      second.dispose();
    } finally { page.dispose(); }
  });

  test('dedicated cell server: the cell runs them and claims their prompts', async () => {
    const cell = await openCellWorld({ instance: 'vehicles-cell' }, { shard: product.shardfile, product, assets, rapier } as never, undefined,
      { saves: new SaveStore({ local: null, session: null }), lone: true, pageless: true });
    try {
      const claims = actRoutes(cell.host).claims;
      expect([vehicleDockPrompt(BUGGY), vehicleSeatPrompt(SAIL, 0), vehicleLeavePrompt(SAIL)].map(id => claims.has(id))).toEqual([true, true, true]);
      expect(shardRows(cell.host).bodies.has(`script:${SAIL}`)).toBe(true);
    } finally { cell.dispose(); }
  });
});

test('a save keeps the vehicles out, their seats and states, and restores onto their bodies', () => {
  const first = createShardfileSim(product.shardfile, assets, { rapier, quest });
  const restored = prepareShardfileSimRestore(product.shardfile, assets, { rapier, quest, restoring: true });
  try {
    const lead = leadPlayer(first.host), runtime = first.vehicles; if (runtime === null) throw new Error('No vehicle runtime');
    lead.position.set(-6, 0, 21); lead.motor.resetAt(lead.position);
    actRoutes(first.host).claims.get(vehicleDockPrompt(BUGGY))?.(lead.id);
    const buggy = playerVehicle(BUGGY, lead.id);
    for (let i = 0; i < 10; i++) first.host.step();
    expect(runtime.ids()).toEqual([SAIL, buggy]);
    restored.restore(snapshotSimHost(first.host));
    const again = restored.simulation.vehicles; if (again === null) throw new Error('No restored vehicle runtime');
    expect(again.ids()).toEqual([SAIL, buggy]);
    expect(again.riders(buggy)).toEqual([lead.id, null]);
    for (let i = 0; i < 30; i++) { first.host.step(); restored.host.step(); }
    expect([again.pose(buggy), again.pose(SAIL)]).toEqual([runtime.pose(buggy), runtime.pose(SAIL)]);
    expect(leadPlayer(restored.host).position).toEqual(lead.position);
    expect(shardRows(restored.host).bodies.has(`script:${buggy}`)).toBe(true);
  } finally { first.dispose(); restored.host.dispose(); }
});

test('a product with no vehicles loads as before', async () => {
  const plain = await loadHeadlessFolder(GAMEPLAY_SLICE);
  expect(shardVehicles(plain.shardfile).docks).toEqual([]);
});
