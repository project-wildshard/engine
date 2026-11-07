import { clearBody as clearNativeBody } from './bodyClear';
import { poseEvery } from '../../../shared/engine/entities/poseCadence';
import { EntityIds } from '../../../shared/engine/entities/ids';
import { emitFault } from '../../../shared/engine/core/faults';
import { MathUtils, Vector3, type PerspectiveCamera } from 'three';
import type { SpeciesFlight } from '../../../shared/engine/ai/flight';
import { canReach } from '../../../shared/engine/ai/reach';
import { brainPinned } from '../../../shared/engine/ai/pinning';
import { TickScheduler, type InterruptReason, type TickRate } from '../../../shared/engine/app/scheduler';
import { dodgeFx } from '../../../shared/engine/player/dodge';
import { CreatureBodies } from '../../../shared/engine/physics/creatures';
import type { EventMap } from '../../../client/engine/events/maps';
import type { CharacterMotor } from '../../../shared/engine/physics/CharacterMotor';
import { SEED, CHUNK_HALF } from '../../../shared/engine/core/config';
import { spawnRolls, fallbackSound, ATTACK_TURN, HURT_ARC, type HuntGround, type HuntHerd } from '../ai/hunt';
import { StalkerBrain } from '../../../shared/engine/ai/stalker';
import { Rng } from '../../../shared/engine/core/rng';
import { heightAt, normalAt, trailDistance, cabinMask, inChunk, waterLevel, hasPond, POND, streamAt } from '../../../shared/engine/world/Heightfield';
import type { Forest } from '../../../client/engine/world/forest/Forest';
import { speciesDef, type EnemyWorld, type ThinkCtx } from '../../../shared/engine/entities/species/registry';
import type { AnimalFactory, AnimalKind } from '../../../client/engine/entities/AnimalFactory';
import type { Animal } from '../../../client/engine/entities/AnimalView';
import { damageFor } from '../../../shared/engine/entities/AnimalSim';
import { creatureFloor } from '../../../shared/engine/entities/creatureFloor';
import { CreatureRefill } from './creatureRefill';
import { killBelowWorld } from './killHeight';
import { activeLevel } from '../../../shared/engine/level/selection';
import type { App } from '../../../client/engine/app/app';
import type { Physics } from '../../../shared/engine/physics/Physics';
import type { LevelFrameBinding } from '../../../client/engine/level/frame';
import { frameCost } from '../../../shared/engine/core/frameCost';
import { practiceRoomState } from '../../../shared/engine/core/practiceRoomState';
import type { AnimalGroup } from '../../../client/engine/entities/animalMatrices';

export interface WanderGoalQuery { herd: number; goal: { x: number; z: number; r: number } | null }
declare module '../../../client/engine/events/maps' {
  interface AskMap { 'creature.wander-goal': readonly [WanderGoalQuery, WanderGoalQuery] }
}

/**
 * AnimalManager (the sim half, P1-E4.3; AnimalHerdView.ts draws) — spawns the chunk's huntable wildlife (the active ShardManifest's `fauna` herd plans),
 * runs their AI at 10 Hz (idle / graze / wander / alert / flee / charge / stalk / dead), animates
 * them every frame, and exposes the combat + audio hooks.
 *
 *   const animals = new AnimalManager(new AnimalHerdView(scene, sky), app, forest).build();
 *   game.onUpdate((dt, t) => animals.update(dt, t, player.position, player.sprinting));
 *
 *   animals.raycast(origin, dir, maxDist) → { animal, point, distance, headshot, damage } | null  (result object is reused;
 *                                          `damage` = DAMAGE model (Animal.ts) for that hit: body 32–40 with distance falloff past 40 m, head ×2.5)
 *   animal.applyDamage(amount, hitPoint, dir) → true if it died   (deer 60 hp, boar 100 hp; variants override — Old Ironhide 300)
 *   animals.hit(hit, dir)  — convenience: applyDamage(hit.damage)
 *   animals.disturb(point, strength) — a bolt landed / something loud happened here: animals within
 *                                      impactSpook m bolt, within impactAlert m go alert (Combat calls it on misses)
 *   animals.nearRay(origin, dir, maxDist, tol) → the animal whose head/body passes within `tol` m of the ray (aim assist / "was I aiming at it")
 *   Blood burst + ground decal, sounds, AI reaction and onKill all fire from applyDamage.
 *   animal.fadeOut()  — dissolve a harvested carcass over 1.5 s (animal.hidden afterwards)
 *
 * The hunting loop (DEER_TUNING / BOAR_TUNING below): every animal carries an `awareness` meter 0..1. It rises while the
 * player is inside the SIGHT cone (body heading ± sightCone, out to sightRange — far less while grazing head-down) or
 * inside the HEARING radius (any direction; grows with the player's speed: still < crouch < walk < sprint), and decays
 * otherwise. At `alertAt` the head comes up and the animal FREEZES staring at you for freezeMin..freezeMax s — that is
 * the shot window — then bolts if it still senses you (`boltAt`), or relaxes back to grazing after `relaxAfter` s. It
 * flees at `runSpeed` (faster than a sprinting player) but only until `fleeUntil..fleeUntilMax` m away, then stops, looks
 * back, and grazes again — "wary" (sharper senses) for `waryTime` s. A hit that does not kill bolts it at once. One
 * spooked animal alerts its herd within `herdAlertRadius` m. Boars charge when hit or when the player is within
 * `chargeDist` m. HUNTERS (a species whose HuntTuning has `stalk` — the bear) never bolt: the alert freeze
 * ends in a STALK (walking the player down, huffing) that becomes a charge inside panicDist, and a charge that
 * lands or times out drops back into the stalk after `stalk.rechargeCd` s until the player is `stalk.giveUp` m away.
 *
 *   animals.onKill   = (animal) => …
 *   animals.onCharge = (animal, damage) => …          a boar reached the player
 *   animals.onSound  = (name, position) => …          'deer_call' | 'boar_grunt' | 'hoofsteps' | 'boar_squeal'
 *   animals.onWindup = (animal) => …                  melee shards: an attack's wind-up began (the charge telegraph, a crab's
 *                                                     claw raise, the sailor's cutlass) — play its cue (the level's wind-up voice)
 *   animals.animals: Animal[]   animals.alive (count)
 *
 * Species + variants: every kind comes from the species registry (`src/engine/entities/species/<kind>.ts`, see
 * AnimalFactory.ts). Each spawn rolls a VariantDef by weight with the seeded rng — its `scale`, `hp` and `mods`
 * (speed / chargeDist / damageTaken / chargeDamage / relentless) are applied HERE on top of the species'
 * HuntTuning (DEER_TUNING / BOAR_TUNING below stay the untouched baseline; a species may ship its own
 * `tuning`). A 'legendary' variant is capped at ONE alive per kind (the roll falls back to the rare tier).
 * HerdPlan.variants restricts a herd's pool to those ids.
 *
   * Dev helpers: animals.spawn(kind, x, z, yaw, variant?, placement?) adds a single animal (no herd AI target) — `variant`
 * is a variant id ('ironhide') or an id list to roll from; omitted = the species' full weighted table.
 * animals.debug = true draws the hit capsules, animals.calm = true stops them reacting to the player.
 *
 * Species that THINK FOR THEMSELVES (`SpeciesDef.think` — Driftwood Isle's Reef Crab / Coconut Monkey / Drowned Sailor,
 * src/shards/driftwood-isle/creatures/Enemies.ts spawns them): the manager still owns spawning, per-frame animation, hit tests, blood, sounds,
 * onKill and the corpse, but their 10 Hz tick goes to the species' `think(animal, ThinkCtx)` instead of the senses /
 * flee / charge loop above, and a hit does not push them into flee / charge. Their damage to the player arrives through
 * the same `onCharge(animal, damage)`. `animals.enemyWorld` (EnemyWorld) is what the shard hands those AIs: palm
 * perches, the coconut thrower, the wreck's hold — Enemies.ts fills it; a missing piece degrades to ground behaviour.
 * `animals.addHerd(kind, cx, cz)` makes a herd for such a spawner (`spawn()` then `animal.herd = index`).
 *
 * MELEE SHARDS (`meleeShard(ShardManifest)`: 'sword' / 'nalati', Driftwood C5 — Pine Hollow's crossbow hunting is untouched): every attack
 * is telegraphed and lands on an arc, so strafing is the dodge.
 *   • A charge starts with a WIND-UP (CHARGE_WINDUP: boar 0.55 s, bear 0.65 s): the animal stops, turns to you, drops its
 *     head and paws the ground (Animal.poseWindup) with the roar / grunt as the cue, then runs. A sword blow during the
 *     wind-up interrupts it (Animal.stagger cancels the attack → `staggered` sends it back to alert / stalk).
 *   • A running charge connects per frame, not at 10 Hz, and only if you are inside CHARGE_ARC of its heading when it
 *     reaches you; inside the last CHARGE_COMMIT m it can barely turn — sidestep late and it thunders past.
 *   • The self-thinking species' strikes (crab snap, monkey bite, cutlass) only hurt inside HURT_ARC of the attacker's
 *     facing, and while an attack runs the animal turns at most ATTACK_TURN rad/s (Animal.attackTurnCap): a wind-up
 *     commits to a direction you can step out of.
 *   • No hit through solid geometry (E296 — the wreck's hold, where the sailor cut you from behind the mast and beams):
 *     a strike or a charge only lands when `canReach` — the physics `lineOfSight` from your chest to the attacker's finds
 *     nothing (a hull wall, a beam, a deck, a rock) short of the attacker's own body. Asked only on the frame a hit would
 *     land; `ThinkCtx.reach` lets a species skip a swing it could not land (the sailor does).
 *
 * FIGHT RULES (E297, `ShardManifest.fight.attackers` — Driftwood only; src/shared/engine/entities/fightRules.ts): one set of rules for every enemy.
 *   • At most `maxAttackers` (2) attack at once: a charge (wind-up + run) or a species' strike needs an attack token
 *     (`tokens`; `ThinkCtx.claim` / `mayAttack`); the rest hold back on a ring and wait. A token goes back when the
 *     charge ends / the strike's attackPhase drops below 0 (swept every think tick), or at once on leaving 'charge'.
 *   • Boars fight like the bears: a boar gets a synthesized `stalk` (RULES_STALK) — it does not bolt when it notices you,
 *     it comes for you. After a charge (landed, missed, timed out or broken by a blow) a charger BACKS OFF past the ring
 *     (`backoffPoint`, ≤ BACKOFF_MAX_T s), then circles on it (RING: boar 6.5 m, bear 7.5 m) facing you until its
 *     cooldown (RULES_CD_HIT 3.4 s / RULES_CD_MISS 2.0 s) and a token let it turn, wind up and charge again (`reengage`).
 *     Only a nearly dead (< 25 %), non-relentless one may break off after a hit (50 %).
 *   • A big animal's body never swallows the camera (`clearBody`, per frame): a boar / bear / deer body closer to the
 *     player than its radius + the player's capsule + a margin is moved back out, through its physics motor.
 *   • `isThreat(a)` says an attack is coming (a charge's wind-up or run, a strike's wind-up) — src/client/engine/ui/WindupWarn.ts draws
 *     the off-screen warning from it.
 */

/** What the herd sim reads of the running app, live at each call: a region's frame swaps these under it. */
export type AnimalHost = Pick<App, 'aggression' | 'clock' | 'combat' | 'equipmentHost' | 'events' | 'levelScope' | 'navmesh' | 'physics' | 'rng' | 'scheduler' | 'world'>;

/**
 * The herd's presentation (AnimalHerdView.ts on the page). The sim half decides who exists, who thinks and what a hit
 * does; everything about a rig, a batch, a shadow or a drop of blood goes through here, and nothing here feeds back
 * into a decision. `rig` is the one place an actor is made, so the sim half never names a model.
 */
export interface AnimalDraw {
  readonly group: AnimalGroup;
  readonly factory: AnimalFactory;
  shadowBatch: boolean | null;
  debug: boolean;
  /** this tier's tick overrides of `level`, or of the running render level */
  tierTicks: (level?: LevelFrameBinding['terrain']['level']) => Readonly<Record<string, TickRate>> | undefined;
  start: () => void;
  finish: () => void;
  park: () => void;
  show: () => void;
  inFrame: <T>(frame: LevelFrameBinding, run: () => T) => T;
  rig: (kind: AnimalKind, variant: string, rigSeed: number, seed: number, scale: number, id: string) => { actor: Animal; flight: SpeciesFlight | undefined };
  adopt: (a: Animal, player: Vector3, asleep: (a: Animal) => boolean) => void;
  hide: (a: Animal) => void;
  remove: (a: Animal) => void;
  trample: (animals: readonly Animal[], player: Vector3) => void;
  beginDraw: (camera: PerspectiveCamera | null) => void;
  reach: (a: Animal, from: Vector3, asleep: (a: Animal) => boolean) => void;
  sleep: (a: Animal) => void;
  draw: (a: Animal, index: number, distanceSquared: number) => void;
  endDraw: (animals: readonly Animal[], count: number, dt: number) => void;
  bloodBurst: (at: Vector3, dir: Vector3, strength: number) => void;
}

export interface AnimalHit { animal: Animal; point: Vector3; distance: number; headshot: boolean; damage: number }
/** a species' own sound id (SpeciesDef.sounds); the engine names none (E405) */
type AnimalSound = string;

type Herd = HuntHerd<Animal>;

/** the far LOD distance of the per-frame animation (m) */
const ANIM_LOD = 140;
/** E297 body clearance: the player's capsule radius (Player.ts RADIUS) + a margin for the camera's near plane (m) */

const _a = new Vector3(), _b = new Vector3(), _c = new Vector3(), _d = new Vector3(), _p = new Vector3();

/** What `clearBody` needs of an animal (Animal implements it). */
export interface BodyClearable {
  readonly position: Vector3;
  readonly yaw: number;
  readonly scale: number;
  readonly dims: { readonly bodyRadius: number; readonly headRadius: number };
  /** its physics body: src/shared/engine/physics/creatures.ts hands every live, shown, un-ridden animal within 45 m one */
  readonly motor: CharacterMotor | null;
  readonly mesh: { readonly position: Vector3 };
  bodyCapsule: (a: Vector3, b: Vector3) => void;
  headWorld: (out: Vector3) => Vector3;
}

/** Shared renderer-free law; the page mesh follows the same native displacement. */
export function clearBody(a: BodyClearable, player: Vector3): boolean { return clearNativeBody(a, player); }

export class AnimalManager {
  private readonly reportedDecisions = new WeakSet<Animal>();
  /** the page's scene graph of the herd (AnimalHerdView.ts) */
  get group(): AnimalGroup { return this.draw.group; }
  animals: Animal[] = [];
  private readonly entityIds = new EntityIds('creature');
  private readonly spawnedActors = new WeakSet<Animal>();
  private readonly retiredActors = new WeakSet<Animal>();
  /** the herds (the hunting brain's: placement and external spawners add to it) */
  get herds(): Herd[] { return this.hunt.herds; }
  get factory(): AnimalFactory { return this.draw.factory; }
  onKill?: (animal: Animal) => void;
  onCharge?: (animal: Animal, damage: number) => void;
  onSound?: (name: AnimalSound, position: Vector3) => void;
  /** melee shards: an attack's wind-up began (see the header) */
  onWindup?: ((animal: Animal, dur: number) => void) | undefined;
  /** every non-lethal AND lethal hit: amount actually dealt, world hit point, whether it was the head (Combat draws the numbers) */
  onDamage?: (animal: Animal, amount: number, hitPoint: Vector3, headshot: boolean, died: boolean) => void;
  get debug(): boolean { return this.draw.debug; }
  set debug(on: boolean) { this.draw.debug = on; }
  /** dev: animals ignore the player (no alert / flee) */
  calm = false;
  /** Everyone in the room, when the herd serves more than the page's own player (J109). Null: that one player. */
  roomPlayers: (() => readonly { readonly position: Vector3 }[]) | null = null;
  /** J109, J108: herds that lost a body fill again, in a room of two or more; one player's herds stay as they fell */
  private readonly refill: CreatureRefill;
  /** the shard's creature budget: what its own herds placed at build (no author writes one) */
  private budget = 0;
  /** the player is not among them: `calm`, or a practice room is up (the arena, a playground — 1–3 km over the shard at the
   *  same x / z: no pack hunts, no horse bolts, no boar charges from under it; E321) */
  private get unaware(): boolean { return this.calm || practiceRoomState.open; }
  /** the shard's pieces for the self-thinking enemy species (see the header; Enemies.ts fills it) */
  enemyWorld: EnemyWorld = {};
  get habitat(): EnemyWorld { return this.enemyWorld; }
  set habitat(value: EnemyWorld) { this.enemyWorld = value; }
  /** a place a herd animal's wander walks to instead of a random point (within r m of it), or null for the usual wander —
   *  Pine Hollow's rain sends the grazers in under the big trees (src/shards/pine-hollow/world/weather.ts, PH-C7) */
  wanderGoal: ((a: Animal) => { x: number; z: number; r: number } | null) | null = null;
  private rng = new Rng(SEED + 31);
  readonly scheduler: TickScheduler;
  private readonly visibility = new WeakMap<Animal, boolean>();
  /** Tile streaming T6: from the viewer, which animals stay awake (a resident ring); null: every animal */
  private residency: ((viewer: Vector3) => (x: number, z: number) => boolean) | null = null;
  private resident: ((x: number, z: number) => boolean) | null = null;
  private dodgeId = dodgeFx.id;
  private playerSprinting = false;
  private playerPos = new Vector3();
  private playerPrev = new Vector3(); private playerSpeed = 0; private playerInit = false;
  /** the stalker hunt pattern (src/shared/engine/ai/stalker.ts, SF72/82): every herd animal's decisions, its memory, the herds and the tokens */
  private readonly hunt: StalkerBrain<Animal>;
  /** a melee shard (the sword): telegraphed charges, attacks on an arc (see the header) — Driftwood's swords, Nalati's sabre / spear */
  private get melee(): boolean { return this.hunt.melee; }
  /** E297: the shard's fight rules (Driftwood), null = the old fights (see the header) */
  private get rules(): ReturnType<typeof activeLevel>['fight'] | null { return this.hunt.rules; }
  /** E297: the attack tokens — at most `rules.maxAttackers` attacking at once */
  get tokens(): StalkerBrain<Animal>['tokens'] { return this.hunt.tokens; }
  /** a token holder still attacking: a charger while it charges, a self-thinking species while its strike runs */
  private readonly stillAttacking = (a: Animal): boolean =>
    a.alive && !a.hidden && (speciesDef(a.kind).think !== undefined ? a.attackPhase >= 0 : a.state === 'charge');
  /** E297: an attack is coming from `a` — a charge's wind-up or run, a strike before it lands (WindupWarn reads it) */
  readonly isThreat = (a: Animal): boolean =>
    a.alive && !a.hidden && !a.stunned && (speciesDef(a.kind).think !== undefined ? a.attackPhase >= 0 && a.attackPhase < 1 : a.state === 'charge');
  /** A level's override of the tier's shadow batching (AnimalHerdView.ts). */
  get shadowBatch(): boolean | null { return this.draw.shadowBatch; }
  set shadowBatch(batch: boolean | null) { this.draw.shadowBatch = batch; }

  private readonly draw: AnimalDraw;
  private readonly host: AnimalHost;
  private readonly forest: Forest;
  /** Regional construction retains its own physics; omitted preserves the active-page legacy path. */
  private readonly physics: Physics | undefined;
  constructor(draw: AnimalDraw, host: AnimalHost, forest: Forest, physics?: Physics) {
    this.draw = draw;
    this.host = host;
    this.forest = forest;
    this.physics = physics;
    this.scheduler = new TickScheduler(host.scheduler);
    const onePlayer = [{ position: this.playerPos }];
    this.refill = new CreatureRefill({ players: () => this.roomPlayers?.() ?? onePlayer, room: () => this.budget - this.alive,
      random: () => host.rng.stream('spawn').next(), spawn: ({ kind, variant, herd, x, z }, yaw) => {
        const a = this.spawn(kind, x, z, yaw, variant);
        a.herd = herd;
        this.herds[herd]?.members.push(a);
      } });
    // the hunting brain's world: the live Heightfield (its exports are live bindings: read at call time), the forest, the app
    const ground: HuntGround = {
      heightAt: (x, z) => heightAt(x, z), normalY: (x, z) => normalAt(x, z)[1], trailDistance: (x, z) => trailDistance(x, z),
      cabinMask: (x, z) => cabinMask(x, z), inChunk: (x, z, margin) => inChunk(x, z, margin), streamAt: (x, z) => streamAt(x, z),
      waterLevel: () => waterLevel(), pond: () => hasPond() ? POND : null, sea: () => host.world.water.sea !== null,
      wetAt: (x, z) => this.wetAt?.(x, z) === true, trees: (x, z, r) => this.forest.nearby(x, z, r),
      treeless: () => this.forest.trees.length === 0, // Driftwood Isle: palms are not Forest trees
      terrain: () => activeLevel().ground.terrain !== undefined, chunkHalf: CHUNK_HALF,
    };
    this.hunt = new StalkerBrain<Animal>({ pattern: 'hunt', config: { rng: this.rng, fight: activeLevel().fight, faunaTuning: () => activeLevel().faunaTuning }, ports: {
      ground, nav: () => host.navmesh, reach: (a, player) => this.canReach(a, player),
      wanderGoal: (a) => host.events.ask('creature.wander-goal', { herd: a.herd, goal: this.wanderGoal?.(a) ?? null }).goal,
      unaware: () => this.unaware, now: () => performance.now(),
      sound: (name, a) => { this.onSound?.(name, a.position); }, charge: (a, damage) => { this.onCharge?.(a, damage); },
    }, player: this.playerPos, sampleTerrain: actor => { actor.sampleTerrain(); } });
    // Legacy authored species keep their brain/strike callback until S3.4 / S4.2 migrates it.
    this.configureTicks(draw.tierTicks());
    const scope = host.levelScope;
    if (scope) {
      host.combat.registerTargets(scope, () => host.levelScope !== scope ? [] : this.animals.map((animal) =>
        host.combat.targetPort(animal.combatActor(), animal, (velocity) => { animal.impulse(velocity); },
          () => !scope.disposed && host.levelScope === scope && !animal.hidden && animal !== host.equipmentHost?.player.mountedOn)));
      host.events.on('weapon.fired', () => { if (host.levelScope === scope) this.interruptTargets('target.attack'); }, scope);
      host.events.on('creature.tamed', tamed => { if (host.levelScope === scope) this.tamed(tamed); }, scope);
      scope.onDispose(() => { this.scheduler.reset(); });
    }
  }

  private configureTicks(overrides: Readonly<Record<string, TickRate>> | undefined): void {
    this.scheduler.configure(overrides);
    this.scheduler.rate('legacy', { bands: [{ upTo: Infinity, brainHz: 10, body: 'frame' }] });
  }

  get alive(): number { let n = 0; for (const a of this.animals) if (a.alive) n++; return n; }

  build(): this {
    this.draw.start();
    for (const _herd of this.spawnHerds()) { /* all herds in one go */ }
    return this.finish();
  }

  /**
   * `build()` with the event loop let in between herds (`pause`, e.g. a macrotask): the same herds, the
   * same rolls — each herd's first animal of a species builds its model (lofted body + fur), and all of
   * them in one call was a 250–650 ms main-thread task of the boot's `animals` step at 4x CPU.
   * Regional shells pass their retained frame: construction and every resumed herd slice use its
   * services/owner; the frame is restored while awaiting models or yielding between herds.
   */
  async buildAsync(pause: () => Promise<void>, frame?: LevelFrameBinding): Promise<this> {
    const draw = this.draw;
    if (frame === undefined) draw.start();
    else draw.inFrame(frame, () => { draw.start(); this.configureTicks(draw.tierTicks(frame.terrain.level)); });
    await draw.factory.ready;   // Pine Hollow's generated hulls (pineCreatures.ts) before the first herd: a model is made once
    if (frame === undefined) {
      for (const _herd of this.spawnHerds()) await pause();
      await draw.factory.settled();   // the herds' coats, painted in slices (SpeciesLook.settle), before any animal is shown
      return this.finish();
    }
    // Each resumed herd reads its retained level/terrain/services, never the intervening page frame.
    // Keep the ambient binding synchronous: another region may enter while pause() is pending.
    // The hidden group joins its region first, so the region's draw watch takes each herd as it spawns, between the
    // pauses, instead of the whole population in one task when it finishes (Pine's ~180 ms afterKit task at 4x CPU).
    draw.inFrame(frame, () => { draw.park(); });
    const herds = this.spawnHerds();
    while (!draw.inFrame(frame, () => herds.next()).done) await pause();
    await draw.inFrame(frame, () => draw.factory.settled());
    return draw.inFrame(frame, () => { this.finish(); draw.show(); return this; });
  }

  private finish(): this {
    this.draw.finish();
    this.budget = this.animals.length;
    return this;
  }

  // ── spawning ───────────────────────────────────────────────────────────────────────────

  /** a shard's own water the flat `waterLevel()` cannot see (Nalati: the river's gravel corridor, the plateau brook —
   *  src/shards/nalati-grasslands/wet.ts); null = the water line alone */
  wetAt: ((x: number, z: number) => boolean) | null = null;

  /** A page on a server: its creatures are rows, and it places no herds of its own. */
  herdless = false;

  /** Places the shard's herds, yielding after each one (`build` drains it, `buildAsync` pauses between). */
  private *spawnHerds(): Generator<number, void, undefined> {
    if (this.herdless) { yield* this.draw.factory.prepareSteps(activeLevel().spawns.flatMap(({ kind, variants }) => variants?.map(variant => ({ kind, variant })) ?? [{ kind }])); return; }
    // herd placement comes from the shard: each HerdPlan asks for a clearing (or canopy) in a band of
    // distances off the trails, optionally in a ring around an anchor (a trail, a cabin…) — the hunting brain's recipe
    const { spawns: plan, spawn } = activeLevel();
    yield* this.hunt.placeHerds(plan, spawn, (kind, x, z, yaw, variants) => this.spawn(kind, x, z, yaw, variants));
  }

  /** the species' hunting-loop numbers (the hunting brain's: its own `tuning`, else the baseline, with the shard's overrides) */
  private tuningFor(a: Animal): ReturnType<StalkerBrain<Animal>['tuningFor']> { return this.hunt.tuningFor(a); }

  /** true if a living legendary of this kind is already in the chunk (the cap is one per kind) */
  private hasLegendary(kind: AnimalKind): boolean {
    for (const a of this.animals) if (a.kind === kind && a.rarity === 'legendary' && a.alive) return true;
    return false;
  }

  /**
   * Add one animal (also used by the dev showcase). `variant`: a variant id (exact, even a second legendary),
   * an id list to roll from by weight, or nothing for the species' whole table.
   */
  /** Retire a scripted creature through the same body and manager ownership boundary. */
  retire(a: Animal): void {
    if (this.spawnedActors.has(a) && this.animals.includes(a)) this.retiredActors.add(a);
    a.hidden = true; this.draw.hide(a);
    if (!a.simulationBound) { a.alive = false; a.position.y = -9999; }
    const i = this.animals.indexOf(a); if (i !== -1) this.animals.splice(i, 1);
    this.hunt.forget(a); this.tokens.release(a); this.scheduler.forget(a);
    this.bodies?.remove(a);
    a.retireBody();
    this.draw.remove(a);
  }

  /** Spawn below a WORLD ray origin (fromY), or at an exact initial world feet height (y). */
  spawn(kind: AnimalKind, x: number, z: number, yaw: number, variant?: string | string[], placement?: { y?: number; fromY?: number; entityId?: string; body?: { seed: number; scale: number } }): Animal {
    return this.spawnAnimal(kind, x, z, yaw, variant, placement);
  }

  /** This manager retired `actor`. */
  retired(actor: Animal): boolean { return this.retiredActors.has(actor); }

  /** Rebuild one retired authored home with fresh rig/state and ordinary spawn RNG, preserving its logical identity.
   * Only an actor retired by this manager can be replaced, once; a foreign/live actor or live duplicate refuses before construction. */
  replace(retired: Animal, x: number, z: number, yaw: number, variant?: string | string[], placement?: { y?: number; fromY?: number }): Animal {
    if (retired.simulationBound || !this.retiredActors.has(retired) || this.animals.some(actor => actor.entityId === retired.entityId)) throw new Error('Replacement requires this manager\'s unreplaced retired actor');
    const replacement = this.spawnAnimal(retired.kind, x, z, yaw, variant, placement, retired.entityId);
    this.retiredActors.delete(retired);
    return replacement;
  }

  private spawnAnimal(kind: AnimalKind, x: number, z: number, yaw: number, variant?: string | string[], placement?: { y?: number; fromY?: number; entityId?: string; body?: { seed: number; scale: number } }, identity?: string): Animal {
    if ((placement?.y !== undefined && !Number.isFinite(placement.y)) || (placement?.fromY !== undefined && !Number.isFinite(placement.fromY))) throw new Error('Creature spawn placement must be finite');
    const { variant: v, scale, rigSeed, seed } = spawnRolls(this.rng, kind, variant, this.hasLegendary(kind)); // the shared stream's spawn rolls (hunt.ts)
    const { actor: a, flight } = this.draw.rig(kind, v.id, rigSeed, placement?.body?.seed ?? seed, placement?.body?.scale ?? scale, identity ?? this.entityIds.allocate(placement?.entityId));
    a.maxHp = a.hp = v.hp ?? this.tuningFor(a).hp;
    const physics = this.physics ?? this.host.physics;
    const fromY = placement?.fromY ?? Math.max(activeLevel().spawn.y ?? heightAt(x, z), heightAt(x, z)) + 1;
    const floor = creatureFloor(physics, x, z, fromY);
    const y = placement?.y ?? (flight === undefined ? floor.y : flight.altitude + (flight.above === 'world' ? 0 : floor.y));
    a.place(x, z, yaw, y);
    a.levelGround = floor.structure;
    if (activeLevel().ground.structures !== undefined || floor.structure || placement !== undefined) {
      a.groundHeight = (px, pz, py) => creatureFloor(physics, px, pz, py).y;
    }
    a.herd = -1;
    a.onFootfall = this.footfall;
    a.onDamaged = this.damaged;
    a.onStaggered = this.staggered;
    this.scheduler.onInterrupt(a, () => {
      if (a.simulationBound || a.hidden || a.harnessHold || !a.alive || (speciesDef(a.kind).think !== undefined && speciesDef(a.kind).tick === undefined)) return;
      const dt = this.scheduler.takeBrainDt(this.tickRate(a), a);
      this.think(a, dt, this.playerPos, this.playerSprinting);
    });
    a.sampleTerrain();
    this.draw.adopt(a, this.playerPos, this.asleepNow);
    this.animals.push(a);
    this.spawnedActors.add(a);
    this.host.aggression.register(a, this.tokens, this.host.levelScope ?? undefined);
    this.hunt.adopt(a, x, z); // its memory: three more draws on the shared stream
    if (this.melee) { a.attackTurnCap = ATTACK_TURN; a.onAttack = (who, dur) => { this.onWindup?.(who, dur); }; }
    return a;
  }

  /** J108: a wild creature became a player's mount; a new wild one comes to its spot later. */
  tamed({ id, ...spot }: EventMap['creature.tamed']): void { this.refill.left({ ...spot, from: id }); }

  /** a herd for an external spawner (Enemies.ts): returns its index for `animal.herd`; push the animals into `members` */
  addHerd(kind: AnimalKind, cx: number, cz: number): number { return this.hunt.addHerd(kind, cx, cz); }

  private footfall = (a: Animal, strength: number): void => {
    if (this.onSound === undefined) return;
    if (a.position.distanceToSquared(this.playerPos) > 35 * 35) return;
    if (strength > 0.5) this.onSound('hoofsteps', a.position);
  };

  // ── per frame ──────────────────────────────────────────────────────────────────────────

  /**
   * `viewPos` is where the frame is seen from — the player, or Explore's free camera (main.ts `viewer()`, E125).
   * Drawing (visible / castShadow / draw LOD / fur shells / animation rate) is measured from it; the AI, the
   * hitboxes and the footfalls stay on `playerPos`. Explore parks the player 3 km away, so a player-measured cull
   * hid every animal there. `camera`: the view — the far herd skips the far animals outside it (PH-P2).
   */
  /**
   * Tile streaming T6: `follow(viewer)` answers which animals stay awake, by their position (the shard's resident ring
   * around the player). Outside it an animal is dormant: no decision, no body step, not drawn, its state left exactly as it
   * was (a save stays exact), until the ring reaches it again. A pinned, driven, harness-held or simulation-bound animal
   * never sleeps. Null: every animal awake, as before.
   */
  setResidency(follow: ((viewer: Vector3) => (x: number, z: number) => boolean) | null): void {
    this.residency = follow; this.resident = null;
  }
  /** outside the resident ring (and free to doze there) */
  private outside(a: Animal): boolean {
    const resident = this.resident;
    return resident !== null && !a.simulationBound && !a.harnessHold && !a.drawPinned && !a.driven && !brainPinned(a) && !resident(a.position.x, a.position.z);
  }
  /** dormant: outside the ring (MF11: no texture lease; a woken model draws at once, its textures never left) */
  private dormant(a: Animal): boolean { return this.outside(a); }
  /** `dormant` as a reusable callback (CreatureBodies.sync's `asleep`) */
  private readonly asleepNow = (a: Animal): boolean => this.dormant(a);

  update(dt: number, t: number, playerPos: Vector3, playerSprinting = false, viewPos: Vector3 = playerPos, camera: PerspectiveCamera | null = null): void {
    this.playerPos.copy(playerPos);
    this.resident = this.residency === null ? null : this.residency(playerPos);
    this.playerSprinting = playerSprinting;
    this.scheduler.beginFrame(dt, playerPos);
    this.hunt.beginTick(dt);
    this.refill.step(dt);
    this.draw.trample(this.animals, playerPos);
    // hitboxes posed from last frame's bones, bodies handed out / back by distance (PHYSICS P6)
    this.bodiesFor()?.sync(this.animals, playerPos, this.asleepNow);
    // Decisions and bodies have independent per-subject clocks; the free camera never wakes a herd.
    const n = this.animals.length;
    if (dt > 0) {
      // the player's ground speed (m/s) is the noise they make: still / crouch / walk / sprint
      if (!this.playerInit) { this.playerPrev.copy(playerPos); this.playerInit = true; }
      const moved = Math.hypot(playerPos.x - this.playerPrev.x, playerPos.z - this.playerPrev.z);
      this.playerPrev.copy(playerPos);
      // oxlint-disable-next-line prefer-exponentiation-operator -- `**` never reaches the portable Math (test/portable-math.test.ts).
      this.playerSpeed += (Math.min(moved / dt, 9) - this.playerSpeed) * (1 - Math.pow(0.5, dt * 10));
      this.hunt.resetRepaths();
      if (this.rules !== null) this.tokens.sweep(this.stillAttacking); // E297: the tokens of attacks that are over go back
      const t0 = frameCost.on ? performance.now() : 0;
      if (this.dodgeId !== dodgeFx.id) { this.dodgeId = dodgeFx.id; this.interruptTargets('target.dodge'); }
      for (const a of this.animals) {
        if (a.simulationBound || a.harnessHold || a.hidden || this.dormant(a)) { this.scheduler.forget(a); continue; }
        const rate = this.tickRate(a);
        if (a.alive && a.aggressive && (a.state === 'charge' || a.state === 'stalk' || a.state === 'alert')) {
          const seen = this.canReach(a, playerPos);
          if (this.visibility.get(a) === true && !seen) this.scheduler.interrupt(a, 'lost.sight');
          this.visibility.set(a, seen);
        }
        const brainDt = this.scheduler.takeBrainDt(rate, a);
        if (brainDt > 0) this.think(a, brainDt, playerPos, playerSprinting);
      }
      if (frameCost.on) frameCost.sub('think', t0);
    }
    this.draw.beginDraw(camera);
    const poseT0 = frameCost.on ? performance.now() : 0;
    for (let i = 0; i < n; i++) {
      const a = this.animals[i];
      if (a === undefined) continue;
      this.draw.reach(a, viewPos, this.asleepNow);
      if (a.hidden) continue;
      if (this.dormant(a)) { this.draw.sleep(a); continue; }   // T6: asleep outside the ring
      const d2 = a.position.distanceToSquared(viewPos);
      const near = d2 < ANIM_LOD * ANIM_LOD;
      a.poseEvery = poseEvery(d2);
      const bodyDt = a.harnessHold ? 0 : a.simulationBound ? dt : this.scheduler.bodyDt(this.tickRate(a), a);
      if (bodyDt > 0) {
        if (!a.simulationBound && a.alive && !a.stunned && a.state === 'charge' && speciesDef(a.kind).think === undefined) this.hunt.advanceCharge(a, bodyDt, playerPos);
        const act = speciesDef(a.kind).act;
        if (!a.simulationBound && act !== undefined && a.alive && !a.stunned) act(a, this.customContext(a, bodyDt, playerPos, this.playerSprinting));
        a.update(bodyDt, t, near);
        if (!a.simulationBound && a.alive) killBelowWorld(a, activeLevel().world, this.host.combat);
        if (!a.simulationBound && this.melee && a.state === 'charge' && a.alive && !a.stunned) this.hunt.chargeContact(a, playerPos);
        if (!a.simulationBound && this.rules !== null && a.alive && a.position.distanceToSquared(playerPos) < 36) this.clearBody(a, playerPos);
      }
      this.draw.draw(a, i, d2);
    }
    if (frameCost.on) frameCost.sub('pose', poseT0);
    this.draw.endDraw(this.animals, n, dt);
  }

  private tickRate(a: Animal): string {
    if (a.driven || a.state === 'sidestep' || brainPinned(a)) return 'always';
    const species = speciesDef(a.kind);
    return species.tick ?? (species.think === undefined ? 'ai' : 'legacy');
  }

  /** Hit/target edges bypass the decision interval, including for a far animal. */
  interrupt(a: Animal, why: InterruptReason): void {
    if (a.simulationBound || a.hidden || a.harnessHold || !a.alive || (speciesDef(a.kind).think !== undefined && speciesDef(a.kind).tick === undefined)) return;
    this.scheduler.interrupt(a, why);
  }
  private interruptTargets(why: InterruptReason): void {
    for (const a of this.animals) if (a.aggressive || this.hunt.sensed(a)) this.interrupt(a, why);
  }

  /** Decision and body callbacks share exactly the same sensing/reach/director ports. */
  private customContext(a: Animal, dt: number, player: Vector3, sprinting: boolean): ThinkCtx {
    const c = this.thinkCtx, herd = a.herd >= 0 ? this.herds[a.herd] ?? null : null;
    c.dt = dt; c.t = this.host.clock.now; c.player = player; c.playerSpeed = sprinting ? 7.2 : this.playerSpeed;
    c.calm = this.unaware; c.herd = herd?.members ?? null; c.world = this.enemyWorld;
    c.hurt = (damage) => { if ((!this.melee || this.hunt.facing(a, player, HURT_ARC)) && this.canReach(a, player)) this.onCharge?.(a, damage); };
    c.sound = (name) => { this.onSound?.(name, a.position); };
    return c;
  }

  private think(a: Animal, dt: number, player: Vector3, sprinting: boolean): void {
    try { this.thinkFrame(a, dt, player, sprinting); }
    catch (error) {
      if (!this.reportedDecisions.has(a)) { this.reportedDecisions.add(a); emitFault({system: 'animals.think', error, verdict: 'retry'}); }
    }
  }
  /** Keep refused observations local to one actor, including interrupt wakes.
   * Accepted native state/effects are never rolled back or replayed. */
  private thinkFrame(a: Animal, dt: number, player: Vector3, sprinting: boolean): void {
    if (a.simulationBound) return;
    if (this.hunt.memory(a) === undefined) throw new Error(`AnimalManager: ${a.kind} has no brain (not spawned through spawn())`);
    const self = speciesDef(a.kind).think;
    if (self !== undefined) {
      // a self-thinking species (the island's enemies): its own tick, its own reactions, its own bounds
      if (!a.alive) {
        a.lookWeight = 0;
        const fade = speciesDef(a.kind).corpseFade;
        if (fade && !a.hidden && performance.now() - a.lastHitT > fade * 1000) a.fadeOut();
        return;
      }
      if (a.stunned) { a.setMotion(a.yaw, 0, 1); a.setStrafe(0); a.lookTarget.copy(player); a.lookWeight = 1; return; }
      const c = this.customContext(a, dt, player, sprinting);
      const herd = a.herd >= 0 ? this.herds[a.herd] ?? null : null;
      a.sampleTerrain();
      self(a, c);
      if (herd !== null) this.hunt.updateHerd(herd);
      return;
    }
    this.hunt.think(a, dt, player, sprinting, this.playerSpeed);
  }

  /** E297: a big animal's body never swallows the camera (the module's `clearBody`). Self-thinking species keep their own spacing. */
  private clearBody(a: Animal, player: Vector3): void {
    if (a.hidden || speciesDef(a.kind).think !== undefined) return;
    clearBody(a, player);
  }

  /**
   * E296: nothing solid between `a` and the player — the physics `lineOfSight` from the player's chest to the attacker's
   * (its body centre; on a tall one halfway up to the head, LockOnTarget's aim point), which only counts a world surface
   * short of the attacker's own body (so one brushing a wall, or a big one half inside a rock, still reaches you). Creatures
   * never block. Asked on the frame a hit would land (and by `ThinkCtx.reach` before a swing): one ray, not per frame.
   */
  private canReach(a: Animal, player: Vector3): boolean { return canReach(a, player, this.host.physics); }

  private thinkCtx: ThinkCtx = {
    dt: 0.1, t: 0, player: new Vector3(), playerSpeed: 0, rng: this.rng, calm: false, herd: null,
    hurt: () => undefined, sound: () => undefined, world: {}, heightAt, waterLevel,
    steer: (a, yaw, speed, turnRate) => { this.hunt.steerAny(a, yaw, speed, turnRate); },
    flight: { steer: (a, yaw, speed, altitude, turnRate) => { a.fly(yaw, speed, altitude, turnRate); } },
    pathYaw: (a, tx, tz, every = 1) => this.hunt.pathYawFor(a, tx, tz, every),
    confine: (a) => { this.hunt.confine(a); },
    reach: (a) => this.canReach(a, this.thinkCtx.player),
    claim: (a) => this.host.events.ask('ai.claim', a),
    mayAttack: (a) => this.host.events.ask('ai.mayAttack', a),
  };

  /**
   * Something loud landed at `point` (a bolt in a tree or the dirt): animals within impactSpook m bolt after a
   * short start, within impactAlert m their heads come up. `strength` scales both radii (1 = a bolt).
   */
  disturb(point: Vector3, strength = 1): void { this.hunt.disturb(this.animals, point, strength); }

  /** A shard's own thinkers steer by the navmesh (Nalati: set by src/shards/nalati-grasslands/index.ts — NALATI-MERGE P3; hunt.ts `steerNav`). */
  get navSteer(): boolean { return this.hunt.navSteer; }
  set navSteer(on: boolean) { this.hunt.navSteer = on; }

  // ── combat ─────────────────────────────────────────────────────────────────────────────

  /** the reused raycast() result (made on the first hit) */
  private hitResult: AnimalHit | null = null;

  /** the DAMAGE model (Animal.ts): a body bolt from `dist` m (falloff past 40 m), ×headMul for the head */
  damageFor(headshot: boolean, dist: number): number { return damageFor(headshot, dist, () => this.host.rng.stream('gameplay').next()); }

  /**
   * Ray vs every living animal's head sphere + body capsule. Returns the nearest hit
   * (the returned object is reused between calls — copy what you need).
   */
  raycast(origin: Vector3, dir: Vector3, maxDist: number, aliveOnly = true): AnimalHit | null {
    // PHYSICS P6: the animals' head / body hitboxes in the physics world (posed every update); dead ones have none
    void aliveOnly;
    const hit = this.bodiesFor()?.cast(origin, dir, maxDist, this.host.equipmentHost?.player.mountedOn ?? null) ?? null;
    if (hit === null) return null;
    const h = this.hitResult ??= { animal: hit.creature, point: new Vector3(), distance: 0, headshot: false, damage: 0 };
    h.animal = hit.creature; h.distance = hit.distance; h.headshot = hit.head;
    h.point.copy(hit.point);
    h.damage = this.damageFor(hit.head, h.point.distanceTo(this.playerPos));
    return h;
  }

  private bodies: CreatureBodies<Animal> | null = null;
  /** the physics side of the herds (src/shared/engine/physics/creatures.ts), made once the shard's world exists */
  private bodiesFor(): CreatureBodies<Animal> | null {
    if (this.bodies === null) { const p = this.physics ?? this.host.physics; if (p !== null) this.bodies = new CreatureBodies<Animal>(p); }
    return this.bodies;
  }
  /** how many animals have a physics body (the near LOD) — the bench reads it */
  get physicsBodies(): number { return this.bodies?.bodies ?? 0; }

  /**
   * The living animal whose head sphere or body capsule passes within `tol` m of the ray (nearest along the ray),
   * or null. Cheap (one closest-point test per animal in range) — Combat asks every frame for the crosshair target.
   */
  nearRay(origin: Vector3, dir: Vector3, maxDist: number, tol: number): Animal | null {
    let best = maxDist, bestA: Animal | null = null;
    for (const a of this.animals) {
      if (!a.alive || a.hidden || a === this.host.equipmentHost?.player.mountedOn) continue;
      _c.copy(a.position); _c.y += a.dims.bodyY * a.scale;
      _d.subVectors(_c, origin);
      const t = _d.dot(dir);
      if (t < 0 || t > best) continue;
      const r = (a.dims.bodyHalfLen + a.dims.bodyRadius) * a.scale + tol;
      // (a second body capsule, dims.fore — the Antler King — reaches past that bound: the refine alone decides)
      if (a.dims.fore === undefined && _d.lengthSq() - t * t > r * r) continue;
      // refine against the head sphere and the body capsule
      a.headWorld(_p);
      const rh = a.dims.headRadius * a.scale + tol;
      _d.subVectors(_p, origin); const th = _d.dot(dir);
      let ok = th > 0 && _d.lengthSq() - th * th < rh * rh;
      if (!ok) {
        a.bodyCapsule(_a, _b);
        ok = segRayDist2(origin, dir, _a, _b) < (a.dims.bodyRadius * a.scale + tol) ** 2;
      }
      const fore = a.dims.fore;
      if (!ok && fore !== undefined && a.foreCapsule(_a, _b)) ok = segRayDist2(origin, dir, _a, _b) < (fore.radius * a.scale + tol) ** 2;
      if (ok) { best = t; bestA = a; }
    }
    return bestA;
  }

  /** Convenience: apply a raycast hit with its modelled damage. Returns true if it died. */
  hit(hit: AnimalHit, dir: Vector3): boolean {
    return hit.animal.applyDamage(hit.damage, hit.point, dir);
  }

  /** every applyDamage lands here: blood, sounds, AI reaction, kill event */
  private damaged = (a: Animal, amount: number, hitPoint: Vector3, dir: Vector3, died: boolean): void => {
    const sp = speciesDef(a.kind);
    if (sp.blood !== false) this.draw.bloodBurst(hitPoint, dir, amount >= 80 ? 1.5 : 1);
    this.onSound?.((sp.sounds?.hurt ?? fallbackSound(a.aggressive, 'hurt')), a.position);
    // headshot = the hit point sits inside the head sphere (a hair of slack for the ray step)
    a.headWorld(_p);
    const headshot = _p.distanceToSquared(hitPoint) < (a.dims.headRadius * a.scale + 0.06) ** 2;
    this.onDamage?.(a, amount, hitPoint, headshot, died);
    if (died) {
      this.onKill?.(a); this.hunt.died(a);
      const herd = this.herds[a.herd];
      if (herd !== undefined) this.refill.left({ kind: a.kind, variant: a.variant, herd: a.herd, x: herd.cx, z: herd.cz, from: a.entityId });
      return;
    }
    if (sp.think !== undefined) return;   // a self-thinking species reads animal.lastHitT / hp in its own tick
    this.hunt.hurt(a);   // the hunting brain's hit reaction (hunt.ts): bolt, turn on you, or come for you
    this.interrupt(a, 'hit');
  };

  /**
   * every Animal.stagger lands here: a blow that lands on a RUNNING charge breaks it — the animal stops dead (the stun),
   * comes up alert glaring, and either resumes the charge as soon as the stun lifts (a light swing: chargeCd shorter than
   * the stun) or, off a heavy, wheels away and comes again (the after-charge cooldown path). A blow on a standing animal
   * only delays whatever `damaged` decided.
   */
  private staggered = (a: Animal, strength: number, running: boolean): void => {
    if (speciesDef(a.kind).think !== undefined) return;
    this.hunt.staggered(a, strength, running);
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// Ray helpers
// ─────────────────────────────────────────────────────────────────────────────────────────

const _ab = new Vector3(), _ao = new Vector3();


/** squared distance between a ray (o, d unit) and a segment a-b (closest points, clamped to the segment and t ≥ 0) */
function segRayDist2(o: Vector3, d: Vector3, a: Vector3, b: Vector3): number {
  _ab.subVectors(b, a); _ao.subVectors(a, o);
  const abab = _ab.dot(_ab), abd = _ab.dot(d), aod = _ao.dot(d), abao = _ab.dot(_ao);
  const den = abab - abd * abd;
  let u = den > 1e-6 ? (abd * aod - abao) / den : 0;            // param on the segment
  u = MathUtils.clamp(u, 0, 1);
  let t = aod + u * abd;                                        // param on the ray
  if (t < 0) t = 0;
  const px = a.x + _ab.x * u - (o.x + d.x * t), py = a.y + _ab.y * u - (o.y + d.y * t), pz = a.z + _ab.z * u - (o.z + d.z * t);
  return px * px + py * py + pz * pz;
}
