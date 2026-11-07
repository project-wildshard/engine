import { MathUtils, Vector3 } from 'three';
import type { AnimalSim, AnimalState } from '../entities/AnimalSim';
import { GroupBrain } from './GroupBrain';
import type { Rng } from '../core/rng';
import type { FightRules } from '../level/spec';
import type { HerdPlan } from '../level/data';
import type { Navmesh } from '../physics/navmesh';
import { creatureSoundDefaults, rollVariant, speciesDef, variantOf, type SpeciesDef, type VariantDef, type VariantTable } from '../entities/species/registry';
import { AggressionDirector } from './director';
import { reengage, backoffPoint, aroundPoint, RING_DEFAULT, BACKOFF_MAX_T, BREAK_OFF_HP, BREAK_OFF_CHANCE, RULES_CD_HIT, RULES_CD_MISS } from '../entities/fightRules';

/**
 * The hunting brain (SF72, E435): the herds' 10 Hz decisions that used to live inside AnimalManager — senses and the
 * awareness meter, alert / freeze, flee, the hunters' stalk, charges (the melee wind-up, the committed stretch, contact),
 * the E297 fight rules (attack tokens, back-off, the ring, `reengage`), herd panic, ambient calls, hit / stagger
 * reactions, wander goals with navmesh paths and the no-navmesh steering — plus the herd placement recipe.
 *
 * Renderer-free: it reads the world only through `HuntPorts` (ground, water, trees, navmesh, line of sight, the wander
 * goal) and speaks only through them (sounds, charge hits). The browser's AnimalManager wires the ports to the live
 * Heightfield / Forest / app and keeps blood, views and audio; a trusted Node host wires them to baked data. One shared
 * `Rng` (the manager's `Rng(SEED + 31)`) feeds placement, every spawn's rolls (`spawnRolls` then `adopt`) and every
 * decision, in exactly the order the browser always drew them.
 *
 * The hunting loop (DEER_TUNING / BOAR_TUNING below): every animal carries an `awareness` meter 0..1. It rises while the
 * player is inside the SIGHT cone or the HEARING radius and decays otherwise. At `alertAt` the head comes up and the
 * animal FREEZES staring at you (the shot window), then bolts if it still senses you (`boltAt`), or relaxes. It flees
 * only until `fleeUntil..fleeUntilMax` m away, then looks back and grazes again, "wary" for `waryTime` s. One spooked
 * animal alerts its herd within `herdAlertRadius` m. Chargers charge when hit or inside `chargeDist`; HUNTERS (a
 * HuntTuning with `stalk`) never bolt: the freeze ends in a STALK that becomes a charge inside panicDist.
 */

/** One animal kind's hunting-loop numbers. Player speeds for reference: crouch 2.2, walk 4.3, sprint 7.2 m/s. */
export interface HuntTuning {
  hp: number;
  // ── senses ──
  sightRange: number;      // m: a head-up animal notices a MOVING player inside its cone out to here
  sightRangeGraze: number; // m: head down in the grass it sees far less
  sightCone: number;       // rad: half-angle of the cone around the body heading
  hearStill: number; hearCrouch: number; hearWalk: number; hearSprint: number; // m: hearing radius by player speed (any direction)
  noticeRate: number;      // awareness/s at the edge of a sense; up to 2× nearer (× 0.3 for a player standing still in view)
  forgetRate: number;      // awareness/s decay while nothing is sensed
  alertAt: number;         // awareness → head up + freeze
  boltAt: number;          // awareness → run (once the freeze is over)
  // ── alert ──
  freezeMin: number; freezeMax: number; // s: the stare before it may bolt — the shot window
  relaxAfter: number;      // s: alert with nothing sensed → back to grazing
  panicDist: number;       // m: player closer than this → bolt at once, no freeze
  // ── flee ──
  runSpeed: number;        // m/s gallop
  trotSpeed: number;       // m/s once it is nearly far enough
  fleeMinTime: number;     // s: run at least this long
  fleeUntil: number; fleeUntilMax: number; // m from the player where it stops (seeded per animal in this band)
  fleeMaxTime: number;     // s: give up running (edge of the chunk, pond…)
  lookBack: number;        // s: stopped after the run, looking back at you, before grazing again
  waryTime: number; waryBoost: number; // s of sharper senses after a scare, and the multiplier
  // ── herd ──
  herdAlertRadius: number; // m: a spooked animal alerts herd-mates within this
  herdBoltDelayMin: number; herdBoltDelayMax: number; // s: herd-mates bolt this long after it
  // ── disturbances (a bolt landing nearby) ──
  impactSpook: number;     // m: bolt now
  impactAlert: number;     // m: head up (a HUNTER also engages from this far: it heard the shot)
  // ── hunters (bear): the alert turns into a pursuit ('stalk') instead of a bolt ──
  stalk?: {
    detect: number;      // m: the player inside this radius is noticed at once, any direction (it smells you)
    speed: number;       // m/s of the stalk — a deliberate walk toward the player
    giveUp: number;      // m: a stalking animal this far from the player loses interest
    rechargeCd: number;  // s between a charge (contact or timeout) and the next
    huffMin: number; huffMax: number; // s between huffs (the species' `call` sound) while stalking
    roar: string;        // AnimalSound played at the start of a charge
    fleeBelowHp: number; // hp fraction under which a hit may make a NON-relentless variant break off and flee
    fleeChance: number;  // probability of that break-off per hit
  } | undefined;
}

export const DEER_TUNING: HuntTuning = {
  hp: 60,
  // Huntable, not paranoid (user: "I need to be able to get close and shoot them"): head-on a deer notices you
  // walking at ~22 m; from behind / the side you get to ~12 m on foot. Only sprinting inside 24 m is heard.
  sightRange: 30, sightRangeGraze: 14, sightCone: MathUtils.degToRad(55),
  hearStill: 3, hearCrouch: 6, hearWalk: 12, hearSprint: 24,
  noticeRate: 0.3, forgetRate: 0.3, alertAt: 0.45, boltAt: 1.0,
  // 4–7 s head-up stare: plenty of time to raise the crossbow and take the shot
  freezeMin: 4.0, freezeMax: 7.0, relaxAfter: 3.5, panicDist: 6,
  // gallop 6.0 (you sprint 7.2 — you CAN close on one) and only to 35–50 m, then it trots, stops and looks back
  runSpeed: 6.0, trotSpeed: 3.2, fleeMinTime: 1.5, fleeUntil: 35, fleeUntilMax: 50, fleeMaxTime: 8, lookBack: 2.5,
  waryTime: 10, waryBoost: 1.2,
  herdAlertRadius: 8, herdBoltDelayMin: 0.4, herdBoltDelayMax: 1.2,
  impactSpook: 4, impactAlert: 10,
};

export const BOAR_TUNING: HuntTuning = {
  hp: 100,
  // poor eyes, good nose: a short cone but it hears a walker from 22 m
  sightRange: 22, sightRangeGraze: 14, sightCone: MathUtils.degToRad(60),
  hearStill: 4, hearCrouch: 7, hearWalk: 14, hearSprint: 28,
  noticeRate: 0.5, forgetRate: 0.2, alertAt: 0.35, boltAt: 1.0,
  freezeMin: 1.5, freezeMax: 2.8, relaxAfter: 4, panicDist: 10, // panicDist doubles as the charge trigger
  runSpeed: 6.8, trotSpeed: 3.6, fleeMinTime: 2, fleeUntil: 40, fleeUntilMax: 60, fleeMaxTime: 10, lookBack: 2,
  waryTime: 20, waryBoost: 1.5,
  herdAlertRadius: 12, herdBoltDelayMin: 0.2, herdBoltDelayMax: 0.7,
  impactSpook: 7, impactAlert: 18,
};

const GRAZER_WALK = 1.3, CHARGER_WALK = 1.1, BOAR_CHARGE = 7.5, CHARGE_HIT_DIST = 1.4;   // species defaults (SpeciesDef.walkSpeed / chargeSpeed override)
const CHARGE_WHEN_HIT_DIST = 25;   // a wounded boar this close turns on you instead of running
/** melee shards: the charge wind-up per species (s) when the species declares none */
const CHARGE_WINDUP_DEFAULT = 0.5;
/** melee shards: the contact arc (half-angle, rad), the self-thinking species' strike arc, the turn cap while attacking (rad/s) */
export const CHARGE_ARC: number = MathUtils.degToRad(50), HURT_ARC: number = MathUtils.degToRad(70), ATTACK_TURN = 1.5;
const CHARGE_COMMIT = 4.5, CHARGE_COMMIT_TURN = 1.1;   // m from the player inside which a charge stops tracking, and its turn rate there (rad/s)
/** E297 fight rules: the stalk a boar gets when it has none (it comes for you instead of bolting); its circling / back-off speeds (m/s) */
const RULES_STALK: NonNullable<HuntTuning['stalk']> = { detect: 0, speed: 3.0, giveUp: 45, rechargeCd: RULES_CD_HIT, huffMin: 2.5, huffMax: 5, roar: '', fleeBelowHp: BREAK_OFF_HP, fleeChance: BREAK_OFF_CHANCE };
const CIRCLE_SPEED = 1.7, BACKOFF_SPEED = 4.2;
/** E297: a charger turns to within this of you (rad) before its wind-up starts */
const FACE_BEFORE_CHARGE = 0.6;
/** the bearings `steerNav` tries round a blocked heading (rad, each side) */
const NAV_FAN = [0.4, 0.8, 1.2, 1.6, 2.1, 2.6];

/** a species with no `sounds`: the installed default call / hurt for its temperament (installKitSpecies); none installed: '' */
export const fallbackSound = (charger: boolean, which: 'call' | 'hurt'): string => creatureSoundDefaults()?.[charger ? 'charger' : 'grazer'][which] ?? '';

/** One animal's hunting-brain memory. */
export interface HuntMemory {
  timer: number;        // time left in the current state
  tx: number; tz: number; // wander target
  fleeT: number;        // seconds spent fleeing
  fleeUntil: number;    // m from the player at which this animal stops running (seeded per animal)
  chargeCd: number;
  callT: number;
  awareness: number;    // 0..1 sense meter (see DEER_TUNING)
  freeze: number;       // alert: seconds of head-up stare left before it may bolt
  spooked: boolean;     // alert: bolt as soon as the freeze ends, whatever the senses say (herd panic, impact, hit)
  wary: number;         // seconds of sharpened senses left after a scare
  sensed: boolean;      // the player was sensed this think
  windup: number;       // melee shards: seconds of charge wind-up left (0 = running / none)
  // ── E297 fight rules ──
  backoff: number;      // s of the after-charge back-off left (0 = none); tx / tz is where it backs off to
  side: number;         // ±1: which way it arcs round you (flipped every back-off)
  committed: boolean;   // this charge got inside CHARGE_COMMIT of the player (a miss is then a pass-through)
  // ── the navmesh path being followed (PHYSICS P6b; empty without a navmesh) ──
  path: Vector3[]; pathI: number; goalX: number; goalZ: number; repathAt: number;
}


/** Plain hunt continuation values; the owning roster retains its schema and version. */
export type SavedHuntMemory=Record<string,number|boolean|[number,number,number][]>;
const savedPathPoint=(value:unknown):Vector3=>{
  if(!Array.isArray(value)||value.length!==3)throw new Error('Invalid hunting path point');
  const x:unknown=value[0],y:unknown=value[1],z:unknown=value[2];
  if(typeof x!=='number'||typeof y!=='number'||typeof z!=='number'||!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(z))throw new Error('Invalid hunting path point');
  return new Vector3(x,y,z);
};
/** Copy/restore only memory values; no brain, body, clock or RNG owner is created. */
export const huntMemoryCodec={
  /** Save the live record, or an authored historical field list, with plain path triples. */
  save(memory:HuntMemory,fields:readonly string[]=Object.keys(memory)):SavedHuntMemory {
    if(fields.length>256||new Set(fields).size!==fields.length)throw new Error('Invalid hunting memory fields');
    const saved:SavedHuntMemory={};
    for(const key of fields){
      if(!Object.hasOwn(memory,key))throw new Error(`Missing hunting memory ${key}`);
      const value:unknown=Reflect.get(memory,key);
      if(Array.isArray(value))saved[key]=value.map((point:unknown):[number,number,number]=>{
        if(!(point instanceof Vector3))throw new Error('Unsaveable hunting path');return [point.x,point.y,point.z];
      });
      else if(typeof value==='boolean'||typeof value==='number')saved[key]=value;
      else throw new Error(`Unsaveable hunting memory ${key}`);
    }
    return saved;
  },
  /** Preflight complete or historical subset fields before mutating the brain's actual record. */
  restore(memory:HuntMemory,input:unknown,complete=true):void {
    if(input===null||typeof input!=='object'||Array.isArray(input))throw new Error('Invalid hunting memory continuation');
    const fields=Object.keys(input),known=Object.keys(memory);
    if(fields.length>256||(complete&&fields.length!==known.length))throw new Error('Incompatible hunting memory');
    const changes=fields.map(key=>{
      if(!Object.hasOwn(memory,key))throw new Error(`Incompatible hunting memory ${key}`);
      const value:unknown=Reflect.get(input,key),current:unknown=Reflect.get(memory,key);
      if(Array.isArray(value)){
        if(!Array.isArray(current))throw new Error(`Incompatible hunting memory ${key}`);
        return {key,value:value.map((point:unknown)=>savedPathPoint(point))};
      }
      if(typeof value!==typeof current||(typeof value!=='number'&&typeof value!=='boolean')
        ||(typeof value==='number'&&!Number.isFinite(value)))throw new Error(`Incompatible hunting memory ${key}`);
      return {key,value};
    });
    for(const change of changes)Reflect.set(memory,change.key,change.value);
  },
};

/** What the brain drives: the native body plus the two view facts it reads (a hidden rig, the 10 Hz slope sample). */
export interface HuntBody extends AnimalSim {
  readonly hidden: boolean;
  /** sample the ground under the body (the view tilts to it; a headless body may no-op) */
  sampleTerrain: () => void;
}

export interface HuntHerd<A extends AnimalSim> { kind: string; cx: number; cz: number; members: A[] }

/** a tree as the brain sees it (Forest's TreeInstance has these) */
export interface HuntTree { readonly x: number; readonly z: number; readonly r: number }

/** The ground, water and trees the brain reads. Every query is live: the host decides what world answers it. */
export interface HuntGround {
  heightAt: (x: number, z: number) => number;
  /** the up component of the ground normal */
  normalY: (x: number, z: number) => number;
  trailDistance: (x: number, z: number) => number;
  cabinMask: (x: number, z: number) => number;
  inChunk: (x: number, z: number, margin: number) => boolean;
  streamAt: (x: number, z: number) => number | null;
  waterLevel: () => number;
  /** the level's pond (its surface square), or null when it has none */
  pond: () => { readonly x: number; readonly z: number; readonly r: number } | null;
  /** the level has an open sea */
  sea: () => boolean;
  /** a shard's own water the water line cannot see (Nalati's river corridor) */
  wetAt: (x: number, z: number) => boolean;
  trees: (x: number, z: number, radius: number) => readonly HuntTree[];
  /** a shard with no forest trees: every spot is a clearing, a canopy ask is moot */
  treeless: () => boolean;
  /** the level has analytic terrain (a structures-only world has no navigation surface to steer by) */
  terrain: () => boolean;
  /** half the chunk's side (m): the hard clamp */
  chunkHalf: number;
}


export type HuntNav = Pick<Navmesh, 'closestWalkable' | 'randomPointNear' | 'findPath' | 'clearAhead'>;

export interface HuntPorts<A extends AnimalSim> {
  ground: HuntGround;
  /** the level's navmesh, or null (the straight-heading fallback) */
  nav: () => HuntNav | null;
  /** nothing solid between `a` and the player (E296) */
  reach: (a: A, player: Vector3) => boolean;
  /** where a wander walks to instead of a random point (within r m), or null */
  wanderGoal: (a: A) => { x: number; z: number; r: number } | null;
  /** the player is not among them (calm, a practice room) */
  unaware: () => boolean;
  /** a millisecond clock for the idle glances (cosmetic: look weight only) */
  now: () => number;
  sound: (name: string, a: A) => void;
  /** a charge reached the player */
  charge: (a: A, damage: number) => void;
}

export interface HuntConfig {
  rng: Rng;
  fight: FightRules;
  /** the shard's per-kind overrides (ShardManifest.faunaTuning), read once per kind at its first use */
  faunaTuning: () => Partial<Record<string, Partial<HuntTuning>>> | undefined;
  /** Each kind's species row, as the brain reads it. Omitted: the global registry (`speciesDef`), as the browser's
   *  manager always resolved it. A renderer-free host passes its own data rows (ai/species SpeciesRow), no looks. */
  species?: (kind: string) => HuntSpecies;
}
/** The species fields the hunting brain reads: a registered SpeciesDef and a renderer-free SpeciesRow both satisfy it. */
export type HuntSpecies = Pick<SpeciesDef, 'aggressive' | 'tuning' | 'sounds' | 'think' | 'walkSpeed' | 'chargeSpeed' | 'chargeWindup' | 'ringRadius'>;

/** A spawn's rolls on the shared stream, in order: the variant (when rolled), the scale, the rig seed and the body seed. */
export interface SpawnRolls { variant: VariantDef; scale: number; rigSeed: number; seed: number }
export function spawnRolls(rng: Rng, kind: string, variant: string | string[] | undefined, hasLegendary: boolean, species: (kind: string) => VariantTable = speciesDef): SpawnRolls {
  const sp = species(kind);
  const v = typeof variant === 'string' ? variantOf(sp, variant) : rollVariant(sp, rng, variant, hasLegendary);
  const scale = rng.range(v.scale[0], v.scale[1]);
  const rigSeed = rng.next();
  return { variant: v, scale, rigSeed, seed: rng.next() };
}

const _ring = { x: 0, z: 0 };
const _navFrom = new Vector3(), _navTo = new Vector3();

/** The herds' hunting brain over host ports (see the header). One per manager; it owns the memories, herds and tokens. */
export class HuntingStalkerCore<A extends AnimalSim> extends GroupBrain<A> {
  readonly herds: HuntHerd<A>[] = [];
  navSteer = false;
  private readonly memories = new Map<A, HuntMemory>();
  private readonly tuningCache = new Map<string, HuntTuning>();
  private readonly hunting: {
    rng: Rng; ports: HuntPorts<A>; ground: HuntGround; player: Vector3; sampleTerrain: (actor: A) => void;
    faunaTuning: HuntConfig['faunaTuning']; species: (kind: string) => HuntSpecies;
    melee: boolean; rules: FightRules | null; tokens: AggressionDirector<A>;
  } | null;
  private repaths = 0;
  private clock = 0;
  constructor(members: A[], profile?: { config: HuntConfig; ports: HuntPorts<A>; player: Vector3; sampleTerrain: (actor: A) => void }) {
    super(members);
    if (profile === undefined) { this.hunting = null; return; }
    const { config, ports, player, sampleTerrain } = profile;
    const rng = config.rng, ground = ports.ground, faunaTuning = config.faunaTuning, species = config.species ?? speciesDef;
    const melee = config.fight.telegraphed === true;
    const rules = config.fight.attackers === undefined || !Number.isFinite(config.fight.attackers) ? null : config.fight;
    this.hunting = { rng, ports, ground, player, sampleTerrain, faunaTuning, species, melee, rules, tokens: new AggressionDirector<A>(rules?.attackers ?? Infinity) };
  }
  private requireHunt(): NonNullable<typeof this.hunting> { if (this.hunting === null) throw new Error('Incompatible stalker hunt pattern'); return this.hunting; }
  private get rng(): Rng { return this.requireHunt().rng; }
  private get ports(): HuntPorts<A> { return this.requireHunt().ports; }
  /** The same captured ground authority used by this hunting controller; other patterns refuse. */
  get ground(): HuntGround { return this.requireHunt().ground; }
  private get faunaTuning(): HuntConfig['faunaTuning'] { return this.requireHunt().faunaTuning; }
  private get species(): (kind: string) => HuntSpecies { return this.requireHunt().species; }
  /** Original telegraphed-contact mode, read once at construction. */
  get melee(): boolean { return this.requireHunt().melee; }
  /** Original bounded attacker rules, retaining host object identity. */
  get rules(): FightRules | null { return this.requireHunt().rules; }
  /** One manager-owned attack-token pool, never duplicated into its members. */
  get tokens(): AggressionDirector<A> { return this.requireHunt().tokens; }
  /** Original player observation identity for reactions and pathfinding. */
  get player(): Vector3 { return this.requireHunt().player; }

  memory(a: A): HuntMemory | undefined { return this.memories.get(a); }
  forget(a: A): void { this.memories.delete(a); }
  sensed(a: A): boolean { return this.memories.get(a)?.sensed === true; }

  /** A new body joins: its memory, from three more draws on the shared stream (its side from its own seed). */
  adopt(a: A, x: number, z: number): void {
    const rng = this.rng, tune = this.tuningFor(a);
    this.memories.set(a, {
      timer: rng.range(1, 4), tx: x, tz: z, fleeT: 0, fleeUntil: rng.range(tune.fleeUntil, tune.fleeUntilMax), chargeCd: 0,
      callT: rng.range(10, 60), awareness: 0, freeze: 0, spooked: false, wary: 0, sensed: false, windup: 0,
      backoff: 0, side: a.seed % 0.02 < 0.01 ? -1 : 1, committed: false, // from its own seed: no extra draw on the shared rng (the herds' rolls stay put)
      path: [], pathI: 0, goalX: 0, goalZ: 0, repathAt: 0,
    });
  }

  /** a herd for an external spawner: returns its index for `animal.herd`; push the animals into `members` */
  addHerd(kind: string, cx: number, cz: number): number {
    this.herds.push({ kind, cx, cz, members: [] });
    return this.herds.length - 1;
  }

  /** the start of an update with time passing: the world clock, and the per-tick path-search budget */
  beginTick(dt: number): void { this.clock += dt; }
  resetRepaths(): void { this.repaths = 0; }

  /** the species' hunting-loop numbers: its own `tuning`, else the baseline for its temperament, with the shard's overrides */
  tuningFor(a: { readonly kind: string }): HuntTuning {
    const cached = this.tuningCache.get(a.kind);
    if (cached !== undefined) return cached;
    const sp = this.species(a.kind);
    const base = sp.tuning ?? (sp.aggressive ? BOAR_TUNING : DEER_TUNING);
    const over = this.faunaTuning()?.[a.kind];
    let t = over !== undefined ? { ...base, ...over, stalk: over.stalk ?? base.stalk } : base;   // ShardManifest.faunaTuning: the shard's overrides (Driftwood's far-sighted beach boars)
    // E297 fight rules: a charger without a stalk (the boar) gets one — it comes for you instead of bolting
    if (this.rules !== null && sp.aggressive === true && sp.think === undefined && t.stalk === undefined) t = { ...t, stalk: { ...RULES_STALK, roar: sp.sounds?.call ?? fallbackSound(true, 'call') } };
    this.tuningCache.set(a.kind, t);
    return t;
  }

  // ── placement ──────────────────────────────────────────────────────────────────────────

  /**
   * Dry ground: not under water — the shard's own water, a stream, below the water line on an open-water shard, or
   * inside the pond's square (2r + 30 m across). With no pond to measure against, walkable on the navmesh = dry (the
   * navmesh bake's own wet test).
   */
  isDry(x: number, z: number): boolean {
    const g = this.ground;
    if (g.wetAt(x, z)) return false; // caller-owned water outside the common waterline (for example a river corridor)
    const y = g.heightAt(x, z), s = g.streamAt(x, z);
    if (s !== null && y < s - 0.05) return false;
    if (y > g.waterLevel() + 0.25) return true;
    if (g.sea()) return false; // the open sea (the level's registered water body)
    const pond = g.pond();
    if (pond === null) {
      // no pond to measure against (Nalati): the navmesh bake's own wet test — walkable on it = dry
      const nav = this.ports.nav();
      if (nav === null) return false;
      const p = nav.closestWalkable(_navFrom.set(x, y, z), 0, _navTo);
      return p !== null && Math.hypot(p.x - x, p.z - z) < 1;
    }
    const half = pond.r + 15;
    return Math.abs(x - pond.x) > half || Math.abs(z - pond.z) > half;
  }

  /** Ground an animal can stand on. `clearingR` > 3 asks for a clearing (few trunks in that radius); `canopy` instead asks for trees around. */
  isOpen(x: number, z: number, clearingR: number, canopy = false): boolean {
    const g = this.ground;
    if (!g.inChunk(x, z, 22)) return false;
    if (g.trailDistance(x, z) < (clearingR > 3 ? 9 : 6)) return false;
    if (g.cabinMask(x, z) > 0) return false;
    if (g.normalY(x, z) < 0.8) return false;
    if (!this.isDry(x, z)) return false;
    const near = g.trees(x, z, clearingR).length;
    if (clearingR > 3) return canopy ? near >= 3 || g.treeless() : near <= 2;
    return near === 0;
  }

  /**
   * The herd placement recipe: each HerdPlan asks for a clearing (or canopy) in a band of distances off the trails,
   * optionally in a ring around an anchor; then each member a spot 1.5–9 m from the centre and a yaw, and `spawn` makes
   * it (its own rolls follow on the same stream: `spawnRolls`, then `adopt`). Yields after each herd.
   */
  *placeHerds(plan: readonly HerdPlan[], spawn: { readonly x: number; readonly z: number },
    make: (kind: string, x: number, z: number, yaw: number, variants: string[] | undefined) => A): Generator<number, void, undefined> {
    const rng = this.rng, g = this.ground;
    const centres: [number, number][] = [];
    for (const h of plan) {
      let cx = 0, cz = 0, ok = false;
      // herd centres keep 60 m apart when the shard leaves placement to us; an anchored plan already says where
      // it wants to be (a laid-out grid of small groups, `src/engine/world/faunaLayout.ts`), so only its own ring size
      // — never less than 20 m — separates it from its neighbours
      const sep = h.anchor ? Math.min(60, Math.max(20, h.anchor.rMax)) : 60;
      for (let tries = 0; tries < 1500 && !ok; tries++) {
        if (h.anchor) {
          const ang = rng.range(0, Math.PI * 2), r = rng.range(h.anchor.rMin, h.anchor.rMax);
          cx = h.anchor.x + Math.cos(ang) * r; cz = h.anchor.z + Math.sin(ang) * r;
        } else { cx = rng.range(-215, 215); cz = rng.range(-215, 215); }
        // relax the trail band and clearing size as the search goes on
        const relax = tries / 1500;
        const td = g.trailDistance(cx, cz);
        if (td < h.trailBand[0] || td > h.trailBand[1] + relax * 60) continue;
        if (!this.isOpen(cx, cz, h.canopy ? 9 : 7 - relax * 3, h.canopy)) continue;
        if (Math.hypot(cx - spawn.x, cz - spawn.z) < 30) continue;         // not on top of the spawn point
        if (centres.some(([x, z]) => Math.hypot(x - cx, z - cz) < sep)) continue;
        ok = true;
      }
      if (!ok) continue;
      centres.push([cx, cz]);
      const herd: HuntHerd<A> = { kind: h.kind, cx, cz, members: [] };
      this.herds.push(herd);
      for (let i = 0; i < h.count; i++) {
        let px = cx, pz = cz, placed = false;
        for (let tries = 0; tries < 60 && !placed; tries++) {
          const ang = rng.range(0, Math.PI * 2), r = rng.range(1.5, 9);
          px = cx + Math.cos(ang) * r; pz = cz + Math.sin(ang) * r;
          if (!this.isOpen(px, pz, 1.2)) continue;
          if (herd.members.some((m) => Math.hypot(m.position.x - px, m.position.z - pz) < 1.8)) continue;
          placed = true;
        }
        if (!placed) continue;
        const a = make(h.kind, px, pz, rng.range(0, Math.PI * 2), h.variants);
        a.herd = this.herds.length - 1;
        herd.members.push(a);
      }
      yield this.herds.length;
    }
  }

  // ── decisions ──────────────────────────────────────────────────────────────────────────

  /** One decision tick of a hunting-loop animal (not a self-thinking species: the host routes those). */
  decideHunt(a: A, dt: number, player: Vector3, sprinting: boolean, playerSpeed: number): void {
    const br = this.memories.get(a);
    if (br === undefined) throw new Error(`HuntBrain: ${a.kind} has no memory (not adopted)`);
    if (!a.alive) { a.lookWeight = 0; return; }   // the corpse is a ragdoll (PHYSICS P8) or the keyframed collapse: nothing to think
    if (a.stunned) { br.chargeCd = Math.max(0, br.chargeCd - dt); a.setMotion(a.yaw, 0, 1); a.lookTarget.copy(player); a.lookWeight = 1; this.confine(a); return; }   // staggered by a sword blow: the AI holds (the charge cooldown still ticks)
    const rng = this.rng;
    const sp = this.species(a.kind);
    const charger = a.aggressive;                 // charges instead of only fleeing
    const T = this.tuningFor(a);
    const M = a.mods;
    const unaware = this.ports.unaware();
    const dx = player.x - a.position.x, dz = player.z - a.position.z;
    const dPlayer = Math.hypot(dx, dz);
    br.chargeCd = Math.max(0, br.chargeCd - dt);
    br.wary = Math.max(0, br.wary - dt);
    this.requireHunt().sampleTerrain(a);

    // ── senses → awareness meter ──
    // sight: inside the cone around the body heading, further when the head is up; a still player is far harder to spot
    const wary = br.wary > 0 ? T.waryBoost : 1;
    const pSpeed = sprinting ? 7.2 : playerSpeed;
    let rate = 0;
    if (!unaware && dPlayer > 0.01) {
      const grazing = a.state === 'graze';
      const sight = (grazing ? T.sightRangeGraze : T.sightRange) * wary;
      if (dPlayer < sight) {
        let rel = Math.atan2(dx, dz) - a.yaw;
        rel = Math.atan2(Math.sin(rel), Math.cos(rel));
        if (Math.abs(rel) < T.sightCone) {
          const still = pSpeed < 0.4 ? 0.3 : pSpeed < 2.6 ? 0.7 : 1;
          rate = Math.max(rate, T.noticeRate * (1 + (1 - dPlayer / sight)) * still);
        }
      }
      // hearing: any direction, radius from the noise the player makes
      const hear = (pSpeed < 0.4 ? T.hearStill : pSpeed < 2.6 ? T.hearCrouch : pSpeed < 5.2 ? T.hearWalk : T.hearSprint) * wary;
      if (dPlayer < hear) rate = Math.max(rate, T.noticeRate * 1.5 * (1 + (1 - dPlayer / hear)));
      if (T.stalk !== undefined && dPlayer < T.stalk.detect) rate = Math.max(rate, T.noticeRate * 3);   // a hunter smells you
    }
    br.sensed = rate > 0;
    br.awareness = br.sensed ? Math.min(1, br.awareness + rate * dt) : Math.max(0, br.awareness - T.forgetRate * dt);
    const panic = !unaware && dPlayer < T.panicDist * (charger ? M.chargeDist : 1);   // for chargers this is the charge trigger

    // ambient calls
    br.callT -= dt;
    if (br.callT <= 0) {
      const every = sp.sounds?.callEvery;
      br.callT = every !== undefined ? rng.range(every[0], every[1]) : rng.range(20, 90);
      // species may limit the call to some variants (elk: only bulls bugle) and it is a CALM sound — not mid-flight
      const caller = sp.sounds?.callVariants === undefined || sp.sounds.callVariants.includes(a.variant);
      if (caller && dPlayer < 80 && a.state !== 'flee' && a.state !== 'charge') this.ports.sound(sp.sounds?.call ?? fallbackSound(charger, 'call'), a);
    }

    const herd = a.herd >= 0 ? this.herds[a.herd] ?? null : null;
    // the player is inside the charge distance: chargers charge (hunters stalk while the charge cools down), the rest bolt
    const engage = (): void => { if (charger && br.chargeCd <= 0) this.enter(a, br, 'charge'); else if (T.stalk !== undefined) this.enter(a, br, 'stalk'); else { br.spooked = true; this.enter(a, br, 'flee'); } };

    switch (a.state) {
      case 'idle': case 'graze': case 'wander': {
        if (panic) { engage(); break; }
        if (br.awareness >= T.alertAt) { this.enter(a, br, 'alert'); break; }
        br.timer -= dt;
        if (a.state === 'wander') {
          const tdx = br.tx - a.position.x, tdz = br.tz - a.position.z;
          const td = Math.hypot(tdx, tdz);
          if (td < 1.2 || br.timer <= 0) { this.enter(a, br, rng.next() < 0.6 ? 'graze' : 'idle'); break; }
          this.steerTo(a, br, br.tx, br.tz, sp.walkSpeed ?? (charger ? CHARGER_WALK : GRAZER_WALK), 1.8, 4);
        } else {
          a.setMotion(a.desiredYaw, 0, 1.5);
          if (br.timer <= 0) {
            const r = rng.next();
            if (r < 0.45) this.enter(a, br, 'wander'); else this.enter(a, br, r < 0.8 ? 'graze' : 'idle');
          }
        }
        // a half-noticed player gets glances (awareness creeping up); otherwise the odd look around
        a.lookWeight = br.awareness > 0.12 ? 0.6 : dPlayer < 55 && Math.sin(a.seed * 20 + this.ports.now() * 0.0004) > 0.7 ? 0.4 : 0;
        a.lookTarget.copy(player);
        break;
      }
      case 'alert': {
        // head up, frozen, staring at you: the shot window
        a.setMotion(a.desiredYaw, 0, 2.0);
        a.lookTarget.copy(player); a.lookWeight = 1;
        br.freeze -= dt;
        if (panic) { engage(); break; }
        if (br.freeze <= 0 && (br.spooked || br.awareness >= T.boltAt)) {
          if (T.stalk === undefined) { this.enter(a, br, 'flee'); break; }
          // a hunter comes for you instead — unless it is nearly dead (it stands and watches), or you are out of reach
          const wounded = !M.relentless && a.hp / a.maxHp < T.stalk.fleeBelowHp;
          if (!wounded && dPlayer < T.impactAlert) this.enter(a, br, 'stalk');
          else { br.spooked = false; br.awareness = Math.min(br.awareness, T.alertAt * 0.5); this.enter(a, br, 'graze'); }
          break;
        }
        if (br.sensed) br.timer = T.relaxAfter;
        else { br.timer -= dt; if (br.timer <= 0) { br.spooked = false; br.awareness = Math.min(br.awareness, T.alertAt * 0.5); this.enter(a, br, 'graze'); } }
        break;
      }
      case 'flee': {
        br.fleeT += dt;
        // run away, biased back toward the herd's side of the map and away from the chunk edge
        let ax = -dx / (dPlayer + 1e-3), az = -dz / (dPlayer + 1e-3);
        if (herd !== null) { const hx = herd.cx - a.position.x, hz = herd.cz - a.position.z, hd = Math.hypot(hx, hz) + 1e-3; if (hd > 25) { ax += hx / hd * 0.35; az += hz / hd * 0.35; } }
        const farEnough = dPlayer > br.fleeUntil;
        const done = br.fleeT > T.fleeMaxTime || (br.fleeT > T.fleeMinTime && farEnough);
        if (done) { this.enter(a, br, 'alert'); br.freeze = T.lookBack; br.spooked = false; br.timer = T.relaxAfter; break; }
        // gallop, easing to a trot for the last stretch
        const speed = (dPlayer > br.fleeUntil * 0.8 && br.fleeT > T.fleeMinTime ? T.trotSpeed : T.runSpeed * (0.92 + 0.08 * Math.sin(a.seed * 9))) * M.speed;
        const al = Math.hypot(ax, az) + 1e-3;
        this.steerTo(a, br, a.position.x + ax / al * 20, a.position.z + az / al * 20, speed, 3.5, 1);
        a.lookWeight = 0;
        break;
      }
      case 'stalk': {
        // hunters only: walk the player down, huffing, and charge once inside panicDist (again after rechargeCd)
        const st = T.stalk;
        if (st === undefined) throw new Error(`HuntBrain: ${a.kind} is stalking without HuntTuning.stalk`);
        if (unaware || dPlayer > st.giveUp) { br.awareness = 0; br.spooked = false; br.backoff = 0; this.enter(a, br, 'wander'); break; }
        if (this.rules !== null) { if (this.circle(a, br, player, dPlayer, st.speed * M.speed, dt)) break; }
        else {
          if (panic && br.chargeCd <= 0) { this.enter(a, br, 'charge'); break; }
          this.steerTo(a, br, player.x, player.z, st.speed * M.speed, 2.5, 0.4);
          a.lookTarget.copy(player); a.lookWeight = 1;
        }
        br.timer -= dt;
        if (br.timer <= 0) { br.timer = rng.range(st.huffMin, st.huffMax); if (dPlayer < 80) this.ports.sound(sp.sounds?.call ?? fallbackSound(true, 'call'), a); }
        break;
      }
      case 'charge': break; // Wind-up, movement and contact run on the body clock.
      case 'attack': case 'dead': case 'hide': case 'perch': case 'rise': case 'sidestep': break;
      // no default
    }
    // keep every animal inside the chunk / off steep ground / out of trunks
    this.confine(a);
    if (herd !== null) this.updateHerd(herd);
  }

  /** The body clock of a running charge: the melee wind-up, the steering (straight in the committed stretch), contact or timeout. */
  advanceCharge(a: A, dt: number, player: Vector3): void {
    const br = this.memories.get(a); if (!br) return;
    const sp = this.species(a.kind), M = a.mods, T = this.tuningFor(a);
    const dx = player.x - a.position.x, dz = player.z - a.position.z, dPlayer = Math.hypot(dx, dz);
    if (br.windup > 0) {
      // melee shard: the telegraph — stand, face the player, head down, paw (Animal.poseWindup); then run
      br.windup -= dt;
      a.setMotion(Math.atan2(dx, dz), 0, 3.0);
      a.lookTarget.copy(player); a.lookWeight = 1;
      if (br.windup <= 0) { br.windup = 0; a.cancelAttack(); }
      return;
    }
    br.timer -= dt;
    // melee shards: the last CHARGE_COMMIT m are committed (it can barely turn) — a late sidestep makes it thunder past
    if (this.melee && dPlayer < CHARGE_COMMIT) this.steer(a, Math.atan2(dx, dz), (sp.chargeSpeed ?? BOAR_CHARGE) * M.speed, CHARGE_COMMIT_TURN); // the committed stretch: straight
    else this.steerTo(a, br, player.x, player.z, (sp.chargeSpeed ?? BOAR_CHARGE) * M.speed, 4.0, 0.3);
    a.lookTarget.copy(player); a.lookWeight = 0.5;
    const after: AnimalState = T.stalk !== undefined ? 'stalk' : 'flee';   // a hunter keeps pressing; a boar wheels away
    if (dPlayer < CHARGE_COMMIT) br.committed = true;
    // E297: a charge you sidestepped thunders past and is over — it backs off and comes round again, not a U-turn into you
    const passed = this.rules !== null && br.committed && dPlayer > CHARGE_COMMIT && !this.facing(a, player, CHARGE_ARC);
    if (!this.melee && dPlayer < CHARGE_HIT_DIST * Math.max(1, a.scale) && this.ports.reach(a, player)) this.chargeHit(a, br);   // melee shards connect per frame on an arc (chargeContact)
    else if (br.timer <= 0 || passed) {
      br.chargeCd = this.rules !== null ? RULES_CD_MISS : T.stalk !== undefined ? T.stalk.rechargeCd : M.relentless ? 1.5 : 4;
      this.enter(a, br, after);
    }
    this.confine(a);
  }

  /** a charge reached the player: the damage, the grunt, the cooldown, and back to stalk (hunters) / flee (a boar wheels away) */
  private chargeHit(a: A, br: HuntMemory): void {
    const T = this.tuningFor(a), sp = this.species(a.kind);
    this.ports.charge(a, a.mods.chargeDamage);
    this.ports.sound(sp.sounds?.call ?? fallbackSound(true, 'call'), a);
    br.chargeCd = this.rules !== null ? Math.max(RULES_CD_HIT, T.stalk?.rechargeCd ?? 0) : T.stalk !== undefined ? T.stalk.rechargeCd : a.mods.relentless ? 2 : 6;   // Old Ironhide wheels round and comes again
    this.enter(a, br, T.stalk !== undefined ? 'stalk' : 'flee');
  }

  /** melee shards, every frame: a running charge connects when it reaches the player AND the player is inside CHARGE_ARC of its heading */
  chargeContact(a: A, player: Vector3): void {
    const br = this.memories.get(a);
    if (br === undefined || br.windup > 0) return;
    const dx = player.x - a.position.x, dz = player.z - a.position.z;
    const reach = CHARGE_HIT_DIST * Math.max(1, a.scale);
    if (dx * dx + dz * dz > reach * reach || Math.abs(player.y - a.position.y) > 2.5) return;
    if (!this.facing(a, player, CHARGE_ARC)) return; // it runs past a player who stepped aside
    if (!this.ports.reach(a, player)) return;        // nor through a wall, a rock or a deck (E296)
    this.chargeHit(a, br);
  }

  /** E297: the ring a charger circles on (m from the player): RING by kind, a little wider for a big one */
  private ringFor(a: A): number { return (this.species(a.kind).ringRadius ?? RING_DEFAULT) * Math.max(1, a.scale * 0.6); }

  /** E297: back off past the ring (fightRules.backoffPoint), arcing round you — the other way from last time */
  private startBackoff(a: A, br: HuntMemory): void {
    br.side = -br.side;
    backoffPoint(this.player.x, this.player.z, a.position.x, a.position.z, this.ringFor(a), br.side, _ring);
    br.tx = _ring.x; br.tz = _ring.z; br.backoff = BACKOFF_MAX_T;
  }

  /**
   * E297 fight rules, the engaged charger's think (its 'stalk'): the back-off after a charge, then round and round on the
   * ring facing you until `reengage` says charge — it turns square to you first, then winds up (enter 'charge' takes the
   * token; none free → it keeps circling). Closer than the ring it steps back out; further, it closes at `speed`.
   * True when it charged (left the stalk).
   */
  private circle(a: A, br: HuntMemory, player: Vector3, d: number, speed: number, dt: number): boolean {
    a.lookTarget.copy(player);
    if (br.backoff > 0) {
      br.backoff -= dt;
      if (br.backoff > 0 && Math.hypot(br.tx - a.position.x, br.tz - a.position.z) > 1.2) {
        this.steerTo(a, br, br.tx, br.tz, BACKOFF_SPEED * a.mods.speed, 4.5, 0.5);
        a.lookWeight = 0.5;
        return false;
      }
      br.backoff = 0;
    }
    a.lookWeight = 1;
    const T = this.tuningFor(a), ring = this.ringFor(a);
    const next = reengage({ hpFrac: a.hp / a.maxHp, relentless: a.mods.relentless, roll: 1, ready: br.chargeCd <= 0, token: this.tokens.free(a), dist: d, chargeDist: Math.max(T.panicDist * a.mods.chargeDist, ring + 2), hit: false });
    const toPlayer = Math.atan2(player.x - a.position.x, player.z - a.position.z);
    if (next === 'charge') {
      if (this.facing(a, player, FACE_BEFORE_CHARGE)) { this.enter(a, br, 'charge'); return a.state === 'charge'; }
      a.setMotion(toPlayer, 0, 4.0); // square up to you first: the wind-up reads as aimed at you
      return false;
    }
    if (d > ring + 2) this.steerTo(a, br, player.x, player.z, speed, 3.0, 0.4);
    else if (d < ring - 2) { aroundPoint(player.x, player.z, a.position.x, a.position.z, ring, br.side * 0.5, _ring); this.steerTo(a, br, _ring.x, _ring.z, speed, 3.5, 0.3); }
    else {
      // on the ring: walk round you (a step ahead along the ring), head turned to you
      aroundPoint(player.x, player.z, a.position.x, a.position.z, ring, br.side * 0.45, _ring);
      this.steerTo(a, br, _ring.x, _ring.z, CIRCLE_SPEED * a.mods.speed, 3.0, 0.3);
    }
    return false;
  }

  /** the player is within ±`arc` of the animal's heading */
  facing(a: A, player: Vector3, arc: number): boolean {
    let rel = Math.atan2(player.x - a.position.x, player.z - a.position.z) - a.yaw;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    return Math.abs(rel) <= arc;
  }

  private enter(a: A, br: HuntMemory, s: AnimalState): void {
    const rng = this.rng, g = this.ground;
    const T = this.tuningFor(a);
    const sp = this.species(a.kind);
    const from = a.state;
    if (this.rules !== null) {
      if (s === 'charge' && !this.tokens.take(a)) {
        // E297: two others are attacking — it holds back on the ring (a charger without a stalk holds its alert)
        if (T.stalk !== undefined) { if (from !== 'stalk') this.enter(a, br, 'stalk'); }
        else if (from !== 'alert') this.enter(a, br, 'alert');
        return;
      }
      if (from === 'charge' && s !== 'charge') {
        this.tokens.release(a);
        br.windup = 0; br.committed = false;
        if (s === 'stalk') this.startBackoff(a, br);   // after every charge: back off past the ring, then come round again
      }
    }
    a.state = s;
    switch (s) {
      case 'idle': br.timer = rng.range(3, 7); a.setMotion(a.desiredYaw, 0, 1.5); break;
      case 'graze': br.timer = rng.range(6, 14); a.setMotion(a.desiredYaw, 0, 1.5); break;
      case 'wander': {
        const herd = a.herd >= 0 ? this.herds[a.herd] ?? null : null;
        let ok = false;
        const nav = this.ports.nav();
        const goal = this.ports.wanderGoal(a);
        if (goal !== null && nav !== null) {
          const t = nav.randomPointNear(_navFrom.set(goal.x, g.heightAt(goal.x, goal.z), goal.z), goal.r, this.agentRadius(a), () => rng.next(), _navTo);
          if (t !== null && g.inChunk(t.x, t.z, 20)) { br.tx = t.x; br.tz = t.z; ok = true; }
        }
        if (nav !== null && !ok) {
          // a reachable point 5–25 m away on the navmesh; a straggler > 15 m from its herd wanders back toward the centre
          const far = herd !== null && Math.hypot(a.position.x - herd.cx, a.position.z - herd.cz) > 15;
          const origin = herd !== null && far ? _navFrom.set(herd.cx, g.heightAt(herd.cx, herd.cz), herd.cz) : a.position;
          const t = nav.randomPointNear(origin, far ? 10 : rng.range(5, 25), this.agentRadius(a), () => rng.next(), _navTo);
          if (t !== null && g.inChunk(t.x, t.z, 20)) { br.tx = t.x; br.tz = t.z; ok = true; }
        }
        for (let i = 0; i < 12 && !ok; i++) {
          const ang = rng.range(0, Math.PI * 2), r = rng.range(5, 25);
          let tx = a.position.x + Math.cos(ang) * r, tz = a.position.z + Math.sin(ang) * r;
          if (herd !== null) { // stay within ~15 m of the herd centre
            const hx = tx - herd.cx, hz = tz - herd.cz, hd = Math.hypot(hx, hz);
            if (hd > 15) { tx = herd.cx + hx / hd * 14; tz = herd.cz + hz / hd * 14; }
          }
          if (!g.inChunk(tx, tz, 20) || g.normalY(tx, tz) < 0.78 || g.cabinMask(tx, tz) > 0 || !this.isDry(tx, tz)) continue;
          if (g.trees(tx, tz, 1.0).length > 0) continue;
          br.tx = tx; br.tz = tz; ok = true;
        }
        if (!ok) { a.state = 'idle'; br.timer = 2; break; }
        br.timer = rng.range(8, 20) + (goal !== null ? Math.hypot(br.tx - a.position.x, br.tz - a.position.z) : 0); // a goal: time to walk there
        break;
      }
      case 'alert':
        br.freeze = rng.range(T.freezeMin, T.freezeMax); br.timer = T.relaxAfter;
        a.setMotion(a.desiredYaw, 0, 2);
        if (a.aggressive && rng.next() < 0.5) this.ports.sound(sp.sounds?.call ?? fallbackSound(true, 'call'), a);
        // one head coming up makes the herd glance (awareness nudge) — only a BOLT brings every head up (alertHerd)
        if (from !== 'flee' && from !== 'alert') this.alertHerd(a, false);
        break;
      case 'flee':
        br.fleeT = 0; br.fleeUntil = rng.range(T.fleeUntil, T.fleeUntilMax);
        br.wary = T.waryTime; br.awareness = 1; br.spooked = false;
        if (!a.aggressive && rng.next() < 0.3) this.ports.sound(sp.sounds?.call ?? fallbackSound(false, 'call'), a);
        if (from !== 'charge') this.alertHerd(a, true);
        break;
      case 'stalk':
        br.timer = 0.4; br.wary = T.waryTime; br.awareness = 1; br.spooked = false;
        break;
      case 'charge':
        br.timer = a.mods.relentless ? 12 : 4; br.wary = T.waryTime; br.committed = false; br.backoff = 0;
        // melee shard: the charge opens with a readable wind-up (the roar below is its cue)
        br.windup = this.melee ? sp.chargeWindup ?? CHARGE_WINDUP_DEFAULT : 0;
        if (br.windup > 0) { a.startAttack(br.windup); a.setMotion(a.yaw, 0, 3); }
        this.ports.sound(T.stalk?.roar ?? sp.sounds?.call ?? fallbackSound(true, 'call'), a);
        break;
      case 'attack': case 'dead': case 'hide': case 'perch': case 'rise': case 'sidestep': break;
      // no default
    }
  }

  /**
   * Herd-mates within herdAlertRadius: `bolt` = one of them is running, so they all come up alert and run too a beat
   * later; otherwise (a head came up) they only get a nudge of awareness — a sentry freezing must not empty the
   * clearing, or there is never a shot.
   */
  private alertHerd(a: A, bolt: boolean): void {
    if (a.herd < 0) return;
    const herd = this.herds[a.herd];
    if (herd === undefined) return;
    const T = this.tuningFor(a);
    const r2 = T.herdAlertRadius * T.herdAlertRadius;
    for (const m of herd.members) {
      if (m === a || !m.alive) continue;
      if (m.position.distanceToSquared(a.position) > r2) continue;
      const mb = this.memories.get(m);
      if (mb === undefined) continue;
      if (m.state === 'flee' || m.state === 'charge' || m.state === 'stalk') continue;
      if (!bolt) { mb.awareness = Math.min(T.alertAt * 0.7, mb.awareness + 0.12); continue; }
      if (m.state !== 'alert') { mb.awareness = Math.max(mb.awareness, T.alertAt); this.enter(m, mb, 'alert'); }
      mb.spooked = true; mb.freeze = Math.min(mb.freeze, this.rng.range(T.herdBoltDelayMin, T.herdBoltDelayMax));
    }
  }

  /**
   * Something loud landed at `point` (a bolt in a tree or the dirt): animals within impactSpook m bolt after a
   * short start, within impactAlert m their heads come up. `strength` scales both radii (1 = a bolt).
   */
  disturb(animals: readonly A[], point: Vector3, strength: number): void {
    if (this.ports.unaware()) return;
    for (const a of animals) {
      if (!a.alive) continue;
      const T = this.tuningFor(a);
      const d = Math.hypot(point.x - a.position.x, point.z - a.position.z);
      if (d > T.impactAlert * strength) continue;
      const br = this.memories.get(a);
      if (br === undefined) continue;
      if (a.state === 'flee' || a.state === 'charge' || a.state === 'stalk') continue;
      if (a.state !== 'alert') { br.awareness = Math.max(br.awareness, T.alertAt); this.enter(a, br, 'alert'); }
      if (d < T.impactSpook * strength) { br.spooked = true; br.freeze = Math.min(br.freeze, 0.25); }
      else br.awareness = Math.min(1, br.awareness + 0.3);
    }
  }

  /** a hit killed it: its timer stops */
  died(a: A): void { const br = this.memories.get(a); if (br !== undefined) br.timer = 0; }

  /** A hit that did not kill (not a self-thinking species): a wounded animal bolts at once; chargers may turn on you; hunters come for you. */
  hurt(a: A): void {
    const br = this.memories.get(a);
    if (br === undefined || a.state === 'charge' || a.scripted) return;
    // a wounded animal bolts at once — no freeze; a boar this close turns on you instead
    const T = this.tuningFor(a);
    br.wary = T.waryTime;
    const M = a.mods;
    if (T.stalk !== undefined) {
      // a hunter never runs from a hit — it comes for you from wherever it is (the charge times out into a stalk);
      // only a nearly dead, non-relentless one (a black bear under 20 %) may break off
      if (this.rules !== null) {
        // E297: the same decision every charger makes (fightRules.reengage) — break off only nearly dead; else it
        // charges when it can, and one you hit at arm's length first backs off to charge distance
        const d = Math.hypot(this.player.x - a.position.x, this.player.z - a.position.z);
        const next = reengage({ hpFrac: a.hp / a.maxHp, relentless: M.relentless, roll: this.rng.next(), ready: true, token: this.tokens.free(a), dist: d, chargeDist: T.panicDist * M.chargeDist, hit: true });
        if (next === 'flee') { br.spooked = true; this.enter(a, br, 'flee'); }
        else if (next === 'charge' && d > this.ringFor(a) * 0.6) { br.chargeCd = 0; this.enter(a, br, 'charge'); }
        else { if (a.state !== 'stalk') this.enter(a, br, 'stalk'); br.chargeCd = Math.min(br.chargeCd, 0.5); if (d < this.ringFor(a) * 0.6) this.startBackoff(a, br); }
      }
      else if (!M.relentless && a.hp / a.maxHp < T.stalk.fleeBelowHp && this.rng.next() < T.stalk.fleeChance) { br.spooked = true; this.enter(a, br, 'flee'); }
      else { br.chargeCd = 0; this.enter(a, br, 'charge'); }
    } else if (a.aggressive && this.player.distanceTo(a.position) < CHARGE_WHEN_HIT_DIST * M.chargeDist && (br.chargeCd <= 0 || M.relentless) && (M.relentless || this.rng.next() < 0.7)) this.enter(a, br, 'charge');
    else { br.spooked = true; this.enter(a, br, 'flee'); }
  }

  /**
   * A blow that lands on a RUNNING charge breaks it — the animal stops dead (the stun), comes up alert glaring, and
   * either resumes the charge as soon as the stun lifts (a light swing) or, off a heavy, wheels away and comes again.
   * A blow during the melee wind-up interrupts the charge. A blow on a standing animal only delays what `hurt` decided.
   */
  staggered(a: A, strength: number, running: boolean): void {
    const br = this.memories.get(a);
    if (br === undefined || a.state !== 'charge') return;
    const T = this.tuningFor(a);
    if (br.windup > 0) {
      // a blow during the wind-up interrupts the charge (melee shards): glare, then come again once the cooldown lets it
      br.windup = 0; br.chargeCd = 1.0 + strength;
      this.enter(a, br, T.stalk !== undefined ? 'stalk' : 'alert');
      br.freeze = 0.4 + strength * 0.6;
      return;
    }
    if (!running) return;
    br.chargeCd = strength >= 0.75 ? (T.stalk !== undefined ? T.stalk.rechargeCd : 1.4) : 0.3;
    this.enter(a, br, T.stalk !== undefined ? 'stalk' : 'alert');
    br.freeze = 0.3 + strength * 0.8;
  }

  // ── steering ───────────────────────────────────────────────────────────────────────────

  /** the creature's navmesh layer radius — the same size as its physics body (src/shared/engine/physics/creatures.ts) */
  agentRadius(a: A): number {
    return MathUtils.clamp(Math.min(a.dims.bodyRadius, a.dims.bodyHalfLen) * a.scale, 0.12, 0.9);
  }

  /**
   * Head for (tx, tz) along the navmesh (PHYSICS P6b): re-path when the goal moved > 2 m or every `every` s, follow the
   * path's corners, and let the physics body resolve the last metre. Without a navmesh: the straight heading through
   * `steer`'s trunk / slope / edge bending.
   */
  private steerTo(a: A, br: HuntMemory, tx: number, tz: number, speed: number, turnRate: number, every: number): void {
    if (this.ports.nav() === null) { this.steer(a, Math.atan2(tx - a.position.x, tz - a.position.z), speed, turnRate); return; }
    a.setMotion(this.pathYaw(a, br, tx, tz, every), speed, turnRate);
  }

  /** `pathYaw` for any animal: the straight heading for one without a memory (a self-thinking species never adopted) */
  pathYawFor(a: A, tx: number, tz: number, every: number): number {
    const br = this.memories.get(a);
    return br === undefined ? Math.atan2(tx - a.position.x, tz - a.position.z) : this.pathYaw(a, br, tx, tz, every);
  }

  /**
   * The heading toward (tx, tz) along the navmesh: the next corner of the path there (re-planned when the goal moved
   * > 2 m or every `every` s — at most 8 plans a think tick), the straight heading without a navmesh or a path.
   */
  private pathYaw(a: A, br: HuntMemory, tx: number, tz: number, every: number): number {
    const nav = this.ports.nav();
    if (nav === null) return Math.atan2(tx - a.position.x, tz - a.position.z);
    const now = this.clock;
    const stale = br.path.length === 0 || Math.hypot(tx - br.goalX, tz - br.goalZ) > 2 || now >= br.repathAt;
    if (stale && this.repaths < 8) {
      this.repaths++;
      _navTo.set(tx, this.ground.heightAt(tx, tz), tz);
      const p = nav.findPath(a.position, _navTo, this.agentRadius(a), br.path);
      if (p === null) br.path.length = 0;
      br.pathI = 0; br.goalX = tx; br.goalZ = tz; br.repathAt = now + every;
    }
    while (br.pathI < br.path.length) {
      const c = br.path[br.pathI];
      if (c === undefined || Math.hypot(c.x - a.position.x, c.z - a.position.z) > 0.8) break;
      br.pathI++;
    }
    const c = br.path[br.pathI];
    const aimX = c === undefined ? tx : c.x, aimZ = c === undefined ? tz : c.z;
    return Math.atan2(aimX - a.position.x, aimZ - a.position.z);
  }

  /** the self-thinking species' steering: by the navmesh when the shard asks (`navSteer`), else `steer` */
  steerAny(a: A, yaw: number, speed: number, turnRate: number): void {
    if (this.navSteer) this.steerNav(a, yaw, speed, turnRate); else this.steer(a, yaw, speed, turnRate);
  }

  /**
   * By the navmesh: the heading is kept while the navmesh is clear `look` m along it; blocked (a yurt, a fence, a
   * boulder, the river, ground past 40°) it turns to the nearest clear bearing, toward the side the wall's normal opens
   * on. Off the mesh it falls back to `steer`.
   */
  private steerNav(a: A, yaw: number, speed: number, turnRate: number): void {
    const nav = this.ports.nav();
    if (nav === null || speed <= 0.05) { this.steer(a, yaw, speed, turnRate); return; }
    const r = this.agentRadius(a), look = Math.max(3, 1.5 + speed * 0.7);
    const ahead = nav.clearAhead(a.position, yaw, look, r);
    if (ahead === null) { this.steer(a, yaw, speed, turnRate); return; }
    if (ahead.clear >= 1) { a.setMotion(yaw, speed, turnRate); return; }
    // blocked: the side the wall opens toward first, then alternate, widening
    const side = Math.sin(yaw) * ahead.normalZ - Math.cos(yaw) * ahead.normalX >= 0 ? 1 : -1;
    let best = yaw, bestClear = ahead.clear;
    for (const step of NAV_FAN) {
      for (const s of [side, -side]) {
        const y = yaw + s * step, c = nav.clearAhead(a.position, y, look, r);
        if (c === null) continue;
        if (c.clear >= 1) { a.setMotion(y, speed, turnRate); return; }
        if (c.clear > bestClear + 0.05) { bestClear = c.clear; best = y; }
      }
    }
    a.setMotion(best, bestClear * look < 0.6 ? speed * 0.3 : speed, turnRate);
  }

  /** desired heading with trunk repulsion, slope + edge avoidance — the no-navmesh fallback of `steerTo` */
  steer(a: A, yaw: number, speed: number, turnRate: number): void {
    const g = this.ground;
    let vx = Math.sin(yaw), vz = Math.cos(yaw);
    const px = a.position.x, pz = a.position.z;
    const look = 1.5 + speed * 0.45;
    for (const tr of g.trees(px + vx * look * 0.5, pz + vz * look * 0.5, look)) {
      const ox = px - tr.x, oz = pz - tr.z;
      const d = Math.hypot(ox, oz) + 1e-3;
      const range = tr.r + look;
      if (d < range) { const f = (1 - d / range) * 1.6; vx += ox / d * f; vz += oz / d * f; }
    }
    // steep ground ahead / chunk edge: bend toward the chunk centre
    const ax = px + vx * look, az = pz + vz * look;
    // A structures-only world has no analytic navigation surface. Keep the requested steering; WORLD collision
    // and the body's floor sampler own support. A brain wanting ledge avoidance can probe floorBelow explicitly.
    if (g.terrain() && (!g.inChunk(ax, az, 22) || g.normalY(ax, az) < 0.75 || !this.isDry(ax, az))) {
      const cd = Math.hypot(px, pz) + 1e-3;
      vx += -px / cd * 1.5; vz += -pz / cd * 1.5;
      // and try the perpendiculars
      const sx = -vz, sz = vx;
      const lOk = g.inChunk(px + sx * look, pz + sz * look, 22) && g.normalY(px + sx * look, pz + sz * look) >= 0.75 && this.isDry(px + sx * look, pz + sz * look);
      if (lOk) { vx += sx; vz += sz; } else { vx -= sx; vz -= sz; }
    }
    a.setMotion(Math.atan2(vx, vz), speed, turnRate);
  }

  /** keep an animal out of the water, inside the chunk and out of the trunks */
  confine(a: A): void {
    const p = a.position;
    if (!this.isDry(p.x, p.z)) {
      // stepped into the pond: back up toward the last dry heading
      p.x -= Math.sin(a.yaw); p.z -= Math.cos(a.yaw);
      a.desiredYaw = a.yaw + Math.PI * 0.75;
    }
    const lim = this.ground.chunkHalf - 4; // hard clamp; steering keeps AI animals ≥ 20 m from the edge
    if (Math.abs(p.x) > lim) p.x = Math.sign(p.x) * lim;
    if (Math.abs(p.z) > lim) p.z = Math.sign(p.z) * lim;
    for (const tr of this.ground.trees(p.x, p.z, 0.6)) {
      const ox = p.x - tr.x, oz = p.z - tr.z;
      const d = Math.hypot(ox, oz), min = tr.r + 0.45;
      if (d < min && d > 1e-4) { p.x = tr.x + ox / d * min; p.z = tr.z + oz / d * min; }
    }
  }

  /** the herd's centre eases toward its living members' mean */
  updateHerd(h: HuntHerd<A>): void {
    let x = 0, z = 0, n = 0;
    for (const m of h.members) if (m.alive) { x += m.position.x; z += m.position.z; n++; }
    if (n > 0) { h.cx += (x / n - h.cx) * 0.2; h.cz += (z / n - h.cz) * 0.2; }
  }
}
