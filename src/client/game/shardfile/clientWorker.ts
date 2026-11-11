// P1-E5.3 I6 (J126), E6: every page runs the real Game and Player against the real server in its worker: the Player predicts and
// reconciles, and every creature is an interpolated row drawn by the real views.
import type { Scope } from '@wildshard/engine/app/scope';
import type { LiveGridWire } from '../grid/liveSession';
import type { SystemSpec } from '@wildshard/engine/app/systems';
import type { Player } from '@wildshard/engine/player/Player';
import { Vector3, type Object3D } from 'three';
import { appIdentity } from '@wildshard/engine/app/identity';
import { bootMark, bootTask } from '@wildshard/engine/boot/timing';
import { importPageSaves, openIndexedSaves, serverSaveDatabase, serverStopsForImport, type IndexedSaves } from '@wildshard/engine/saves/indexed';
import { saveEnvironment } from '@wildshard/engine/saves/environment';
import { syncPageRewards } from '../../../shared/game/saves';
import type { SaveStorage } from '@wildshard/engine/saves/store';
import { atMostLeaveWait, holdLeaving } from '@wildshard/engine/boot/lastEnd';
import { countedWait } from '@wildshard/engine/boot/waits';
import { diagnosticNow } from '@wildshard/engine/core/clock';
import type { NetClient } from '@wildshard/engine/net/client';
import type { NetCombatEvent } from '@wildshard/engine/net/messages';
import type { DeathCause } from '@wildshard/engine/combat/pipeline';
import { deviceIdentity, type NetIdentity } from '@wildshard/engine/net/identity';
import { NetPlayer, type NetWeapons } from '@wildshard/engine/net/netPlayer';
import type { PredictedRow } from '@wildshard/engine/net/predictionWorld';
import { ANIMAL_CLASS } from '@wildshard/engine/net/netSchemas';
import type { OtherPlayers } from '@wildshard/engine/net/otherPlayers';
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
import { travel } from '../travel/travel';
import type { ShardSlug } from '../../../shared/game/shard/slug';
import { DAY_ROW, NET_POSE } from '@wildshard/engine/sim/shardRows';
import { POSE_NAMES } from '@wildshard/engine/net/acts';
import { poseInputNames } from '../../../shared/game/plugin/channelPrograms';
import type { EncounterRow } from '../boss/barFeed';
import { wirePage, type DayFollower } from './wirePage';
import { OWNED_ROW } from '../../../shared/game/loot/ownedRows';
import { declaredKitSlots } from '../../../shared/game/shardfile/items';
import { earlyStandalone, serverRoute } from './serverRoute';

type Creatures = Pick<RowBodiesView, 'animals' | 'spawn' | 'retire' | 'onWindup' | 'presentHit' | 'presentDeath' | 'presentReward'>;
/** What a grid page lends: its crossing follows the server, and its creatures are the entered cell's. */
export interface WorkerClientGrid {
  readonly cells: readonly { readonly instance: string; readonly slug: string }[];
  readonly bindWire: (wire: LiveGridWire) => void;
  readonly frame: () => string | null;
  readonly animals: () => Creatures | null;
  /** The entered cell's item rows; none on the road, which keeps the last cell's. */
  readonly items: () => readonly WorkerItemRow[] | null;
  /** Say where the page stands: a reload boots the cell it names, and has to open where the server's save stands. */
  readonly saveLocation: () => void;
  /** GO5: the world's door named where this player stands (a grid instance, cell-local). The page's own hint and card follow it. */
  readonly serverPlace?: (instance: string, at: { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number }) => void;
  /** GO4: the seat is in another cell than this page booted: enter the grid again there (a grid entry, never a `?chunk=` page). */
  readonly reenter?: (instance: string) => void;
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
}
interface ShellModule { readonly startStandalone: (config: { slug: string; base: string; build: string; savePrefix: string; lone?: true; held?: (url: string) => Promise<ArrayBuffer | null> } & IndexedSaves) => Shell }
/** What `stampBuildDocuments` writes into a build that has a world: its signed release file and the key that signed it. */
interface BuildWorld { readonly release: string; readonly key: string; readonly recordTag?: string }
/** E7.2d: the page's seat in the one world, in a shell of the same shape. */
interface OnlineModule { readonly startOnline: (config: BuildWorld & { loaded: string; build: string; identity: (name?: string) => NetIdentity; grid?: { readonly cell: string; readonly cells: readonly string[]; readonly placed: (cell: string, at: { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number }) => void; readonly reenter: (cell: string) => void } }) => Promise<Shell> }
interface Shell { readonly redials?: true; pause: () => void; hold: (on: boolean) => void; bossGod: () => void; raise: (flag: string) => void; join: (id: string, x: number, y: number, z: number) => { readonly client: NetClient; readonly move: (x: number, y: number, z: number) => void }; readonly client: NetClient; readonly booted: Promise<{ readonly restored: boolean }>; place: (x: number, y: number, z: number, yaw: number) => void; hardHits: (by: number) => void; ready: () => void; leave?: () => Promise<void>; save: () => Promise<{ readonly tick: number; readonly ok: boolean }>; probe: () => Promise<{ readonly tickMs: number }>; dispose: () => void }

const SAVE_EVERY_MS = 30_000;
/** How long the card waits for the server's first rows, and how often it looks. A server that has booted says them in a tick. */
const FIRST_ROWS_MS = 1500, FIRST_ROWS_POLL_MS = 20;
/** How often a page whose frames are parked behind a panel still hears the server. */
const PARKED_BEAT_MS = 120;
const column = (name: string): number => ANIMAL_CLASS.row.findIndex(entry => entry.name === name);
const X = column('x'), Y = column('y'), Z = column('z'), YAW = column('yaw'), STATE = column('state'), ATTACK = column('attackT'), ATTACK_DUR = column('attackDur'), ATTACK_STAMP = column('attackStamp'), WINDING = column('winding'), TARGET = column('target'), FLINCH = column('flinch'), HP = column('hp'), ALIVE = column('alive'), RIDEABLE = column('rideable'), STRAFE = column('strafe'), BRACE = column('brace'), RISE = column('rise'), ACT = column('act');

/** What the page measures, as I6 lists it. */
export interface WorkerClientReport {
  frames: number; framesPerSecond: number; ticksPerSecond: number; correctionsPerMinute: number; corrections: number; worstOffset: number; queue: number; replaysPerFrame: number;
  delayMs: number; jitterMs: number; mainMsP95: number; workerTickMs: number; rows: number; attacks: number; hits: number; kills: number; refused: number; held: number; dropped: number; hp: number; falls: number; closed: string | null; x: number; z: number; cell: number; serverX: number; serverZ: number; restored: boolean; savedTick: number; savedOk: boolean;
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
  /** Movers this page holds, the poses rows have given them, and the highest drift rows have laid. */
  movers: number; posed: number; sand: number;
  /** Bodies this page made and the rows put away, by kind: what its own sim still builds. */
  retired: Readonly<Record<string, number>>;
  /** The longest a row of each kind took to spawn, in ms: a model built late shows here. */
  spawnMs: Readonly<Record<string, number>>;
  /** What the corrections disagreed on. */
  missed: Readonly<NetPlayer['predictor']['missed']>; misses: readonly (readonly number[])[];
}
/** A fight as a proof reads it: its row, where its body stands and the server's name for it. */
export type WorkerClientFight = EncounterRow & { readonly at: { readonly x: number; readonly y: number; readonly z: number } | null; readonly name: string | null };
declare global { interface Window { __onlinePlayers?: () => OtherPlayers['shown']; __workerClientFights?: () => readonly WorkerClientFight[]; __workerClientHits?: (by: number) => void; __workerClientTravel?: (to: ShardSlug) => void;__workerClientSky?: (name: string) => void; __workerClientTime?: (pick: OptionValue<'time'>) => void; __workerClientRow?: (name: string) => number | undefined; __workerClientFlag?: (flag: string) => void; __workerClientRows?: (kind: string) => readonly { readonly x: number; readonly y: number; readonly z: number }[]; __workerClientGate?: (flag: string) => boolean; __workerClientBot?: (id: string, x: number, y: number, z: number) => { readonly move: (x: number, y: number, z: number) => void; readonly press: (id: string) => void; readonly end: () => void }; __workerClient?: () => WorkerClientReport; __workerClientSave?: () => Promise<void> } }

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
interface RowBody { readonly body: Animal; readonly manager: Creatures; windup?: number }
/** Every creature on this page is a row: a new one spawns through the real manager, one the server dropped retires. */
function syncCreatures(client: NetClient, animals: Creatures | null, bodies: Map<number, RowBody>, retired: Map<string, number>, spawnMs: Map<string, number>, poses: ReadonlyMap<string, Record<string, number>>): void {
  if (animals === null) return;
  for (const [handle, info] of client.entities) {
    if (info.cls.cls !== ANIMAL_CLASS.cls || bodies.has(handle)) continue; // the shell's bundle has its own copy of the class
    const { x = 0, y = 0, z = 0, yaw = 0 } = client.interpolator.fields(handle, Number.MAX_SAFE_INTEGER) ?? {};
    if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number' || typeof yaw !== 'number') continue;
    const kind = String(info.initial['kind']), at = diagnosticNow(), body = animals.spawn(kind, x, z, yaw, String(info.initial['variant']), { y, body: { seed: Number(info.initial['seed']), scale: Number(info.initial['scale']) } });
    spawnMs.set(kind, Math.max(spawnMs.get(kind) ?? 0, diagnosticNow() - at));
    body.rowDriven = true;
    wirePage.dress(animals, body);
    bodies.set(handle, { body, manager: animals });
    Object.assign(body.mem, poses.get(info.id));
  }
  for (const body of animals.animals.filter(entry => !entry.rowDriven)) { animals.retire(body); retired.set(body.kind, (retired.get(body.kind) ?? 0) + 1); } // what the page's own population made
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

/** Rows onto the bodies, and the near ones into the predicted world as capsules. */
function showRows(client: NetClient, net: NetPlayer, ports: WorkerClientPorts, bodies: ReadonlyMap<number, RowBody>, renderTick: number, dt: number, row: Float64Array, near: PredictedRow[], rideable: Set<number>): number {
  const { interpolator } = client, own = client.welcome?.handle ?? 0, under = client.riders.get(own);
  let shown = 0;
  near.length = 0;
  for (const [handle, entry] of bodies) {
    const { body, manager } = entry;
    if (handle === under || !interpolator.sample(handle, renderTick, row)) continue; // the body under this player is its own prediction (J48)
    const attack = row[ATTACK] ?? 0, duration = (row[ATTACK_DUR] ?? 1000) / 1000, winding = row[WINDING] === 1;
    const stamp = row[ATTACK_STAMP] ?? 0, started = winding && row[TARGET] === own && entry.windup !== stamp;
    body.showRow({ x: row[X] ?? 0, y: row[Y] ?? 0, z: row[Z] ?? 0, yaw: row[YAW] ?? 0, state: ANIMAL_STATES[row[STATE] ?? 0] ?? 'idle', attack, attackDuration: duration, winding, flinch: row[FLINCH] ?? 0, strafe: row[STRAFE] ?? 0, brace: row[BRACE] ?? 0, hp: row[HP] ?? 0, alive: row[ALIVE] === 1, rise: row[RISE] ?? 0, act: row[ACT] ?? 0 }, dt);
    if (started) { entry.windup = stamp; if (body.alive) manager.onWindup?.(body, duration); }
    shown++;
    if (row[RIDEABLE] === 1) rideable.add(handle);
    const { radius, height } = creatureBodyShape(body.dims, body.scale);
    near.push({ handle, x: row[X] ?? 0, y: row[Y] ?? 0, z: row[Z] ?? 0, alive: row[ALIVE] === 1, driven: false, radius, height });
  }
  // A data cell's life draws its own bodies, and a crossing has none yet: the rows still stand in the predicted world, or walking into one corrects.
  for (const [handle, info] of client.entities) {
    if (info.cls.cls !== ANIMAL_CLASS.cls || bodies.has(handle) || handle === under || !interpolator.sample(handle, renderTick, row)) continue;
    const kind = String(info.initial['kind']), dims = KIND_DIMS.get(kind) ?? ports.dims(kind) ?? SOME_CREATURE;
    KIND_DIMS.set(kind, dims);
    const { radius, height } = creatureBodyShape(dims, Number(info.initial['scale'] ?? 1));
    near.push({ handle, x: row[X] ?? 0, y: row[Y] ?? 0, z: row[Z] ?? 0, alive: row[ALIVE] === 1, driven: false, radius, height });
  }
  net.world.syncRows(near, ports.player.position);
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
  const saves = await bootTask('server:indexed-saves-open', () => openIndexedSaves(serverSaveDatabase()));
  if (page !== null) { await bootTask('server:page-save-carry', () => importPageSaves(saves, page, savePrefix)); await bootTask('server:reward-reconcile', () => syncPageRewards(saves, page, savePrefix)); }
  // DL21: the card counts what the server has read. DL25: it reads what this page holds first.
  return startStandalone({ slug, base: `/shardfiles/${slug}/`, build, savePrefix, ...lone ? { lone: true as const } : {}, held: url => { held(); return spawnHeldBytes(url); }, ...saves });
}
/** LD5 (J208): a standalone server started while the first frame builds. On Jake's iPhone its boot was the last 5.1 s of
 *  Load, after every frame step; it runs on its own thread, so it can boot beside them. Its reads before the Worker boot
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
/** Start the standalone server now, for the Worker boot step to adopt. A one-shard page of a build with a world joins it at
 *  that step instead, as before. A level left before adoption saves and stops this server as an adopted one would. */
export function startWorkerServerEarly(options: { readonly slug: string; readonly lone: boolean; readonly scope: Scope }): void {
  // GO4: a build with a world puts every page in it, a grid page too: no in-page server to start early.
  if (!earlyStandalone((globalThis as { __WS_WORLD__?: BuildWorld }).__WS_WORLD__)) return;
  if (early !== null && !early.adopted) return;
  const reads: EarlyServer['reads'] = { count: 0, card: null };
  const shell = bootStandalone(options.slug, options.lone, () => { if (reads.card === null) reads.count++; else reads.card.add(); });
  // Its failures are the Worker boot step's, which awaits the same promises; until then nothing reports them early.
  void (async () => { try { await (await shell).booted; } catch { /* reported at the Worker boot step */ } })();
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
async function startWorkerClient(ports: WorkerClientPorts, card: ReturnType<typeof countedWait>): Promise<void> {
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
  const online = async (world: BuildWorld, storage: SaveStorage): Promise<Shell> => {
    const { startOnline } = await bootTask('server:online-module', () => import(/* @vite-ignore */ `${root}/online.js`)) as OnlineModule;
    const { grid } = ports, booted = grid?.booted;
    return startOnline({ ...world, loaded: slug, build, identity: name => deviceIdentity(storage, savePrefix, name),
      ...(grid === null || booted === undefined ? {} : { grid: { cell: booted, cells: grid.cells.map(cell => cell.instance), placed: (cell, at) => { grid.serverPlace?.(cell, at); }, reenter: cell => { grid.reenter?.(cell); } } }) });
  };
  const world = (globalThis as { __WS_WORLD__?: BuildWorld }).__WS_WORLD__;
  const shell = await (world !== undefined && page !== null && serverRoute(world, page) === 'online' ? online(world, page) : standalone()), { client } = shell;
  void shell.booted.catch(() => undefined);
  // QA row 16: a navigation the game chose leaves the world's seat from the moment there is a shell, even mid-load (a returning held
  // body may already be back). Once the page can save, the hold below replaces this one.
  let ended = false, leaves = shell.leave === undefined ? (): void => undefined : holdLeaving(async () => { shell.pause(); await shell.leave?.(); });
  // Settings stops a server before it touches what the server saves: that stop must not save.
  const stop = (): void => { if (!ended) { ended = true; leaves(); shell.dispose(); } };
  scope.onDispose(serverStopsForImport(stop));
  // A session that ends with its page still here saves first. What navigates asks through `holdLeaving`, below.
  scope.onDispose(() => { if (ended) return; ended = true; leaves(); shell.pause(); closing = atMostLeaveWait(shell.save()).finally(() => { shell.dispose(); }); });
  const retired = new Map<string, number>(), spawnMs = new Map<string, number>(), net = new NetPlayer(client, player, physics), show = isDev() ? overlay(ports) : (): void => undefined, row = new Float64Array(ANIMAL_CLASS.row.length), near: PredictedRow[] = [], costs = new Float64Array(240), bodies = new Map<number, RowBody>();
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
  wirePage.led = () => net.predictor.leading; wirePage.rowBody = handle => bodies.get(handle)?.body ?? null;
  wirePage.namedBody = id => { for (const [handle, { body }] of bodies) if (client.entities.get(handle)?.id === id) return body; return null; };
  scope.onDispose(() => { wirePage.unbind(); wirePage.led = () => false; wirePage.rowBody = () => null; wirePage.namedBody = () => null; });
  // J116: the lock's body by the server's name for it
  net.lockTarget = () => {
    if (lockOn.state !== 'locked' || lockOn.target === null) return undefined;
    for (const [handle, { body }] of bodies) if (body === lockOn.target) return client.entities.get(handle)?.id;
    return undefined;
  };
  // A crossing brings another shard's items, and each has its own slots.
  let items = ports.items;
  // SR11 (C8): a data shard's kit melee goes by its order among them, the slot its server owner reads (`declaredKitSlots`).
  const slotsOf = (rows: readonly WorkerItemRow[]): Map<string, number> => new Map([...declaredKitSlots(rows), ...rows.flatMap(item => item.ranged === undefined ? [] : [[item.id, item.ranged.slot] as const])]);
  player.link = net; net.place = shell.place; net.bindWeapons(ports.weapons, slotsOf(items));
  // A frame names its world. A grid page crosses when one says so; a one-shard page has only the world it opened in, and waits there.
  const { grid } = ports, bookOf = (cell: number | undefined): string | null => cell === undefined || cell === 0 ? null : grid?.cells[cell - 1]?.slug ?? null, siteOf = (cell: number): string | null | undefined => cell === 0 ? null : grid?.cells[cell - 1]?.instance;
  let opened: number | undefined, renderTick = 0;
  if (grid === null) net.inCell = cell => (opened ??= cell) === cell;
  else {
    grid.bindWire({ site: () => { const cell = client.latest?.cell; return cell === undefined ? undefined : siteOf(cell); }, rebound: next => { net.world.rebind(next); }, rows: netNeighbourRegion(client, () => renderTick) });
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
  const { restored } = await bootTask('server:await-booted', () => shell.booted);
  // E7.6: only a world has anyone else in it.
  let others: OtherPlayers | null = null;
  if (shell.redials === true) others = new (await import('@wildshard/engine/net/otherPlayers')).OtherPlayers(client, ports.scene, scope);
  if (new URLSearchParams(location.search).has('bossGod')) shell.bossGod();
  bootMark('server:ready-send'); shell.ready();
  const started = diagnosticNow(), report: WorkerClientReport = { drawn: wirePage.drawn, frames: 0, framesPerSecond: 0, ticksPerSecond: 0, correctionsPerMinute: 0, corrections: 0, retired: {}, spawnMs: {}, missed: net.predictor.missed, misses: net.predictor.misses, worstOffset: 0, queue: 0, replaysPerFrame: 0, delayMs: 0, jitterMs: 0, mainMsP95: 0, workerTickMs: 0, rows: 0, attacks: 0, hits: 0, kills: 0, refused: 0, held: 0, dropped: 0, hp: 0, falls: 0, closed: null, x: 0, z: 0, cell: 0, serverX: 0, serverZ: 0, restored, savedTick: -1, savedOk: false, receipts: [], quests: {}, flags: [], paid: 0, fights: [], owned: {}, sky: null, day: null, clawed: false, own: null, movers: 0, posed: 0, sand: 0 };
  scope.onDispose(client.onLedger(receipt => { report.receipts.push(`${receipt.grant}:${receipt.name}`); }));
  const contacts: NetCombatEvent[] = [];
  scope.onDispose(client.onTravel(() => { contacts.length = 0; }));
  scope.onDispose(client.onCombat(event => {
    contacts.push(event);
    if (event.kind === 'hit' && event.target === client.welcome?.handle) ports.hurt(event.amount, new Vector3(...event.at), event.blow === true);
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
    report.movers = wirePage.movers.size; report.posed = wirePage.posed; report.sand = wirePage.sandPeak; report.clawed = clawed !== null; report.own = client.welcome?.player ?? null;
    report.quests = Object.fromEntries([...client.quests].map(([id, quest]) => [id, quest.started ? quest.step : 'unstarted'])); report.flags = [...client.phased, ...client.flags()]; report.fights = wirePage.encounters().map(fight => `${fight.id}:${fight.state}:${fight.hp}`);
    report.framesPerSecond = (report.frames - framesAt) / (now - sampledAt) * 1000; framesAt = report.frames; sampledAt = now;
    report.mainMsP95 = [...costs].sort((a, b) => a - b)[Math.floor(Math.min(report.frames, costs.length) * 0.95) + Math.max(0, costs.length - report.frames)] ?? 0;
    if (now - sampleAt > 2000) { sampleAt = now; void readWorker(shell, report); }
    show(`worker client ${report.closed ?? 'open'}\n${report.framesPerSecond.toFixed(1)} fps  ${report.ticksPerSecond.toFixed(1)} ticks/s\ndelay ${report.delayMs.toFixed(0)} ms  jitter ${report.jitterMs.toFixed(1)} ms\ncorrections ${report.corrections} (${report.correctionsPerMinute.toFixed(1)}/min)  worst ${report.worstOffset.toFixed(2)} m\nqueue ${report.queue}  replays/frame ${report.replaysPerFrame.toFixed(2)}\nmain ${report.mainMsP95.toFixed(2)} ms  worker ${report.workerTickMs.toFixed(1)} ms  rows ${report.rows}\nhits ${report.hits}  kills ${report.kills}  refused ${report.refused}  waiting ${report.attacks}  held ${report.held}`);
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
    for (const [handle, { body }] of bodies) if (client.entities.get(handle)?.id === id) { body.mem[field] = value; break; }
  }));
  const decks = new NetMovers(client, wirePage.movers, player.position);
  scope.onDispose(net.world.addMover(decks));
  system({ id: 'proof.worker.reconcile', phase: 'input', run: () => { const at = diagnosticNow(); net.reconcile(); cost = diagnosticNow() - at; } });
  system({ id: 'proof.worker.present', phase: 'update', run: dt => {
    // A page still crossing stands in another world than the frames: those rows aren't its manager's to spawn.
    const at = diagnosticNow(), here = client.latest === null || net.inCell(client.latest.cell), animals = !here ? null : grid === null ? ports.animals : grid.animals();
    renderTick = client.present();
    const entered = grid?.items() ?? items;
    if (entered !== items) { items = entered; net.bindSlots(slotsOf(items)); }
    sayPoseInputs(); syncCreatures(client, animals, bodies, retired, spawnMs, poses);
    if (here) for (const event of contacts.splice(0)) {
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
    const shown = showRows(client, net, ports, bodies, renderTick, dt, row, near, rideable);
    others?.frame(renderTick, dt);
    wirePage.frame(here ? bookOf(client.latest?.cell) : null, here, ports.day()); decks.frame(renderTick);
    report.rows = animals === null ? [...client.entities.values()].filter(info => info.cls.cls === ANIMAL_CLASS.cls).length : shown; // a data cell's life draws them
    if (!quiet()) net.present(dt);
    const now = diagnosticNow(), { predictor } = net, seconds = (now - started) / 1000, tick = client.latest?.tick ?? 0;
    costs[report.frames % costs.length] = cost + now - at;
    report.frames++;
    if (firstTick === -1 && tick > 0) firstTick = tick;
    report.ticksPerSecond = firstTick === -1 ? 0 : (tick - firstTick) / ((now - ticksFrom) / 1000); // each world keeps its own clock
    report.missed = predictor.missed; report.corrections = predictor.corrections; report.correctionsPerMinute = predictor.corrections / seconds * 60; report.worstOffset = net.worstOffset; report.queue = predictor.pending;
    report.replaysPerFrame = predictor.replays / report.frames; report.delayMs = client.clock.delayMs; report.jitterMs = client.clock.jitterMs;
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
  window.__onlinePlayers = () => others?.shown ?? [];
  window.__workerClientHits = by => { shell.hardHits(by); };
  window.__workerClientFlag = flag => { shell.raise(flag); };
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
      out.push({ ...fight, at: body === null ? null : { x: Number(body['x']), y: Number(body['y']), z: Number(body['z']) }, name: client.entities.get(fight.body)?.id ?? null });
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
  const firstBy = diagnosticNow() + FIRST_ROWS_MS;
  while (client.latest === null && diagnosticNow() < firstBy && !scope.disposed && !scope.disposing) await poll();
  if (scope.disposed || scope.disposing) return;
  net.reconcile(false);
  // the mark says whether the page took the server's place (a crossing's frame or a held respawn does not)
  bootMark(net.joined ? 'server:first-owner-adopted' : 'server:first-owner-unadopted');
  if (ports.linkBodies === undefined) { bootMark('server:launch-complete'); return; }
  bootMark('server:first-body-preparation-start');
  let first = -1;
  const until = diagnosticNow() + FIRST_ROWS_MS;
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
  const card = countedWait('Worker boot', 'files'); // completed worker tasks and verified inputs own its progress
  try { await startWorkerClient(ports, card); }
  catch (error) { console.error('[worker client]', error); throw error; }
  finally { card.end(); }
}

/** Start the client and its server; a failure says so, because a phone has no console. It settles once the server has booted, or
 *  failed: the boot is part of the load, so a page that awaits it hands the player a world the server already holds. */
export function launchWorkerClient(ports: WorkerClientPorts): Promise<void> {
  return new Promise((resolve, reject) => { ports.scope.onDispose(resolve); void guarded(ports).then(resolve, reject); }); // a level left mid-boot hears no server
}
