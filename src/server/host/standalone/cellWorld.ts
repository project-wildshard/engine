// E7.3: opening one cell's world, shared by the phone's grid (`gridServer.ts`) and a dedicated room (`DedicatedRoom`). What differs
// between them is in `CellWorldOptions`: who keeps a player's goods and facts, and whether solids stay near one player.
import { bootTask } from '@wildshard/engine/boot/timing';
import type { NetTickInput } from '@wildshard/engine/net/room';
import { NearColliders } from '@wildshard/engine/physics/nearColliders';
import { removeChunkEdgeWalls } from '@wildshard/engine/physics/terrain';
import type { SimHost } from '@wildshard/engine/sim';
import type { PlayerSim } from '@wildshard/engine/sim/playerSim';
import { actRoutes } from '@wildshard/engine/sim/actRoutes';
import type { PlaceArea } from '@wildshard/engine/quest/lastPlace';
import { questBooks } from '@wildshard/engine/quest/players';
import { decodeSimSnapshot, type SimSnapshot } from '@wildshard/engine/sim/snapshot';
import { restoreSimHost } from '@wildshard/engine/sim/restore';
import type { SaveStore } from '@wildshard/engine/saves/store';
import type { GridCell } from '@wildshard/engine/game/grid/assembly';
import { carryRefusedSave, importPageProgress } from '@wildshard/engine/game/grid/durability';
import { regionalRuntimeCheckpoint } from '@wildshard/engine/game/grid/runtimeCheckpoint';
import type { GridResident } from '@wildshard/engine/game/grid/simulation';
import { bindShardfileSim, createShardfileSim, type ShardfileSimPorts, type ShardfileSimulation } from '@wildshard/engine/game/plugin/simulation';
import { installRoomRespawn } from '@wildshard/engine/game/roomRespawn';
import { hasNativeAssembly } from '@wildshard/engine/game/shardfile/nativeAssembly';
import { installDeclaredClimate } from '@wildshard/engine/game/shardfile/declaredClimate';
import { installPlayerOwned, type OwnedBook, type OwnedStores, type CreatureRewardStore } from '@wildshard/engine/game/loot/playerOwned';
import { QUEST_OWNED } from '@wildshard/engine/game/quest/nativeComposition';
import { shardRows } from '@wildshard/engine/sim/shardRows';
import { createQuestLedger } from '@wildshard/engine/game/quest/ledger';
import { serverDiscoveries } from '@wildshard/engine/game/quest/serverPlaces';
import { RESPAWN_NOW_ACT, STORY_ACT, UNSTUCK_ACT } from '@wildshard/engine/net/acts';
import { installServerChapters } from '@wildshard/engine/game/quest/serverChapters';
import { installServerDoors } from '@wildshard/engine/game/quest/serverDoors';
import { pageOpenDoors } from '@wildshard/engine/game/shardfile/buildingDoor';
import { pageRuntimeState } from '@wildshard/engine/game/shardfile/runtimeState';
import { commandsOf } from '@wildshard/engine/game/grid/roomNet';
import { pageSavedFlags } from '@wildshard/engine/world/interact/flags';
import { installDeclaredKitItems, type DeclaredKitItems } from '@wildshard/engine/game/shardfile/declaredKitItems';
import { createTrustedHeadlessResident, type HeadlessRuntimeInput, type TrustedHeadlessResident } from '../headlessRuntime';
import { registerInstalled } from '@wildshard/engine/game/shardfile/installedSides';
import { productHeadlessSections } from '@wildshard/engine/host/headlessSections';
import type { HeadlessEffect } from '../../../shared/host/tickProtocol';
import { FallFloor, shardFallFloor, shardPlayArea } from './fallFloor';
import { stepResident } from '../../../shared/host/standalone/netInput';

/** The host's own player: the seat its systems are bound to. */
export const LEAD_SEAT = 'actor.player';

/** What the durable ledger answers a fact with. Null: this player's facts have no store. */
export interface FactReceipt { readonly id: string; readonly status: 'granted' | 'duplicate' | 'pending' }
/** One world a host has open: its host, and how it takes a tick and reports what the tick granted. */
export interface CellWorld extends GridResident {
  /** Take over a page's progress in this cell, in a world made fresh for it. False keeps the fresh world. */
  readonly adopt: (refused?: SimSnapshot) => boolean;
  readonly effects: () => readonly HeadlessEffect[];
  readonly step: (inputs: readonly NetTickInput[]) => void;
  readonly fact: (name: string, entity: string, player: string) => FactReceipt | null;
  /** What each player holds in this shard. */
  readonly owned: OwnedBook;
  /** A fall recovery for one player, off what this shard declares. Each keeps the ground that player last stood on. */
  readonly fallFloor: () => FallFloor;
  /** The first seat's. */
  readonly fall: FallFloor;
  /** HS1: a native world's trusted resident, which a tick adapter steps with the lead's own commands. A data cell has none. */
  readonly resident?: TrustedHeadlessResident;
}
/** What a host lends a cell it opens. */
export interface CellWorldOptions {
  readonly saves: SaveStore;
  /** A cell with no road around it (a one-shard page, `WORLD_CROSSING=off`): its fall floor sets a player back on the ground they last
   *  stood on instead of a death. It has no edge walls (GC36, J322), so past its edge a player falls to that floor. */
  readonly lone: boolean;
  /** C6: a room holds every solid, since no one list can follow every player. Left out, a native world keeps its solids near its lead. */
  readonly wholeSolids?: boolean;
  /** Each player's own goods. Left out, one purse is the session's. */
  readonly owned?: OwnedStores;
  readonly profiles?: CreatureRewardStore;
  /** Where a player's facts go. Left out, they go in `saves`, the session's. */
  readonly facts?: (name: string, entity: string, player: string, input: HeadlessRuntimeInput) => FactReceipt | null;
  /** A room has no page, so no page's save seeds a fresh world. */
  readonly pageless?: boolean;
}

/** The seat a cell's tick reads as the lead, which a host always has. */
const leadSeat = (host: SimHost): PlayerSim => {
  const player = host.players.get(LEAD_SEAT);
  if (player === undefined) throw new Error('The session player has no body in this host');
  return player;
};
/** A cell's fall recovery, off what its shard declares. */
/** SS6: the same area the page reads, the manifest's bounds under its `client/plan` rows. An input with no product can't read
 *  those rows, so it keeps the manifest's floor alone and no x/z edge, rather than an edge the page may not have. */
function fallFloorOf(input: HeadlessRuntimeInput, host: SimHost, lone: boolean): FallFloor {
  if (input.product !== undefined) registerInstalled(host, 'fallFloor'); // SS3: the page's own `player.enter` / `world.runtime-hooks` area
  return new FallFloor(input.product === undefined ? shardFallFloor(input.shard.manifest?.bounds?.floor) : shardPlayArea(input.shard.manifest?.bounds, input.product), lone, host.level.player.at);
}

/** A cell with no native plan: a data shard, which any host can run from its output. */
async function openDataCell(input: HeadlessRuntimeInput, snapshot: string | SimSnapshot | undefined, effects: HeadlessEffect[]): Promise<Pick<CellWorld, 'host' | 'dispose'> & { readonly sim: () => ShardfileSimulation | undefined; readonly kit: () => DeclaredKitItems | null }> {
  await Promise.resolve();
  const { shard, assets, rapier } = input;
  // A data shard's decisions, moves and targets ride its product sections (TE-ENG1's boss rows): without them the
  // encounter runs no decision and the boss falls back to its native phase chase.
  const sections = input.sections ?? (input.product === undefined ? undefined : productHeadlessSections(input.product));
  const ports: ShardfileSimPorts = { rapier, ...(sections === undefined ? {} : { sections }),
    quest: { fact: (name, actorId) => { effects.push({ kind: 'fact', name, actorId }); }, coins: (amount, actorId) => { effects.push({ kind: 'coins', amount, actorId }); } } };
  // SR11: the kit items install with the simulation, so a restore finds their seats where the save put them.
  const kitOf = (sim: ShardfileSimulation): DeclaredKitItems | null => installDeclaredKitItems(sim.host, shard, sim.itemHooks);
  if (snapshot === undefined) {
    const fresh = createShardfileSim(shard, assets, ports), kit = kitOf(fresh);
    // SS3: a data shard's simulation builds its declared prop solids; a shard with none built has no server half to claim
    if (fresh.colliders.size > 0) registerInstalled(fresh.host, 'collision');
    return { host: fresh.host, sim: () => fresh, kit: () => kit, dispose: () => { fresh.dispose(); } };
  }
  const probe = createShardfileSim(shard, assets, ports), { level } = probe.host; probe.dispose();
  const installed: { value?: ReturnType<typeof bindShardfileSim>; kit?: DeclaredKitItems | null } = {};
  const host = restoreSimHost(level, { rapier }, typeof snapshot === 'string' ? decodeSimSnapshot(snapshot) : snapshot, restored => { installed.value = bindShardfileSim(restored, shard, assets, { ...ports, restoring: true }); installed.kit = kitOf(installed.value); if (installed.value.colliders.size > 0) registerInstalled(restored, 'collision'); });
  return { host, sim: () => installed.value, kit: () => installed.kit ?? null, dispose: () => { (installed.value ?? { dispose: () => { host.dispose(); } }).dispose(); } };
}

/** How far past a place's own radius a client's word for it holds: it saw it a frame ago, and the server is a command behind. */
const SEEN_SLACK = 1.5;
/** A named place is the page's to notice, and the server's to check. One the page resolves against a placed object has no world position here, so its word stands: a `seen:` flag draws a map, and pays nothing. */
function bindDiscovery(host: SimHost, places: readonly { readonly id: string; readonly area: PlaceArea | null }[]): void {
  const areas = new Map(places.map(place => [`seen:${place.id}`, place.area]));
  if (places.length > 0) registerInstalled(host, 'places'); // SS3: the server checks a player's word for each named place
  actRoutes(host).seen = (player, flag) => {
    const area = areas.get(flag), feet = host.players.get(player)?.position;
    if (area === undefined || feet === undefined || (area !== null && Math.hypot(feet.x - area.x, feet.z - area.z) > area.r * SEEN_SLACK)) return;
    const books = questBooks(host);
    books.claim([flag]); books.of(player).flags.set(flag);
  };
}

/** What each player holds in a cell. A shard with goods sells them here. */
function ownedOf(host: SimHost, input: HeadlessRuntimeInput, stores: OwnedStores | undefined, profiles?: CreatureRewardStore): OwnedBook {
  const economy = input.shard.rows.loot.find(row => row.economy !== undefined)?.economy, sold = economy !== undefined && 'exchange' in economy ? economy.exchange : undefined;
  return installPlayerOwned(host, input.shard.identity.slug, sold ?? null, !shardRows(host).owned.has(QUEST_OWNED), stores, input.shard, profiles);
}

/** Whether this output runs on the trusted headless owner. */
export const nativeCell = (input: HeadlessRuntimeInput): boolean => input.product !== undefined && (hasNativeAssembly(input.product) || input.product.has('sim/runtime-plan'));

/** Open `cell`'s world from `input`, at `snapshot` if there is one. */
export async function openCellWorld(cell: Pick<GridCell, 'instance'>, input: HeadlessRuntimeInput, snapshot: string | SimSnapshot | undefined, options: CellWorldOptions, refused?: SimSnapshot): Promise<CellWorld> {
  const declared = new Set(input.shard.ledger.map(row => row.fact)), placed = { id: cell.instance, shard: input.shard.identity.slug }, { facts, lone } = options;
  const ledger = facts === undefined ? createQuestLedger(options.saves, input.shard, cell.instance) : null;
  const fact: CellWorld['fact'] = (name, entity, player) => !declared.has(name) ? null : ledger === null ? facts?.(name, entity, player, input) ?? null : ledger(name, entity);
  if (nativeCell(input)) {
    // J68: a native assembly keeps its ground whole and its solids as data. A saved world holds none of them, so a throwaway fresh one lists them.
    const near = options.wholeSolids !== true && input.product !== undefined && hasNativeAssembly(input.product) ? new NearColliders() : undefined;
    const around = { room: true, ...(near === undefined ? {} : { near }) };
    if (near !== undefined && snapshot !== undefined) (await bootTask('server:restore-collision-inventory', () => createTrustedHeadlessResident(input, undefined, around))).dispose();
    // A world with no save of its own takes the page's: the flags and records its fights read as they install.
    const seeded = snapshot === undefined && options.pageless !== true;
    const page = seeded ? { flags: [...new Set([...new Set([input.shard.identity.slug, cell.instance])].flatMap(level => pageSavedFlags(level)).concat(refused?.flags ?? []))], state: pageRuntimeState(options.saves, cell.instance) } : undefined;
    const resident = await bootTask(snapshot === undefined ? 'server:simulation-and-collision-create' : 'server:continuation-restore', () => createTrustedHeadlessResident(input, snapshot, page === undefined ? around : { ...around, page })), { host } = resident;
    if (snapshot !== undefined) removeChunkEdgeWalls(host.physics); // GC36: a world saved while lone cells had walls
    bindDiscovery(host, input.product === undefined ? [] : await serverDiscoveries(input.product)); await installServerChapters(host, input.product, input.shard, resident.fact); await installServerDoors(host, input.product, seeded ? pageOpenDoors(options.saves, placed) : undefined, snapshot !== undefined);
    host.respawn.served = true; actRoutes(host).introLocks = true;
    const owned = ownedOf(host, input, options.owned, options.profiles), fallFloor = (): FallFloor => fallFloorOf(input, host, lone);
    return { host, owned, fallFloor, fall: fallFloor(), resident, dispose: () => { resident.dispose(); }, fact, effects: () => resident.effects,
      adopt: () => { regionalRuntimeCheckpoint(options.saves, placed, input.shard.identity.revision).restore({ animals: [...host.entities.values()] }); return true; }, step: inputs => {
      const player = leadSeat(host);
      near?.update(player.position.x, player.position.z);
      stepResident(resident, player.id, inputs);
    } };
  }
  const effects: HeadlessEffect[] = [], { host, dispose, sim, kit } = await bootTask(snapshot === undefined ? 'server:data-simulation-and-collision' : 'server:data-continuation-restore', () => openDataCell(input, snapshot, effects));
  if (snapshot !== undefined) removeChunkEdgeWalls(host.physics); // GC36: a world saved while lone cells had walls
  installRoomRespawn(host, []);
  installDeclaredClimate(host, input.shard.rows);
  bindDiscovery(host, input.product === undefined ? [] : await serverDiscoveries(input.product));
  host.respawn.served = true; actRoutes(host).introLocks = true;
  const fallFloor = (): FallFloor => fallFloorOf(input, host, lone);
  return { host, owned: ownedOf(host, input, options.owned, options.profiles), fallFloor, fall: fallFloor(), dispose, fact, effects: () => effects, adopt: saved => { const held = sim(); return held === undefined || (saved === undefined ? importPageProgress(options.saves, placed, input.shard, held) : carryRefusedSave(input.shard, held, saved)); }, step: inputs => {
    effects.length = 0;
    // A data shard's prompts answer whoever stands at them; an id they don't offer that player is dropped, since an input may not end the server.
    const routes = actRoutes(host);
    const items = kit();
    for (const { player, command } of inputs) if (command !== null) items?.command(player, command);
    for (const { player, acts } of inputs) for (const act of acts) {
      const claim = act.kind === 'interact' ? routes.claims.get(act.id) : undefined;
      if (act.kind === 'equip' && items?.equip(player, act.slot) === true) continue;
      if (act.kind === 'interact' && items?.scene(player, act.id) === true) continue;
      if (act.kind === 'reload' && items?.reload(player, act.slot) === true) continue;
      if (act.kind === 'interact' && act.id.startsWith('seen:') && routes.seen !== null) routes.seen(player, act.id);
      else if (act.kind === 'interact' && act.id.startsWith(STORY_ACT)) routes.story?.(player, act.id.slice(STORY_ACT.length));
      else if (act.kind === 'interact' && act.id === UNSTUCK_ACT && routes.unstuck !== null) routes.unstuck(player);
      else if (act.kind === 'interact' && act.id === RESPAWN_NOW_ACT && routes.respawnNow !== undefined) routes.respawnNow(player);
      else if (claim !== undefined) claim(player);
      else if (act.kind === 'interact' && sim()?.selectedInteraction(player) === act.id) sim()?.interact(act.id, player);
      else if (act.kind !== 'climate' && act.kind !== 'buy' && act.kind !== 'board' && act.kind !== 'wear') routes.refused++;
    }
    host.step(commandsOf(inputs));
  } };
}
