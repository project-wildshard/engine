import type { MotionPlatform, MotionRide } from '../../shared/engine/player/motion';
import { validateLocalMovement, type LocalMovementCommand } from '../../shared/engine/input/commands';
import type { NetCommand } from '@wildshard/wire/netCommand';
import { Vector3 } from 'three';
import { Scope, type DisposeStep } from '../../shared/engine/app/scope';
import { withOwner } from '../../shared/engine/app/ownership';
import { Events } from '../../shared/engine/events/events';
import { GameClock } from '../../shared/engine/core/clock';
import { RngService } from '../../shared/engine/core/rng';
import { FIXED_STEP } from '../../shared/engine/core/fixedStep';
import { AnimalSim, type AnimalSimSpec } from '../../shared/engine/entities/AnimalSim';
import { StrikeRunner, type StrikeSpec } from '../../shared/engine/ai/strikes';
import { canReach } from '../../shared/engine/ai/reach';
import { CombatPipeline } from '../../shared/engine/combat/pipeline';
import { DamageBook } from './combat/damageBook';
import { RespawnBook } from './sim/respawn';
import type { PlayerHealth } from '../../shared/engine/combat/health';
import { Physics } from '../../shared/engine/physics/Physics';
import { CharacterMotor, PLAYER_BODY, PLAYER_CAPSULE, type MotorOptions } from '../../shared/engine/physics/CharacterMotor';
import { PlayerSim, simCommandOf } from './sim/playerSim';
import { publishDay } from '../../shared/engine/sim/shardRows';
import { actRoutes } from '../../shared/engine/sim/actRoutes';
import { BodyBandClocks, creatureBodyDistance, creatureBodyShape, keepsCreatureBody, tickDistance, type BandsState } from '../../shared/engine/sim/bands';
import type { TickRate } from '../../shared/engine/app/scheduler';
import { modeCollides } from '../../shared/engine/player/modes';
import type { Rapier } from '../../shared/engine/physics/rapier';
import { groups } from '../../shared/engine/physics/groups';
import { tagCollider } from '../../shared/engine/physics/surface';
import { Flags } from '../../shared/engine/world/interact/flags';
import type { QuestBookSaved } from '../../shared/engine/quest/players';
import { QuestState, type QuestDef } from '../../shared/engine/quest/core';
import type { DayCycle, DayCycleClock, DayCycleSpec } from '../../shared/engine/world/dayCycle';
import { clockDayPhase, clockPeriod, wrapClock, type DayClockState } from '../../shared/engine/sim/dayClock';
import { SIM_API_VERSION } from '../../shared/engine/sim/apiVersion';

/** Serializable F1 extension values, without callbacks or renderer objects. */
export type SimValue = null | boolean | number | string | SimValue[] | { [key: string]: SimValue };
/** Script instance memory, module globals, authored quest data and ledger dedupe live on the host. */
export interface SimSlots {
  scriptMemory: Record<string, SimValue>; scriptGlobals: Record<string, SimValue>;
  questState: Record<string, SimValue>; ledgerDedupe: string[];
}
/** Pure strike data. The host supplies the constant selection weight. */
export type SimStrike = Omit<StrikeSpec, 'weight'>;
/** One authored creature spawn, with its instance identity independent of view or streaming. */
export interface SimSpawn {
  id: string; spec: AnimalSimSpec; seed: number; scale: number;
  at: { x: number; y: number; z: number }; yaw: number; strike?: SimStrike;
}
/** A renderer-free level. F1 installs richer behaviours through scoped step callbacks. */
export interface SimLevel {
  version: number; id: string; seed: number;
  ground: { size: number; height: number };
  /** `coyoteMs`: the level's authored ground grace, absent at the default (player/jump.ts), so a level keeps its fingerprint. */
  player: { at: { x: number; y: number; z: number }; yaw: number; speed: number; coyoteMs?: number };
  entities: readonly SimSpawn[]; weapon: SimStrike; quests: readonly QuestDef[];
  /** SF72: where the day clock a runtime installs (SimHost.useDayClock) starts, in that clock's own units (its spec's
   *  `start`: the day fraction for a 'phase' clock, the hour for an 'hour' clock), over the clock's own start. A witness
   *  sets it to begin near dusk without ticking a whole day. Absent keeps the level's exact bytes. */
  day?: { start: number };
}
/** Resolved world-space movement and an optional targeted attack for one fixed tick. */
export interface SimCommand extends LocalMovementCommand {
  moveX: number; moveZ: number; yaw: number; attack?: { targetId: string };
  /** The HOVER press this tick (SF72): steps on or off the hoverboard, as the client's `hover` action toggles
   * `Player.setHover(!hover)`. A press, not a held state: `advance`, which repeats its command, refuses it. */
  hover?: true;
  /** The JUMP press this tick (SF72): on foot the client Player's jump (player/jump.ts: on the ground or within its
   * 100 ms coyote window, else the double jump), on the board the board jump. A press: `advance` refuses it. */
  jump?: true;
  /** The DODGE press this tick (SF72): the client Player's dodge (player/dash.ts) toward this command's move, a backstep
   * with none; refused on its 0.8 s cooldown and on the board. A press: `advance` refuses it. */
  dodge?: true;
  /** SF34: the DIVE and SURFACE controls held this tick while swimming (player/swim.ts; the page's Space / Shift and the
   *  touch discs). Held states, so `advance` repeats them; read only by a host with water (useWater). */
  dive?: boolean; surface?: boolean;
  /** Developer boost held this tick (`hoverSpeed`), where the host allows it: `allowDeveloperBoost`. */
  boost?: true;
  /** J116: the body the client says it is locked on: its orbit and side-hop bend round it, if it is real and in reach. */
  lockTarget?: string;
}
/** One player's input for one tick: off the wire, or a recorded world-space tape command. */
export type SimTickCommand = NetCommand | SimCommand;
/** Resident on-foot tuning supplied by a scoped owner: the dry walking speed and the crouch. The native motor, fall and
 *  jump remain authoritative. */
export interface SimWalkingControl {
  readonly speed: number; readonly crouching: boolean;
}
/** Combat's motion input, not corrected displacement. Delegated movement owns these same scalar observations. */
export interface SimPlayerMotionSample {
  readonly velocityX: number; readonly velocityZ: number;
  readonly grounded: boolean; readonly swimming: boolean; readonly hover: boolean;
}
/** The ride a mode holds (P1-E5.3-D1): what the step dispatches to, its read of the command ahead of the world's step, and the motion it reports. */
export interface SimRide extends MotionRide {
  read: (command: Readonly<SimCommand> | undefined, dt: number) => void;
  readonly motionSample: () => SimPlayerMotionSample;
  /** The body under the rider, by id. */
  readonly mount: () => string;
  /** The ride as flat words only its law reads (P1-E5.3-D3), and how many. */
  capture: (out: Float64Array, at: number) => number;
}
/** One owned host's alternative player-motion law, without changing its single physics/system authority.
 * Input runs before physics and returns true only while it owns motion; step then runs after physics instead of the
 * ordinary walk/board/dodge/jump. False retains that ordinary law. Register mutable state through a SimStateAdapter. */
export interface SimPlayerDriver {
  /** Queried after step, only when a motion observer is installed. Missing delegated samples are unavailable. */
  readonly motionSample?: () => SimPlayerMotionSample;
  input: (command: Readonly<SimCommand> | undefined, dt: number, host: SimHost) => boolean;
  step: (dt: number, host: SimHost) => void;
}
/**
 * SF34: the water an owned host's player wades and swims in (SimHost.useWater), the level's water bodies as the page
 * Player reads them (app.world.water): the rest surface, and the surface's swell over it.
 */
export interface SimWater {
  /** the rest water surface at (x, z), or null on dry land (the page's `app.world.water.restAt`) */
  surfaceAt: (x: number, z: number) => number | null;
  /** the surface's swell over its rest level at (x, z) (a sea's waves); absent = the pond's gentle bob on the host clock */
  bob?: (x: number, z: number) => number;
}
/** Each future brain/script instance registers its own continuation state, never a process singleton. */
export interface SimStateAdapter {
  snapshot: () => SimValue; restore: (value: SimValue) => void;
  /** Reconnect saved native handles after world replacement and owner tagging, without allocating or stepping gameplay. */
  physicsRestored?: () => void;
  /** Came to this world after some of its saves were made: a save without it restores, and it stays as it installed. */
  joined?: true;
}

/**
 * SF72: run this host's bodies on the page's distance bands (sim/bands.ts), as the page's AnimalManager runs a native
 * shard's creatures: each body's update cadence on its tick rate ('ai': every tick within 60 m of the player, every
 * other tick with the two ticks' time to 160 m, paused beyond) and the physics body LOD (a creature motor in the page's
 * capsule only within 45 m, released past 55 m). Off by default: a host that never opts in keeps every body stepped and
 * collided every tick, and its exact snapshot bytes.
 */
export interface SimBodyBands {
  /** Tick rates by id over the page scheduler's defaults ('always', 'ai', 'npc', 'fx', 'weather') and the manager's
   *  'legacy' (decisions 10 Hz, the body every tick at any distance): the level's tier `ticks`. */
  rates?: Readonly<Record<string, TickRate>>;
  /** A body's rate id this tick (the page's AnimalManager.tickRate); default 'always' for a driven or fight-scripted
   *  ('sidestep') body, else 'ai'. A body that changes rate starts a fresh clock, as on the page. */
  rate?: (body: AnimalSim) => string;
  /** Roster presence, independent of distance: an absent body has no brain/body clock, and physics LOD releases its motor. The roster owns this
   * predicate and restores its state before the next tick. Omitted means every installed body remains present. */
  present?: (body: AnimalSim) => boolean;
  /** The physics body LOD (default true); false keeps every body's host motor. */
  physics?: boolean;
}

/** Hooks around each body's own step (SimHost.useBodyStep), in the host's body order: the page creature manager's per-body
 *  loop runs a body's `act` right before it moves and its contact checks right after, before the next body acts. */
export interface SimBodyStep {
  before?: (id: string, body: AnimalSim, dt: number) => void;
  after?: (id: string, body: AnimalSim, dt: number) => void;
}

/** The day clock a host steps: the page's DayCycle (world/dayCycle.ts), read through its usual query surface. */
type SimDayClock = DayCycleClock & Pick<DayCycle, 'snapshot' | 'restore'> & { readonly spec: Pick<DayCycleSpec, 'units' | 'schedule' | 'dayFraction'> };

/** The existing page owns this traveller, its health update and its one physics/movement step. */
export interface SimExternalPlayer { position: Vector3; readonly yaw: number; health: PlayerHealth; owner: object }
/** The fields a page lends to stand in as a host's player. */
export interface SimPlayerBody { id: string; position: Vector3; yaw: number; health: PlayerHealth; motor: CharacterMotor }

/** Borrowed client state is stepped and disposed by its existing world owner. */
export interface SimHostPorts {
  rapier: Rapier; physics?: Physics; player?: SimPlayerBody;
  events?: Events; clock?: GameClock; combat?: CombatPipeline; scope?: Scope;
  ground?: boolean; heightAt?: (x: number, z: number) => number;
  /** Grid-only native flat boundary lattice; absent preserves the standalone two-triangle datum. */
  groundResolution?: 256 | 257;
  /** Frozen grid neighbours have logical player state, but no player capsule or controller. */
  playerBody?: boolean;
  fixedStep?: (run: () => void) => () => void;
}

/** A Vector3 that reads and writes whichever vector `read` names at the moment. */
function liveVector(read: () => Vector3): Vector3 {
  const view = new Vector3();
  for (const axis of ['x', 'y', 'z'] as const) Object.defineProperty(view, axis, { enumerable: true, get: () => read()[axis], set: (value: number) => { read()[axis] = value; } });
  return view;
}

/** Added to a dead player's squared distance, so any living player outranks every dead one. */
const DEAD_PLAYER_PENALTY = 1e12;

/** A session-local 60 Hz host using the same creature motion, damage, strikes, events and physics as the client. */
export class SimHost {
  readonly level: SimLevel;
  readonly scope: Scope;
  readonly events: Events;
  readonly clock: GameClock;
  readonly rng: RngService;
  readonly flags: Flags;
  readonly quests: QuestState[];
  /** P1-E3.3: other players' quest books, which the save carries; engine/quest/players sets it. */
  questStore: { save: () => QuestBookSaved[] | undefined; restore: (saved: readonly QuestBookSaved[] | undefined) => void } | undefined = undefined;
  readonly entities: Map<string, AnimalSim> = new Map<string, AnimalSim>();
  readonly strikes: Map<string, StrikeRunner> = new Map<string, StrikeRunner>();
  readonly adapters: Map<string, SimStateAdapter> = new Map<string, SimStateAdapter>();
  readonly state = { tick: 0, accumulator: 0, timers: {} as Record<string, number> };
  readonly slots: SimSlots = { scriptMemory: {}, scriptGlobals: {}, questState: {}, ledgerDedupe: [] };
  readonly combat: CombatPipeline;
  /** J105: who hurt which body. */
  readonly damage: DamageBook = new DamageBook();
  /** J107: where each player of a room goes back to. */
  readonly respawn: RespawnBook = new RespawnBook();
  physics: Physics;
  /** Every player in this host, the lead first. */
  readonly players: Map<string, PlayerSim> = new Map<string, PlayerSim>();
  /** The player this host was built with (leadPlayer). */
  private readonly lead: PlayerSim;
  private readonly playerScopes = new Map<string, Scope>();
  private readonly callbacks = new Map<string, (dt: number, host: SimHost) => void>();
  private readonly afterCallbacks = new Map<string, (dt: number, host: SimHost) => void>();
  private readonly weapons = new Map<string, StrikeSpec>();
  private readonly strikeCatalogues = new Map<string, ReadonlyMap<string, StrikeSpec>>();
  private readonly dynamicActors = new Set<string>();
  private readonly targetIds = new Map<string, string>();
  /** The command `seq` behind each player's running strike, which its hit confirms (J47). A restored strike lands unconfirmed. */
  private readonly strikeSeqs = new Map<string, number>();
  private tickCommands: ReadonlyMap<string, SimTickCommand> | undefined;
  /**
   * A live view of the position of the player the body acting right now deals with: what a brain holds where it once held
   * "the player's" position. It follows `focusedPlayer`, which the host sets to the player nearest each body as it decides
   * and moves. With one player it reads that player's position, always.
   */
  readonly playerFocus: Vector3;
  private focused: PlayerSim;
  /** Seats held out of the world: their capsule is disabled, and they take no input, move and heal nothing, and draw no one. */
  readonly parked: Set<string> = new Set<string>();
  /** What a net room's queues say of the next `step` (J125). That step clears it; a host with no room never has one. */
  commanded: { readonly still: ReadonlySet<string>; readonly extra: ReadonlyMap<string, SimTickCommand> } | null = null;
  /** Each says whether its system alone moves a player now, for the owner block's `led`: a grapple's pull, a cable. */
  readonly leading: ((player: PlayerSim) => boolean)[] = [];
  /** The player `player.traversal` is being asked for: a mode answers only for its own player. */
  traversing: PlayerSim | null = null;
  private boardHandles: number[] = [];
  private readonly direction = new Vector3();
  private readonly hitOrigin = new Vector3();
  private readonly hitPoint = new Vector3();
  disposed = false;
  readonly embedded: boolean;
  private readonly ownsPlayer: boolean;
  /** The terrain under (x, z). */
  heightAt: (x: number, z: number) => number;
  /** Walkable floor functions, as the page's `Player.platforms`: decks with no collider. A `solidFloor` piece is its colliders
   *  on both sides, so no shipped row lends one today (P1-E5.3-A10); the owner of one pushes it here. */
  readonly floors: MotionPlatform[] = [];
  /** SF34: the level's water (useWater), if any. */
  water: SimWater | undefined;
  private bands: { clocks: BodyBandClocks; rate: (body: AnimalSim) => string; present: ((body: AnimalSim) => boolean) | undefined; physics: boolean } | undefined;
  private bodyStep: SimBodyStep | undefined;
  // Reused visitor state keeps this turn's captured hooks/band decision even
  // when a callback enters another fixed step. No iterator tuples per body.
  private visitingBodyBands = false;
  private visitingBodyHooks: SimBodyStep | undefined;
  private floorQuery: ((x: number, z: number, fromY: number, maxDrop: number) => number | undefined) | undefined;
  private day: SimDayClock | undefined;

  constructor(level: SimLevel, ports: SimHostPorts) {
    if (level.version !== SIM_API_VERSION) throw new RangeError('Unsupported simulation level version');
    if (!Number.isFinite(level.ground.height) || !Number.isFinite(level.ground.size) || level.ground.size <= 0
      || !Number.isFinite(level.player.speed) || level.player.speed < 0) throw new RangeError('Invalid simulation level');
    const ids = level.entities.map((entity) => entity.id);
    if (new Set(ids).size !== ids.length || ids.includes(ports.player?.id ?? 'actor.player')) throw new Error('Duplicate simulation entity identity');
    if ((ports.physics === undefined) !== (ports.player === undefined) || (ports.physics !== undefined && (ports.events === undefined || ports.clock === undefined || ports.combat === undefined))) throw new Error('Borrowed simulation needs physics, player, events, clock and combat together');
    if (ports.fixedStep !== undefined && ports.physics === undefined) throw new Error('A fixed-step driver belongs to a borrowed world');
    if (ports.groundResolution !== undefined && ![256, 257].includes(ports.groundResolution)) throw new RangeError('Invalid native ground resolution');
    this.embedded = ports.physics !== undefined; this.ownsPlayer = ports.player === undefined;
    this.level = level; this.scope = ports.scope?.child(`sim:${level.id}`) ?? new Scope(`sim:${level.id}`); this.rng = new RngService(level.seed);
    this.heightAt = ports.heightAt ?? (() => level.ground.height);
    this.events = ports.events ?? new Events(); this.clock = ports.clock ?? new GameClock();
    this.physics = ports.physics ?? new Physics(ports.rapier, undefined, this.scope);
    if (ports.ground !== false && !this.embedded) {
      const count = ports.groundResolution ?? 2;
      const ground = this.physics.world.createCollider(ports.rapier.ColliderDesc.heightfield(count - 1, count - 1,
      new Float32Array(count ** 2).fill(level.ground.height), { x: level.ground.size, y: 1, z: level.ground.size }).setCollisionGroups(groups('WORLD')));
      tagCollider(ground, 'ground');
    }
    this.combat = ports.combat ?? new CombatPipeline(this.events, this.scope, () => this.physics);
    if (ports.player !== undefined && ports.playerBody === false) throw new Error('A borrowed player owns its motor');
    this.lead = new PlayerSim(this, { borrowed: ports.player, bodiless: ports.playerBody === false, id: ports.player?.id ?? 'actor.player', at: level.player.at, yaw: level.player.yaw,
      motor: health => this.playerMotor(health.id) }, this.scope);
    this.players.set(this.lead.id, this.lead);
    this.focused = this.lead; this.playerFocus = liveVector(() => this.focused.position);
    this.flags = new Flags(level.id, false);
    this.quests = level.quests.map((def) => new QuestState(def, this.flags, this.events, this.scope));
    this.strikes.set(this.lead.id, this.lead.strike);
    this.weapons.set(this.lead.id, { ...level.weapon, weight: () => 1 });
    for (const spawn of level.entities) this.createActor(spawn);
    this.events.on('actor.died', ({ actor }) => { this.flags.set(`dead:${actor.id}`); }, this.scope);
    this.events.on('damage.dealt', ({ req, dealt }) => { this.damage.record(req, dealt, this.players); }, this.scope);
    this.scope.onDispose(() => {
      this.disposed = true;
      for (const player of this.players.values()) { player.releaseExternal(); if (this.ownsPlayer) player.disposeMotor(); }
      for (const entity of this.entities.values()) entity.motor?.dispose();
      if (!this.embedded) this.physics.dispose();
    });
    if (!this.embedded) this.physics.step();
    if (ports.fixedStep !== undefined) {
      this.scope.onDispose(ports.fixedStep(() => { this.stepEmbedded(); }));
    }
  }
  private createActor(spawn: SimSpawn): AnimalSim {
    const entity = new AnimalSim(spawn.spec, spawn.seed, spawn.scale, spawn.id, {
      heightAt: (x, z) => this.heightAt(x, z), now: () => this.clock.now * 1000,
      floorBelow: (x, z, fromY, maxDrop) => this.floorQuery === undefined ? this.heightAt(x, z) : this.floorQuery(x, z, fromY, maxDrop),
      random: () => this.rng.stream('gameplay').next(), hit: (req) => this.combat.hit(req),
      attackStarted: () => { this.targetIds.set(spawn.id, this.focusedPlayer.id); },
    });
    entity.place(spawn.at.x, spawn.at.z, spawn.yaw, spawn.at.y);
    // under the physics body LOD a body spawns bodiless, as on the page: the next tick's sync gives it one when near
    if (this.bands?.physics !== true) {
      const body = new CharacterMotor(this.physics, this.creatureOptions(spawn.spec.dims.bodyRadius * spawn.scale, spawn.spec.dims.bodyY * spawn.scale * 2, spawn.id));
      // The capsule starts at the spawn: a creature that never walks (an idle boss) never moves it, and Rapier would
      // otherwise leave it at the world origin, an invisible wall at the cell centre (G222 playtest #7).
      body.resetAt(entity.position);
      entity.motor = body;
    }
    this.entities.set(spawn.id, entity);
    if (spawn.strike !== undefined) {
      this.strikes.set(spawn.id, new StrikeRunner()); this.weapons.set(spawn.id, { ...spawn.strike, weight: () => 1 });
    }
    return entity;
  }
  /** A player joins: a body at `at` (the level's spawn by default), with its own health, strike runner and motor. Systems
   *  bound to the lead at install do not extend to it. */
  addPlayer(id: string, at: { readonly x: number; readonly y: number; readonly z: number } = this.level.player.at, yaw: number = this.level.player.yaw): PlayerSim {
    if (this.disposed || this.embedded || this.players.has(id) || this.entities.has(id) || !/^[a-zA-Z0-9._:-]{1,128}$/u.test(id) || ![at.x, at.y, at.z, yaw].every(Number.isFinite)) throw new Error('Invalid simulation player');
    const scope = this.scope.child(`player:${id}`);
    const player = new PlayerSim(this, { id, at, yaw, motor: health => this.playerMotor(health.id) }, scope);
    this.players.set(id, player); this.playerScopes.set(id, scope);
    this.strikes.set(id, player.strike); this.weapons.set(id, { ...this.level.weapon, weight: () => 1 });
    return player;
  }
  /** A player leaves, with its body and strike. The lead stays: the host's systems are bound to it. */
  removePlayer(id: string): boolean {
    if (this.disposed) throw new Error('Simulation host is disposed');
    const player = this.players.get(id);
    if (player === undefined || player === this.lead) return false;
    if (this.focused === player) this.focused = this.lead;
    player.disposeMotor(); this.playerScopes.get(id)?.dispose(); this.playerScopes.delete(id);
    this.players.delete(id); this.strikes.delete(id); this.weapons.delete(id); this.strikeSeqs.delete(id); this.damage.leave(id);
    for (const [source, target] of this.targetIds) if (source === id || target === id) {
      this.strikes.get(source)?.cancel(); this.entities.get(source)?.cancelAttack(); this.targetIds.delete(source);
    }
    return true;
  }
  /** The living player nearest `point`, else the nearest of the dead: who a creature there is dealing with. */
  nearestPlayer(point: { readonly x: number; readonly y: number; readonly z: number }): PlayerSim {
    if (this.players.size === 1) return this.lead;
    let best = this.lead, bestScore = Infinity;
    for (const player of this.players.values()) {
      if (this.parked.has(player.id)) continue;
      const p = player.position, score = (p.x - point.x) ** 2 + (p.y - point.y) ** 2 + (p.z - point.z) ** 2 + (player.health.alive ? 0 : DEAD_PLAYER_PENALTY);
      if (score < bestScore) { best = player; bestScore = score; }
    }
    return best;
  }
  /** The player `playerFocus` follows. */
  get focusedPlayer(): PlayerSim { return this.focused; }
  /** Put a saved focus back; a player who has left leaves it on the lead. */
  restoreFocus(id: string | undefined): void { this.focused = (id === undefined ? undefined : this.players.get(id)) ?? this.lead; }
  /** Make `playerFocus` the player nearest `point`: each body before it decides and moves, an encounter before its step. */
  focusOn(point: { readonly x: number; readonly y: number; readonly z: number }): void { if (this.players.size > 1) this.focused = this.nearestPlayer(point); }
  /** Materialize a trusted deferred actor. Stable identity and immutable recipe are included in exact continuation.
   * The installer reinstalls the saved dynamic roster before restore; native motors belong to this host, never its caller.
   */
  spawn(spawn: SimSpawn): AnimalSim {
    if (this.disposed || this.entities.has(spawn.id) || this.players.has(spawn.id) || this.adapters.has(`runtime.actor.${spawn.id}`) || this.hasStep(`runtime.actor.${spawn.id}`)
      || !/^[a-zA-Z0-9._:-]{1,128}$/u.test(spawn.id) || ![spawn.seed, spawn.scale, spawn.at.x, spawn.at.y, spawn.at.z, spawn.yaw].every(Number.isFinite) || spawn.scale <= 0) throw new Error('Invalid dynamic simulation actor');
    const recipe = structuredClone(spawn), contract = JSON.stringify(recipe);
    const actor = withOwner(null, () => this.createActor(recipe));
    this.dynamicActors.add(spawn.id);
    this.adapters.set(`runtime.actor.${spawn.id}`, { snapshot: () => contract, restore: saved => {
      if (saved !== contract) throw new Error('Incompatible dynamic simulation actor recipe');
    } });
    return actor;
  }
  /** Retire only an explicitly spawned actor and its native motor/strike. Static level actors retain their existing lifetime. */
  retire(id: string): boolean {
    if (this.disposed) throw new Error('Simulation host is disposed');
    if (!this.dynamicActors.has(id)) return false;
    this.entities.get(id)?.motor?.dispose(); this.dynamicActors.delete(id); this.entities.delete(id); this.strikes.delete(id); this.weapons.delete(id); this.strikeCatalogues.delete(id);
    this.adapters.delete(`runtime.actor.${id}`); this.bands?.clocks.forget(id);
    for (const [source, target] of this.targetIds) if (source === id || target === id) {
      this.strikes.get(source)?.cancel(); this.entities.get(source)?.cancelAttack(); this.targetIds.delete(source);
    }
    return true;
  }
  /** Exact restore resolves pending strikes from the currently installed static or trusted dynamic recipe. */
  strikeSpecifications(id: string): readonly StrikeSpec[] {
    const spec = this.weapons.get(id);
    const specs = new Map(this.strikeCatalogues.get(id));
    if (spec !== undefined && !specs.has(spec.id)) specs.set(spec.id, spec);
    const result: StrikeSpec[] = [];
    for (const row of specs.values()) result.push({ ...row, shape: { ...row.shape }, tags: [...row.tags] });
    return result;
  }
  /** A declared decision owner selects among admitted strikes on the existing runner, including after restore. */
  registerStrikeCatalogue(id: string, specs: readonly SimStrike[]): void {
    if (!this.entities.has(id) || this.strikeCatalogues.has(id) || new Set(specs.map(row => row.id)).size !== specs.length) throw new Error('Invalid strike catalogue owner');
    const rows = new Map<string, StrikeSpec>();
    for (const spec of specs) rows.set(spec.id, { ...structuredClone(spec), weight: () => 1 });
    this.strikeCatalogues.set(id, rows);
    if (specs.length > 0 && !this.strikes.has(id)) this.strikes.set(id, new StrikeRunner());
  }
  /** Selection never installs another clock or contact path. Missing or busy actors retain today's refusal. */
  startDeclaredStrike(sourceId: string, targetId: string, strike: string): boolean {
    const spec = this.strikeCatalogues.get(sourceId)?.get(strike);
    return spec === undefined ? false : this.beginStrike(sourceId, targetId, spec);
  }
  /** The player's capsule on the page's body law (PLAYER_BODY: ITEM bodies stop it and its 80 kg pushes them), a creature's
   * on the page's creature filter. */
  private creatureOptions(radius: number, height: number, owner: string): MotorOptions {
    return { radius, height, step: 0.3, maxClimbDeg: 45, snap: 0.2, group: 'CREATURE', blockedBy: ['WORLD', 'PLAYER', 'CREATURE'], owner };
  }
  /** The page's capsule, on every host. */
  private playerOptions(owner: string): MotorOptions { return { ...PLAYER_CAPSULE, ...PLAYER_BODY, owner }; }
  private playerMotor(owner: string): CharacterMotor { return new CharacterMotor(this.physics, this.playerOptions(owner)); }
  /** The same capsule law also reconstructs a saved motor for a bodyless restore target. */
  playerMotorOptions(player: PlayerSim): MotorOptions {
    return player.motorOptions(() => this.playerOptions(player.id));
  }
  /** Opt into the page's distance bands for every body (SimBodyBands), once, before the first step; the installer runs
   * it again on a restoring host, before restore. The physics body LOD drops the bodies' host motors at once. */
  useBodyBands(options: SimBodyBands = {}): void {
    if (this.disposed || this.embedded || this.bands !== undefined) throw new Error('Body bands belong to an owned host, once');
    const clocks = new BodyBandClocks(options.rates);
    this.bands = { clocks, rate: options.rate ?? ((body) => body.driven || body.state === 'sidestep' ? 'always' : 'ai'),
      present: options.present, physics: options.physics ?? true };
    if (this.bands.physics) for (const entity of this.entities.values()) { entity.motor?.dispose(); entity.motor = null; }
  }
  /** Wrap every body's step (SimBodyStep), once, by the installer that owns the bodies' brains (restoring too: hooks hold
   *  no state of the host's). A body that does not step this tick (paused, the off tick of 'half') runs neither hook. */
  useBodyStep(hooks: SimBodyStep): void {
    if (this.disposed || this.bodyStep !== undefined) throw new Error('Body step hooks belong to one installer, once');
    this.bodyStep = hooks;
  }
  /** Whether the host runs on body bands, and with the physics body LOD. */
  get bodyBands(): { physics: boolean } | undefined { return this.bands === undefined ? undefined : { physics: this.bands.physics }; }
  /** This tick's update step for body `id` (s): the fixed step without bands; with them 0 while paused or on the off
   * tick of 'half' (the next takes both ticks). Asked first in a tick it fixes the tick's value, as the page's clock. */
  bodyDt(id: string): number {
    const entity = this.entities.get(id);
    if (entity === undefined) throw new RangeError(`Unknown simulation body ${id}`);
    const bands = this.bands;
    if (bands === undefined) return FIXED_STEP;
    if (entity.harnessHold || bands.present?.(entity) === false) { bands.clocks.forget(id); return 0; }
    return bands.clocks.bodyDt(id, bands.rate(entity), tickDistance(entity.position, this.nearestPlayer(entity.position).position));
  }
  /** Take this tick's decision step for body `id` on its band (the page scheduler's takeBrainDt): 0 until its rate's
   * period has passed, the time since its last decision when due; `urgent` (a hit, a lost sight line) wakes it now.
   * Without bands every tick decides (the fixed step). */
  brainDt(id: string, urgent = false): number {
    const entity = this.entities.get(id);
    if (entity === undefined) throw new RangeError(`Unknown simulation body ${id}`);
    this.focusOn(entity.position);
    const bands = this.bands;
    if (bands === undefined) return FIXED_STEP;
    if (bands.present?.(entity) === false) { bands.clocks.forget(id); return 0; }
    return bands.clocks.takeBrainDt(id, bands.rate(entity), tickDistance(entity.position, this.nearestPlayer(entity.position).position), urgent);
  }
  /** The page's creature capsule for a body under the physics body LOD (physics/creatures.ts's recipe), owned by its id. */
  creatureMotorOptions(entity: AnimalSim): MotorOptions {
    return { ...creatureBodyShape(entity.dims, entity.scale), group: 'CREATURE', blockedBy: ['WORLD', 'PLAYER', 'CREATURE'], owner: entity.entityId };
  }
  /** The band clocks as plain values (SimSnapshot.bands); undefined without bands. */
  bodyBandState(): BandsState | undefined { return this.bands?.clocks.snapshot(); }
  /** Exact band restore: saved state is refused unless this host runs on the same bands, and the reverse. */
  restoreBodyBands(saved: BandsState | undefined): void {
    if ((saved === undefined) !== (this.bands === undefined)) throw new RangeError('Snapshot body bands do not match');
    if (saved !== undefined) this.bands?.clocks.restore(saved, new Set(this.entities.keys()));
  }
  /** CreatureBodies.sync's physics body LOD, before the tick's decisions as on the page. */
  private syncBodies(): void {
    for (const entity of this.entities.values()) {
      const keep = this.bands?.present?.(entity) !== false
        && keepsCreatureBody(entity.motor !== null, entity.alive, entity.driven, creatureBodyDistance(entity.position, this.nearestPlayer(entity.position).position));
      if (entity.motor === null && keep) {
        const motor = new CharacterMotor(this.physics, this.creatureMotorOptions(entity));
        motor.resetAt(entity.position); // at the animal, not the world origin (G222 playtest #7)
        entity.motor = motor;
      } else if (entity.motor !== null && !keep) { entity.motor.dispose(); entity.motor = null; }
    }
  }
  /**
   * SF72: step the page's own day clock on this host, once, at install (a restoring host installs it again before
   * restore): build the shard's DayCycle exactly as its page sky does (its spec, cycle, scale) and hand it here. It then
   * advances one fixed step at the start of every tick, before the step callbacks, so a runtime reads `dayPhase`,
   * `night`, `dusk`, `hour` and hears `onDusk` / `onNight` / `onPhase` as the page's systems do. The level's `day.start`
   * (if any) moves it there first, silently. It rides the strict snapshot as `day` with exact restore; a host without a
   * clock keeps its exact bytes. Returns the clock.
   */
  useDayClock<C extends SimDayClock>(clock: C): C {
    if (this.disposed || this.embedded || this.day !== undefined) throw new Error('A day clock belongs to an owned host, once');
    const start = this.level.day?.start;
    if (start !== undefined) {
      if (!Number.isFinite(start)) throw new RangeError('Invalid simulation day start');
      const value = wrapClock(start, clockPeriod(clock.spec));
      clock.restore({ ...clock.snapshot(), value, last: clockDayPhase(clock.spec, value) });
    }
    this.day = clock;
    publishDay(this, clock);
    actRoutes(this).time = pick => { if (this.players.size === 1) clock.pickTime(pick); }; // a room shares one day
    actRoutes(this).day = phase => { if (this.players.size === 1 && !clock.paused) clock.phase = phase; };
    return clock;
  }
  /** The installed day clock, if any (its query surface: hour, phase, dayPhase, night, dusk, onDusk…). */
  get dayClock(): DayCycleClock | undefined { return this.day; }
  /** The day clock as plain values (SimSnapshot.day); undefined without a clock. */
  dayClockState(): DayClockState | undefined { return this.day?.snapshot(); }
  /** Exact day clock restore: saved state is refused unless this host has a clock, and the reverse. */
  restoreDayClock(saved: DayClockState | undefined): void {
    if ((saved === undefined) !== (this.day === undefined)) throw new RangeError('Snapshot day clock does not match');
    if (saved !== undefined) this.day?.restore(saved);
  }
  /** Reinstall the admitted terrain height query before a fresh host's same-engine continuation resumes. */
  setHeightQuery(heightAt: (x: number, z: number) => number): void { this.heightAt = heightAt; }
  /** Opt into layered native ground queries, including flight, after admitted colliders install or reconnect.
   * The default keeps the existing analytic height reader; a missing native floor stays undefined over a void.
   */
  setFloorQuery(query: (x: number, z: number, fromY: number, maxDrop: number) => number | undefined): void { this.floorQuery = query; }
  /** Read admitted frame-local terrain without decoding a second copy for the page traveller. */
  groundHeightAt(x: number, z: number): number {
    if (!Number.isFinite(x) || !Number.isFinite(z)) throw new RangeError('Invalid regional ground query');
    return this.heightAt(x, z);
  }
  /** One active region's systems/local clock after the page move; no physics, player, health or page event phase advances. */
  stepExternal(): void {
    if (this.disposed || this.embedded) throw new Error('External regional player is not bound');
    this.lead.followExternal();
    this.events.beginFrame(); this.clock.tick(FIXED_STEP);
    this.stepSystems(); this.events.flush('fixed.post');
  }
  /** Preflight a fixed-step registration without installing a callback or consuming any simulation state. */
  hasStep(id: string): boolean { return this.callbacks.has(id) || this.afterCallbacks.has(id); }
  /** Scoped fixed-step work before bodies by default; afterBodies matches equipment following creature contact.
   * Removing a registration releases its future snapshot adapter. Registration order remains snapshot order. */
  onStep(id: string, run: (dt: number, host: SimHost) => void, adapter?: SimStateAdapter, phase: 'beforeBodies' | 'afterBodies' = 'beforeBodies'): () => void {
    if (this.disposed || this.hasStep(id) || this.adapters.has(id)) throw new Error(`Invalid simulation registration ${id}`);
    const callbacks = phase === 'afterBodies' ? this.afterCallbacks : this.callbacks;
    callbacks.set(id, run); if (adapter !== undefined) this.adapters.set(id, adapter);
    let registered = true;
    let forget: () => void = () => undefined;
    const remove = (): void => {
      if (!registered) return;
      registered = false; forget(); // an early remove drops the host scope's hold on `run`
      callbacks.delete(id); this.adapters.delete(id);
    };
    forget = this.scope.capture('disposers', remove); return remove;
  }
  /**
   * SF34: give the owned player the level's water (SimWater), once, before the first step; the installer runs it again
   * on a restoring host, before restore. From then the client Player's water law (player/swim.ts) holds headless: on foot
   * the feet wade (the walk slows by the wade, the jump saps, a landing in water is soft, a dash stops at deep water),
   * past SWIM_IN they swim (the command's dive / surface held), and the board rides the surface. A host without water
   * keeps its exact bytes.
   */
  useWater(water: SimWater): void {
    if (this.disposed || this.embedded || !this.ownsPlayer || this.water !== undefined) throw new Error('Water belongs to an owned host, once');
    this.water = water;
  }
  /** The installed water's real surface, shared by native projectile readers. */
  waterSurfaceAt(x:number,z:number):number|null{return this.water?.surfaceAt(x,z)??null;}
  /** Whether the host has water (useWater). */
  get hasWater(): boolean { return this.water !== undefined; }
  /** Register board-only colliders (Sky Reach's hover decks and updraft, `Piece.active` = the player is on the board):
   * enabled only while a player rides, synced every step before physics. Their handles are snapshot state. */
  boardColliders(colliders: readonly { readonly handle: number }[]): void {
    if (this.disposed || this.embedded) throw new Error('Board-only colliders belong to an owned host');
    for (const collider of colliders) {
      if (this.boardHandles.includes(collider.handle) || !this.physics.world.colliders.contains(collider.handle)) throw new Error('Invalid board-only collider');
      this.boardHandles.push(collider.handle);
    }
    this.syncBoardColliders();
  }
  /** The registered board-only collider handles, in registration order (SimSnapshot.boardColliders). */
  boardColliderHandles(): readonly number[] { return [...this.boardHandles]; }
  /** Exact restore: the saved handles, each present in the restored world, then synced to the restored board. */
  restoreBoardColliders(handles: readonly number[]): void {
    if (new Set(handles).size !== handles.length || handles.some((handle) => !this.physics.world.colliders.contains(handle))) throw new RangeError('Snapshot board collider does not exist');
    this.boardHandles = [...handles]; this.syncBoardColliders();
  }
  private syncBoardColliders(): void {
    let on = false; // the page's Piece.mode rule (SF34): they stand for whoever rides
    for (const player of this.players.values()) if (modeCollides('board', player.modes.current())) on = true;
    for (const handle of this.boardHandles) { const collider = this.physics.world.getCollider(handle); if (collider.isEnabled() !== on) collider.setEnabled(on); }
  }
  /** Ask whether a traversal owns `player`'s motion this tick. */
  askTraversal(player: PlayerSim): unknown {
    this.traversing = player;
    try { return this.events.ask('player.traversal', FIXED_STEP); }
    finally { this.traversing = null; }
  }
  /** One simulation tick, with at most one command per player. No wall clock, renderer, active app or device input is
   *  consulted. Every player's input lands, then the world steps, then every player moves, in join order. */
  step(commands?: ReadonlyMap<string, SimTickCommand>): void {
    if (this.disposed) throw new Error('Simulation host is disposed');
    if (this.embedded) throw new Error('Borrowed simulation uses the existing fixed-step driver');
    const { players, parked } = this, present = parked.size === 0 ? players : new Map([...players].filter(([id]) => !parked.has(id)));
    for (const player of present.values()) if (!player.hasMotor) throw new Error('Frozen simulation cannot step');
    if (commands !== undefined) for (const id of commands.keys()) if (!players.has(id)) throw new RangeError(`Unknown simulation player ${id}`);
    this.tickCommands = commands;
    const { commanded } = this;
    this.commanded = null;
    for (const player of present.values()) player.take(commands?.get(player.id), commanded?.still.has(player.id) === true);
    this.events.beginFrame(); this.clock.tick(FIXED_STEP);
    for (const player of present.values()) player.input();
    if (this.boardHandles.length > 0) this.syncBoardColliders();
    this.physics.step();
    for (const player of present.values()) player.move();
    if (commanded !== null) for (const [id, command] of commanded.extra) present.get(id)?.catchUp(command);
    this.stepSystems();
    for (const player of present.values()) player.health.update(FIXED_STEP);
    this.events.flush('fixed.post');
  }
  /** Called once by the client's fixed.post slot; it never advances physics, clock, player or event phases. */
  stepEmbedded(): void {
    if (this.disposed || !this.embedded) throw new Error('Invalid borrowed simulation step');
    this.stepSystems();
  }
  private stepSystems(): void {
    this.state.tick++;
    const bands = this.bands;
    if (bands !== undefined) { bands.clocks.beginTick(FIXED_STEP); if (bands.physics) this.syncBodies(); }
    this.day?.update(FIXED_STEP);
    const timers = this.state.timers; // for-in: a tick makes no key array
    for (const key in timers) if (Object.hasOwn(timers, key)) timers[key] = Math.max(0, (timers[key] ?? 0) - FIXED_STEP);
    this.callbacks.forEach(this.visitStepCallback);
    this.strikes.forEach(this.visitStrike);
    const previousBands = this.visitingBodyBands, previousHooks = this.visitingBodyHooks;
    this.visitingBodyBands = bands !== undefined; this.visitingBodyHooks = this.bodyStep;
    try { this.entities.forEach(this.visitBody); }
    finally { this.visitingBodyBands = previousBands; this.visitingBodyHooks = previousHooks; }
    this.afterCallbacks.forEach(this.visitStepCallback);
  }
  private readonly visitStepCallback = (run: (dt: number, host: SimHost) => void): void => { run(FIXED_STEP, this); };
  private readonly visitStrike = (runner: StrikeRunner, id: string): void => { this.updateStrike(id, runner); };
  private readonly visitBody = (entity: AnimalSim, id: string): void => {
    if (entity.harnessHold) return;
    this.focusOn(entity.position);
    const dt = this.visitingBodyBands ? this.bodyDt(id) : FIXED_STEP, hooks = this.visitingBodyHooks;
    if (dt <= 0) return;
    hooks?.before?.(id, entity, dt);
    entity.step(dt);
    hooks?.after?.(id, entity, dt);
  };
  /** Accumulate elapsed simulation seconds; a caller can submit exactly the same command tape after restoration. */
  advance(seconds: number, commands?: ReadonlyMap<string, SimTickCommand>): number {
    if (this.disposed) throw new Error('Simulation host is disposed');
    if (this.embedded) throw new Error('Borrowed simulation uses the existing fixed-step driver');
    if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('Invalid simulation delta');
    if (commands !== undefined) for (const input of commands.values()) {
      const command = simCommandOf(input);
      if (![command.moveX, command.moveZ, command.yaw].every(Number.isFinite)) throw new RangeError('Invalid simulation command');
      validateLocalMovement(command);
      if (command.hover !== undefined || command.jump !== undefined || command.dodge !== undefined) throw new RangeError('A HOVER, JUMP or DODGE press is one tick\'s input; advance repeats its command');
    }
    this.state.accumulator += seconds; let ticks = 0;
    while (this.state.accumulator + Number.EPSILON >= FIXED_STEP) { this.state.accumulator -= FIXED_STEP; this.step(commands); ticks++; }
    return ticks;
  }
  /** Start an authored strike; active/recovery/cooldown timing remains in StrikeRunner. */
  startStrike(sourceId: string, targetId: string): boolean {
    const started = this.beginStrike(sourceId, targetId, this.weapons.get(sourceId)), input = this.tickCommands?.get(sourceId);
    if (started && input !== undefined && 'seq' in input) this.strikeSeqs.set(sourceId, input.seq);
    if (started) this.players.get(sourceId)?.swung(0, false); // RP6: others see a player's strike start
    return started;
  }
  private beginStrike(sourceId: string, targetId: string, spec: StrikeSpec | undefined): boolean {
    const runner = this.strikes.get(sourceId), source = this.entities.get(sourceId), target = this.entities.get(targetId);
    const sourcePlayer = this.players.get(sourceId), position = sourcePlayer?.position ?? source?.position;
    const targetPosition = this.players.get(targetId)?.position ?? target?.position;
    if (runner === undefined || spec === undefined || runner.busy || position === undefined || targetPosition === undefined) return false;
    const actor = source ?? sourcePlayer?.actor();
    if (actor?.alive !== true) return false;
    runner.start(spec, actor, targetPosition); this.targetIds.set(sourceId, targetId); return true;
  }
  private updateStrike(id: string, runner: StrikeRunner): void {
    const targetId = this.targetIds.get(id), source = this.entities.get(id), target = targetId === undefined ? undefined : this.entities.get(targetId);
    const victim = targetId === undefined ? undefined : this.players.get(targetId), striker = this.players.get(id);
    const health = victim?.health ?? target?.combatActor(), position = victim?.position ?? target?.position;
    const actor = source ?? striker?.actor();
    if (health === undefined || position === undefined || actor === undefined) return;
    runner.update(FIXED_STEP, { actor, target: position, canReach: () => source === undefined ? true : canReach(source, position, this.physics), hit: (spec) => {
      this.direction.subVectors(position, actor.position).normalize();
      this.hitOrigin.copy(actor.position); this.hitOrigin.y += source === undefined ? 1.2 : source.dims.bodyY * source.scale;
      this.hitPoint.copy(position); this.hitPoint.y += target === undefined ? 1.2 : target.dims.bodyY * target.scale;
      this.combat.hit({ source: source?.combatActor() ?? striker?.health ?? 'env', sourceTags: spec.tags, target: health,
        amount: spec.damage, point: this.hitPoint, dir: this.direction, from: this.hitOrigin, moveId: spec.id, attackSeq: this.strikeSeqs.get(id) ?? 0 });
    } });
  }
  /** Timed attack targets are host state; snapshot restoration must reconnect them before replay. */
  attackTargets(): readonly [string, string][] { return [...this.targetIds]; }
  restoreAttackTargets(entries: readonly (readonly [string, string])[]): void { this.targetIds.clear(); for (const [id, target] of entries) this.targetIds.set(id, target); }
  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    this.scope.dispose();
  }
  /** The same teardown as steps (`Scope.disposeSteps`): a retiring region spreads it over frames; drain to the end. */
  *disposeSteps(): Generator<DisposeStep, void> {
    if (this.disposed) return; this.disposed = true;
    yield* this.scope.disposeSteps();
  }
}
/** Embed a level with an initialized Rapier module. Its own scope owns teardown, independently of the caller's ambient page callback. */
export function createSimHost(level: SimLevel, ports: SimHostPorts): SimHost { return withOwner(null, () => new SimHost(level, ports)); }
