// P1-E5.3 I6 (J126), E6: every page runs the real Game and Player against the real server in its worker: the Player predicts and
// reconciles, and every creature is an interpolated row drawn by the real views.
import type { CreatureSkinClipName } from '@wildshard/format/skinData';
import { AbilityTells } from './abilityTell';
import { StrikeFlights } from './strikeFlight';
import { Scope } from '@wildshard/engine/app/scope';
import type { DevBox, DevGround } from '@wildshard/engine/game/devColliders';
import type { LiveGridWire } from '../grid/liveSession';
import { chosenArrival, chosenCell, gotoHosted, pageGoto } from '../../../shared/game/grid/pageMode';
import { GridAssembly } from '../../../shared/game/grid/assembly';
import { findSpecies, speciesDef } from '@wildshard/engine/entities/species/registry';
import type { SystemSpec } from '@wildshard/engine/app/systems';
import type { Player } from '@wildshard/engine/player/Player';
import { Scene, Vector3, type Object3D } from 'three';
import { appIdentity } from '@wildshard/engine/app/identity';
import { bootMark, bootTask } from '@wildshard/engine/boot/timing';
import { SEAT_GRACE_MS, seatedInTime } from './seatGrace';
import { exploreChannel } from '@wildshard/engine/app/view/exploreChannel';
import { importPageSaves, pageOnlyServerSaves, openIndexedSaves, serverSaveDatabase, serverStopsForImport, type IndexedSaves } from '@wildshard/engine/saves/indexed';
import { saveEnvironment } from '@wildshard/engine/saves/environment';
import { jsonSlot } from '@wildshard/engine/saves/slots';
import { syncPageRewards } from '../../../shared/game/saves';
import type { SaveStorage } from '@wildshard/engine/saves/store';
import { atMostLeaveWait, holdLeaving, markUnload } from '@wildshard/engine/boot/lastEnd';
import { dropTabArrival, setTitleArrival } from '@wildshard/engine/boot/titleArrival';
import { countedWait } from '@wildshard/engine/boot/waits';
import { contentURL } from '@wildshard/engine/boot/contentBase';
import { diagnosticNow } from '@wildshard/engine/core/clock';
import { ownedArray } from '@wildshard/engine/core/ownedBuffer';
import type { NetClient } from '@wildshard/engine/net/client';
import type { NetCombatEvent } from '@wildshard/engine/net/messages';
import type { DeathCause } from '@wildshard/engine/combat/pipeline';
import { deviceIdentity, heldName, type NetIdentity } from '@wildshard/engine/net/identity';
import { askNameToJoin } from '@wildshard/engine/ui/namePrompt';
import { NetPlayer, type NetWeapons } from '@wildshard/engine/net/netPlayer';
import { CreaturePrediction, type CreaturePredictionRow } from './creaturePrediction';
import { ownsInlineCandidate } from './inlineOwner';
import { ANIMAL_CLASS, roadPlaceOf } from '@wildshard/engine/net/netSchemas';
import type { OtherPlayers } from '@wildshard/engine/net/otherPlayers';
import { hurtOther } from '@wildshard/engine/net/hurtOther';
import type { Physics } from '@wildshard/engine/physics/Physics';
import type { RowBodiesView } from '@wildshard/engine/entities/RowBodies';
import type { Animal } from '@wildshard/engine/entities/AnimalView';
import { ANIMAL_STATES } from '@wildshard/engine/entities/animalStates';
import { creatureBodyShape } from '@wildshard/engine/sim/bands';
import { lockOn } from '@wildshard/engine/player/AimTargets';
import { perfDockSection } from '@wildshard/engine/ui/perfDock';
import { isDev } from '@wildshard/engine/core/devMode';
import { showError } from '@wildshard/engine/ui/ErrorModal';
import { saveSetting, type OptionValue } from '@wildshard/engine/ui/Settings';
import { netNeighbourRegion } from '../grid/neighbourRows';
import { mountOf } from '../../../shared/game/riding/entered';
import { GrappleTool } from '../grapple/tool';
import { netClaw } from '../grapple/netClaw';
import type { Mount } from '../riding/mount';
import { NetMovers } from '../plugin/moverViews';
import { spawnHeldBytes } from '../boot/spawnDownload';
import { travel, whenEntersInPage } from '../travel/travel';
import { RegridLater, type RegridHere } from '../grid/regridLater';
import { lendOnlineGate } from '../grid/onlineGate';
import type { ShardSlug } from '../../../shared/game/shard/slug';
import { DAY_ROW, NET_POSE } from '@wildshard/engine/sim/shardRows';
import { POSE_NAMES } from '@wildshard/engine/net/acts';
import { poseInputNames } from '../../../shared/game/plugin/channelPrograms';
import type { EncounterRow } from '../boss/barFeed';
import { wirePage, type DayFollower, type RoomSaves } from './wirePage';
import type { VehicleReport } from '../plugin/followedVehicles';
import { OWNED_ROW } from '../../../shared/game/loot/ownedRows';
import { declaredKitSlots } from '../../../shared/game/shardfile/items';
import { MISSING_SERVER, pageServerRoute, serverStepLabel } from './serverRoute';
import { worldHosted } from '../grid/oneWayIn';
import { drawnPlace } from '../grid/edgeCreatures';
import { setLampFollow } from '@wildshard/engine/render/lookLight';
import { pageLogin, refreshTicket, signedIn, ticketBeforeJoin, ticketed, TICKET_REFRESH_MS } from '@wildshard/engine/net/playerLogin';

type Creatures = Pick<RowBodiesView, 'animals' | 'spawn' | 'retire' | 'onWindup' | 'presentHit' | 'presentDeath' | 'presentReward'>;
/** What a grid page lends: its crossing follows the server, and its creatures are the entered cell's. */
export interface WorkerClientGrid {
  readonly cells: readonly { readonly instance: string; readonly slug: string }[];
  readonly bindWire: (wire: LiveGridWire) => void;
  readonly frame: () => string | null;
  readonly animals: () => Creatures | null;
  /** MMO-PLAN MP5.2b: on the road, the home's creature manager and the home's origin in the world's frame, where the road's rows of the
   *  home's creatures near its edge are drawn; null in a cell, or with no home world on the page. */
  readonly roadAnimals?: () => { readonly animals: Creatures; readonly origin: { readonly x: number; readonly z: number } } | null;
  /** The entered cell's item rows; none on the road, which keeps the last cell's. */
  readonly items: () => readonly WorkerItemRow[] | null;
  /** Say where the page stands: a reload boots the cell it names, and has to open where the server's save stands. */
  readonly saveLocation: () => void;
  /** GO5: the world's door named where this player stands (a grid instance, cell-local). The page's own hint and card follow it. */
  readonly serverPlace?: (instance: string, at: { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number }) => void;
  /** GO4: the seat is in another cell than this page booted: enter the grid again there (a grid entry, never a `?chunk=` page). */
  readonly reenter?: (instance: string) => void;
  /** GO5: the same entry on this page (the app's same-page entry): `handOver` runs once it will go, before the page leaves, and the
   *  answer is true; false when this page can't enter in place (nothing ran). */
  readonly reenterInPage?: (instance: string, handOver: () => void) => boolean;
  /** OF2: the world hosts one cell: enter this cell again as its one-shard online page, never the solo grid. */
  readonly reshard?: (instance: string) => void;
  /** The cell (instance) this page booted in. */
  readonly booted?: string;
}
/** The part of an item row that says where the server holds it. */
export interface WorkerItemRow { readonly id: string; readonly kind?: string; readonly family?: string; readonly ranged?: { readonly slot: number } | undefined }
/** What the page hands the proof. */
export interface WorkerClientPorts {
  readonly slug: string;
  readonly player: Player; readonly physics: Physics;
  /** Where another player's body stands. */
  readonly scene: Object3D;
  /** The page's creature manager: its views draw rows, and its own population is retired. */
  readonly animals: Creatures;
  readonly grid: WorkerClientGrid | null;
  /** The real weapons: they send their presses and take the server's word. */
  readonly weapons: NetWeapons;
  /** The page's health: the server's word from now on, and nothing on the page can touch it. */
  readonly health: { readonly attributes: { health: number; incomingCap?: number } };
  /** The owner's settled contact: existing feel only, with no page damage. */
  readonly hurt: (amount: number, at: Vector3, blow: boolean) => void;
  /** Deliver this owner's settled lifecycle. Resume the authoritative pose when the existing fade reaches dark. */
  readonly died: (event: { readonly checkpoint: boolean; readonly cause?: DeathCause }, resume: () => void) => void;
  /** The page's own shard's item rows: a ranged row names the server's slot for it. */
  readonly items: readonly WorkerItemRow[];
  /** A creature kind's body measures, where a page knows them: what a row with no body here stands as in the predicted world. */
  readonly dims: (kind: string) => Parameters<typeof creatureBodyShape>[0] | null;
  /** The tools this page holds now: a hook tool's claw goes on the wire. */
  readonly tools: () => readonly object[];
  /** The clock this page's sky reads, while it has one. */
  readonly day: () => DayFollower | null;
  readonly scope: Scope;
  readonly system: (system: SystemSpec) => void;
  /** Link what the first rows' bodies draw, under the card. A page that reveals nothing yet has no such step. */
  readonly linkBodies?: () => Promise<void>;
  /** NET-LAG NL15: link these roots' road (exterior) variants in play, paced (the other-player warm body's, once filled). */
  readonly warmRoad?: (roots: readonly Object3D[]) => Promise<void> | void;
}
interface ShellModule { readonly startStandalone: (config: { slug: string; base: string; build: string; savePrefix: string; name?: string; lone?: true; backgroundSaves?: boolean; held?: (url: string) => Promise<ArrayBuffer | null> } & IndexedSaves) => Shell;
  readonly prespawnStandalone?: (held?: (url: string) => Promise<ArrayBuffer | null>) => void }
/** What `stampBuildDocuments` writes into a build that has a world: its signed release file and the key that signed it. */
interface BuildWorld { readonly release: string; readonly key: string; readonly recordTag?: string }
/** OF4: the page's keep for the last verified release file, in its own device saves (online.js's store has no storage). */
interface ReleaseKeep { readonly read: () => { of: string; at: number; text: string } | null; readonly write: (kept: { of: string; at: number; text: string }) => void }
function releaseKeep(): ReleaseKeep {
  const slot = jsonSlot('release.kept', 'device');
  return {
    read: () => {
      const kept = slot.read();
      if (typeof kept !== 'object' || kept === null || Array.isArray(kept)) return null;
      const { of, at, text } = kept;
      return typeof of === 'string' && typeof at === 'number' && typeof text === 'string' ? { of, at, text } : null;
    },
    write: kept => { slot.write({ of: kept.of, at: kept.at, text: kept.text }); },
  };
}
/** E7.2d: the page's seat in the one world, in a shell of the same shape. */
/** FM3 mode 23: how the online shell leaves this document on purpose, through the page's own saves (shell.ts `OnlineLeaving`). */
interface OnlineLeaving { readonly arrive: (slug: string) => void; readonly unarrive: () => void; readonly unload: (reason: string) => void;
  readonly reloadStale: () => Promise<boolean>; readonly reloadByHand: () => Promise<void>; readonly settle: () => void }
const onlineLeaving: OnlineLeaving = {
  arrive: slug => { setTitleArrival({ slug, mode: 'enter' }, { tab: true }); }, unarrive: dropTabArrival, unload: reason => { markUnload(reason); },
  reloadStale: async () => (await import('@wildshard/engine/boot/browserChunkRecovery')).reloadRefusedBuild(true),
  reloadByHand: async () => { await (await import('@wildshard/engine/boot/browserChunkRecovery')).reloadPastWorker(); },
  settle: () => { void (async () => { (await import('@wildshard/engine/boot/browserChunkRecovery')).settleRefusedBuild(); })(); },
};
/** FM8b mode 27: the page's sign-in, lent to the online shell (shell.ts `OnlineSession`). */
interface OnlineSession {
  readonly renew: () => Promise<'ok' | 'ended' | 'guest' | 'unknown'>;
  readonly onEnded: (heard: () => void) => void;
  readonly signIn: () => Promise<boolean>;
}
interface OnlineModule { readonly startOnline: (config: BuildWorld & { keep: ReleaseKeep; leaving: OnlineLeaving; loaded: string; build: string; identity: (name?: string) => NetIdentity; grid?: OnlineGrid; session?: OnlineSession }) => Promise<Shell>;
  /** TR-4b: the release read, begun at the boot's data step (shell.ts `readReleaseEarly`) */
  readonly readReleaseEarly?: (config: BuildWorld & { keep: ReleaseKeep; leaving: OnlineLeaving }) => void }
interface Shell { readonly redials?: true; readonly roomSaves?: RoomSaves; devColliders?: (name: string, boxes: readonly DevBox[]) => void; devGround?: (ground: DevGround) => void; pause: () => void; hold: (on: boolean) => void; bossGod: () => void; still: () => void; raise: (flag: string) => void; join: (id: string, x: number, y: number, z: number) => { readonly client: NetClient; readonly move: (x: number, y: number, z: number) => void }; readonly client: NetClient; readonly booted: Promise<{ readonly restored: boolean }>; place: (x: number, y: number, z: number, yaw: number) => void; hardHits: (by: number) => void; ready: () => void; leave?: () => Promise<void>; save: () => Promise<{ readonly tick: number; readonly ok: boolean }>; probe: () => Promise<{ readonly tickMs: number }>; dispose: () => void;
  /** ZE10d2: an online shell's gate word and its adoption by the next session on this page (`shell.ts` `StartedOnline`) */
  enter?: (cell: string) => Promise<{ readonly x: number; readonly z: number; readonly yaw: number } | null>;
  adopt?: (next: { readonly loaded: string; readonly grid: OnlineGrid }) => void }
interface OnlineGrid { readonly cell: string; readonly cells: readonly string[]; readonly placed: (cell: string, at: { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number }) => void; readonly reenter: (cell: string) => void; readonly reenterInPage: (cell: string, reload: () => void) => boolean; readonly goto?: boolean; readonly spawn?: boolean }
/** ZE10d2: the online shell a gate's `enter` handed over (its seat frozen at the gate of `cell`), for the next session on this page. */
let handedOver: { readonly shell: Shell; readonly cell: string } | null = null;
/** ZE10d2: past the door's `READY_MS` (120 s) a handed-over link no session took is let go. */
const HANDOVER_MS = 130_000;
/** GO5b: how long a disagreeing `resume` waits for this page's session and its same-page entry (control) before GO4's reload. */
const REGRID_WAIT_MS = 45_000;
/** GO5/GO5b: a seat in another cell than this page booted is entered on this page once the running session can hand its link over and
 *  the app's same-page entry is in place, both of which may come after the door's `resume` (it can arrive mid-boot). */
const regrids = new RegridLater({ waitMs: REGRID_WAIT_MS, timeout: (ms, then) => {
  const wait = new Scope('grid.regrid-wait');
  wait.timeout(ms, () => { wait.dispose(); then(); });
  return () => { wait.dispose(); };
} });
whenEntersInPage(() => { regrids.entry(); });
let regridSession: RegridHere | null = null;

const SAVE_EVERY_MS = 30_000;
/** How long the card waits for the server's first rows, and how often it looks. A server that has booted says them in a tick. */
const FIRST_ROWS_MS = 1500, FIRST_ROWS_POLL_MS = 20;
/** How often a page whose frames are parked behind a panel still hears the server. */
const PARKED_BEAT_MS = 120;
const column = (name: string): number => ANIMAL_CLASS.row.findIndex(entry => entry.name === name);
const X = column('x'), Y = column('y'), Z = column('z'), YAW = column('yaw'), STATE = column('state'), ATTACK = column('attackT'), ATTACK_DUR = column('attackDur'), ATTACK_STAMP = column('attackStamp'), WINDING = column('winding'), TARGET = column('target'), FLINCH = column('flinch'), HP = column('hp'), ALIVE = column('alive'), RIDEABLE = column('rideable'), STRAFE = column('strafe'), BRACE = column('brace'), RISE = column('rise'), ACT = column('act');
// CC28: the actor channels and lock answer (wire 1.1); an older room reads each at its default (0, `row`).
const CHANNELS = [column('channel1'), column('channel2'), column('channel3'), column('channel4')], LOCKABLE = column('lockable');
/** MP5.2b: a road row's place (wire 1.3); a build without the columns reads none. */
const ROAD_X = column('roadX'), ROAD_Z = column('roadZ');
/** CC11a2c: the declared ability a row runs and how far through (wire 1.4); an older room reads 0, the attack fallback. */
const ABILITY = column('ability'), ABILITY_T = column('abilityT');
/** Where the row stands in its manager. Road positions are in world metres until moved into the home cell. */
const placeInto = (row: Float64Array, home: Readonly<Place> | null, out: Place): boolean => {
  if (home === null) { out.x = row[X] ?? 0; out.z = row[Z] ?? 0; return true; }
  const at = drawnPlace({ x: row[X] ?? 0, z: row[Z] ?? 0, roadX: row[ROAD_X] ?? 0, roadZ: row[ROAD_Z] ?? 0 }, home);
  if (at === null) return false;
  out.x = at.x; out.z = at.z; return true;
};
interface Place { x: number; z: number }
const PLACE: Place = { x: 0, z: 0 };
const LOCKS = ['row', 'on', 'off'] as const;
const channelsOf = (row: Float64Array, out: number[]): number[] => { for (let i = 0; i < 4; i++) out[i] = row[CHANNELS[i] ?? -1] ?? 0; return out; };
const ROW_CHANNELS = [0, 0, 0, 0], SYNC_CHANNELS = [0, 0, 0, 0], SYNC_ROW = ownedArray(Float64Array, ANIMAL_CLASS.row.length, { owner: 'game/creatures', asset: 'row-swap' });

/** What the page measures, as I6 lists it. */
export interface WorkerClientReport {
  frames: number; framesPerSecond: number; ticksPerSecond: number; correctionsPerMinute: number; corrections: number; worstOffset: number; queue: number; replaysPerFrame: number; /** NL12 (h): matches that took the room's state quietly. */ resyncs: number;
  delayMs: number; jitterMs: number;
  /** Render frames drawn older than the interpolation buffer, and past its newest frame's run-on (NL2): rows held either way. */
  interpHeld: number; interpStarved: number;
  mainMsP95: number; workerTickMs: number; rows: number; attacks: number; hits: number; kills: number; refused: number; held: number; dropped: number; hp: number; falls: number; closed: string | null; x: number; z: number; cell: number; serverX: number; serverZ: number; restored: boolean; savedTick: number; savedOk: boolean;
  /** The ledger's receipts this page heard, by kind and name. */
  receipts: string[];
  /** This player's quests by id, the flags the server says are theirs, the coins it paid, and its fights. */
  quests: Record<string, string | null>; flags: readonly string[]; paid: number; fights: readonly string[];
  /** Whether a hook tool holds the wire's claw, and the server's name for this player. */
  clawed: boolean; own: string | null;
  /** What the server says this player holds, the sky's phase and the day: what a proof reads of the rows. */
  owned: Readonly<Record<string, number>>; sky: number | null; day: number | null;
  /** What this page drew of what it only hears, by name. */
  drawn: Readonly<Record<string, number>>;
  /** EG-15: every view word the server said to this page, by name: what `drawn` is held against (scripts/fight-page-census.mjs). */
  heard: Readonly<Record<string, number>>;
  /** Of those, the words for a view this page hasn't built (`wirePage.unbuilt`): not drawn, and not dark. */
  offstage: Readonly<Record<string, number>>;
  /** Movers this page holds, the poses rows have given them, and the highest drift rows have laid. */
  movers: number; posed: number; sand: number;
  /** MIRROR-SALT-ZONE MSZ16: the page's driving (`FollowedVehicles.report`), or null with no vehicles. */
  vehicle: VehicleReport | null;
  /** Bodies this page made and the rows put away, by kind: what its own sim still builds. */
  retired: Readonly<Record<string, number>>;
  /** The longest a row of each kind took to spawn, in ms: a model built late shows here. */
  spawnMs: Readonly<Record<string, number>>;
  /** What corrections disagreed on, and server-owned transitions that were deliberately not corrections. */
  missed: Readonly<NetPlayer['predictor']['missed']>; misses: readonly (readonly number[])[]; authoritative: Readonly<NetPlayer['predictor']['authoritative']>;
}
/** A fight as a proof reads it: its row, where its body stands and the server's name for it. `shown` (EG-15): the page's body for that row
 *  is in the scene and visible; null when the page holds no row body for it (an open arena draws its own, off its view words). */
export type WorkerClientFight = EncounterRow & { readonly at: { readonly x: number; readonly y: number; readonly z: number } | null; readonly name: string | null; readonly shown: boolean | null };
/** Whether an object is drawn: visible, and so is every parent up to a scene. */
function inScene(object: Object3D): boolean {
  for (let at: Object3D | null = object; at !== null; at = at.parent) { if (!at.visible) return false; if (at instanceof Scene) return true; }
  return false;
}
declare global { interface Window { __workerClientNet?: () => { readonly client: NetClient; readonly predictor: NetPlayer['predictor'] }; __onlinePlayers?: () => OtherPlayers['shown']; __softCollide?: () => OtherPlayers['soft']['report'] | null; __workerClientFights?: () => readonly WorkerClientFight[]; __workerClientHits?: (by: number) => void; __workerClientStill?: () => void; __workerClientTravel?: (to: ShardSlug) => void;__workerClientSky?: (name: string) => void; __workerClientTime?: (pick: OptionValue<'time'>) => void; __workerClientRow?: (name: string) => number | undefined; __workerClientFlag?: (flag: string) => void; __workerClientDevColliders?: (name: string, boxes: readonly DevBox[]) => void; __workerClientRows?: (kind: string) => readonly { readonly x: number; readonly y: number; readonly z: number }[]; __workerClientGate?: (flag: string) => boolean; __workerClientBot?: (id: string, x: number, y: number, z: number) => { readonly move: (x: number, y: number, z: number) => void; readonly press: (id: string) => void; readonly end: () => void }; __workerClient?: () => WorkerClientReport; __workerClientSave?: () => Promise<void> } }

/** The page's pose inputs, as acts short enough to go. */
function poseActs(names: ReadonlySet<string>): readonly string[] {
  const acts: string[] = [];
  let line = '';
  for (const name of names) {
    if (`${line},${name}`.length > POSE_NAMES) { acts.push(line); line = ''; }
    line = line === '' ? name : `${line},${name}`;
  }
  return line === '' ? acts : [...acts, line];
}
/** A creature on screen, and the world's manager that holds it: a crossing leaves it behind. */
interface RowBody { readonly body: Animal; readonly manager: Creatures; windup?: number; /** its page kind before a look swap (CC28c) */ readonly home: string;
  /** CC11a2c: its species id, and the running ability its row names, refilled in place */ readonly species: string; readonly ability: { id: string; clip?: CreatureSkinClipName; progress: number } }
/** Every creature on this page is a row: a new one spawns through the real manager, one the server dropped retires. */
/** A one-shard page's view of the world's cells, by shard in frame order (the grid page's `cells`); none when the catalogue can't say. */
function oneShardCells(): readonly string[] | undefined {
  try { return new GridAssembly({ developer: false, devserver: false }).cells.map(cell => cell.slug); } catch { return undefined; }
}
/** A row whose kind this page has no species for (another cell's creature) is never drawn, and is said once per kind; the page goes
 *  on (Jake's duneRay, 2026-11-19: a Driftwood page given Signal Dunes' rows died on its first frame). */
const foreignSaid = new Set<string>();
function drawable(kind: string): boolean {
  // DF11: answered without a throw; a refused kind builds speciesDef's error once, for the words it is said with
  try { if (findSpecies(kind) !== undefined) return true; if (foreignSaid.has(kind)) return false; speciesDef(kind); return true; } catch (error) {
    if (!foreignSaid.has(kind)) { foreignSaid.add(kind); console.warn(`[worker client] a row of '${kind}' has no species on this page; not drawn`, error instanceof Error ? error.message : error); }
    return false;
  }
}
function syncCreatures(client: NetClient, animals: Creatures | null, bodies: Map<number, RowBody>, retired: Map<string, number>, spawnMs: Map<string, number>, poses: ReadonlyMap<string, Record<string, number>>, edgeHome: Readonly<Place> | null = null): void {
  if (animals === null) return;
  for (const [handle, info] of client.creatures) {
    if (bodies.has(handle)) continue;
    // DF11: the kind first, so a row this page cannot draw (another cell's creature) copies no fields every frame
    const home = wirePage.rowKind(info.initial['species'], String(info.initial['kind']));
    if (!client.interpolator.sample(handle, Number.MAX_SAFE_INTEGER, SYNC_ROW)) SYNC_ROW.fill(0);
    const kind = wirePage.lookKind(home, channelsOf(SYNC_ROW, SYNC_CHANNELS));
    if (!drawable(kind)) continue;
    // MP5.2b: on the road only the home's creatures near its edge are drawn, in the home's metres
    if (!placeInto(SYNC_ROW, edgeHome, PLACE)) continue;
    const { x, z } = PLACE, y = SYNC_ROW[Y] ?? 0, yaw = SYNC_ROW[YAW] ?? 0, at = diagnosticNow();
    const body = animals.spawn(kind, x, z, yaw, String(info.initial['variant']), { y, body: { seed: Number(info.initial['seed']), scale: Number(info.initial['scale']) } });
    spawnMs.set(kind, Math.max(spawnMs.get(kind) ?? 0, diagnosticNow() - at));
    body.rowDriven = true;
    wirePage.dress(animals, body);
    bodies.set(handle, { body, manager: animals, home, species: typeof info.initial['species'] === 'string' ? info.initial['species'] : '', ability: { id: '', progress: 0 } });
    Object.assign(body.mem, poses.get(info.id));
  }
  // STR20: run every frame; the page's own population is retired once, so the common frame finds none and copies nothing
  let own = false;
  for (let k = 0; k < animals.animals.length && !own; k++) own = animals.animals[k]?.rowDriven === false;
  if (own) for (const body of animals.animals.filter(entry => !entry.rowDriven)) { animals.retire(body); retired.set(body.kind, (retired.get(body.kind) ?? 0) + 1); } // what the page's own population made
}

type BodyDims = Parameters<typeof creatureBodyShape>[0];
/** A session leaving with its page still up, until its last save has landed. */
let closing: Promise<void> = Promise.resolve();
/** Measures of a kind this page has no species for, which only stop a walk a little early or late. A kind's measures never change, and building them isn't cheap. */
const SOME_CREATURE: BodyDims = { bodyRadius: 0.45, bodyHalfLen: 0.7, bodyY: 0.9 }, KIND_DIMS = new Map<string, BodyDims>();
/** The head over a body, as an elite's bar reads it. */
function headOf(body: Animal | undefined, to: Vector3): boolean {
  if (body === undefined) return false;
  to.copy(body.mesh.position); to.y += body.dims.bodyY * body.scale * 1.6;
  return true;
}

type ShownRow = { -readonly [K in keyof Parameters<Animal['showRow']>[0]]-?: Parameters<Animal['showRow']>[0][K] };
const SHOWN_ROW: ShownRow = { x: 0, y: 0, z: 0, yaw: 0, state: 'idle', attack: 0, attackDuration: 1, winding: false, flinch: 0, strafe: 0, brace: 0,
  hp: 0, alive: true, rise: 0, act: 0, channels: [], lock: 'row', ability: undefined };
/** CC11a2c: the declared ability row `index` names for this body, in its reused holder; none for 0 (an older room). */
function rowAbility(entry: RowBody, index: number, progress: number): RowBody['ability'] | undefined {
  const named = wirePage.abilityOf(entry.species, index);
  if (named === undefined) return undefined;
  const held = entry.ability; held.id = named.id; held.progress = progress;
  if (named.clip === undefined) delete held.clip; else held.clip = named.clip;
  return held;
}
/** CC11b3: each scene's running-ability ground tells (`AbilityTells`), made on first use. */
const TELLS = new WeakMap<Object3D, AbilityTells>();
function tellsOf(scene: Object3D): AbilityTells {
  let tells = TELLS.get(scene);
  if (tells === undefined) { tells = new AbilityTells(scene as Scene); TELLS.set(scene, tells); }
  return tells;
}
/** STR20: the predicted capsule rows, one object per creature slot for the page's life, refilled each frame (the literal
 *  was one object per near creature a frame). CreaturePrediction rewrites them in place too. */
const NEAR_ROWS: CreaturePredictionRow[] = [];
/** each creature's capsule shape, once: its dims and scale do not change while it lives (keyed by its body or its row) */
const SHAPES = new WeakMap<object, { readonly radius: number; readonly height: number; readonly dims: BodyDims; readonly scale: number }>();
function nearRow(near: CreaturePredictionRow[], handle: number, row: Float64Array, key: object, dims: BodyDims, scale: number): void {
  let shape = SHAPES.get(key);
  if (shape === undefined || shape.dims !== dims || shape.scale !== scale) {
    const { radius, height } = creatureBodyShape(dims, scale);
    shape = { radius, height, dims, scale }; SHAPES.set(key, shape);
  }
  const slot = NEAR_ROWS[near.length] ?? { handle: 0, x: 0, y: 0, z: 0, alive: false, driven: false, radius: 0, height: 0 };
  NEAR_ROWS[near.length] = slot;
  slot.handle = handle; slot.x = row[X] ?? 0; slot.y = row[Y] ?? 0; slot.z = row[Z] ?? 0; slot.alive = row[ALIVE] === 1; slot.driven = false;
  slot.radius = shape.radius; slot.height = shape.height;
  near.push(slot);
}
/** Rows onto the bodies, and the near ones into the predicted world as capsules. */
function showRows(client: NetClient, ports: WorkerClientPorts, bodies: Map<number, RowBody>, renderTick: number, dt: number, row: Float64Array, near: CreaturePredictionRow[], rideable: Set<number>, home: Readonly<Place> | null = null): number {
  const { interpolator } = client, own = client.welcome?.handle ?? 0, under = client.riders.get(own);
  let shown = 0;
  near.length = 0;
  const tells = tellsOf(ports.scene); tells.begin();
  for (const [handle, entry] of bodies) {
    const { body, manager } = entry;
    if (handle === under || !interpolator.sample(handle, renderTick, row)) continue; // the body under this player is its own prediction (J48)
    // CC28c: a channel crossed its look swap: retire the body, and the next sync spawns the row in the other look
    const channels = channelsOf(row, ROW_CHANNELS);
    if (wirePage.lookKind(entry.home, channels) !== body.kind) { manager.retire(body); bodies.delete(handle); continue; }
    const attack = row[ATTACK] ?? 0, duration = (row[ATTACK_DUR] ?? 1000) / 1000, winding = row[WINDING] === 1;
    const stamp = row[ATTACK_STAMP] ?? 0, started = winding && row[TARGET] === own && entry.windup !== stamp;
    // STR20: one row object refilled per body (showRow copies its fields; the literal was one object per creature a frame)
    const drawn = SHOWN_ROW;
    if (!placeInto(row, home, PLACE)) continue;
    drawn.x = PLACE.x; drawn.y = row[Y] ?? 0; drawn.z = PLACE.z; drawn.yaw = row[YAW] ?? 0; drawn.state = ANIMAL_STATES[row[STATE] ?? 0] ?? 'idle';
    drawn.attack = attack; drawn.attackDuration = duration; drawn.winding = winding; drawn.flinch = row[FLINCH] ?? 0; drawn.strafe = row[STRAFE] ?? 0;
    drawn.brace = row[BRACE] ?? 0; drawn.hp = row[HP] ?? 0; drawn.alive = row[ALIVE] === 1; drawn.rise = row[RISE] ?? 0; drawn.act = row[ACT] ?? 0;
    drawn.channels = channels; drawn.lock = LOCKS[row[LOCKABLE] ?? 0] ?? 'row';
    drawn.ability = rowAbility(entry, ABILITY < 0 ? 0 : row[ABILITY] ?? 0, ABILITY_T < 0 ? 0 : row[ABILITY_T] ?? 0);
    body.showRow(drawn, dt);
    // CC11b3: a running ability's ground tell (a marked slam's ring, a lane), from its row and the server's progress
    if (drawn.ability !== undefined) tells.show(wirePage.abilityOf(entry.species, row[ABILITY] ?? 0), drawn.ability.progress, PLACE.x, PLACE.z, drawn.yaw, renderTick / 60);
    if (started) { entry.windup = stamp; if (body.alive) manager.onWindup?.(body, duration); }
    shown++;
    if (row[RIDEABLE] === 1) rideable.add(handle);
    if (home !== null) continue; // MP5.2b: a road row has no body in the road's world to walk into
    nearRow(near, handle, row, body, body.dims, body.scale);
  }
  // A data cell's life draws its own bodies, and a crossing has none yet: the rows still stand in the predicted world, or walking into one corrects.
  for (const [handle, info] of client.creatures) {
    if (bodies.has(handle) || handle === under || !interpolator.sample(handle, renderTick, row)) continue;
    if (ROAD_X >= 0 && ROAD_Z >= 0 && roadPlaceOf(row[ROAD_X], row[ROAD_Z]) !== null) continue; // MP5.2b: read-only across the home edge
    const kind = String(info.initial['kind']), dims = KIND_DIMS.get(kind) ?? ports.dims(kind) ?? SOME_CREATURE;
    KIND_DIMS.set(kind, dims);
    nearRow(near, handle, row, info, dims, Number(info.initial['scale'] ?? 1));
  }
  return shown;
}

function overlay({ scope }: Pick<WorkerClientPorts, 'scope'>): (text: string) => void {
  // A14 (Jake, 2026-11-10: "all the net debug text moves into the FPS box"): a section of the frame meter's panel, under its
  // header; a tap on the fps pill opens it. Nothing of it is drawn over the world.
  const block = document.createElement('pre');
  block.className = 'ws-perf-net';
  perfDockSection(block, scope, 10);
  return text => { if (block.textContent !== text) block.textContent = text; };
}

async function readWorker(shell: Shell, report: WorkerClientReport): Promise<void> { report.workerTickMs = (await shell.probe()).tickMs; }

/** Boot the server in its worker and put this page on it. */
const buildRoot = (): { build: string; root: string } => {
  const build = (globalThis as { __WS_BUILD_ID__?: string }).__WS_BUILD_ID__ ?? '';
  return { build, root: `/b/${build}/standalone` };
};
/** The server's page-side modules, once a page: its identity, its save environment and its shell. */
let serverModules: Promise<ShellModule> | null = null;
function loadServerModules(): Promise<ShellModule> {
  serverModules ??= (async () => {
    const { root } = buildRoot();
    await bootTask('server:identity-module', () => import(/* @vite-ignore */ `${root}/identity.js`));
    const environment = await bootTask('server:storage-module', () => import(/* @vite-ignore */ `${root}/storage.js`)) as { installBrowserSaveEnvironment: () => void };
    environment.installBrowserSaveEnvironment();
    return await bootTask('server:shell-module', () => import(/* @vite-ignore */ `${root}/shell.js`)) as ShellModule;
  })();
  void serverModules.catch(() => { serverModules = null; });
  return serverModules;
}
/** A standalone server's boot: the page's saves carried into IndexedDB, then its worker. `held` counts each read it answers. */
async function bootStandalone(slug: string, lone: boolean, held: () => void): Promise<Shell> {
  // Read at the call: a leave this boot's own owner sets later chains on this boot, and must not be waited for here.
  const previous = closing;
  const { startStandalone } = await loadServerModules(), { build } = buildRoot(), { savePrefix } = appIdentity(), page = saveEnvironment().storage('shard');
  // The server's saves: the page's own, read once into IndexedDB and left in place. A session outgrows localStorage at its first cell.
  await bootTask('server:previous-session-close', () => previous); // a world a session just left may still be saving into what this one reads
  const saves = exploreChannel() ? pageOnlyServerSaves() : await bootTask('server:indexed-saves-open', () => openIndexedSaves(serverSaveDatabase()));
  if (page !== null) { await bootTask('server:page-save-carry', () => importPageSaves(saves, page, savePrefix)); await bootTask('server:reward-reconcile', () => syncPageRewards(saves, page, savePrefix)); }
  // DL21: the card counts what the server has read. DL25: it reads what this page holds first.
  // PZ3: its book, server parts, road part and loose reads follow the content base; rapier stays in the page
  // MP2.4: the Name the page keeps (the Name prompt) goes with the server's own device id; solo shows it on this page only
  const name = page === null ? null : heldName(page, savePrefix);
  // J311: on a grid page, Shard select's pick is where the in-page grid starts, wherever this device last stood.
  // ZE10b: a gate's zone entry also names where in that cell it arrives (its entryway, past the gate)
  const goto = lone ? null : chosenCell(), enter = goto === null ? null : chosenArrival();
  // NB19: the inline runtime candidate this page owns reads its own server files (inlineOwner.ts)
  const backgroundSaves = jsonSlot('debug.backgroundStandaloneSaves', 'device').read() === true;
  return startStandalone({ slug, base: contentURL(`/shardfiles/${slug}/`), build, savePrefix, backgroundSaves, ...name === null ? {} : { name }, ...lone ? { lone: true as const } : {}, ...ownsInlineCandidate(slug) ? { ownServer: true as const } : {}, ...goto === null ? {} : { goto }, ...enter === null ? {} : { enter }, held: url => { held(); return spawnHeldBytes(url); }, ...saves });
}
/** LD5 (J208): a standalone server started while the first frame builds. On Jake's iPhone its boot was the last 5.1 s of
 *  Load, after every frame step; it runs on its own thread, so it can boot beside them. Its reads before the server
 *  step are counted there when that step adopts it. */
const serverKey = (world: string, lone: boolean): string => `${world}${lone ? '|lone' : '|grid'}`;
interface EarlyServer { readonly key: string; readonly shell: Promise<Shell>; readonly reads: { count: number; card: ReturnType<typeof countedWait> | null }; adopted: boolean }
let early: EarlyServer | null = null;
/** An unadopted server's leave: saved and stopped, as an adopted one's is; a boot that failed holds nothing. */
async function leaveEarly(shell: Promise<Shell>): Promise<void> {
  let server: Shell;
  try { server = await shell; } catch { return; }
  server.pause();
  try { await atMostLeaveWait(server.save()); } catch { /* the stop goes on */ } finally { server.dispose(); }
}
/** MG10 (J410): the standalone server's worker, started at the boot's data step to load and warm physics while the page
 *  holds little (shell.ts `prespawnStandalone`); the server's boot adopts it. Only a build with an in-page server. */
export function prespawnWorkerServer(): void {
  if (pageServerRoute() !== 'standalone') return;
  void (async () => {
    try { (await loadServerModules()).prespawnStandalone?.(url => spawnHeldBytes(url)); } catch { /* the server's boot loads them again */ }
  })();
}
/** TEMPLATE-E2E TR-4b (T1 K): a build with a world reads its release file now, at the boot's data step, so a missing file
 *  ("Can't find the world") shows within seconds of the tap rather than after the whole load; the server step's `startOnline`
 *  takes the read over (shell.ts `readReleaseEarly`). */
export function readOnlineReleaseEarly(): void {
  const world = (globalThis as { __WS_WORLD__?: BuildWorld }).__WS_WORLD__;
  if (world === undefined) return;
  void (async () => {
    try {
      const { root } = buildRoot();
      const online = await import(/* @vite-ignore */ `${root}/online.js`) as OnlineModule;
      online.readReleaseEarly?.({ ...world, keep: releaseKeep(), leaving: onlineLeaving });
    } catch { /* the server step reads it as before */ }
  })();
}
/** Start the standalone server now, for the server step to adopt. A one-shard page of a build with a world joins it at
 *  that step instead, as before. A level left before adoption saves and stops this server as an adopted one would. */
export function startWorkerServerEarly(options: { readonly slug: string; readonly lone: boolean; readonly scope: Scope }): void {
  // GO4: a build with a world puts every page in it, a grid page too: no in-page server to start early.
  if (pageServerRoute() !== 'standalone') return;
  if (early !== null && !early.adopted) return;
  const reads: EarlyServer['reads'] = { count: 0, card: null };
  const shell = bootStandalone(options.slug, options.lone, () => { if (reads.card === null) reads.count++; else reads.card.add(); });
  // Its failures are the server step's, which awaits the same promises; until then nothing reports them early.
  void (async () => { try { await (await shell).booted; } catch { /* reported at the server step */ } })();
  const started: EarlyServer = { key: serverKey(options.slug, options.lone), shell, reads, adopted: false };
  early = started;
  // Settings' import stops an unadopted server as it stops an adopted one (no save); adoption registers its own stop.
  const unstop = serverStopsForImport(() => {
    if (started.adopted) return;
    started.adopted = true; if (early === started) early = null;
    closing = (async () => { try { (await shell).dispose(); } catch { /* a failed boot holds nothing */ } })();
  });
  options.scope.onDispose(() => {
    unstop();
    if (early === started) early = null;
    if (started.adopted) return;
    started.adopted = true;
    closing = leaveEarly(shell);
  });
}
/** FR-A18: the early server's boot, for a page whose frames wait for it (a CPU rasterizer, finish.ts). Settles at once when
 *  no early server runs or one was adopted, and never rejects: a failed boot is the server step's to report. */
export async function earlyServerBooted(): Promise<void> {
  const started = early;
  if (started === null || started.adopted) return;
  try { await (await started.shell).booted; } catch { /* reported at the server step */ }
}
/** A device id's storage for a page whose browser keeps nothing (OF2: such a page still joins the world, as a new device each time). */
function pageOnlyStorage(): SaveStorage {
  const items = new Map<string, string>();
  return { get length() { return items.size; }, key: index => [...items.keys()][index] ?? null, getItem: key => items.get(key) ?? null,
    setItem: (key, value) => { items.set(key, value); }, removeItem: key => { items.delete(key); } };
}
async function startWorkerClient(ports: WorkerClientPorts, card: ReturnType<typeof countedWait>): Promise<void> {
  const route = pageServerRoute();
  if (route === 'missing') throw new Error(MISSING_SERVER);
  const { slug, player, physics, scope, system } = ports, { savePrefix } = appIdentity(), page = saveEnvironment().storage('shard');
  const { root, build } = buildRoot();
  const adopted = early !== null && !early.adopted && early.key === serverKey(slug, ports.grid === null) ? early : null;
  if (adopted !== null) { adopted.adopted = true; adopted.reads.card = card; for (let read = 0; read < adopted.reads.count; read++) card.add(); }
  else if (early !== null && !early.adopted) {
    // a server started for another world is stopped unsaved, as Settings stops one, and this one waits for it to go
    const stale = early; stale.adopted = true; early = null;
    closing = (async () => { try { (await stale.shell).dispose(); } catch { /* a failed boot holds nothing */ } })();
  }
  const standalone = (): Promise<Shell> => adopted?.shell ?? bootStandalone(slug, ports.grid === null, () => { card.add(); });
  // E7.2d, GO4: a build stamped with a world puts every page in it, a grid page as well as a one-shard page (no URL switches). A grid
  // page whose seat is in another cell enters the grid again there, never a `?chunk=` page; GO5's hint makes that rare.
  const onlineModule = (): Promise<OnlineModule> => bootTask('server:online-module', () => import(/* @vite-ignore */ `${root}/online.js`)) as Promise<OnlineModule>;
  const online = async (world: BuildWorld, storage: SaveStorage): Promise<Shell> => {
    const { grid } = ports, booted = grid?.booted;
    const gridOf = (cell: string, goto: boolean, spawn = false): OnlineGrid | undefined => grid === null ? undefined : { cell, cells: grid.cells.map(row => row.instance), placed: (at, pose) => { grid.serverPlace?.(at, pose); }, reenter: next => { grid.reenter?.(next); },
      // a page with no in-place entry at all takes GO4's reload at once
      // the ask goes with the boot that made it (review MUST: a page sent back to the title mid-load never re-enters later)
      reenterInPage: (next, reload) => { if (grid.reenterInPage === undefined) return false; scope.onDispose(regrids.ask(next, reload)); return true; }, ...(goto ? { goto: true } : {}), ...(goto && spawn ? { spawn: true } : {}) };
    // ZE10d2: a gate's 0 handed this page's link over: the seat is frozen at that cell's gate, and this session's `ready` seats it past
    const kept = handedOver;
    handedOver = null;
    if (kept !== null) {
      const next = booted === kept.cell ? gridOf(kept.cell, true) : undefined;
      if (next !== undefined && kept.shell.adopt !== undefined) { console.info(`[grid] zone entry: this session takes the link over in ${kept.cell}`); kept.shell.adopt({ loaded: slug, grid: next }); return kept.shell; }
      console.warn(`[grid] zone entry: the link handed over at ${kept.cell}'s gate goes (this session booted ${String(booted)})`);
      // another cell booted: the link goes, and the door's hold seats this session's own dial past the gate (ZE9c)
      kept.shell.dispose();
    }
    const { startOnline } = await onlineModule();
    // MP2.4: a page that came in without the title's PLAY (a link, a reload) asks for the Name here, once per device, before it joins
    const answered = await askNameToJoin(scope, { parent: document.body, doctor: () => { document.dispatchEvent(new CustomEvent('ws:doctor', { detail: 'join' })); } });
    // a page that left while it asked never joins (Codex review): a cancelled load must not take the device's seat
    if (!answered || scope.disposed) throw new Error('The page left before it joined the world');
    // QA 11-19 row 52: a ZONE SELECT pick (chosen, with no gate's arrival) asks the door for the cell's spawn
    const first = booted === undefined ? undefined : gridOf(booted, pageGoto() === booted, chosenCell() === booted && chosenArrival() === null);
    // MP2.2e1: a signed-in page joins with its join ticket, so the door seats its account; a guest, or a page the API can't answer,
    // joins as its device. The ticket is read at each hello, so a redial after a refresh sends the new one.
    // FM8b mode 27: the account service's 401 (a session that ended) signs the page out and is heard by the world's signed-out card,
    // whether it came before the join, from the 20-minute refresh or from the check each drop makes
    const endedHeard: (() => void)[] = [];
    let ended = false;
    const login = { ...pageLogin(storage), ended: () => { ended = true; for (const heard of endedHeard) heard(); } }, device = deviceIdentity(storage, savePrefix).player;
    await ticketBeforeJoin(login, device);
    if (scope.disposed) throw new Error('The page left before it joined the world');
    scope.interval(TICKET_REFRESH_MS, () => { void refreshTicket(login, device); });
    const session: OnlineSession = {
      renew: async () => {
        if (signedIn(login) === undefined) return ended ? 'ended' : 'guest';
        if (await refreshTicket(login, device, AbortSignal.timeout(5000)) !== undefined) return 'ok';
        return signedIn(login) === undefined ? 'ended' : 'unknown';
      },
      onEnded: heard => { endedHeard.push(heard); if (ended) heard(); },
      signIn: async () => {
        const { openSignIn, titleSignedIn } = await import('@wildshard/engine/ui/signInCard');
        await openSignIn(scope, { parent: document.body, overWorld: true });
        return titleSignedIn();
      },
    };
    return startOnline({ ...world, keep: releaseKeep(), leaving: onlineLeaving, loaded: slug, build, identity: name => ticketed(login, deviceIdentity(storage, savePrefix, name)), session,
      ...(first === undefined ? { shardCells: oneShardCells() } : { grid: first }) });
  };
  const world = (globalThis as { __WS_WORLD__?: BuildWorld }).__WS_WORLD__;
  // OFFLINE OF2 (J298): a build with a world sends every page online; the world's word never picks the server. A grid page whose world
  // is known to host one cell (a word in time, or the device's kept answer; no word takes the grid, J300) re-enters as that cell's
  // one-shard online page, never the solo grid. Shard select's goto already asked, so its grid page doesn't ask again.
  const bootedCell = ports.grid?.booted, reshard = ports.grid?.reshard;
  if (world !== undefined && bootedCell !== undefined && reshard !== undefined && !gotoHosted() && !await bootTask('server:grid-hosted', () => worldHosted(world))) {
    // a page the player left while it asked (back to the title) goes nowhere: the title keeps the document (review MUST)
    if (scope.disposed) throw new Error('The page left before it joined the world');
    reshard(bootedCell);
    // the page is leaving for the one-shard page (or the title): this boot never goes on, as a GO4 regrid's never arrives
    await new Promise<never>(() => { /* settles never: the page unloads */ });
  }
  // A page that can keep nothing still joins, with a device id for this page only.
  const shell = await (world !== undefined && route === 'online' ? online(world, page ?? pageOnlyStorage()) : standalone()), { client } = shell;
  // QA-FEEDBACK-2026-11-20-mini row 9: Settings' Saves card and New Game reach the room's copy through this page's link
  const roomSaves = shell.roomSaves ?? null;
  wirePage.roomSaves = roomSaves;
  scope.onDispose(() => { if (wirePage.roomSaves === roomSaves) wirePage.roomSaves = null; });
  // ZE10d2: a handed-over link no session took (this one is not online) goes; the door's hold keeps the seat for a later dial
  if (handedOver !== null) { handedOver.shell.dispose(); handedOver = null; }
  void shell.booted.catch(() => undefined);
  // QA row 16: a navigation the game chose leaves the world's seat from the moment there is a shell, even mid-load (a returning held
  // body may already be back). Once the page can save, the hold below replaces this one.
  let ended = false, leaves = shell.leave === undefined ? (): void => undefined : holdLeaving(async () => { shell.pause(); await shell.leave?.(); });
  // Settings stops a server before it touches what the server saves: that stop must not save.
  const stop = (): void => { if (!ended) { ended = true; leaves(); shell.dispose(); } };
  // ZE10d2 (J352): a world page's gate. On the door's `arrive` the seat is frozen at the gate and the next session on this page takes
  // the link over: this session ends with no quit (the hold below would say one) and no dispose
  const enter = shell.enter;
  if (enter !== undefined && ports.grid !== null) scope.onDispose(lendOnlineGate(async cell => {
    const at = await enter(cell);
    console.info(`[grid] zone entry: the door ${at === null ? 'refused' : 'answered'} ${cell}${ended || scope.disposed ? ' (session gone)' : ''}`);
    if (at === null || ended || scope.disposed) return null;
    ended = true; leaves(); handedOver = { shell, cell };
    // no session took it (the entry's boot failed, the player left for the title): it goes once the door's own wait is over
    const kept = handedOver, expiry = new Scope('zone.handover');
    expiry.timeout(HANDOVER_MS, () => { expiry.dispose(); if (handedOver === kept) { handedOver = null; kept.shell.dispose(); } });
    return at;
  }));
  // GO5: the door seated this page's player in another cell than it booted (a disagreeing hint): the page enters that cell in place
  // and the next session takes this link over, as at a gate's 0, so there is no reload; the door waits for that session's `ready`
  const reenterInPage = ports.grid?.reenterInPage;
  if (shell.adopt !== undefined && reenterInPage !== undefined) {
    // the hand-over runs before the page leaves: the leave's hold (a quit) must be gone first, as at the gate
    // review MUST: a redial's `resume` between the hand-over and the next session's `adopt` names the cell the page is already entering
    const mine = (cell: string): boolean => cell === ports.grid?.booted || handedOver?.cell === cell || ((!ended && !scope.disposed && handedOver === null) && reenterInPage(cell, () => {
      console.info(`[grid] the seat is in ${cell}: entering it on this page, the link handed over`);
      ended = true; leaves(); const kept = { shell, cell }; handedOver = kept;
      const expiry = new Scope('regrid.handover');
      expiry.timeout(HANDOVER_MS, () => { expiry.dispose(); if (handedOver === kept) { handedOver = null; kept.shell.dispose(); } });
    }));
    regrids.session(mine); regridSession = mine;
    // a later session may already have said its own
    scope.onDispose(() => { if (regridSession === mine) { regridSession = null; regrids.session(null); } });
  }
  scope.onDispose(serverStopsForImport(stop));
  // A session that ends with its page still here saves first. What navigates asks through `holdLeaving`, below.
  scope.onDispose(() => { if (ended) return; ended = true; leaves(); shell.pause(); closing = atMostLeaveWait(shell.save()).finally(() => { shell.dispose(); }); });
  const retired = new Map<string, number>(), spawnMs = new Map<string, number>(), net = new NetPlayer(client, player, physics), show = isDev() ? overlay(ports) : (): void => undefined, row = new Float64Array(ANIMAL_CLASS.row.length), near: CreaturePredictionRow[] = [], costs = new Float64Array(240), bodies = new Map<number, RowBody>();
  // the ride: a press goes up, and it starts and ends on the server's word. The body under the rider leaves its row for it
  let mount: Mount | null = null;
  const bindMount = (): void => {
    const next = mountOf(player) ?? null;
    if (next === mount) return;
    mount?.bindWire(null); next?.bindWire(net.ride); mount = next;
  };
  // The rows say who takes a rider. A horse this player tames joins them by the same word.
  const rideable = new Set<number>(), offered = new Set<number>(), offerMounts = (): void => {
    if (mount === null) return;
    for (const handle of rideable) {
      const id = client.entities.get(handle)?.id, body = bodies.get(handle)?.body;
      if (id !== undefined && body !== undefined && !offered.has(handle)) { offered.add(handle); mount.addMountable(body.entityId, `the ${body.label.toLowerCase()}`); }
    }
  };
  net.bindRide({ enter: handle => { const body = bodies.get(handle)?.body; if (body !== undefined) mount?.enter(body.entityId); }, leave: () => { mount?.leave(); } });
  // Adoption and a restored ride can arrive before their row has made a page
  // body. The reliable relation remains until dismount; finish seating it as
  // soon as the manager has materialized that body.
  const seatMount = (): void => {
    const own = client.welcome?.handle;
    if (mount === null || own === undefined) return;
    const under = client.riders.get(own), body = under === undefined ? null : bodies.get(under)?.body;
    if (body === undefined || mount.horse === body) return;
    mount.leave();
    if (body !== null) mount.enter(body.entityId);
  };
  // J116: a hook tool's claw reads this player's rows, so it waits for the server to name them. A grid cell holds its own tool.
  let clawed: GrappleTool | null = null;
  const bindClaw = (): void => {
    const tool = ports.tools().find(item => item instanceof GrappleTool) ?? null, id = client.welcome?.player;
    if (tool === clawed || id === undefined) return;
    clawed?.useClaw(null); clawed = tool;
    tool?.useClaw(course => netClaw(client, id, net.hooks, course));
  };
  scope.onDispose(() => { clawed?.useClaw(null); clawed = null; });
  wirePage.bind(client, id => { net.wire.interact(id); }, stop, (handle, to) => headOf(bodies.get(handle)?.body, to), act => { client.act(act); });
  wirePage.led = () => net.predictor.leading; wirePage.pending = () => net.predictor.pending; net.onCommand = command => { wirePage.command(command); }; wirePage.rowBody = handle => bodies.get(handle)?.body ?? null;
  wirePage.namedBody = id => { for (const [handle, { body }] of bodies) if (client.entities.get(handle)?.id === id) return body; return null; };
  scope.onDispose(() => { wirePage.unbind(); net.onCommand = null; wirePage.led = () => false; wirePage.pending = () => 0; wirePage.rowBody = () => null; wirePage.namedBody = () => null; });
  // SHARD-SOURCE AP24b: a look lamp that follows an actor rides its body, or one of its bones, by the server's name for it
  scope.onDispose(setLampFollow(ports.scene, (actor, bone) => { const body = wirePage.namedBody(actor); return body === null ? null : bone === undefined ? body.mesh : body.mesh.skeleton.getBoneByName(bone) ?? null; }));
  // J116: the lock's body by the server's name for it
  net.lockTarget = () => {
    if (lockOn.state !== 'locked' || lockOn.target === null) return undefined;
    for (const [handle, { body }] of bodies) if (body === lockOn.target) return client.entities.get(handle)?.id;
    return undefined;
  };
  // A crossing brings another shard's items, and each has its own slots.
  let items = ports.items;
  // SR11 (C8): a shard's kit melee goes by its order among them, the slot its server owner reads (`declaredKitSlots`).
  const slotsOf = (rows: readonly WorkerItemRow[]): Map<string, number> => new Map([...declaredKitSlots(rows), ...rows.flatMap(item => item.ranged === undefined ? [] : [[item.id, item.ranged.slot] as const])]);
  player.link = net; net.place = shell.place; net.bindWeapons(ports.weapons, slotsOf(items));
  // A frame names its world. A grid page crosses when one says so; a one-shard page has only the world it opened in, and waits there.
  const { grid } = ports, bookOf = (cell: number | undefined): string | null => cell === undefined || cell === 0 ? null : grid?.cells[cell - 1]?.slug ?? null, siteOf = (cell: number): string | null | undefined => cell === 0 ? null : grid?.cells[cell - 1]?.instance;
  let opened: number | undefined, renderTick = 0;
  if (grid === null) net.inCell = cell => (opened ??= cell) === cell;
  else {
    grid.bindWire({ site: () => { const cell = client.latest?.cell; return cell === undefined ? undefined : siteOf(cell); }, rebound: next => { net.world.rebind(next); }, rows: netNeighbourRegion(client, () => renderTick),
      flags: () => [...client.phased, ...client.flags()] });
    net.inCell = cell => siteOf(cell) === grid.frame();
  }
  scope.onDispose(() => { player.link = null; ports.weapons.bindWire(null); net.dispose(); });
  // A practice room or a playground floats over the world and only this page is in it: its player walks alone, its weapons strike its
  // dummies, and the world waits where they left it. A body the server still had to serve would pull the player back down.
  let away = false;
  // A stopped server earns a client no credit: what a page sent it anyway would be refused, and past a room's flood debt the page is dropped.
  const quiet = (): boolean => away || document.visibilityState === 'hidden';
  scope.listen(document, 'ws:practice-active', event => {
    const inside = event instanceof CustomEvent && event.detail === true;
    if (inside === away) return;
    away = inside; shell.hold(inside); player.link = inside ? null : net;
    if (inside) { ports.weapons.bindWire(null); return; }
    net.bindWeapons(ports.weapons, slotsOf(items));
    const day = ports.day(); if (day !== null) wirePage.dayPassed(day);
  });
  // OF9: a world build (the online shell redials) opens the world without its seat once the grace is up; the shell keeps dialling,
  // the link screens say why, and the seat, when it comes, places the player (GO5). A server in this page boots with it, as before.
  const unseated = shell.redials === true
    && !await seatedInTime(shell.booted, SEAT_GRACE_MS, navigator.onLine, ms => new Promise<void>(resolve => { scope.timeout(ms, resolve); }));
  const { restored } = unseated ? { restored: false } : await bootTask('server:await-booted', () => shell.booted);
  // OF10: unseated, the page plays its own input for the predictor's ring, then holds until the seat
  if (unseated) { bootMark('server:unseated'); net.playUnseated(); }
  // E7.6: only a world has anyone else in it.
  let others: OtherPlayers | null = null;
  if (shell.redials === true) others = new (await import('@wildshard/engine/net/otherPlayers')).OtherPlayers(client, ports.scene, scope, player.position, ports.warmRoad);
  if (others !== null) others.seats = id => wirePage.vehicleSeat(id); // MSZ10: a seated player sits in its vehicle
  // QA-FEEDBACK-2026-11-19 row 54: players don't walk through each other. Each step's move is bent round the bodies drawn here,
  // so the server steps the same move (softCollide.ts); a crossing, a board, water or a saddle lets go.
  const soft = others?.soft ?? null, self = { x: 0, y: 0, z: 0, vx: 0, vz: 0, deep: (x: number, z: number): boolean => player.deepAt(x, z) };
  if (soft !== null) { player.bendMove = (str, fwd, yaw) => soft.bend(str, fwd, yaw); scope.onDispose(() => { player.bendMove = null; }); }
  if (new URLSearchParams(location.search).has('bossGod')) shell.bossGod();
  bootMark('server:ready-send'); shell.ready();
  const heard: Record<string, number> = {};
  const started = diagnosticNow(), report: WorkerClientReport = { drawn: wirePage.drawn, heard, offstage: wirePage.offstage, frames: 0, framesPerSecond: 0, ticksPerSecond: 0, correctionsPerMinute: 0, corrections: 0, retired: {}, spawnMs: {}, missed: net.predictor.missed, misses: net.predictor.misses, authoritative: net.predictor.authoritative, worstOffset: 0, queue: 0, replaysPerFrame: 0, resyncs: 0, delayMs: 0, jitterMs: 0, interpHeld: 0, interpStarved: 0, mainMsP95: 0, workerTickMs: 0, rows: 0, attacks: 0, hits: 0, kills: 0, refused: 0, held: 0, dropped: 0, hp: 0, falls: 0, closed: null, x: 0, z: 0, cell: 0, serverX: 0, serverZ: 0, restored, savedTick: -1, savedOk: false, receipts: [], quests: {}, flags: [], paid: 0, fights: [], owned: {}, sky: null, day: null, clawed: false, own: null, movers: 0, posed: 0, sand: 0, vehicle: null };
  if (unseated) void shell.booted.then(answer => { report.restored = answer.restored; bootMark('server:seated-late'); return undefined; }, () => undefined);
  scope.onDispose(client.onLedger(receipt => { report.receipts.push(`${receipt.grant}:${receipt.name}`); }));
  scope.onDispose(client.onView(({ name }) => { heard[name] = (heard[name] ?? 0) + 1; }));
  const contacts: NetCombatEvent[] = [];
  scope.onDispose(client.onTravel(() => { contacts.length = 0; near.length = 0; }));
  // CC18c: a creature's projectiles, each flown from its `flight` event; a crossing leaves them, a hit beside one ends it
  const flights = new StrikeFlights(ports.scene);
  scope.onDispose(client.onFlight(flight => { flights.add(flight); }));
  scope.onDispose(client.onTravel(() => { flights.clear(); }));
  scope.onDispose(() => { flights.clear(); });
  scope.onDispose(client.onCombat(event => {
    contacts.push(event);
    if (event.kind === 'hit') flights.struck(event.at, event.tick);
    if (event.kind === 'hit' && event.target === client.welcome?.handle) ports.hurt(event.amount, new Vector3(...event.at), event.blow === true);
    else hurtOther(event, client.welcome?.handle, others); // REMOTE-PLAYERS RP10: a hit on another player flashes their body
    if (event.kind === 'hit' && event.confirmFor !== 0) { report.hits++; if (event.killed) report.kills++; }
    if (event.kind === 'reward') report.paid += event.coins;
  }));
  scope.onDispose(client.onPlayerDied(event => {
    report.falls++; net.holdRespawn(); ports.died(event, () => { net.resumeRespawn(); });
  }));
  // Only the server decides a death: the page takes no damage, and its own 0 would start a second one, so it stops at 1.
  const { attributes } = ports.health, cap = attributes.incomingCap;
  attributes.incomingCap = 0;
  scope.onDispose(() => { attributes.incomingCap = cap ?? Infinity; });
  // The server keeps the session's saves, and only a page knows when to ask: on a timer, as a phone hides it, as a page goes, and before
  // a navigation. Hiding is the phone's only warning, so it can't wait for a timer; `pagehide` covers a close that never hid.
  const save = async (): Promise<void> => { const { tick, ok } = await shell.save(); report.savedTick = tick; report.savedOk = ok; grid?.saveLocation(); };
  scope.interval(SAVE_EVERY_MS, () => { void save(); });
  scope.listen(document, 'visibilitychange', () => { if (document.visibilityState === 'hidden') void save(); });
  scope.listen(window, 'pagehide', () => { void save(); });
  // QA row 16: a navigation the game chose (the menu's exit, another world, the doctor) leaves the world's seat at once.
  leaves(); leaves = holdLeaving(async () => { shell.pause(); await save(); await shell.leave?.(); });
  let firstTick = -1, ticksFrom = started, cost = 0, sampleAt = 0, framesAt = 0, sampledAt = started, presented = started;
  scope.onDispose(client.onTravel(() => { firstTick = -1; ticksFrom = diagnosticNow(); }));
  const sample = (now: number): void => {
    const { latest } = client;
    report.retired = Object.fromEntries(retired); report.spawnMs = Object.fromEntries(spawnMs); report.owned = Object.fromEntries(client.owned); report.sky = latest === null ? null : client.stateField(latest, 'weather.phase') ?? null; report.day = latest === null ? null : client.stateField(latest, DAY_ROW) ?? null;
    report.vehicle = wirePage.vehicleReport(); report.movers = wirePage.movers.size; report.posed = wirePage.posed; report.sand = wirePage.sandPeak; report.clawed = clawed !== null; report.own = client.welcome?.player ?? null;
    report.quests = Object.fromEntries([...client.quests].map(([id, quest]) => [id, quest.started ? quest.step : 'unstarted'])); report.flags = [...client.phased, ...client.flags()]; report.fights = wirePage.encounters().map(fight => `${fight.id}:${fight.state}:${fight.hp}`);
    report.framesPerSecond = (report.frames - framesAt) / (now - sampledAt) * 1000; framesAt = report.frames; sampledAt = now;
    report.mainMsP95 = [...costs].sort((a, b) => a - b)[Math.floor(Math.min(report.frames, costs.length) * 0.95) + Math.max(0, costs.length - report.frames)] ?? 0;
    if (now - sampleAt > 2000) { sampleAt = now; void readWorker(shell, report); }
    show(`worker client ${report.closed ?? 'open'}\n${report.framesPerSecond.toFixed(1)} fps  ${report.ticksPerSecond.toFixed(1)} ticks/s\ndelay ${report.delayMs.toFixed(0)} ms  jitter ${report.jitterMs.toFixed(1)} ms  held ${report.interpHeld}/${report.interpStarved}\ncorrections ${report.corrections} (${report.correctionsPerMinute.toFixed(1)}/min)  worst ${report.worstOffset.toFixed(2)} m\nqueue ${report.queue}  replays/frame ${report.replaysPerFrame.toFixed(2)}\nmain ${report.mainMsP95.toFixed(2)} ms  worker ${report.workerTickMs.toFixed(1)} ms  rows ${report.rows}\nhits ${report.hits}  kills ${report.kills}  refused ${report.refused}  waiting ${report.attacks}  held ${report.held}`);
  };
  // A body's pose inputs beyond its rows: this page names what its programs read, and the server says those as they change.
  const poses = new Map<string, Record<string, number>>();
  let said = 0, saidCell = -1, arrowsSaid = -1;
  const sayPoseInputs = (): void => {
    const cell = client.latest?.cell ?? -1;
    if (poseInputNames.size === said && cell === saidCell) return;
    said = poseInputNames.size; saidCell = cell;
    for (const names of poseActs(poseInputNames)) client.act({ kind: 'pose', seq: 0, names });
  };
  // A new link is told every value again, and a new room has heard no page name its inputs.
  scope.onDispose(client.onRejoin(() => { poses.clear(); said = 0; }));
  scope.onDispose(client.onView(({ name, args }) => {
    if (!name.startsWith(NET_POSE)) return;
    const dot = name.lastIndexOf('.'), id = name.slice(NET_POSE.length, dot), field = name.slice(dot + 1), [value = 0] = args;
    let inputs = poses.get(id);
    if (inputs === undefined) { inputs = {}; poses.set(id, inputs); }
    inputs[field] = value;
    for (const [handle, { body }] of bodies) if (client.entities.get(handle)?.id === id) { body.mem[field] = value; wirePage.drew(name); break; }
  }));
  // MSZ9b: a vehicle's row poses the follower that knows its dock
  const decks = new NetMovers(client, { get: id => wirePage.movers.get(id) ?? wirePage.vehicleView(id) }, player.position);
  scope.onDispose(net.world.addMover(decks));
  const creaturePrediction = new CreaturePrediction(client.interpolator, net.world, near, player.position);
  scope.onDispose(net.world.addMover(creaturePrediction));
  system({ id: 'proof.worker.creature-contacts', phase: 'fixed.pre', run: () => { creaturePrediction.prepare(); } });
  system({ id: 'proof.worker.reconcile', phase: 'input', run: () => { const at = diagnosticNow(); net.reconcile(); cost = diagnosticNow() - at; } });
  system({ id: 'proof.worker.present', phase: 'update', run: dt => {
    // A page still crossing stands in another world than the frames: those rows aren't its manager's to spawn.
    const at = diagnosticNow(), here = client.latest === null || net.inCell(client.latest.cell), cellAnimals = !here ? null : grid === null ? ports.animals : grid.animals();
    // MP5.2b: on the road the home's manager draws the road's rows of the home's creatures near its edge
    const road = here && cellAnimals === null && grid !== null ? grid.roadAnimals?.() ?? null : null, animals = road?.animals ?? cellAnimals, home = road?.origin ?? null;
    renderTick = client.present();
    const entered = grid?.items() ?? items;
    if (entered !== items) { items = entered; net.bindSlots(slotsOf(items)); }
    sayPoseInputs(); syncCreatures(client, animals, bodies, retired, spawnMs, poses, home);
    if (here && contacts.length > 0) for (const event of contacts.splice(0)) {
      const entry = bodies.get(event.kind === 'hit' ? event.target : event.kind === 'died' ? event.id : event.body);
      if (entry === undefined) continue;
      if (event.kind === 'hit') entry.manager.presentHit?.(entry.body, event.amount, new Vector3(...event.at), event.head, event.killed, event.confirmFor !== 0);
      else if (event.kind === 'reward') { if (event.item !== undefined) entry.manager.presentReward?.(entry.body, client.welcome?.player ?? '', event.item); }
      else entry.manager.presentDeath?.(entry.body, new Vector3(...event.dir), event.impulse, event.tick, event.by === client.welcome?.handle);
    }
    // A parked page can hear death and despawn before its next frame. Keep the
    // known body until those queued contacts have presented, then retire it.
    for (const [handle, { body, manager }] of bodies) if (!client.entities.has(handle)) { manager.retire(body); bodies.delete(handle); }
    const arrows = client.owned.get(OWNED_ROW.arrows); // plus one, so an empty quiver is a line too
    if (arrows !== undefined && arrows !== arrowsSaid) { arrowsSaid = arrows; ports.weapons.mirrorArrows(arrows - 1); }
    bindMount(); offerMounts(); seatMount(); bindClaw();
    const shown = showRows(client, ports, bodies, renderTick, dt, row, near, rideable, home);
    others?.frame(renderTick, dt); flights.show(renderTick);
    if (others !== null) {
      const feet = player.position, free = here && player.link !== null && !player.hover && !player.swimming && player.ride === null && !player.carried && player.mountedOn === null;
      self.x = feet.x; self.y = feet.y; self.z = feet.z; self.vx = player.velocity.x; self.vz = player.velocity.z;
      others.collide(self, dt, free);
    }
    wirePage.frame(here ? bookOf(client.latest?.cell) : null, here, ports.day());
    if (here) wirePage.syncVehicles(player.position, dt);
    decks.frame(renderTick);
    report.rows = animals === null ? client.creatures.size : shown; // a data cell's life draws them
    if (!quiet()) net.present(dt);
    const now = diagnosticNow(), { predictor } = net, seconds = (now - started) / 1000, tick = client.latest?.tick ?? 0;
    costs[report.frames % costs.length] = cost + now - at;
    report.frames++;
    if (firstTick === -1 && tick > 0) firstTick = tick;
    report.ticksPerSecond = firstTick === -1 ? 0 : (tick - firstTick) / ((now - ticksFrom) / 1000); // each world keeps its own clock
    report.missed = predictor.missed; report.authoritative = predictor.authoritative; report.corrections = predictor.corrections; report.correctionsPerMinute = predictor.corrections / seconds * 60; report.worstOffset = net.worstOffset; report.queue = predictor.pending;
    report.replaysPerFrame = predictor.replays / report.frames; report.resyncs = predictor.resyncs; report.delayMs = client.clock.delayMs; report.jitterMs = client.clock.jitterMs; report.interpHeld = client.interpolator.held; report.interpStarved = client.interpolator.starved;
    report.refused = net.attacks.refused; report.attacks = net.attacks.pending; report.held = net.heldSlot;
    if (report.closed === null && client.closed !== null && !ended && client.closed !== 'reload' && shell.redials !== true) showError(`The game's server stopped (${client.closed})`);
    report.dropped = client.dropped; report.closed = client.closed; report.x = player.position.x; report.z = player.position.z;
    const { latest } = client;
    if (latest !== null) { const { px, pz, hp } = client.owner(latest); report.cell = latest.cell; report.serverX = Number(px); report.serverZ = Number(pz); report.hp = Number(hp); attributes.health = Math.max(1, report.hp); }
    presented = now;
    if (now - sampledAt >= 1000) sample(now);
  } });
  // A glass panel parks the frame loop, and the wire doesn't wait for it: what the server says of a buy or a torn notice reaches the
  // panel in a beat, with no command, because nothing here moves a body. The ack keeps the server's baseline moving.
  scope.interval(PARKED_BEAT_MS, () => {
    const now = diagnosticNow();
    if (now - presented < PARKED_BEAT_MS * 2 || quiet()) return;
    client.present();
    const here = client.latest === null || net.inCell(client.latest.cell);
    wirePage.frame(here ? bookOf(client.latest?.cell) : null, here, ports.day());
    client.flush();
    sample(now);
  });
  window.__workerClient = () => ({ ...report });
  // NET-LAG: observe the real external-room client without creating a second player.
  if (isDev()) {
    const observed = (): { readonly client: NetClient; readonly predictor: NetPlayer['predictor'] } => ({ client, predictor: net.predictor });
    window.__workerClientNet = observed;
    scope.onDispose(() => { if (window.__workerClientNet === observed) delete window.__workerClientNet; });
  }
  window.__onlinePlayers = () => others?.shown ?? [];
  window.__softCollide = () => soft?.report ?? null;
  window.__workerClientHits = by => { shell.hardHits(by); };
  window.__workerClientStill = () => { shell.still(); };
  window.__workerClientFlag = flag => { shell.raise(flag); };
  // SHARD-SOURCE AP5: the dev hook's `swapColliders` reaches the in-page server here (DEVSERVER only: the define folds it away)
  if (typeof __DEVSERVER__ === 'boolean' && __DEVSERVER__) window.__workerClientDevColliders = (name, boxes) => { shell.devColliders?.(name, boxes); };
  // MEMORY-STRUCTURE STR4: on a dev server the ground goes over its control channel (the in-page server's shell exposes its own)
  if (typeof __DEVSERVER__ === 'boolean' && __DEVSERVER__ && shell.devGround !== undefined) { const ground = shell.devGround; window.__workerClientDevGround = next => { ground(next); }; }
  window.__workerClientTravel = to => { travel({ to, mode: 'enter' }); };
  window.__workerClientSky = name => { wirePage.climate({ op: 'force', name, at: 0.1 }); };
  window.__workerClientTime = pick => { saveSetting('time', pick); };
  window.__workerClientRow = name => wirePage.row(name);
  window.__workerClientRows = kind => {
    const { latest } = client, out: { readonly x: number; readonly y: number; readonly z: number }[] = [];
    if (latest === null) return out;
    for (const [handle, info] of client.entities) {
      const seen = info.cls.cls === ANIMAL_CLASS.cls && info.initial['kind'] === kind ? client.fields(latest, handle) : null;
      if (seen !== null && Boolean(seen['alive'])) out.push({ x: Number(seen['x']), y: Number(seen['y']), z: Number(seen['z']) });
    }
    return out;
  };
  window.__workerClientGate = flag => wirePage.gates.has(flag);
  window.__workerClientBot = (id, x, y, z) => {
    const { client: bot, move } = shell.join(id, x, y, z), STILL = { steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: 0 };
    const beat = scope.interval(1000 / 60, () => { bot.present(); bot.command(STILL); bot.flush(); });
    return { client: bot, move, press: wanted => { bot.act({ kind: 'interact', seq: 0, id: wanted }); }, end: () => { scope.cancelTimer(beat); bot.dispose(); } };
  };
  window.__workerClientFights = () => {
    const out: WorkerClientFight[] = [];
    for (const fight of wirePage.encounters()) {
      const body = client.latest === null ? null : client.fields(client.latest, fight.body);
      const held = bodies.get(fight.body)?.body.mesh ?? null;
      out.push({ ...fight, at: body === null ? null : { x: Number(body['x']), y: Number(body['y']), z: Number(body['z']) }, name: client.entities.get(fight.body)?.id ?? null, shown: held === null ? null : inScene(held) });
    }
    return out;
  };
  window.__workerClientSave = save;
  // DL21, DL24: a page on a server builds no bodies of its own, so the first rows were the first its creature programs were asked
  // for: they linked inside the first presented frame, at control (Pine's task of 985 ms at phone CPU, 0.5-2.7 s of 'Final activation'
  // on the Simulator, cold only). The first frame's rows take their bodies here, and their links run under the card.
  // QA row 29 (Jake, 11-10: "the teleporting of locations when you load into the game is a bit jarring"): the first frame
  // after the card showed the authored spawn, the next one the saved place, because this page took the server's first
  // owner block only at its first game frame. It takes it here, under the card (bounded as the first rows are), and the
  // loader draws one more hidden frame from it (finish.ts), so the reveal opens where the player is.
  // A poll that a level left mid-boot settles at once (a cancelled timer alone would leave the boot's waits open).
  const poll = (): Promise<void> => new Promise<void>(resolve => {
    if (scope.disposed || scope.disposing) { resolve(); return; }
    const off = scope.capture('disposers', resolve);
    scope.timeout(FIRST_ROWS_POLL_MS, () => { off(); resolve(); });
  });
  // OF9: an unseated page has no rows to wait for: the world opens now
  const firstBy = unseated ? 0 : diagnosticNow() + FIRST_ROWS_MS;
  while (client.latest === null && diagnosticNow() < firstBy && !scope.disposed && !scope.disposing) await poll();
  if (scope.disposed || scope.disposing) return;
  net.reconcile(false);
  // the mark says whether the page took the server's place (a crossing's frame or a held respawn does not)
  bootMark(net.joined ? 'server:first-owner-adopted' : 'server:first-owner-unadopted');
  if (ports.linkBodies === undefined) { bootMark('server:launch-complete'); return; }
  bootMark('server:first-body-preparation-start');
  let first = -1;
  const until = unseated ? 0 : diagnosticNow() + FIRST_ROWS_MS;
  while (diagnosticNow() < until) {
    renderTick = client.present();
    if (first === -1 && client.latest !== null) first = client.latest.tick;
    if (first !== -1 && renderTick >= first) break;
    await poll();
    if (scope.disposed || scope.disposing) return;
  }
  if (first === -1 || !net.inCell(client.latest?.cell ?? -1)) { bootMark('server:launch-complete'); return; } // a crossing's rows are its next world's
  syncCreatures(client, grid === null ? ports.animals : grid.animals(), bodies, retired, spawnMs, poses);
  bootMark('server:first-body-preparation-end');
  if (bodies.size > 0) await bootTask('server:first-body-links', ports.linkBodies);
  bootMark('server:launch-complete');
}

async function guarded(ports: WorkerClientPorts): Promise<void> {
  const card = countedWait(serverStepLabel(), 'files'); // completed worker tasks and verified inputs own its progress (SB48: the step's own name)
  try { await startWorkerClient(ports, card); }
  catch (error) { console.error('[worker client]', error); throw error; }
  finally { card.end(); }
}

/** Start the client and its server; a failure says so, because a phone has no console. It settles once the server has booted, or
 *  failed: the boot is part of the load, so a page that awaits it hands the player a world the server already holds. */
export function launchWorkerClient(ports: WorkerClientPorts): Promise<void> {
  return new Promise((resolve, reject) => { ports.scope.onDispose(resolve); void guarded(ports).then(resolve, reject); }); // a level left mid-boot hears no server
}
