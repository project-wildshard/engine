import * as v from 'valibot';
import { Vector3, MathUtils } from 'three';
import type { AnimalSim } from '../entities/AnimalSim';
import { HuntingStalkerCore, type HuntConfig, type HuntPorts } from './huntPattern';
import type { AggressionDirector } from './director';
import type { Rng } from '../core/rng';
import { emitFault } from '../core/faults';
import type { SimValue } from '../../../server/engine/sim';
import { isJsonData } from '@wildshard/format/json';
import type { Scope } from '../app/scope';
import type { GroupGuestBindingsV2, GroupGuestFrameV2, GroupGuestProjectionV2, GroupGuestPublicationV2 } from './GroupBrain';
import { GroupBankV2 } from '../script/groupBankV2';
import type { GroupStepNativeResultV2, GroupStepReferenceV2 } from '../script/groupStepV2';
import type { V2ColumnOwners } from '../script/observationColumnsV2';
import type { GroupBankValueV2 } from '@wildshard/format/scriptGroupBankV2';
import { GroupGuestBindingSchema, type GroupGuestBindingRows } from '@wildshard/format/groupBrains';


const packGuestReset=Object.freeze({pc:0,ret:0,try:0,candX:0,candZ:0,hit:0,spotX:0,spotZ:0,claim:0});
const packGuestResetFields=Object.freeze(Object.keys(packGuestReset));
interface PackMemberColumns<A extends AnimalSim> {
  readonly scope:Scope;
  readonly self:{readonly group:string;readonly slot:number;identity:string;actor:A|null};
  player:V2ColumnOwners<A>['player'];observed:V2ColumnOwners<A>['observed'];
  t:number;dt:number;context:NonNullable<V2ColumnOwners<A>['context']>;
  environment:NonNullable<V2ColumnOwners<A>['environment']>;references:NonNullable<V2ColumnOwners<A>['references']>;
  results:NonNullable<V2ColumnOwners<A>['results']>;
}

const packEmptyPlayer=Object.freeze({position:Object.freeze({x:0,z:0})});
const packEmptyObserved:ReadonlyMap<number,AnimalSim>=new Map();
const packEmptyReferences:NonNullable<V2ColumnOwners['references']>=new Map();
const packEmptyContext=Object.freeze({calm:true,playerSpeed:0}),packEmptyResults=Object.freeze({});
const packEmptyEnvironment:NonNullable<V2ColumnOwners['environment']>=Object.freeze({
  playerCrouched:false,playerFwdX:0,playerFwdZ:0,playerMounted:false,playerHealth01:0,light:0,storm:false,
  wind:Object.freeze({x:0,z:0,strength:0}),grassHeightAt:()=>{throw new Error('Inactive pack observation');},
});
function releasePackMembers<A extends AnimalSim>(members:readonly PackMemberColumns<A>[]):void{
  for(let index=0;index<members.length;index++){
    const member=members[index];if(member===undefined)continue;
    member.self.actor=null;member.self.identity='';member.player=packEmptyPlayer;member.observed=packEmptyObserved;
    member.context=packEmptyContext;member.environment=packEmptyEnvironment;member.references=packEmptyReferences;member.results=packEmptyResults;
  }
}

/** The real pack controller is owned and snapshotted by its group host, not copied into the elite. */
export type HowlerPack<A extends AnimalSim> = Pick<StalkerBrain<A>, 'homeX' | 'homeZ' | 'phase' | 'awareness' | 'scare'>;
/** Native pack, shared AI stream, path and environment authority; presentation only answers named events. */
export interface HowlerPorts<A extends AnimalSim> {
  readonly player: { readonly position: Vector3 }; readonly lair: { readonly x: number; readonly z: number };
  readonly phase2: () => boolean; readonly pack: () => HowlerPack<A> | null;
  readonly environment: () => { readonly playerCrouched: boolean; readonly playerFwdX: number; readonly playerFwdZ: number; readonly grassHeightAt: (x: number, z: number) => number };
  readonly random: () => number;
  readonly rings: { readonly setTime: (t: number) => void; readonly ring: (x: number, z: number, r: number, strength: number) => void; readonly hide: () => void };
  readonly hurt: (a: A, amount: number) => void;
  readonly regrouped: () => void; readonly interrupted: () => void; readonly closed: () => void;
  readonly howl: (at: Vector3) => void; readonly signature: () => void;
}
const howlerScalar = v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(600));
const howlerPositive = v.pipe(howlerScalar, v.minValue(Number.MIN_VALUE));
const speedValue = v.pipe(howlerScalar, v.maxValue(40)), turn = v.pipe(howlerScalar, v.maxValue(30));
const fraction = v.pipe(howlerScalar, v.maxValue(1));
const howlerField = v.pipe(v.string(), v.regex(/^[a-z][a-z0-9._:-]{0,127}$/u));
const HowlerSpecSchema: v.GenericSchema<BoundedHowlerSpecInput, BoundedHowlerSpec> = v.pipe(v.strictObject({
  initialHowl: howlerScalar, engagedHowl: howlerScalar, phaseCooldown: howlerScalar, interruptedHowl: howlerScalar,
  nextHowl: howlerScalar, randomHowl: howlerScalar, pathSeconds: howlerPositive, pathNear: howlerScalar, homePathSeconds: howlerPositive,
  homeStop: howlerPositive, homeReset: howlerPositive, meleeRadius: howlerPositive, grassHeight: howlerScalar, hiddenDamage: howlerScalar,
  fields: v.strictObject({ howl: howlerField, low: howlerField, snarl: howlerField }),
  speeds: v.strictObject({ home: speedValue, watched: speedValue, hold: speedValue, hunt: speedValue, bite: speedValue }),
  turns: v.strictObject({ home: turn, den: turn, hold: turn, howl: turn, hunt: turn, bite: turn }),
  hold: v.strictObject({ watchedDot: fraction, minRadius: howlerPositive, maxRadius: howlerPositive, sidestep: howlerScalar, arrival: howlerPositive, watchedLow: fraction, low: fraction }),
  hunt: v.strictObject({ snarlDistance: howlerScalar, attackDistance: howlerPositive, moveDistance: howlerScalar }),
  bite: v.strictObject({ seconds: howlerPositive, phase: fraction, range: howlerPositive, damage: howlerScalar, cooldown: howlerScalar }),
  howl: v.strictObject({ growSeconds: howlerPositive, seconds: howlerPositive, radius: howlerScalar, speed: howlerPositive, span: howlerPositive, strength: howlerScalar, stagger: howlerScalar, scare: howlerScalar }),
}), v.check(s => s.hold.minRadius <= s.hold.maxRadius && new Set(Object.values(s.fields)).size === 3,
  'Ordered hold radii and distinct pose fields'));
/** Strict declared pack-leader circling, howl and melee tuning. */
export type HowlerSpec = v.InferOutput<typeof HowlerSpecSchema>;
/** Validate and copy all tuning before a body or shared pack can be mutated. */
export function readHowlerSpec(value: unknown): HowlerSpec { return v.parse(HowlerSpecSchema, value); }

const howlerFinite = v.pipe(v.number(), v.finite());
const HowlerSaved: v.GenericSchema<BoundedHowlerSaveInput, BoundedHowlerSave> = v.strictObject({ st: v.picklist(['den', 'hold', 'howl', 'hunt', 'home']), howlT: howlerFinite, stT: howlerFinite,
  howlHit: v.union([howlerFinite, v.literal(-Infinity)]), cd: howlerFinite, bit: v.boolean() });

/** One solid ledge observed by the native world; at most six are admitted per pouncer. */
export interface PouncerLedge { readonly x: number; readonly y: number; readonly z: number; readonly r: number }
/** The decision cadence and authoritative path query, separate from the fixed frame clock. */
export interface PouncerContext<A> { readonly dt: number; readonly player: Vector3; readonly pathYaw: (a: A, x: number, z: number, every: number) => number }
/** Explicit runtime/environment authority and presentation events; the controller never imports a world or view. */
export interface PouncerPorts<A> {
  readonly player: { readonly position: Vector3 }; readonly lair: { readonly x: number; readonly z: number };
  readonly ledges: readonly PouncerLedge[]; readonly heightAt: (x: number, z: number) => number; readonly phase2: () => boolean; readonly awareRadius: number;
  readonly isHead: (a: A, point: Vector3) => boolean;
  readonly ring: { readonly setTime: (t: number) => void; readonly ring: (x: number, z: number, radius: number, strength: number) => void; readonly hide: () => void };
  readonly hurt: (a: A, amount: number) => void; readonly knock: (dx: number, dz: number) => void;
  readonly opened: () => void; readonly growl: (at: Vector3) => void; readonly signature: () => void;
}
const pouncerScalar = v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(600));
const pouncerPositive = v.pipe(pouncerScalar, v.minValue(Number.MIN_VALUE));
const pouncerField = v.pipe(v.string(), v.regex(/^[a-z][a-z0-9._:-]{0,127}$/u));
const PouncerSpecSchema: v.GenericSchema<BoundedPouncerSpecInput, BoundedPouncerSpec> = v.pipe(v.strictObject({
  initialCooldown: pouncerScalar, awareCooldown: pouncerScalar, lookIdle: pouncerScalar, homeRadius: pouncerPositive, pathSeconds: pouncerPositive,
  ledgeMargin: pouncerScalar, standRate: pouncerPositive, openSeconds: pouncerPositive, openCooldown: pouncerScalar,
  fields: v.strictObject({ low: pouncerField, leap: pouncerField, snarl: pouncerField }),
  pose: v.strictObject({ stalk: pouncerScalar, perch: pouncerScalar, open: pouncerScalar, leapSwing: pouncerScalar, leapBase: pouncerScalar }),
  speeds: v.strictObject({ home: pouncerScalar, perch: pouncerScalar, stalk: pouncerScalar, back: v.pipe(v.number(), v.finite(), v.minValue(-15), v.maxValue(0)) }),
  turns: v.strictObject({ home: pouncerScalar, idle: pouncerScalar, swipeStart: pouncerScalar, perch: pouncerScalar, stalk: pouncerScalar, tell: pouncerScalar, open: pouncerScalar, swipe: pouncerScalar }),
  stalk: v.strictObject({ far: pouncerPositive, near: pouncerPositive }),
  perch: v.strictObject({ minHeight: pouncerScalar, maxHeight: pouncerScalar, minDistance: pouncerScalar, maxDistance: pouncerScalar, arrival: pouncerPositive,
    retreatHeight: pouncerScalar, retreatDistance: pouncerPositive, cooldown: pouncerScalar, waitSeconds: pouncerScalar }),
  damage: v.strictObject({ airborne: pouncerScalar, openHead: pouncerScalar, perched: pouncerScalar }),
  swipe: v.strictObject({ from: pouncerPositive, seconds: pouncerPositive, first: pouncerScalar, second: pouncerScalar, range: pouncerPositive, damage: pouncerScalar, cooldown: pouncerScalar }),
  pounce: v.strictObject({ minDistance: pouncerScalar, maxDistance: pouncerScalar, seconds: pouncerPositive, arcHeight: pouncerScalar, range: pouncerPositive, damage: pouncerScalar, cooldown: pouncerScalar }),
  tell: v.strictObject({ radius: pouncerPositive, strength: pouncerScalar, growth: pouncerScalar, growSeconds: pouncerPositive, seconds: pouncerPositive }),
}), v.check(s => s.stalk.near <= s.stalk.far && s.perch.minHeight <= s.perch.maxHeight
  && s.perch.minDistance <= s.perch.maxDistance && s.pounce.minDistance <= s.pounce.maxDistance
  && s.swipe.first < s.swipe.second && s.swipe.second <= 1 && new Set(Object.values(s.fields)).size === 3,
  'Ordered pounce ranges, strike fractions and distinct pose fields'));
/** Finite, strictly admitted pounce/swipe/ledge tuning; views and collision authority are supplied separately. */
export type PouncerSpec = v.InferOutput<typeof PouncerSpecSchema>;
/** Copy and validate all tuning before a controller, native body or callback can be mutated. */
export function readPouncerSpec(value: unknown): PouncerSpec { return v.parse(PouncerSpecSchema, value); }

const pouncerFinite = v.pipe(v.number(), v.finite()), pouncerTriple = v.tuple([pouncerFinite, pouncerFinite, pouncerFinite]);
const PouncerSaved: v.GenericSchema<BoundedPouncerSaveInput, BoundedPouncerSave> = v.strictObject({ st: v.picklist(['lurk', 'stalk', 'tell', 'leap', 'open', 'swipe', 'perch', 'home']), stT: pouncerFinite, cd: pouncerFinite,
  from: pouncerTriple, to: pouncerTriple, goal: v.nullable(v.strictObject({ x: pouncerFinite, z: pouncerFinite, y: pouncerFinite })), hitDone: v.picklist([0, 1, 2]) });

/** Parameters for a circling melee archetype with idle wandering and subordinate scattering. */
export interface SkirmisherSpec {
  awareRadius: number; shyRadius: number; disengageRadius: number; holdRadius: number; attackRadius: number;
  attackDuration: number; attackCooldown: number; alertCooldown: number; fleeSpeed: number;
  subordinateVariant: string; leaderVariant: string; noticeCue: string;
}
/** Host-owned perception, navigation and attack-token authority; no rendering or application singleton. */
export interface SkirmisherPorts<A extends AnimalSim> {
  dt: number; player: { x: number; y: number; z: number }; calm: boolean;
  rng: Pick<Rng, 'next' | 'range'>;
  herd: readonly { variant: string; alive: boolean }[] | null;
  sound: (cue: string) => void;
  steer: (actor: A, yaw: number, speed: number, turnRate: number) => void;
  confine: (actor: A) => void; claim: (actor: A) => boolean; mayAttack: (actor: A) => boolean;
}
interface SkirmisherMemory extends Record<string, number> {
  init: number; hx: number; hz: number; st: number; tm: number; sd: number; cd: number; hitT: number; shy: number; scat: number;
  wander: number; tx: number; tz: number; hit: number;
}
const ST_IDLE = 0, ST_ENGAGE = 1, ST_ATTACK = 2, ST_FLEE = 3;

/** Shared predator hunt phases; one decision clock serves every member. */
export type CirclingPackPhase = 'roam' | 'shadow' | 'encircle' | 'regroup' | 'break';
/** Host-owned prey identity, pose and damage recipe; no guest code chooses its target binding. */
export interface CirclingPackPrey {
  readonly position: Vector3; readonly yaw: number; readonly alive: boolean;
  readonly applyDamage: (amount: number, hitPoint: Vector3, dir: Vector3) => boolean;
}
/** Declared circling-pack tuning, independent of a shard, species rig or combat recipe. */
export interface CirclingPackSpec {
  trotSpeed: number; runSpeed: number; shadowMinRadius: number; shadowMaxRadius: number;
  ringMinRadius: number; ringMaxRadius: number; biteRadius: number;
  sightRadius: number; coneAngle: number; smellRadius: number; hearing: readonly [number, number, number, number];
  telegraphSeconds: number; dashSeconds: number; breakoffSeconds: number; attackSeconds: number;
  leaderVariant: string; yipCue: string; howlCue: string; snarlCue: string; biteCue: string;
}
/** Caller-owned AI or body tick; motion, pathfinding and attack-token authority stay with the host. */
export interface CirclingPackContext<A extends AnimalSim> {
  dt: number; t: number; player: Vector3; playerSpeed: number; calm: boolean; rng: Rng;
  sound: (cue: string) => void; claim: (actor: A) => boolean;
  steer: (actor: A, yaw: number, speed: number, turnRate: number) => void;
  pathYaw: (actor: A, x: number, z: number, every?: number) => number;
}
/** Trusted shared observations, terrain, token registration and strike recipe. */
export interface CirclingPackPorts<A extends AnimalSim> {
  sharedRng: () => Rng;
  environment: () => { playerFwdX: number; playerFwdZ: number; playerMounted: boolean; playerHealth01: number; grassHeightAt: (x: number, z: number) => number };
  visibility: (x: number, z: number, player: Vector3, speed: number, time: number) => number;
  hearing: (radii: readonly [number, number, number, number], player: Vector3, speed: number) => number;
  downwind: (x: number, z: number, player: Vector3) => boolean;
  inBounds: (x: number, z: number, margin: number) => boolean; normalY: (x: number, z: number) => number;
  register: (actor: A, director: AggressionDirector<A>) => void;
  bite: (actor: A, context: CirclingPackContext<A>, radius: number) => void;
  onEvent?: (event: string, x: number, z: number) => void;
  preyIdentity?: (prey: CirclingPackPrey) => string;
  resolvePrey?: (id: string) => CirclingPackPrey | null;
}
const packFinite = v.pipe(v.number(), v.finite());
const packContinuation = v.strictObject({ contract: v.string(), group: v.string(), alpha: v.nullable(v.string()),
  prey: v.nullable(v.string()), pendingPrey: v.nullable(v.string()),
  state: v.strictObject({ initialized: v.boolean(), phase: v.picklist(['roam', 'shadow', 'encircle', 'regroup', 'break']), awareness: packFinite,
    homeX: packFinite, homeZ: packFinite, phaseT: packFinite, roamX: packFinite, roamZ: packFinite, roamT: packFinite, nextTokenT: packFinite,
    boldT: packFinite, calmT: packFinite, hpStart: packFinite, halfDone: v.boolean(), deadSeen: packFinite,
    shadowDur: packFinite, howled: v.boolean(), bites: packFinite, scared: v.boolean() }) });
const ROLE_ALPHA = 0, ROLE_FLANK = 1, ROLE_SCOUT = 2;
const _t = new Vector3();
const ease = (cur: number, to: number, k: number): number => cur + (to - cur) * Math.min(1, k);
const angDiff = (a: number, b: number): number => Math.atan2(Math.sin(a - b), Math.cos(a - b));
function validatePack(spec: CirclingPackSpec): CirclingPackSpec {
  const numbers = [spec.trotSpeed, spec.runSpeed, spec.shadowMinRadius, spec.shadowMaxRadius, spec.ringMinRadius, spec.ringMaxRadius,
    spec.biteRadius, spec.sightRadius, spec.coneAngle, spec.smellRadius, ...spec.hearing, spec.telegraphSeconds, spec.dashSeconds, spec.breakoffSeconds, spec.attackSeconds];
  if (numbers.some(value => !Number.isFinite(value) || value < 0 || value > 600) || spec.runSpeed > 15 || spec.trotSpeed > spec.runSpeed
    || spec.shadowMinRadius > spec.shadowMaxRadius || spec.ringMinRadius > spec.ringMaxRadius || spec.coneAngle > Math.PI
    || Math.min(spec.telegraphSeconds, spec.dashSeconds, spec.breakoffSeconds, spec.attackSeconds) <= 0
    || [spec.leaderVariant, spec.yipCue, spec.howlCue, spec.snarlCue, spec.biteCue].some(value => value.length === 0 || value.length > 128)) throw new Error('Invalid pack parameters');
  return { ...spec, hearing: [...spec.hearing] };
}

/** Circling melee, pack-leader howl or ledge pounce; native encounter and body authority remain explicit ports. */
export type StalkerProfile<A extends AnimalSim> =
  | { pattern: 'hunt'; config: HuntConfig; ports: HuntPorts<A>; player: Vector3; sampleTerrain: (actor: A) => void }
  | { pattern: 'pack'; spec: CirclingPackSpec; ports: CirclingPackPorts<A>; members: A[]; home: { x: number; z: number } }
  | { pattern: 'skirmish'; spec: SkirmisherSpec }
  | { pattern: 'howler'; spec: HowlerSpec; ports: HowlerPorts<A> }
  | { pattern: 'pouncer'; spec: PouncerSpec; ports: PouncerPorts<A> };
/** Caller-scheduled perception; phase/body updates retain the original separately scheduled frame methods. */
export type StalkerObservation<A extends AnimalSim> =
  | (SkirmisherPorts<A> & { pattern: 'skirmish' })
  | (PouncerContext<A> & { pattern: 'howler' | 'pouncer' });
function admitProfile<A extends AnimalSim>(profile: StalkerProfile<A>): StalkerProfile<A> {
  if (profile.pattern === 'hunt') return profile;
  if (profile.pattern === 'pack') return { ...profile, spec: validatePack(profile.spec) };
  if (profile.pattern === 'howler') return { ...profile, spec: readHowlerSpec(profile.spec) };
  if (profile.pattern === 'pouncer') {
    const spec = readPouncerSpec(profile.spec);
    if (profile.ports.ledges.length > 6) throw new RangeError('Pouncer ledge bound exceeded');
    return { ...profile, spec };
  }
  const { spec } = profile;
    const numbers = [spec.awareRadius, spec.shyRadius, spec.disengageRadius, spec.holdRadius, spec.attackRadius, spec.attackDuration, spec.attackCooldown, spec.alertCooldown, spec.fleeSpeed];
    if (numbers.some(n => !Number.isFinite(n) || n < 0 || n > 600) || spec.shyRadius > spec.awareRadius || spec.awareRadius > spec.disengageRadius || spec.attackRadius > spec.awareRadius || spec.attackDuration <= 0 || spec.fleeSpeed > 15
      || [spec.subordinateVariant, spec.leaderVariant, spec.noticeCue].some(value => value.length === 0 || value.length > 128)) throw new Error('Invalid skirmisher parameters');
  return { pattern: 'skirmish', spec: { ...spec } };
}
/** One parametric stalker decision/clock owner, preserving native presets and their exact continuation shapes. */
export class StalkerBrain<A extends AnimalSim> extends HuntingStalkerCore<A> {
  private readonly profile: StalkerProfile<A>;
  private readonly contract: string;
  private reportedSkirmishStep = false;
  private st: v.InferOutput<typeof HowlerSaved>['st'] | v.InferOutput<typeof PouncerSaved>['st'] = 'den';
  private stT = 0; private cd = 0; private howlT = 0; private howlHit = -1; private bit = false; private hitDone = 0;
  private readonly back = new Vector3();
  private readonly from = new Vector3(); private readonly to = new Vector3();
  private goal: { x: number; z: number; y: number } | null = null;
  private readonly goalPoint = { x: 0, z: 0, y: 0 };
  private readonly playerDelta = { d: 0, yaw: 0 };
  constructor(profile: StalkerProfile<A>) {
    super(profile.pattern === 'pack' ? profile.members : [], profile.pattern === 'hunt' ? profile : undefined);
    this.profile = admitProfile(profile);
    this.contract = this.profile.pattern === 'hunt' ? '' : this.profile.pattern === 'pack' ? JSON.stringify(this.profile.spec) : JSON.stringify({ version: 1, spec: this.profile.spec });
    if (this.profile.pattern === 'pack') {
      const members = this.members, homeX = this.profile.home.x, homeZ = this.profile.home.z;
      if (members.length === 0 || members.length > 128 || new Set(members.map(actor => actor.entityId)).size !== members.length
        || !Number.isFinite(homeX) || !Number.isFinite(homeZ)) throw new Error('Invalid pack roster');
      this.homeX = this.roamX = homeX; this.homeZ = this.roamZ = homeZ;
      // roles: the alpha variant (else the biggest) leads; the smallest of a 4–5 pack scouts
      let big: A | null = null;
      for (const w of members) {
        if (w.variant === this.packSpec.leaderVariant || big === null || (big.variant !== this.packSpec.leaderVariant && w.scale > big.scale)) big = w;
      }
      this.alpha = big;
      for (const w of members) this.hpStart += w.maxHp;
      return;
    }
    if (this.profile.pattern === 'howler') this.howlT = this.profile.spec.initialHowl;
    else if (this.profile.pattern === 'pouncer') { this.st = 'lurk'; this.cd = this.profile.spec.initialCooldown; }
  }
  /** Borrow the roster's noise/sight continuation and scheduler. Combined wakes
   * request one urgent decision; interrupt wakes precede the ordinary decision.
   * A policy with state:'owned' keeps its own dead/stunned checks. Its sample
   * runs only before a due normal decision, never on an interrupt wake.
   * Both callbacks receive the original roster actor, allowing one policy
   * to serve newly joined bodies without constructing their observations.
   * This driver owns no save state, actor, clock, body step or random stream.
   */
  bindRoster<B>(ports: {
    readonly limit: number; readonly order: 'combined' | 'interrupt';
    readonly at: (index: number) => B | null | undefined;
    readonly actor: (body: B) => A | null; readonly id: (body: B) => string;
    readonly player: Vector3; readonly sight: (boolean | null | undefined)[];
    readonly noise: { seen: boolean; prev: Vector3; speed: number };
    readonly reach: (actor: A, player: Vector3) => boolean;
    readonly brainDt: (id: string, urgent?: boolean) => number;
    readonly policy?: (body: B) => { readonly decide: (dt: number, actor: A) => void; readonly state?: 'owned'; readonly sample?: (actor: A) => void } | null;
    readonly herd?: (body: B) => number;
    readonly beforeDecisions?: () => void;
  }): {
    readonly observe: (dt: number) => void; readonly decide: () => void;
    readonly wake: (body: B | null | undefined) => void;
    readonly damaged: (target: unknown, killed: boolean) => void;
  } {
    if (!Number.isInteger(ports.limit) || ports.limit < 1 || ports.limit > 512
      || !['combined', 'interrupt'].includes(ports.order)) throw new RangeError('Invalid hunt roster cadence');
    const { player, noise, sight } = ports;
    const reported = new WeakSet<A>();
    const refused = (actor: A, error: unknown): void => {
      if (!reported.has(actor)) { reported.add(actor); emitFault({system: 'ai.roster', error, verdict: 'retry'}); }
    };
    const run = (body: B, actor: A, dt: number): void => {
      const policy = ports.policy?.(body) ?? null;
      if (policy === null) { this.think(actor, dt, player, false, noise.speed); return; }
      if (policy.state === 'owned') { policy.decide(dt, actor); return; }
      if (!actor.alive) { actor.lookWeight = 0; return; }
      if (actor.stunned) { actor.setMotion(actor.yaw, 0, 1); actor.setStrafe(0); actor.lookTarget.copy(player); actor.lookWeight = 1; return; }
      policy.decide(dt, actor);
      const index = ports.herd?.(body), herd = index === undefined ? undefined : this.herds[index];
      if (herd !== undefined) this.updateHerd(herd);
    };
    const wakeFrame = (body: B | null | undefined): boolean => {
      if (body === undefined || body === null) return true;
      const actor = ports.actor(body); if (actor === null || !actor.alive) return true;
      try {
        const dt = ports.brainDt(ports.id(body), true);
        if (ports.order === 'interrupt' || dt > 0) run(body, actor, dt);
        return true;
      } catch (error) { refused(actor, error); return false; }
    };
    const wake = (body: B | null | undefined): void => { wakeFrame(body); };
    return {
      observe: dt => {
        if (!Number.isFinite(dt) || dt <= 0) throw new RangeError('Invalid hunt noise step');
        if (!noise.seen) { noise.prev.copy(player); noise.seen = true; }
        const moved = Math.hypot(player.x - noise.prev.x, player.z - noise.prev.z);
        noise.prev.copy(player);
        // oxlint-disable-next-line prefer-exponentiation-operator -- `**` never reaches the portable Math (test/portable-math.test.ts).
        noise.speed += (Math.min(moved / dt, 9) - noise.speed) * (1 - Math.pow(0.5, dt * 10));
      },
      decide: () => {
        this.resetRepaths();
        ports.beforeDecisions?.();
        for (let i = 0; i < ports.limit; i++) {
          const body = ports.at(i); if (body === undefined || body === null) continue;
          const actor = ports.actor(body); if (actor === null) continue;
          try {
            let urgent = false;
            if (actor.alive && actor.aggressive && (actor.state === 'charge' || actor.state === 'stalk' || actor.state === 'alert')) {
              const clear = ports.reach(actor, player); urgent = sight[i] === true && !clear;
              if (ports.order === 'interrupt' && urgent && !wakeFrame(body)) continue;
              sight[i] = clear;
            }
            const dt = ports.brainDt(ports.id(body), ports.order === 'combined' ? urgent : undefined);
            if (dt > 0) { ports.policy?.(body)?.sample?.(actor); run(body, actor, dt); }
          } catch (error) { refused(actor, error); }
        }
      },
      wake,
      damaged: (target, killed) => {
        for (let i = 0; i < ports.limit; i++) {
          const body = ports.at(i); if (body === undefined || body === null || (ports.policy?.(body) ?? null) !== null) continue;
          const actor = ports.actor(body); if (actor === null || actor.combatActor() !== target) continue;
          if (killed) this.died(actor); else { this.hurt(actor); wake(body); }
          return;
        }
      },
    };
  }
  private get howlerSpec(): HowlerSpec { const p = this.profile; if (p.pattern !== 'howler') throw new Error('Incompatible stalker pattern'); return p.spec; }
  private get howlerPorts(): HowlerPorts<A> { const p = this.profile; if (p.pattern !== 'howler') throw new Error('Incompatible stalker pattern'); return p.ports; }
  private get pouncerSpec(): PouncerSpec { const p = this.profile; if (p.pattern !== 'pouncer') throw new Error('Incompatible stalker pattern'); return p.spec; }
  private get pouncerPorts(): PouncerPorts<A> { const p = this.profile; if (p.pattern !== 'pouncer') throw new Error('Incompatible stalker pattern'); return p.ports; }
  private get skirmishSpec(): SkirmisherSpec { const p = this.profile; if (p.pattern !== 'skirmish') throw new Error('Incompatible stalker pattern'); return p.spec; }
  /** Native phase, with skirmish phases held separately in the actor memory snapshot. */
  get state(): string { if (this.profile.pattern === 'hunt') throw new Error('Hunt phases remain actor-owned'); if (this.profile.pattern === 'pack') return this.phase; if (this.profile.pattern === 'skirmish') throw new Error('Skirmish phase remains actor-owned'); return this.st; }
  /** Preserve the legacy contract/object shape; no observation, body callback or RNG is read. */
  snapshot(): SimValue { if (this.profile.pattern === 'hunt') throw new Error('Hunt continuation remains roster-owned'); if (this.profile.pattern === 'pack') return this.snapshotPack(); return this.profile.pattern === 'skirmish' ? this.contract : this.profile.pattern === 'howler' ? this.howlerSnapshot() : this.pouncerSnapshot(); }
  /** Validate a full pattern continuation before mutation, never replaying gameplay. */
  restore(saved: unknown): void {
    if (this.profile.pattern === 'hunt') throw new Error('Hunt continuation remains roster-owned');
    if (this.profile.pattern === 'pack') { if (typeof saved !== 'string') throw new Error('Invalid pack continuation'); this.restorePack(saved); return; }
    if (this.profile.pattern === 'howler') this.howlerRestore(saved);
    else if (this.profile.pattern === 'pouncer') this.pouncerRestore(saved);
    else if (saved !== this.contract) throw new Error('Incompatible skirmisher continuation');
  }
  /** Admit the complete native continuation without allocation, callbacks or mutation.
   * Commit only after the surrounding owner has admitted its whole save bank. */
  prepareRestore(saved: unknown): () => void {
    if (this.profile.pattern === 'howler') { const state = v.parse(HowlerSaved, saved); return () => { this.howlerRestore(state); }; }
    if (this.profile.pattern === 'pouncer') { const state = v.parse(PouncerSaved, saved); return () => { this.pouncerRestore(state); }; }
    throw new Error('Pattern continuation is not owned by the native encounter');
  }
  /** Observe on the original native manager cadence; mismatched ports refuse before effects. */
  think(a: A, c: StalkerObservation<A>): void;
  think(a: A, dt: number, player: Vector3, sprinting: boolean, playerSpeed: number): void;
  think(a: A, c: StalkerObservation<A> | number, player?: Vector3, sprinting?: boolean, playerSpeed?: number): void {
    if (typeof c === 'number') {
      if (this.profile.pattern !== 'hunt' || player === undefined || sprinting === undefined || playerSpeed === undefined) throw new Error('Incompatible stalker hunt observation');
      this.decideHunt(a, c, player, sprinting, playerSpeed); return;
    }
    if (c.pattern !== this.profile.pattern) throw new Error('Incompatible stalker observation');
    if (c.pattern === 'skirmish') this.skirmishThink(a, c);
    else if (c.pattern === 'howler') this.howlerThink(a, c);
    else this.pouncerThink(a, c);
  }
  /** Allocation-free native skirmish perception on the existing manager cadence. */
  decideSkirmisher(a: A, c: SkirmisherPorts<A>): void { if (this.profile.pattern !== 'skirmish') throw new Error('Incompatible stalker observation'); this.skirmishThink(a, c); }
  /** Allocation-free native howl perception on the existing manager cadence. */
  decideHowler(a: A, c: PouncerContext<A>): void { if (this.profile.pattern !== 'howler') throw new Error('Incompatible stalker observation'); this.howlerThink(a, c); }
  /** Allocation-free native pounce perception on the existing manager cadence. */
  decidePouncer(a: A, c: PouncerContext<A>): void { if (this.profile.pattern !== 'pouncer') throw new Error('Incompatible stalker observation'); this.pouncerThink(a, c); }
  /** Deliver the committed melee/swipe contacts on the native body attack phase. */
  act(a: A): void { if (this.profile.pattern === 'howler') this.howlerAct(a); else if (this.profile.pattern === 'pouncer') this.pouncerAct(a); else throw new Error('Skirmish contacts remain body-owned'); }
  /** Advance the existing encounter-frame law without changing callback or shared-RNG order. */
  advance(a: A | null, dt: number, t: number, engaged: boolean, leashing: boolean): void {
    if (this.profile.pattern === 'howler') this.howlerTick(a, dt, t, engaged, leashing);
    else if (this.profile.pattern === 'pouncer') this.pouncerTick(a, dt, t, engaged, leashing);
    else throw new Error('Skirmish body remains host-owned');
  }
  /** Reset the original deferred-spawn state; retain all other clocks exactly as the preset does. */
  spawned(a?: A): void {
    if (this.profile.pattern === 'pouncer') this.pouncerSpawned();
    else if (this.profile.pattern === 'howler' && a !== undefined) this.howlerSpawned(a);
    else throw new Error('Missing stalker spawn authority');
  }
  /** Leash to the native home and clear only the preset's transient tell/pose fields. */
  reset(a: A | null): void { if (this.profile.pattern === 'howler') this.howlerReset(a); else if (this.profile.pattern === 'pouncer') this.pouncerReset(a); else throw new Error('Skirmish state remains actor-owned'); }
  /** Hide the current entered tell without discarding native continuation. */
  disposeTell(): void { if (this.profile.pattern === 'howler') this.howlerDisposeTell(); else if (this.profile.pattern === 'pouncer') this.pouncerDisposeTell(); }
  /** Original authoritative-contact weak-point law. */
  damage(a: A, point: Vector3): number { if (this.profile.pattern === 'howler') return this.howlerDamage(a, point); if (this.profile.pattern === 'pouncer') return this.pouncerDamage(a, point); throw new Error('Skirmish damage remains body-owned'); }
  /** Regroup the already owned pack and enter the native melee phase. */
  enterPhase2(a: A | null): void { if (this.profile.pattern !== 'howler') throw new Error('Incompatible stalker phase transition'); this.howlerEnterPhase2(a); }
  private howlerState(): v.InferOutput<typeof HowlerSaved>['st'] {
    const state = this.st;
    if (state === 'den' || state === 'hold' || state === 'howl' || state === 'hunt' || state === 'home') return state;
    throw new Error('Incompatible howler phase');
  }
  private pouncerPhase(): v.InferOutput<typeof PouncerSaved>['st'] {
    const state = this.st;
    if (state === 'lurk' || state === 'stalk' || state === 'tell' || state === 'leap' || state === 'open' || state === 'swipe' || state === 'perch' || state === 'home') return state;
    throw new Error('Incompatible pouncer phase');
  }
  private get howlerP2(): boolean { return this.howlerPorts.phase2(); }
  private get howlerPack(): HowlerPack<A> | null { return this.howlerPorts.pack(); }
  /** Initialize the existing deferred-spawn howl clock. */
  private howlerSpawned(a: A): void { a.mem[this.howlerSpec.fields.howl] = 0; this.st = 'den'; this.howlT = this.howlerSpec.initialHowl; }
  /** Return home and hide the transient tell without resetting retained clocks. */
  private howlerReset(a: A | null): void { this.st = 'home'; this.howlerPorts.rings.hide(); if (a !== null) a.mem[this.howlerSpec.fields.howl] = 0; }
  /** Hide entered presentation without discarding the pack continuation. */
  private howlerDisposeTell(): void { this.howlerPorts.rings.hide(); }
  private howlerToPlayer(a: A): { d: number; yaw: number } {
    const p = this.howlerPorts.player.position;
    this.playerDelta.d = Math.hypot(p.x - a.position.x, p.z - a.position.z);
    this.playerDelta.yaw = Math.atan2(p.x - a.position.x, p.z - a.position.z); return this.playerDelta;
  }
  private howlerGoHome(a: A, c: PouncerContext<A>, speed: number): void {
    const L = this.howlerPorts.lair; a.setMotion(c.pathYaw(a, L.x, L.z, this.howlerSpec.homePathSeconds), Math.hypot(L.x - a.position.x, L.z - a.position.z) > this.howlerSpec.homeStop ? speed : 0, this.howlerSpec.turns.home);
  }
  private howlerChase(a: A, c: PouncerContext<A>, d: number, yaw: number): number { return d > this.howlerSpec.pathNear ? c.pathYaw(a, c.player.x, c.player.z, this.howlerSpec.pathSeconds) : yaw; }
  private howlerMelee(p: Vector3): boolean { const pl = this.howlerPorts.player.position; return Math.hypot(p.x - pl.x, p.z - pl.z) < this.howlerSpec.meleeRadius; }
  /** Regroup the real pack at its leader and begin the melee phase. */
  private howlerEnterPhase2(a: A | null): void {
    if (this.howlerPack && a) { this.howlerPack.homeX = a.position.x; this.howlerPack.homeZ = a.position.z; this.howlerPack.phase = 'regroup'; }
    this.st = 'hunt'; this.cd = this.howlerSpec.phaseCooldown;
    this.howlerPorts.regrouped();
  }
  /** Compute the hidden ranged weak point from authoritative player/grass queries. */
  private howlerDamage(a: A, p: Vector3): number {
    const wildEnv = this.howlerPorts.environment();
    // the weak point: an arrow from HIDDEN (crouched in tall grass) — and she is never soft in the howl
    const pl = this.howlerPorts.player.position;
    const hidden = wildEnv.playerCrouched && wildEnv.grassHeightAt(pl.x, pl.z) > this.howlerSpec.grassHeight;
    void a;
    return !this.howlerMelee(p) && hidden ? this.howlerSpec.hiddenDamage : 1;
  }
  /** Decide on the native manager cadence with actual path and gaze authority. */
  private howlerThink(a: A, c: PouncerContext<A>): void {
    const wildEnv = this.howlerPorts.environment();
    const tp = this.howlerToPlayer(a);
    a.lookTarget.copy(c.player); a.lookWeight = 1;
    this.cd -= c.dt;
    switch (this.howlerState()) {
      case 'den': a.setMotion(tp.yaw, 0, this.howlerSpec.turns.den); break;
      case 'home': this.howlerGoHome(a, c, this.howlerSpec.speeds.home); if (Math.hypot(a.position.x - this.howlerPorts.lair.x, a.position.z - this.howlerPorts.lair.z) < this.howlerSpec.homeReset) this.st = 'den'; break;
      case 'hold': {
        // 24–32 m out (close enough to read her over the grass), sliding round you — and off your line of sight when you look at her
        const lookX = wildEnv.playerFwdX, lookZ = wildEnv.playerFwdZ;
        const ux = (a.position.x - c.player.x) / Math.max(1, tp.d), uz = (a.position.z - c.player.z) / Math.max(1, tp.d);
        const watched = lookX * ux + lookZ * uz > this.howlerSpec.hold.watchedDot;
        const side = watched ? 1 : 0;
        const r = MathUtils.clamp(tp.d, this.howlerSpec.hold.minRadius, this.howlerSpec.hold.maxRadius);
        const ang = Math.atan2(ux, uz) + side * this.howlerSpec.hold.sidestep;
        const gx = c.player.x + Math.sin(ang) * r, gz = c.player.z + Math.cos(ang) * r;
        const gd = Math.hypot(gx - a.position.x, gz - a.position.z);
        a.setMotion(gd > this.howlerSpec.hold.arrival ? Math.atan2(gx - a.position.x, gz - a.position.z) : tp.yaw, gd > this.howlerSpec.hold.arrival ? (watched ? this.howlerSpec.speeds.watched : this.howlerSpec.speeds.hold) : 0, this.howlerSpec.turns.hold);
        a.mem[this.howlerSpec.fields.low] = watched ? this.howlerSpec.hold.watchedLow : this.howlerSpec.hold.low;
        break;
      }
      case 'howl': a.setMotion(a.yaw, 0, this.howlerSpec.turns.howl); break;
      case 'hunt': {
        a.mem[this.howlerSpec.fields.low] = 0; a.mem[this.howlerSpec.fields.snarl] = tp.d < this.howlerSpec.hunt.snarlDistance ? 1 : 0;
        if (a.attackPhase >= 0) break;
        if (tp.d < this.howlerSpec.hunt.attackDistance && this.cd <= 0) { this.bit = false; a.startAttack(this.howlerSpec.bite.seconds); break; }
        a.setMotion(this.howlerChase(a, c, tp.d, tp.yaw), tp.d > this.howlerSpec.hunt.moveDistance ? this.howlerSpec.speeds.hunt : 0, this.howlerSpec.turns.hunt);
        break;
      }
      default: break;
    }
  }
  /** Deliver the committed bite on the actual body attack phase, once. */
  private howlerAct(a: A): void {
    if (this.st !== 'hunt' || a.attackPhase < 0) return;
    const tp = this.howlerToPlayer(a);

          a.setMotion(tp.yaw, this.howlerSpec.speeds.bite, this.howlerSpec.turns.bite);
          if (a.attackPhase >= this.howlerSpec.bite.phase && !this.bit) { this.bit = true; if (tp.d < this.howlerSpec.bite.range) this.howlerPorts.hurt(a, this.howlerSpec.bite.damage); }
          if (a.attackPhase >= 1) { a.cancelAttack(); this.cd = this.howlerSpec.bite.cooldown; }
  }
  /** Advance the encounter frame law and consume shared RNG only when a howl completes. */
  private howlerTick(a: A | null, dt: number, t: number, engaged: boolean, leashing: boolean): void {
    if (a === null) return;
    this.howlerPorts.rings.setTime(t);
    if (leashing && this.st !== 'home') this.st = 'home';
    if (engaged && (this.st === 'den' || this.st === 'home')) { this.st = this.howlerP2 ? 'hunt' : 'hold'; this.howlT = this.howlerSpec.engagedHowl; }
    this.stT += dt;
    if (this.st === 'hold' && !this.howlerP2) {
      this.howlT -= dt;
      if (this.howlT <= 0) { this.st = 'howl'; this.stT = 0; this.howlHit = a.lastHitT; this.howlerPorts.signature(); this.howlerPorts.howl(a.position); }
    }
    if (this.st === 'howl') {
      a.mem[this.howlerSpec.fields.howl] = Math.min(1, this.stT / this.howlerSpec.howl.growSeconds);
      // pale rings ripple out from her
      this.howlerPorts.rings.ring(a.position.x, a.position.z, this.howlerSpec.howl.radius + ((this.stT * this.howlerSpec.howl.speed) % this.howlerSpec.howl.span), this.howlerSpec.howl.strength * (1 - ((this.stT * this.howlerSpec.howl.speed) % this.howlerSpec.howl.span) / this.howlerSpec.howl.span));
      if (a.lastHitT > this.howlHit) {
        // hit mid-howl: it breaks — she staggers, the pack scatters
        a.mem[this.howlerSpec.fields.howl] = 0; this.howlerPorts.rings.hide();
        this.back.set(Math.sin(a.yaw), 0, Math.cos(a.yaw)).negate(); a.stagger(this.back, this.howlerSpec.howl.stagger);
        this.howlerPack?.scare(a.position.x, a.position.z, this.howlerSpec.howl.scare);
        this.howlerPorts.interrupted();
        this.st = 'hold'; this.howlT = this.howlerSpec.interruptedHowl;
      } else if (this.stT > this.howlerSpec.howl.seconds) {
        a.mem[this.howlerSpec.fields.howl] = 0; this.howlerPorts.rings.hide();
        if (this.howlerPack) { this.howlerPack.awareness = 1; this.howlerPack.phase = 'encircle'; }
        this.howlerPorts.closed();
        this.st = 'hold'; this.howlT = this.howlerSpec.nextHowl + this.howlerPorts.random() * this.howlerSpec.randomHowl;
      }
    } else if (a.mem[this.howlerSpec.fields.howl] !== 0) a.mem[this.howlerSpec.fields.howl] = 0;
  }
  /** Capture every custom clock without drawing RNG or emitting events. */
  howlerSnapshot(): v.InferOutput<typeof HowlerSaved> { if (this.profile.pattern !== 'howler') throw new Error('Incompatible stalker snapshot'); return { st: this.howlerState(), howlT: this.howlT, stT: this.stT, howlHit: this.howlHit, cd: this.cd, bit: this.bit }; }
  /** Strictly validate the full continuation before any mutation. */
  private howlerRestore(input: unknown): void { const s = v.parse(HowlerSaved, input); this.st = s.st; this.howlT = s.howlT; this.stT = s.stT; this.howlHit = s.howlHit; this.cd = s.cd; this.bit = s.bit; }
  /** Current stalking, tell, leap, swipe, retreat or home phase. */
  private get pouncerP2(): boolean { return this.pouncerPorts.phase2(); }
  /** Reset the shipping spawn state; other clocks remain retained as on the page. */
  private pouncerSpawned(): void { this.st = 'lurk'; this.cd = this.pouncerSpec.initialCooldown; }
  /** Leash home and clear the transient tell and pose fields. */
  private pouncerReset(a: A | null): void { this.st = 'home'; this.pouncerPorts.ring.hide(); if (a !== null) { a.mem[this.pouncerSpec.fields.leap] = 0; a.mem[this.pouncerSpec.fields.low] = 0; } }
  /** Hide the transient tell without discarding the retained controller. */
  private pouncerDisposeTell(): void { this.pouncerPorts.ring.hide(); }
  private pouncerToPlayer(a: A): { d: number; yaw: number } {
    const p = this.pouncerPorts.player.position, dx = p.x - a.position.x, dz = p.z - a.position.z;
    this.playerDelta.d = Math.hypot(dx, dz); this.playerDelta.yaw = Math.atan2(dx, dz); return this.playerDelta;
  }
  private pouncerGoHome(a: A, c: PouncerContext<A>, speed: number): void {
    const L = this.pouncerPorts.lair, dx = L.x - a.position.x, dz = L.z - a.position.z;
    a.setMotion(c.pathYaw(a, L.x, L.z, 2), Math.hypot(dx, dz) > this.pouncerSpec.homeRadius ? speed : 0, this.pouncerSpec.turns.home);
  }
  private pouncerChase(a: A, c: PouncerContext<A>, d: number, yaw: number, near: number): number { return d > near ? c.pathYaw(a, c.player.x, c.player.z, this.pouncerSpec.pathSeconds) : yaw; }
  private pouncerStandY(x: number, z: number): number {
    let y = this.pouncerPorts.heightAt(x, z);
    for (let i = 0; i < 6; i++) { const l = this.pouncerPorts.ledges[i]; if (l === undefined) break; if (Math.hypot(x - l.x, z - l.z) < l.r + this.pouncerSpec.ledgeMargin) y = Math.max(y, l.y); }
    return y;
  }
  /** Weak-point multiplier at an authoritative contact point. */
  private pouncerDamage(a: A, p: Vector3): number {
    if (this.st === 'leap') return this.pouncerSpec.damage.airborne;                                   // the weak point: its airborne body
    if (this.st === 'open') return this.pouncerPorts.isHead(a, p) ? this.pouncerSpec.damage.openHead : 1;            // The opened head multiplier composes with the native contact multiplier.
    if (this.pouncerP2 && this.st === 'perch') return this.pouncerSpec.damage.perched;                   // up on its ledge in phase 2
    return 1;
  }
  private pouncerPerchFor(px: number, pz: number, py: number): PouncerLedge | null {
    let best: PouncerLedge | null = null, bd = Infinity;
    for (let i = 0; i < 6; i++) { const l = this.pouncerPorts.ledges[i]; if (l === undefined) break;
      const up = l.y - py, d = Math.hypot(l.x - px, l.z - pz);
      if (up < this.pouncerSpec.perch.minHeight || up > this.pouncerSpec.perch.maxHeight || d < this.pouncerSpec.perch.minDistance || d > this.pouncerSpec.perch.maxDistance) continue;
      if (d < bd) { bd = d; best = l; }
    }
    return best;
  }
  /** Decide on the manager cadence using the same row and native path authority. */
  private pouncerThink(a: A, c: PouncerContext<A>): void {
    const pl = c.player, tp = this.pouncerToPlayer(a);
    this.cd -= c.dt;
    a.lookTarget.copy(pl); a.lookWeight = this.st === 'lurk' ? this.pouncerSpec.lookIdle : 1;
    switch (this.pouncerPhase()) {
      case 'lurk': a.setMotion(a.yaw, 0, this.pouncerSpec.turns.idle); break;
      case 'home': this.pouncerGoHome(a, c, this.pouncerSpec.speeds.home); if (Math.hypot(a.position.x - this.pouncerPorts.lair.x, a.position.z - this.pouncerPorts.lair.z) < this.pouncerSpec.homeRadius) this.st = 'lurk'; break;
      case 'stalk': case 'perch': {
        a.mem[this.pouncerSpec.fields.low] = this.st === 'stalk' ? this.pouncerSpec.pose.stalk : this.pouncerSpec.pose.perch;
        if (tp.d < this.pouncerSpec.swipe.from && this.cd <= 0) { this.st = 'swipe'; this.hitDone = 0; a.startAttack(this.pouncerSpec.swipe.seconds); a.setMotion(tp.yaw, 0, this.pouncerSpec.turns.swipeStart); break; }
        const perch = this.pouncerPerchFor(pl.x, pl.z, pl.y);
        if (perch !== null && this.cd <= 0) {
          const dp = Math.hypot(perch.x - a.position.x, perch.z - a.position.z);
          if (dp < this.pouncerSpec.perch.arrival) { this.pouncerStartTell(a, pl); break; }
          a.setMotion(Math.atan2(perch.x - a.position.x, perch.z - a.position.z), this.pouncerSpec.speeds.perch, this.pouncerSpec.turns.perch);
        } else if (tp.d > this.pouncerSpec.pounce.minDistance && tp.d < this.pouncerSpec.pounce.maxDistance && this.cd <= 0) this.pouncerStartTell(a, pl);   // no ledge: a run-up pounce on open ground
        else a.setMotion(tp.d > this.pouncerSpec.stalk.far ? this.pouncerChase(a, c, tp.d, tp.yaw, this.pouncerSpec.stalk.far) : tp.yaw, tp.d > this.pouncerSpec.stalk.far ? this.pouncerSpec.speeds.stalk : tp.d < this.pouncerSpec.stalk.near ? this.pouncerSpec.speeds.back : 0, this.pouncerSpec.turns.stalk);
        break;
      }
      case 'tell': a.setMotion(Math.atan2(this.to.x - a.position.x, this.to.z - a.position.z), 0, this.pouncerSpec.turns.tell); break;
      case 'leap': case 'open': a.setMotion(a.yaw, 0, this.pouncerSpec.turns.open); break;
      case 'swipe': break;
      default: break;
    }
  }
  /** Deliver each swipe contact exactly once on the body attack phase. */
  private pouncerAct(a: A): void {
    if (this.st !== 'swipe') return;
    const tp = this.pouncerToPlayer(a);

        a.setMotion(tp.yaw, 0, this.pouncerSpec.turns.swipe);
        const k = a.attackPhase;
        if (k >= this.pouncerSpec.swipe.first && this.hitDone === 0) { this.hitDone = 1; if (tp.d < this.pouncerSpec.swipe.range) this.pouncerPorts.hurt(a, this.pouncerSpec.swipe.damage); }
        if (k >= this.pouncerSpec.swipe.second && this.hitDone === 1) { this.hitDone = 2; if (tp.d < this.pouncerSpec.swipe.range) this.pouncerPorts.hurt(a, this.pouncerSpec.swipe.damage); }
        if (k >= 1 || k < 0) { a.cancelAttack(); this.st = this.pouncerP2 ? 'perch' : 'stalk'; this.cd = this.pouncerSpec.swipe.cooldown; if (this.pouncerP2) this.pouncerRetreat(a); }
  }
  private pouncerStartTell(a: A, pl: Vector3): void {
    this.st = 'tell'; this.stT = 0;
    this.from.copy(a.position);
    this.to.set(pl.x, 0, pl.z); this.to.y = this.pouncerPorts.heightAt(pl.x, pl.z);
    a.mem[this.pouncerSpec.fields.low] = 1; a.mem[this.pouncerSpec.fields.snarl] = 1;
    this.pouncerPorts.signature();
    this.pouncerPorts.growl(a.position);
  }
  private pouncerRetreat(a: A): void {
    let best: PouncerLedge | null = null, bd = -1;
    for (let i = 0; i < 6; i++) { const l = this.pouncerPorts.ledges[i]; if (l === undefined) break; const up = l.y - this.pouncerPorts.heightAt(l.x, l.z); const d = Math.hypot(l.x - a.position.x, l.z - a.position.z); if (up > this.pouncerSpec.perch.retreatHeight && d < this.pouncerSpec.perch.retreatDistance && d > bd) { bd = d; best = l; } }
    if (best !== null) { this.from.copy(a.position); this.to.set(best.x, best.y, best.z); this.st = 'leap'; this.stT = 0; this.goalPoint.x = best.x; this.goalPoint.z = best.z; this.goalPoint.y = best.y; this.goal = this.goalPoint; }
  }
  /** Advance engagement, tell, ballistic motion and retreat on the fixed frame clock. */
  private pouncerTick(a: A | null, dt: number, t: number, engaged: boolean, leashing: boolean): void {
    if (a === null) return;
    this.pouncerPorts.ring.setTime(t);
    if (leashing && this.st !== 'home') this.st = 'home';
    if ((this.st === 'lurk' || (this.st === 'home' && !leashing)) && (engaged || a.position.distanceTo(this.pouncerPorts.player.position) < this.pouncerPorts.awareRadius)) { this.st = 'stalk'; this.cd = this.pouncerSpec.awareCooldown; }
    this.stT += dt;
    // Stand on the declared solid ledge, whose top need not be the terrain height.
    if (this.st !== 'leap') a.yOffset += ((this.pouncerStandY(a.position.x, a.position.z) - this.pouncerPorts.heightAt(a.position.x, a.position.z)) - a.yOffset) * Math.min(1, dt * this.pouncerSpec.standRate);
    if (this.st === 'tell') {
      this.pouncerPorts.ring.ring(this.to.x, this.to.z, this.pouncerSpec.tell.radius, this.pouncerSpec.tell.strength + this.pouncerSpec.tell.growth * Math.min(1, this.stT / this.pouncerSpec.tell.growSeconds));
      if (this.stT > this.pouncerSpec.tell.seconds) { this.st = 'leap'; this.stT = 0; this.goal = null; this.from.copy(a.position); this.from.y = this.pouncerStandY(a.position.x, a.position.z); }
    } else if (this.st !== 'leap') this.pouncerPorts.ring.hide();
    if (this.st === 'leap') {
      // a ballistic arc from the perch to the ring (or up to a retreat ledge)
      const T = this.pouncerSpec.pounce.seconds, k = Math.min(1, this.stT / T);
      const x = MathUtils.lerp(this.from.x, this.to.x, k), z = MathUtils.lerp(this.from.z, this.to.z, k);
      const y = MathUtils.lerp(this.from.y, this.to.y, k) + Math.sin(k * Math.PI) * this.pouncerSpec.pounce.arcHeight;
      a.position.x = x; a.position.z = z; a.yOffset = y - this.pouncerPorts.heightAt(x, z);
      a.yaw = a.desiredYaw = Math.atan2(this.to.x - this.from.x, this.to.z - this.from.z);
      a.mem[this.pouncerSpec.fields.leap] = Math.sin(k * Math.PI) * this.pouncerSpec.pose.leapSwing + this.pouncerSpec.pose.leapBase; a.mem[this.pouncerSpec.fields.low] = 0;
      if (k >= 1) {
        a.mem[this.pouncerSpec.fields.leap] = 0; a.mem[this.pouncerSpec.fields.snarl] = 0;
        this.pouncerPorts.ring.hide();
        if (this.goal !== null) { this.st = 'perch'; this.cd = this.pouncerSpec.perch.cooldown; return; }
        const p = this.pouncerPorts.player.position;
        if (Math.hypot(p.x - this.to.x, p.z - this.to.z) < this.pouncerSpec.pounce.range) {
          this.pouncerPorts.hurt(a, this.pouncerSpec.pounce.damage); this.pouncerPorts.knock(p.x - this.from.x, p.z - this.from.z);
          this.st = this.pouncerP2 ? 'perch' : 'stalk'; this.cd = this.pouncerSpec.pounce.cooldown; if (this.pouncerP2) this.pouncerRetreat(a);
        } else { this.st = 'open'; this.stT = 0; this.pouncerPorts.opened(); }
      }
    }
    if (this.st === 'open') { a.mem[this.pouncerSpec.fields.low] = this.pouncerSpec.pose.open; if (this.stT > this.pouncerSpec.openSeconds) { this.st = 'stalk'; this.cd = this.pouncerSpec.openCooldown; } }
    if (this.st === 'perch' && this.pouncerP2 && this.stT > this.pouncerSpec.perch.waitSeconds && this.cd <= 0) this.st = 'stalk';
  }
  /** Exact continuation, preserving the prior keeper field shape and number order. */
  pouncerSnapshot(): v.InferOutput<typeof PouncerSaved> { if (this.profile.pattern !== 'pouncer') throw new Error('Incompatible stalker snapshot'); return v.parse(PouncerSaved, { st: this.st, stT: this.stT, cd: this.cd, hitDone: this.hitDone, from: this.from.toArray(), to: this.to.toArray(), goal: this.goal }); }
  /** Validate the complete continuation before replacing any live state. */
  private pouncerRestore(input: unknown): void { const s = v.parse(PouncerSaved, input); this.st = s.st; this.stT = s.stT; this.cd = s.cd; this.hitDone = s.hitDone; this.from.fromArray(s.from); this.to.fromArray(s.to); if (s.goal === null) this.goal = null; else { Object.assign(this.goalPoint, s.goal); this.goal = this.goalPoint; } }
  private skirmishThink(a: A, c: SkirmisherPorts<A>): void {
    // dt 0 is an interrupt's wake in the frame it already decided (the manager's 'decide now', whatever the clock)
    if (!Number.isFinite(c.dt) || c.dt < 0 || c.dt > 1) {
      if (!this.reportedSkirmishStep) {
        this.reportedSkirmishStep = true;
        emitFault({system: 'ai.skirmisher', error: new Error('Invalid skirmisher step'), verdict: 'retry'});
      }
      return;
    }
    const m = a.mem as SkirmisherMemory, rng = c.rng;
    if (!m.init) { m.init = 1; m.hx = a.position.x; m.hz = a.position.z; m.st = ST_IDLE; m.tm = rng.range(1, 3); m.sd = rng.next() < 0.5 ? -1 : 1; m.cd = 0; m.hitT = 0; m.shy = 0; m.scat = 0; }
    const dx = c.player.x - a.position.x, dz = c.player.z - a.position.z, d = Math.hypot(dx, dz);
    const toPlayer = Math.atan2(dx, dz);
    m.cd = Math.max(0, m.cd - c.dt);
    // a blow interrupts whatever it was doing: it turns on you
    if (a.lastHitT > m.hitT) { m.hitT = a.lastHitT; a.cancelAttack(); if (m.st !== ST_FLEE) { m.st = ST_ENGAGE; m.cd = Math.max(m.cd, this.skirmishSpec.alertCooldown); } }
    // A dead leader makes its subordinate variants scatter and remain shy.
    if (a.variant === this.skirmishSpec.subordinateVariant && !m.scat && c.herd?.some((h) => h.variant === this.skirmishSpec.leaderVariant && !h.alive)) { m.scat = 1; m.shy = 1; m.st = ST_FLEE; m.tm = rng.range(5, 7); a.cancelAttack(); c.sound(this.skirmishSpec.noticeCue); }
    const engageR = m.shy ? this.skirmishSpec.shyRadius : this.skirmishSpec.awareRadius;
    switch (m.st) {
      case ST_IDLE: {
        a.state = 'idle';
        if (!c.calm && d < engageR) { m.st = ST_ENGAGE; m.tm = rng.range(1, 2.5); c.sound(this.skirmishSpec.noticeCue); break; }
        m.tm -= c.dt;
        if (m.tm <= 0) {
          // Alternate resting and a short wander around the remembered home.
          if (m.wander) { m.wander = 0; m.tm = rng.range(2, 6); a.setMotion(a.desiredYaw, 0, 2); a.setStrafe(0); }
          else { m.wander = 1; m.tm = rng.range(1.5, 3); const ang = rng.range(0, Math.PI * 2); m.tx = m.hx + Math.cos(ang) * 3; m.tz = m.hz + Math.sin(ang) * 3; }
        }
        if (m.wander) {
          const wx = m.tx - a.position.x, wz = m.tz - a.position.z;
          if (Math.hypot(wx, wz) < 0.5) { m.wander = 0; m.tm = rng.range(2, 6); a.setMotion(a.desiredYaw, 0, 2); }
          else { const yaw = Math.atan2(wx, wz); a.setMotion(yaw, 0, 3); a.setStrafe(Math.sin(yaw - a.yaw) > 0 ? 0.55 : -0.55); if (Math.abs(Math.sin(yaw - a.yaw)) < 0.3) { a.setStrafe(0); a.setMotion(yaw, 0.5, 3); } }
        }
        a.lookWeight = d < 14 ? 0.5 : 0; a.lookTarget.copy(c.player);
        break;
      }
      case ST_ENGAGE: {
        a.state = 'sidestep';
        a.lookTarget.copy(c.player); a.lookWeight = 1;
        if (c.calm || d > this.skirmishSpec.disengageRadius) { m.st = ST_IDLE; m.tm = 2; a.setStrafe(0); a.setMotion(a.yaw, 0, 2); break; }
        m.tm -= c.dt;
        if (m.tm <= 0) { m.sd = -m.sd; m.tm = rng.range(1.0, 2.5); }
        // An authoritative attack token holds waiting actors outside strike range.
        const wait = !c.mayAttack(a), far = wait ? this.skirmishSpec.holdRadius + 0.6 : 2.6, near = wait ? this.skirmishSpec.holdRadius - 0.6 : 1.4;
        if (d > far) { a.setMotion(toPlayer, 1.7, 5); a.setStrafe(m.sd * 0.5); }
        else if (!wait && m.cd <= 0 && d > 1.75) { a.setMotion(toPlayer, 1.2, 5); a.setStrafe(m.sd * 0.3); } // Its turn: close to strike range.
        else if (d < near) { a.setMotion(toPlayer, wait ? -1.1 : -0.6, 5); a.setStrafe(m.sd * 1.3); }      // too close: back off a step while circling
        else { a.setMotion(toPlayer, 0, 5); a.setStrafe(m.sd * 1.3); }
        if (!wait && d < this.skirmishSpec.attackRadius && m.cd <= 0 && c.claim(a)) { m.st = ST_ATTACK; m.hit = 0; a.startAttack(this.skirmishSpec.attackDuration); a.setStrafe(0); a.setMotion(toPlayer, 0, 6); c.sound(this.skirmishSpec.noticeCue); }
        break;
      }
      case ST_ATTACK: {
        a.state = 'attack';
        a.setMotion(toPlayer, 0, 6); a.setStrafe(0);
        const p = a.attackPhase;
        if (p >= 1 || p < 0) { m.st = ST_ENGAGE; m.cd = this.skirmishSpec.attackCooldown; m.tm = rng.range(0.6, 1.6); a.cancelAttack(); }
        break;
      }
      case ST_FLEE: {
        a.state = 'flee';
        m.tm -= c.dt;
        c.steer(a, Math.atan2(-dx, -dz), this.skirmishSpec.fleeSpeed, 4); a.setStrafe(0);
        a.lookWeight = 0;
        if (m.tm <= 0) { m.st = ST_IDLE; m.tm = 2; m.hx = a.position.x; m.hz = a.position.z; a.setMotion(a.yaw, 0, 2); }
        break;
      }
      default: break;
    }
    c.confine(a);
  }
  private requirePack(): void { if (this.profile.pattern !== 'pack') throw new Error('Incompatible pack stalker pattern'); }
  private get packSpec(): CirclingPackSpec { const p = this.profile; if (p.pattern !== 'pack') throw new Error('Incompatible pack stalker pattern'); return p.spec; }
  private get packPorts(): CirclingPackPorts<A> { const p = this.profile; if (p.pattern !== 'pack') throw new Error('Incompatible pack stalker pattern'); return p.ports; }
  /** The original guarded native authorities lent to a prepared group step. */
  get groupPorts(): CirclingPackPorts<A> { return this.packPorts; }
  private initialized = false;
  alpha: A | null = null;
  phase: CirclingPackPhase = 'roam';
  /** 0..1: how sure the pack is of the player (the max over its wolves' senses) */
  awareness = 0;
  /** the den / home range centre */
  homeX = 0; homeZ = 0;
  /** a foal (or a raided sheep, any CirclingPackPrey) the pack is hunting instead of the player */
  prey: CirclingPackPrey | null = null;
  /** B1: a raid's prey, taken at the next tick while roaming (`raid`) */
  private pendingPrey: CirclingPackPrey | null = null;
  findPrey?: ((x: number, z: number, r: number) => A | null) | undefined;
  onPhase?: ((phase: CirclingPackPhase, pack: StalkerBrain<A>) => void) | undefined;

  private phaseT = 0;
  private roamX = 0; private roamZ = 0; private roamT = 0;
  private nextTokenT = 0; private boldT = 0; private calmT = 0;
  private hpStart = 0; private halfDone = false; private deadSeen = 0;
  private shadowDur = 12;
  private howled = false;
  private bites = 0;
  private scared = false;

  // ── R10b: the pack's law as the owner's group program on GroupBrain's shared loop. A bound pack runs every original call
  // (initialize on the shared stream, tick at the group's slot, drive at each wolf's on the context stream) as segments of
  // its profile; its own fields stay the truth (captured into the bank per call, the candidate committed back). ──
  private packGuest: {
    readonly program: GroupGuestProjectionV2; readonly prepare: GroupGuestProjectionV2['prepareGroup']; readonly bindings: GroupGuestBindingsV2;
    readonly scope: Scope; readonly group: string; readonly handle: number; readonly rows: GroupGuestBindingRows; readonly codec: GroupBankV2;
    readonly results: readonly string[]; readonly roster: () => readonly A[];
    readonly buffers:{readonly bank:Float64Array;readonly captured:Record<string,GroupBankValueV2>;readonly values:Record<string,GroupBankValueV2>;readonly changes:Record<string,GroupBankValueV2>;readonly results:Record<string,number>[];readonly members:PackMemberColumns<A>[]}[];
  } | undefined;
  private packCall: { readonly signal: string; readonly context: CirclingPackContext<A>; readonly bank: Float64Array;
    readonly references: GroupStepReferenceV2<A>[]; readonly random: Rng;readonly captured:Record<string,GroupBankValueV2>;readonly values:Record<string,GroupBankValueV2>;readonly changes:Record<string,GroupBankValueV2>;readonly results:Record<string,number>[];readonly members:PackMemberColumns<A>[];readonly slot:number|undefined } | undefined;
  private packDepth=0;
  /** Select the pack profile (the binding rows: profile, resume) on the SAME admitted programme; `roster` lends the bodies
   *  findPrey picks from (the nearest request's roster). Scope, bodies and random streams stay the original owners'. */
  bindGuest(program: GroupGuestProjectionV2, input: unknown, loans: { readonly scope: Scope; readonly group: string; readonly handle: number;
    readonly roster: () => readonly A[] }): void { this.requirePack();
    if(!isJsonData(input))throw new Error('Pack guest binding requires JSON rows');
    const bindings = program.groupBindings, rows = v.parse(GroupGuestBindingSchema, structuredClone(input));
    if (this.packGuest !== undefined || this.initialized || loans.scope.disposed || loans.scope.disposing || loans.group.length === 0
      || !Number.isSafeInteger(loans.handle) || loans.handle < 1 || bindings === undefined || typeof program.prepareGroup !== 'function') throw new Error('Invalid pack guest binding');
    const shape = rows.profile === 'main' ? bindings : bindings.profiles?.find(row => row.id === rows.profile);
    if(Object.keys(rows.parameters).length!==1||!Number.isFinite(rows.parameters['boundsHalf'])||(rows.parameters['boundsHalf']??0)<=0)throw new Error('Missing pack bounds parameter');
    const signals = ['init', 'tick', ...this.members.map((_, slot) => `drive.${slot}`), ...this.members.map((_, slot) => `body.${slot}`)];
    if (shape === undefined || this.members.length > shape.members || signals.some(name => !shape.signals.includes(name))
      || !shape.bank.some(row => row.name === rows.resume.field && row.kind === 'number')) throw new Error('Incompatible pack guest profile');
    if(rows.capture!==undefined&&(rows.capture.slots.length>0||rows.capture.references.length>0||new Set(rows.capture.common).size!==rows.capture.common.length||rows.capture.common.some(name=>!shape.columns.some(column=>column.name===name))))throw new Error('Invalid pack capture declaration');
    const results = shape.columns.flatMap(row => row.source.kind === 'result' ? [row.source.channel] : []);
    Object.freeze(rows.resume.values);Object.freeze(rows.resume);
    const guest:NonNullable<StalkerBrain<A>['packGuest']> = { program, prepare: program.prepareGroup, bindings, scope: loans.scope, group: loans.group, handle: loans.handle,
      rows, codec: new GroupBankV2(shape.bank), results, roster: loans.roster, buffers:[] };
    const references=this.packReferences(guest),native=this.packValues(guest,references),values={...native,...packGuestReset};
    guest.buffers.push({bank:guest.codec.encode(values,guest.group,references),captured:values,values:native,changes:{},results:this.members.map(()=>Object.fromEntries(results.map(channel=>[channel,0]))),members:[]});this.packGuest=guest;
  }
  private siblings=0;
  protected bindSibling(next:StalkerBrain<A>):void{
    const guest=this.packGuest;if(guest===undefined)return;
    this.siblings++;
    next.bindGuest(guest.program,guest.rows,{scope:guest.scope,group:`${guest.group}.${this.siblings}`,handle:guest.handle*100+this.siblings,roster:guest.roster});
  }
  /** Run one original call on the bound program; false when unbound (the TS law runs). */
  private packValues(guest:NonNullable<StalkerBrain<A>['packGuest']>,references:readonly GroupStepReferenceV2<A>[],output?:Record<string,GroupBankValueV2>):Record<string,GroupBankValueV2>{
    const wire = (prey: CirclingPackPrey | null): string | null => prey === null ? null : references.find(row => row.body === prey)?.wire ?? null;
    const values=output??{};
    Object.assign(values,guest.rows.parameters);
    values['initialized']=this.initialized;values['time']=this.groupTime===-Infinity?null:this.groupTime;
    values['phase']=this.phase;values['awareness']=this.awareness;values['homeX']=this.homeX;values['homeZ']=this.homeZ;
    values['phaseT']=this.phaseT;values['roamX']=this.roamX;values['roamZ']=this.roamZ;values['roamT']=this.roamT;
    values['nextTokenT']=this.nextTokenT;values['boldT']=this.boldT;values['calmT']=this.calmT;values['hpStart']=this.hpStart;
    values['halfDone']=this.halfDone;values['deadSeen']=this.deadSeen;values['shadowDur']=this.shadowDur;
    values['howled']=this.howled;values['bites']=this.bites;values['scared']=this.scared;
    values['alpha']=this.alpha===null?0:this.members.indexOf(this.alpha)+1;
    values['prey']=wire(this.prey);values['pendingPrey']=wire(this.pendingPrey);return values;
  }
  private syncPackCall(call:NonNullable<StalkerBrain<A>['packCall']>,guest:NonNullable<StalkerBrain<A>['packGuest']>):void{
    const references=this.packReferences(guest);call.references.splice(0,call.references.length,...references);
    const values=this.packValues(guest,references,call.values),changed=call.changes;
    for(const key of Object.keys(changed))delete changed[key];
    for(const key of Object.keys(values)){const value=values[key];if(value===undefined)throw new Error('Missing pack capture value');if(key==='prey'||key==='pendingPrey'||!Object.is(value,call.captured[key]))changed[key]=value;}
    guest.codec.update(call.bank,changed,guest.group,references);Object.assign(call.captured,values);
  }
  private runPack(signal:string,context:CirclingPackContext<A>,random:Rng,slot?:number):boolean{
    const guest=this.packGuest;if(guest===undefined)return false;
    if(guest.scope.disposed||guest.scope.disposing||guest.program.prepareGroup!==guest.prepare||guest.program.groupBindings!==guest.bindings)throw new Error('Replaced pack guest binding');
    // Reserve the depth before roster/scalar getters can reenter, including preparation failures.
    const previous=this.packCall,depth=this.packDepth++;
    let members:PackMemberColumns<A>[]|undefined;
    try{
      const references=this.packReferences(guest);
      let buffer=guest.buffers[depth];
      const values=this.packValues(guest,references,buffer?.values);
      if(buffer===undefined){const initial={...values,...packGuestReset};buffer={bank:guest.codec.encode(initial,guest.group,references),captured:initial,values,changes:{},results:this.members.map(()=>Object.fromEntries(guest.results.map(channel=>[channel,0]))),members:[]};guest.buffers[depth]=buffer;}
      else{
        const changed=buffer.changes;for(const key of Object.keys(changed))delete changed[key];
        for(const key of Object.keys(values)){const value=values[key];if(value===undefined)throw new Error('Missing pack capture value');if(key==='prey'||key==='pendingPrey'||!Object.is(value,buffer.captured[key]))changed[key]=value;}
        for(let index=0;index<packGuestResetFields.length;index++){
          const name=packGuestResetFields[index];if(name===undefined)throw new Error('Missing pack reset field');
          if(!Object.is(buffer.captured[name],0))changed[name]=0;
        }
        guest.codec.update(buffer.bank,changed,guest.group,references);Object.assign(buffer.captured,values,packGuestReset);
      }
      members=buffer.members;
      this.packCall={signal,context,bank:buffer.bank,captured:buffer.captured,values:buffer.values,changes:buffer.changes,results:buffer.results,members:buffer.members,references,random,slot};
      this.runGuest(guest.program);
    }finally{try{if(members!==undefined)releasePackMembers(members);}finally{this.packDepth=depth;this.packCall=previous;}}
    return true;
  }
  /** members 1..n, then the roster's bodies, then the prey and pending prey when outside it (crowd prey by pose) */
  private packReferences(guest: NonNullable<StalkerBrain<A>['packGuest']>): GroupStepReferenceV2<A>[] {
    const rows: GroupStepReferenceV2<A>[] = this.members.map((body, slot) => ({ group: guest.group, slot, identity: body.entityId, wire: body.entityId, handle: slot + 1, body }));
    for (const body of guest.roster()) if (!this.members.includes(body)) rows.push({ group: `${guest.group}:prey`, slot: rows.length, identity: body.entityId, wire: body.entityId, handle: rows.length + 1, body });
    for (const prey of [this.prey, this.pendingPrey]) if (prey !== null && !rows.some(row => row.body === prey)) {
      const identity = this.packPorts.preyIdentity?.(prey); if (identity === undefined) throw new Error('Missing pack prey identity');
      rows.push({ group: `${guest.group}:prey`, slot: rows.length, identity, wire: identity, handle: rows.length + 1, body: prey, pose: true });
    }
    return rows;
  }
  protected override captureGuest(replies: readonly GroupStepNativeResultV2[]): GroupGuestFrameV2<A> {
    const call = this.packCall, guest = this.packGuest;
    if (call === undefined || guest === undefined) throw new Error('Missing pack guest call');
    if(guest.scope.disposed||guest.scope.disposing||guest.program.prepareGroup!==guest.prepare||guest.program.groupBindings!==guest.bindings)throw new Error('Replaced pack guest owner');
    // the environment's grass is a method of its owner: lent bound
    this.syncPackCall(call,guest);
    const { context, references } = call, env = this.packPorts.environment(), grass = (x: number, z: number): number => env.grassHeightAt(x, z);
    const results = call.results;
    while(results.length<this.members.length)results.push(Object.fromEntries(guest.results.map(channel=>[channel,0])));
    results.length=this.members.length;
    for(const row of results)for(const channel of Object.keys(row))row[channel]=0;
    for (const reply of replies) for (const [slot, row] of results.entries()) if (reply.member === undefined || reply.member.slot === slot) row[reply.channel] = reply.value;
    const ref = (prey: CirclingPackPrey | null): { identity: string; handle: number; body: CirclingPackPrey } | null => {
      const row = prey === null ? undefined : references.find(value => value.body === prey); return row === undefined ? null : { identity: row.identity, handle: row.handle, body: row.body };
    };
    const lent = new Map([['prey', ref(this.prey)], ['pending', ref(this.pendingPrey)]]);
    const player = { position: context.player }, observed = new Map<number,A>();
    const environment = { playerCrouched: false, playerFwdX: env.playerFwdX, playerFwdZ: env.playerFwdZ, playerMounted: env.playerMounted,
      playerHealth01: env.playerHealth01, light: 1, storm: false, wind: { x: 0, z: 0, strength: 0 }, grassHeightAt: grass };
    // The call depth is reserved before any live owner getter. Reuse only
    // private wrappers at that depth; every borrowed field is refreshed here.
    const members=call.members;members.length=this.members.length;
    for(let slot=0,count=this.members.length;slot<count;slot++){
      const actor=this.members[slot];if(actor===undefined)throw new Error('Missing pack member');
      let member=members[slot];
      if(member===undefined){
        member={scope:guest.scope,self:{group:guest.group,slot,identity:actor.entityId,actor},
          player,observed,t:context.t,dt:context.dt,context,environment,references:lent,results:results[slot]??{}};
        members[slot]=member;
      }else{
        member.self.identity=actor.entityId;member.self.actor=actor;member.player=player;member.observed=observed;
        member.t=context.t;member.dt=context.dt;member.context=context;member.environment=environment;member.references=lent;member.results=results[slot]??{};
      }
    }
    const roster = references.filter(row => row.group === `${guest.group}:prey` && row.pose !== true);
    return { input: { group: guest.group, handle: guest.handle, profile: guest.rows.profile, signal: call.signal, tick: 0, state: call.bank, members, references, random: call.random,
      ...(guest.rows.capture===undefined||call.slot===undefined?{}:{capture:{common:guest.rows.capture.common,slots:[...new Set([0,call.slot])]}}) },
      native: { scope: guest.scope, members, references, rosters: new Map([['foals', roster]]), group: { kind: 'pack', owner: this },
        contexts: members.map(() => context), ground: { normalY: (x, z) => this.packPorts.normalY(x, z) }, grass: { grassHeightAt: grass } },
      resume: guest.rows.resume };
  }
  protected override prepareGuestCommit(frame: GroupGuestFrameV2<A>, values: Readonly<Record<string, GroupBankValueV2>>): GroupGuestPublicationV2 {
    const call = this.packCall;
    if (call === undefined || frame.input.state !== call.bank) throw new Error('Foreign pack guest publication');
    const body = (value: GroupBankValueV2 | undefined): CirclingPackPrey | null => {
      if (value === null || value === undefined) return null;
      const row = call.references.find(reference => reference.wire === value); if (row === undefined) throw new Error('Unresolved pack guest prey'); return row.body;
    };
    const number = (name: string): number => { const value = values[name]; if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid pack guest ${name}`); return value; };
    const flag = (name: string): boolean => { const value = values[name]; if (typeof value !== 'boolean') throw new Error(`Invalid pack guest ${name}`); return value; };
    const phase = values['phase'], time = values['time'], alpha = number('alpha');
    if (typeof phase !== 'string' || !(['roam', 'shadow', 'encircle', 'regroup', 'break'] as const).some(name => name === phase)
      || (time !== null && typeof time !== 'number') || !Number.isInteger(alpha) || alpha < 0 || alpha > this.members.length) throw new Error('Invalid pack guest state');
    const next = { initialized: flag('initialized'), awareness: number('awareness'), homeX: number('homeX'), homeZ: number('homeZ'), phaseT: number('phaseT'),
      roamX: number('roamX'), roamZ: number('roamZ'), roamT: number('roamT'), nextTokenT: number('nextTokenT'), boldT: number('boldT'), calmT: number('calmT'),
      hpStart: number('hpStart'), halfDone: flag('halfDone'), deadSeen: number('deadSeen'), shadowDur: number('shadowDur'), howled: flag('howled'),
      bites: number('bites'), scared: flag('scared') };
    const prey = body(values['prey']), pendingPrey = body(values['pendingPrey']), leader = alpha === 0 ? null : this.members[alpha - 1] ?? null;
    const validate = (): void => { if (this.packCall !== call) throw new Error('Replaced pack guest call'); };
    return { validate, commit: () => {
      validate();
      this.phase = phase === 'roam' || phase === 'shadow' || phase === 'encircle' || phase === 'regroup' ? phase : 'break';
      Object.assign(this, next); this.groupTime = time ?? -Infinity; this.prey = prey; this.pendingPrey = pendingPrey; this.alpha = leader;
      Object.assign(call.captured,values);
    } };
  }


  /** Perform the shipping setup draws exactly once after every group/controller preflight succeeds; never run a decision or body. */
  initialize(): void { this.requirePack();
    if (this.initialized) throw new Error('Pack already initialized');
    if (this.packGuest !== undefined) {
      const rng = this.packPorts.sharedRng(), zero = new Vector3();
      this.runPack('init', { dt: 0, t: 0, player: zero, playerSpeed: 0, calm: true, rng, sound: () => undefined, claim: () => false,
        steer: () => undefined, pathYaw: () => 0 }, rng);
      return;
    }
    let small: A | null = null;
    for (const actor of this.members) if (small === null || actor.scale < small.scale) small = actor;
    for (const w of this.members) {
      w.mem['role'] = w === this.alpha ? ROLE_ALPHA : this.members.length >= 4 && w === small ? ROLE_SCOUT : ROLE_FLANK;
      w.mem['ox'] = (this.packPorts.sharedRng().next() - 0.5) * 8; w.mem['oz'] = (this.packPorts.sharedRng().next() - 0.5) * 8;
      w.mem['hitT'] = w.lastHitT;
      w.mem['ring'] = this.packSpec.ringMinRadius + this.packPorts.sharedRng().next() * (this.packSpec.ringMaxRadius - this.packSpec.ringMinRadius);
    }
    this.initialized = true;
  }

  /** Group continuation stores timers, tokens and trusted prey references; actors and shared RNG are snapshotted by their owner. */
  snapshotPack(): string { this.requirePack();
    const preyId = (prey: CirclingPackPrey | null): string | null => {
      if (prey === null) return null;
      if (this.packPorts.preyIdentity === undefined) throw new Error('Missing prey snapshot port');
      return this.packPorts.preyIdentity(prey);
    };
    return JSON.stringify({ contract: this.contract, group: this.snapshotGroup(actor => actor.entityId), alpha: this.alpha?.entityId ?? null,
      prey: preyId(this.prey), pendingPrey: preyId(this.pendingPrey), state: {
        initialized: this.initialized, phase: this.phase, awareness: this.awareness, homeX: this.homeX, homeZ: this.homeZ, phaseT: this.phaseT,
        roamX: this.roamX, roamZ: this.roamZ, roamT: this.roamT, nextTokenT: this.nextTokenT, boldT: this.boldT,
        calmT: this.calmT, hpStart: this.hpStart, halfDone: this.halfDone, deadSeen: this.deadSeen,
        shadowDur: this.shadowDur, howled: this.howled, bites: this.bites, scared: this.scared } });
  }
  /** Reject changed tuning, missing prey or forged members before applying any continuation; restore never runs a body or RNG. */
  private restorePack(saved: string): void {
    const data = v.parse(packContinuation, JSON.parse(saved));
    if (data.contract !== this.contract) throw new Error('Incompatible pack continuation');
    const alpha = data.alpha === null ? null : this.members.find(actor => actor.entityId === data.alpha);
    if (alpha === undefined) throw new Error('Unresolved pack leader');
    const resolve = (id: string | null): CirclingPackPrey | null => {
      if (id === null) return null;
      const prey = this.packPorts.resolvePrey?.(id);
      if (prey === undefined || prey === null || this.packPorts.preyIdentity?.(prey) !== id) throw new Error('Unresolved pack prey');
      return prey;
    };
    const prey = resolve(data.prey), pendingPrey = resolve(data.pendingPrey);
    this.restoreGroup(data.group, actor => actor.entityId);
    this.alpha = alpha; this.prey = prey; this.pendingPrey = pendingPrey;
    Object.assign(this, data.state);
  }

  /** a stampede / lightning / anything terrifying at (x, z): the pack breaks if a wolf is within `r` m */
  scare(x: number, z: number, r = 20): void { this.requirePack();
    for (const w of this.members) if (w.alive && Math.hypot(w.position.x - x, w.position.z - z) < r) { this.scared = true; return; }
  }

  get alive(): number { let n = 0; for (const w of this.members) if (w.alive) n++; return n; }

  /** B1: send a roaming pack after `p` (a raid on the flock) — false if it is busy (hunting, ringing you, fleeing) or dead */
  raid(p: CirclingPackPrey): boolean { this.requirePack();
    if (this.phase !== 'roam' || this.alive === 0 || !p.alive) return false;
    this.pendingPrey = p;
    return true;
  }

  private setPhase(p: CirclingPackPhase, c: CirclingPackContext<A>): void {
    if (p === this.phase) return;
    this.phase = p; this.phaseT = 0;
    if (p === 'shadow') {
      this.shadowDur = c.rng.range(9, 16);
      // the scout gives the pack away with a yip
      for (const w of this.members) if (w.alive && w.mem['role'] === ROLE_SCOUT) { this.sound(c, w, this.packSpec.yipCue); break; }
    }
    if (p === 'regroup') this.howled = false;
    if (p === 'break') { for (const w of this.members) { w.mem['lunge'] = 0; w.cancelAttack(); } this.packPorts.onEvent?.('pack-break', this.cx(), this.cz()); }
    if (p === 'roam') { this.prey = null; this.pickRoam(c); }
    this.onPhase?.(p, this);
  }

  private cx(): number { let x = 0, n = 0; for (const w of this.members) if (w.alive) { x += w.position.x; n++; } return n > 0 ? x / n : this.homeX; }
  private cz(): number { let z = 0, n = 0; for (const w of this.members) if (w.alive) { z += w.position.z; n++; } return n > 0 ? z / n : this.homeZ; }

  private sound(c: CirclingPackContext<A>, _w: A, name: string): void { c.sound(name); }

  private pickRoam(c: CirclingPackContext<A>): void {
    for (let i = 0; i < 16; i++) {
      const ang = c.rng.range(0, Math.PI * 2), r = c.rng.range(40, 90);
      const x = this.homeX + Math.cos(ang) * r, z = this.homeZ + Math.sin(ang) * r;
      if (!this.packPorts.inBounds(x, z, 30) || this.packPorts.normalY(x, z) < 0.8) continue;
      this.roamX = x; this.roamZ = z; break;
    }
    this.roamT = c.rng.range(60, 120);
  }

  /** where the hunt is aimed (the player, or the prey) */
  private target(c: CirclingPackContext<A>): Vector3 { return this.prey !== null ? this.prey.position : c.player; }
  /** the direction the target faces, as a yaw (animal convention: atan2(x, z)) */
  private targetFacing(): number { return this.prey !== null ? this.prey.yaw : Math.atan2(this.packPorts.environment().playerFwdX, this.packPorts.environment().playerFwdZ); }

  /** the pack-level tick: senses, phase changes, the attack token (once per AI tick, whichever wolf thinks first) */
  tick(c: CirclingPackContext<A>): void {
    try{ this.requirePack();
    if (!this.initialized) throw new Error('Pack is not initialized');
    if(this.packGuest!==undefined&&Math.abs(c.t-this.groupTime)<1e-8)return;
    if (this.runPack('tick', c, c.rng)) return;
    const dt = this.groupDelta(c.t, c.dt);
    if (dt <= 0) return;
    this.phaseT += dt; this.boldT = Math.max(0, this.boldT - dt); this.calmT = Math.max(0, this.calmT - dt);
    let living = 0, hp = 0, dead = 0;
    for (const w of this.members) { if (w.alive) { living++; hp += w.hp; } else dead++; }
    if (living === 0) return;
    if (this.prey !== null && !this.prey.alive) {
      this.packPorts.onEvent?.('prey-killed', this.prey.position.x, this.prey.position.z);
      this.prey = null; this.setPhase('roam', c); this.calmT = 40;
    }

    // ── senses → pack awareness ──
    let rate = 0;
    let hit = false;
    for (const w of this.members) {
      if (!w.alive) continue;
      if (w.lastHitT > (w.mem['hitT'] ?? -Infinity)) { w.mem['hitT'] = w.lastHitT; hit = true; }
      if (c.calm || this.calmT > 0) continue;
      const dx = c.player.x - w.position.x, dz = c.player.z - w.position.z, d = Math.hypot(dx, dz);
      const V = this.packPorts.visibility(w.position.x, w.position.z, c.player, c.playerSpeed, c.t);
      const sight = this.packSpec.sightRadius * V;
      if (d < sight && Math.abs(angDiff(Math.atan2(dx, dz), w.yaw)) < this.packSpec.coneAngle) rate = Math.max(rate, 0.5 * (2 - d / sight));
      const hear = this.packPorts.hearing(this.packSpec.hearing, c.player, c.playerSpeed);
      if (d < hear) rate = Math.max(rate, 0.6 * (2 - d / hear));
      if (d < this.packSpec.smellRadius && this.packPorts.downwind(w.position.x, w.position.z, c.player)) rate = Math.max(rate, 0.35 * (2 - d / this.packSpec.smellRadius));
    }
    if (hit && this.calmT <= 0) { this.awareness = 1; if (this.prey !== null) { this.prey = null; } }
    this.awareness = rate > 0 ? Math.min(1, this.awareness + rate * dt) : Math.max(0, this.awareness - 0.1 * dt);

    // ── break conditions ──
    const alphaDead = this.alpha !== null && !this.alpha.alive;
    const lastOne = this.members.length > 1 && living <= 1;
    if (this.phase !== 'break' && (alphaDead || lastOne || this.scared)) { this.scared = false; this.setPhase('break', c); }
    this.scared = false;

    const tgt = this.target(c);
    const al = this.alpha;
    const dAlpha = al?.alive === true ? al.position.distanceTo(tgt) : Math.hypot(this.cx() - tgt.x, this.cz() - tgt.z);
    switch (this.phase) {
      case 'roam': {
        // B1: a raid — the pack goes after the flock's sheep, whatever it had of you
        if (this.pendingPrey !== null) {
          const p = this.pendingPrey;
          this.pendingPrey = null;
          if (p.alive) { this.prey = p; this.awareness = 0; this.calmT = 0; this.setPhase('shadow', c); break; }
        }
        this.roamT -= dt;
        if (this.roamT <= 0 || (Math.hypot(this.cx() - this.roamX, this.cz() - this.roamZ) < 6 && c.rng.next() < 0.05)) this.pickRoam(c);
        if (this.awareness >= 0.35) { this.setPhase(hit ? 'encircle' : 'shadow', c); break; }
        // a foal nearby: hunt it (only when the pack has not found you)
        if (this.findPrey !== undefined && this.calmT <= 0 && this.awareness < 0.1 && c.rng.next() < 0.01) {
          const p = this.findPrey(this.cx(), this.cz(), 70);
          if (p !== null) { this.prey = p; this.setPhase('shadow', c); }
        }
        break;
      }
      case 'shadow':
        if (hit) { this.setPhase('encircle', c); break; }
        if (this.prey === null && this.awareness < 0.15) { this.setPhase('roam', c); break; }
        if (dAlpha < 22 || this.phaseT > this.shadowDur || (this.prey !== null && this.phaseT > 6)) this.setPhase('encircle', c);
        break;
      case 'encircle': {
        if (dead > this.deadSeen || (!this.halfDone && hp < this.hpStart * 0.5)) {
          if (hp < this.hpStart * 0.5) this.halfDone = true;
          this.deadSeen = dead;
          if (this.alpha?.alive === true) { this.setPhase('regroup', c); break; }
        }
        if (this.prey === null && this.awareness < 0.08 && dAlpha > 50) { this.setPhase('roam', c); break; }
        this.assignToken(c);
        break;
      }
      case 'regroup':
        // the alpha howls (2.2 s), the others answer; all pull back to 30 m; then in again, bolder
        if (!this.howled && this.alpha !== null) { this.howled = true; this.sound(c, this.alpha, this.packSpec.howlCue); this.packPorts.onEvent?.('howl', this.alpha.position.x, this.alpha.position.z); }
        if (this.phaseT > 3.6) { this.boldT = 10; this.nextTokenT = c.t + 0.6; this.setPhase('encircle', c); }
        break;
      case 'break': {
        let far = true;
        for (const w of this.members) if (w.alive && w.position.distanceTo(c.player) < 70) far = false;
        if (far || this.phaseT > 14) { this.calmT = 120; this.awareness = 0; this.setPhase('roam', c); }
        break;
      }
      // no default
    }
    }catch(error){if(this.packGuest===undefined)throw error;this.skipGuestFrame(error);}
  }

  /** hand the attack token(s) to the wolves best placed behind the target */
  private assignToken(c: CirclingPackContext<A>): void {
    const tgt = this.target(c);
    let lungers = 0, living = 0;
    for (const w of this.members) if (w.alive) { living++; const l = w.mem['lunge'] ?? 0; if (l === 1 || l === 2) lungers++; }
    const tokens = (this.packPorts.environment().playerMounted && this.prey === null ? 2 : 1) + (this.boldT > 0 ? 1 : 0);
    if (lungers >= tokens || c.t < this.nextTokenT) return;
    const facing = this.targetFacing();
    let best: A | null = null, bestScore = -Infinity;
    for (const w of this.members) {
      if (!w.alive || w.stunned || (w.mem['lunge'] ?? 0) !== 0) continue;
      const d = w.position.distanceTo(tgt);
      if (d > 24) continue;
      const role = w.mem['role'] ?? ROLE_FLANK;
      if (role === ROLE_ALPHA && living > 1 && this.packPorts.environment().playerHealth01 >= 0.6 && this.bites < 3) continue;   // the alpha holds back
      const behind = Math.abs(angDiff(Math.atan2(w.position.x - tgt.x, w.position.z - tgt.z), facing));   // π = straight behind
      const score = behind - d * 0.03 + (role === ROLE_SCOUT && this.bites === 0 ? 1.5 : 0);
      if (score > bestScore) { bestScore = score; best = w; }
    }
    if (best === null) return;
    const director = this.groupDirector(tokens, (actor) => actor.alive && ((actor.mem['lunge'] ?? 0) === 1 || (actor.mem['lunge'] ?? 0) === 2));
    this.packPorts.register(best, director);
    if (!c.claim(best)) return;
    best.mem['lhit'] = best.lastHitT; best.mem['lunge'] = 1; best.mem['lt'] = this.packSpec.telegraphSeconds; best.mem['bit'] = 0;
    this.sound(c, best, this.packSpec.snarlCue);
    this.nextTokenT = c.t + (this.boldT > 0 ? c.rng.range(1.2, 2.0) : c.rng.range(2.5, 4.0));
  }

  /** steer one wolf for this tick (after `tick`) */
  drive(a: A, c: CirclingPackContext<A>, body = false): void {
    try{ this.requirePack();
    if (!this.initialized) throw new Error('Pack is not initialized');
    if(this.packGuest!==undefined&&body!==(this.phase==='encircle'&&(a.mem['lunge']??0)!==0))return;
    if (this.runPack(`${body ? 'body' : 'drive'}.${this.members.indexOf(a)}`, c, c.rng,this.members.indexOf(a))) return;
    const m = a.mem;
    const committed = this.phase === 'encircle' && (m['lunge'] ?? 0) !== 0;
    if (body !== committed) return;
    const dt = c.dt;
    const tgt = this.target(c);
    const dx = tgt.x - a.position.x, dz = tgt.z - a.position.z, d = Math.hypot(dx, dz);
    const toTgt = Math.atan2(dx, dz);
    const role = m['role'] ?? ROLE_FLANK;
    let low = 0, snarl = 0, howl = 0;
    a.lookTarget.copy(tgt); a.lookWeight = this.phase === 'roam' ? 0 : 0.8;
    // a hit mid-lunge staggers it and breaks the lunge off
    const lunge = m['lunge'] ?? 0;
    if ((lunge === 1 || lunge === 2) && a.lastHitT > (m['lhit'] ?? -Infinity)) {
      _t.set(-dx, 0, -dz).normalize();
      a.stagger(_t, 0.7); a.cancelAttack();
      m['lunge'] = 3; m['lt'] = this.packSpec.breakoffSeconds + 0.5;
    }
    m['lhit'] = a.lastHitT;

    switch (this.phase) {
      case 'roam': {
        const tx = this.roamX + (m['ox'] ?? 0), tz = this.roamZ + (m['oz'] ?? 0);
        const td = Math.hypot(tx - a.position.x, tz - a.position.z);
        if (td > 3) this.steerSep(a, c, c.pathYaw(a, tx, tz, 2), td > 25 ? this.packSpec.trotSpeed : 1.6, 2.5);
        else { a.setMotion(a.yaw, 0, 1.5); a.state = 'graze'; }   // sniffing the ground
        if (td > 3) a.state = 'wander';
        break;
      }
      case 'shadow': {
        a.state = 'stalk'; low = 1;
        // stay 30–40 m out on our side of the target, in the tallest grass we can find
        m['st'] = (m['st'] ?? 0) - dt;
        if (m['st'] <= 0 || m['sx'] === undefined) {
          m['st'] = 1.5;
          const bearing = Math.atan2(a.position.x - tgt.x, a.position.z - tgt.z);
          const r = this.packSpec.shadowMinRadius + (a.seed % 1) * (this.packSpec.shadowMaxRadius - this.packSpec.shadowMinRadius);
          let bestG = -1, bx = a.position.x, bz = a.position.z;
          for (let k = -2; k <= 2; k++) {
            const ang = bearing + k * 0.3;
            const x = tgt.x + Math.sin(ang) * r, z = tgt.z + Math.cos(ang) * r;
            if (!this.packPorts.inBounds(x, z, 24)) continue;
            const g = this.packPorts.environment().grassHeightAt(x, z) - Math.abs(k) * 0.05;
            if (g > bestG) { bestG = g; bx = x; bz = z; }
          }
          m['sx'] = bx; m['sz'] = bz;
        }
        const sx = m['sx'] ?? a.position.x, sz = m['sz'] ?? a.position.z;
        const sd = Math.hypot(sx - a.position.x, sz - a.position.z);
        const speed = d > 55 ? this.packSpec.runSpeed * 0.8 : sd > 4 ? this.packSpec.trotSpeed : sd > 1.5 ? 1.4 : 0;
        if (speed > 0) this.steerSep(a, c, c.pathYaw(a, sx, sz, 1.5), speed, 3);
        else a.setMotion(toTgt, 0, 2);
        break;
      }
      case 'encircle': {
        a.state = 'stalk';
        if (lunge === 1) {
          // the telegraph: stop, face, crouch, snarl
          a.state = 'attack'; low = 1; snarl = 1;
          a.setMotion(toTgt, 0, 6);
          m['lt'] = (m['lt'] ?? 0) - dt;
          if ((m['lt'] ?? 0) <= 0) { m['lunge'] = 2; m['lt'] = this.packSpec.dashSeconds; }
          break;
        }
        if (lunge === 2) {
          a.state = 'charge'; snarl = 1;
          c.steer(a, toTgt, this.packSpec.runSpeed * a.mods.speed, 7);
          if (d < 2.6 && a.attackPhase < 0) a.startAttack(this.packSpec.attackSeconds);
          m['lt'] = (m['lt'] ?? 0) - dt;
          if (d < this.packSpec.biteRadius * Math.max(1, a.scale) + 0.25 && (m['bit'] ?? 0) === 0) {
            m['bit'] = 1; this.bites++;
            this.sound(c, a, this.packSpec.biteCue);
            if (this.prey !== null) { _t.set(dx, 0, dz).normalize(); this.prey.applyDamage(role === ROLE_ALPHA ? 22 : 15, this.prey.position, _t); }
            else { this.packPorts.bite(a, c, this.packSpec.biteRadius * Math.max(1, a.scale) + 0.25); if (this.packPorts.environment().playerMounted) this.packPorts.onEvent?.('rider-bitten', a.position.x, a.position.z); }   // B1: the horse panics
            m['lunge'] = 3; m['lt'] = this.packSpec.breakoffSeconds;
          } else if ((m['lt'] ?? 0) <= 0) { m['lunge'] = 3; m['lt'] = this.packSpec.breakoffSeconds * 0.6; }
          break;
        }
        if (lunge === 3) {
          // hard break-off: out and round, back toward the ring
          a.state = 'flee';
          m['lt'] = (m['lt'] ?? 0) - dt;
          const out = Math.atan2(-dx, -dz) + ((a.seed * 10) % 2 < 1 ? 0.6 : -0.6);
          c.steer(a, out, 8, 5);
          if ((m['lt'] ?? 0) <= 0) { m['lunge'] = 0; a.cancelAttack(); }
          break;
        }
        // on the ring: take the slot, drift with the target's turning, never cut through it
        const slot = this.slotFor(a, c);
        const R = (m['ring'] ?? 14) + (role === ROLE_ALPHA ? 5 : 0);
        const bearing = Math.atan2(a.position.x - tgt.x, a.position.z - tgt.z);
        const step = MathUtils.clamp(angDiff(slot, bearing), -0.7, 0.7);
        const ang = bearing + step;
        const px = tgt.x + Math.sin(ang) * R, pz = tgt.z + Math.cos(ang) * R;
        const pd = Math.hypot(px - a.position.x, pz - a.position.z);
        low = 0.25;   // on the ring: slinking, head still over the grass
        if (pd > 1.2) this.steerSep(a, c, pd > 6 ? c.pathYaw(a, px, pz, 0.8) : Math.atan2(px - a.position.x, pz - a.position.z), pd > 10 ? this.packSpec.runSpeed * 0.85 : pd > 3 ? this.packSpec.trotSpeed * 1.2 : 2.2, 4);
        else a.setMotion(toTgt, 0, 3);
        break;
      }
      case 'regroup': {
        a.state = 'alert';
        if (a === this.alpha) {
          a.setMotion(toTgt, 0, 2);
          howl = this.phaseT < 2.6 ? 1 : 0;
          a.lookWeight = 0;
        } else if (d < 29) {
          this.steerSep(a, c, Math.atan2(-dx, -dz), this.packSpec.runSpeed * 0.8, 4);   // pull back to 30 m…
        } else {
          a.setMotion(toTgt, 0, 2); howl = this.phaseT > 0.8 && this.phaseT < 2.8 && (a.seed * 7) % 1 > 0.35 ? 1 : 0;   // …and answer the howl
        }
        m['lunge'] = 0;
        break;
      }
      case 'break':
        a.state = 'flee';
        this.steerSep(a, c, Math.atan2(-dx, -dz), this.packSpec.runSpeed * a.mods.speed, 3.5);
        break;
      // no default
    }
    // pose knobs (postPose eases toward them)
    m['low'] = ease(m['low'] ?? 0, low, dt * 5);
    m['snarl'] = ease(m['snarl'] ?? 0, snarl, dt * 8);
    m['howl'] = ease(m['howl'] ?? 0, howl, dt * 4);
    // stealth: still in tall grass and more than 10 m out → hidden (off the minimap, out of aim assist)
    m['hidden'] = a.speed < 0.5 && d > 10 && this.packPorts.environment().grassHeightAt(a.position.x, a.position.z) >= 0.8 ? 1 : 0;
    }catch(error){if(this.packGuest===undefined)throw error;this.skipGuestFrame(error);}
  }

  /** the ring angle (bearing from the target) this wolf should hold: slots spread round the back, out of the view cone */
  private slotFor(a: A, c: CirclingPackContext<A>): number {
    const tgt = this.target(c);
    const behind = this.targetFacing() + Math.PI;
    // ring members in bearing order (relative to "behind"); a tiny n, so a sort of a small scratch array is fine
    const ring = this.ringScratch; ring.length = 0;
    for (const w of this.members) if (w.alive && (w.mem['lunge'] ?? 0) === 0) ring.push(w);
    const n = ring.length;
    if (n <= 1) return behind;
    const rel = (w: A): number => angDiff(Math.atan2(w.position.x - tgt.x, w.position.z - tgt.z), behind);
    ring.sort((p, q) => rel(p) - rel(q));
    const spacing = Math.min((Math.PI * 2) / n, (Math.PI * 1.5) / (n - 1));
    const k = ring.indexOf(a);
    return behind + (k - (n - 1) / 2) * spacing;
  }
  private ringScratch: A[] = [];

  /** steer with a little separation from pack-mates so they don't stack */
  private steerSep(a: A, c: CirclingPackContext<A>, yaw: number, speed: number, turnRate: number): void {
    let vx = Math.sin(yaw), vz = Math.cos(yaw);
    for (const w of this.members) {
      if (w === a || !w.alive) continue;
      const ox = a.position.x - w.position.x, oz = a.position.z - w.position.z, d = Math.hypot(ox, oz);
      if (d < 2.2 && d > 1e-3) { const f = (1 - d / 2.2) * 1.2; vx += (ox / d) * f; vz += (oz / d) * f; }
    }
    c.steer(a, Math.atan2(vx, vz), speed, turnRate);
  }
}

/** Complete admitted data, independent of validator implementation metadata. */
type BoundedHowlerSpecInput = BoundedHowlerSpec;
interface BoundedHowlerSpecFields {
    initialHowl: number;
    engagedHowl: number;
    phaseCooldown: number;
    interruptedHowl: number;
    nextHowl: number;
    randomHowl: number;
    pathSeconds: number;
    pathNear: number;
    homePathSeconds: number;
    homeStop: number;
    homeReset: number;
    meleeRadius: number;
    grassHeight: number;
    hiddenDamage: number;
    fields: {
        howl: string;
        low: string;
        snarl: string;
    };
    speeds: {
        home: number;
        watched: number;
        hold: number;
        hunt: number;
        bite: number;
    };
    turns: {
        home: number;
        den: number;
        hold: number;
        howl: number;
        hunt: number;
        bite: number;
    };
    hold: {
        watchedDot: number;
        minRadius: number;
        maxRadius: number;
        sidestep: number;
        arrival: number;
        watchedLow: number;
        low: number;
    };
    hunt: {
        snarlDistance: number;
        attackDistance: number;
        moveDistance: number;
    };
    bite: {
        seconds: number;
        phase: number;
        range: number;
        damage: number;
        cooldown: number;
    };
    howl: {
        growSeconds: number;
        seconds: number;
        radius: number;
        speed: number;
        span: number;
        strength: number;
        stagger: number;
        scare: number;
    };
}
type BoundedHowlerSpec = { [Key in keyof BoundedHowlerSpecFields]: BoundedHowlerSpecFields[Key] };
type BoundedHowlerSaveInput = BoundedHowlerSave;
interface BoundedHowlerSaveFields {
    st: "howl" | "home" | "hold" | "hunt" | "den";
    howlT: number;
    stT: number;
    howlHit: number;
    cd: number;
    bit: boolean;
}
type BoundedHowlerSave = { [Key in keyof BoundedHowlerSaveFields]: BoundedHowlerSaveFields[Key] };
type BoundedPouncerSpecInput = BoundedPouncerSpec;
interface BoundedPouncerSpecFields {
    initialCooldown: number;
    awareCooldown: number;
    lookIdle: number;
    homeRadius: number;
    pathSeconds: number;
    ledgeMargin: number;
    standRate: number;
    openSeconds: number;
    openCooldown: number;
    fields: {
        low: string;
        leap: string;
        snarl: string;
    };
    pose: {
        stalk: number;
        perch: number;
        open: number;
        leapSwing: number;
        leapBase: number;
    };
    speeds: {
        home: number;
        perch: number;
        stalk: number;
        back: number;
    };
    turns: {
        home: number;
        idle: number;
        swipeStart: number;
        perch: number;
        stalk: number;
        tell: number;
        open: number;
        swipe: number;
    };
    stalk: {
        far: number;
        near: number;
    };
    perch: {
        minHeight: number;
        maxHeight: number;
        minDistance: number;
        maxDistance: number;
        arrival: number;
        retreatHeight: number;
        retreatDistance: number;
        cooldown: number;
        waitSeconds: number;
    };
    damage: {
        airborne: number;
        openHead: number;
        perched: number;
    };
    swipe: {
        from: number;
        seconds: number;
        first: number;
        second: number;
        range: number;
        damage: number;
        cooldown: number;
    };
    pounce: {
        minDistance: number;
        maxDistance: number;
        seconds: number;
        arcHeight: number;
        range: number;
        damage: number;
        cooldown: number;
    };
    tell: {
        radius: number;
        strength: number;
        growth: number;
        growSeconds: number;
        seconds: number;
    };
}
type BoundedPouncerSpec = { [Key in keyof BoundedPouncerSpecFields]: BoundedPouncerSpecFields[Key] };
type BoundedPouncerSaveInput = BoundedPouncerSave;
interface BoundedPouncerSaveFields {
    st: "home" | "leap" | "stalk" | "perch" | "open" | "tell" | "swipe" | "lurk";
    stT: number;
    cd: number;
    from: [
        number,
        number,
        number
    ];
    to: [
        number,
        number,
        number
    ];
    goal: {
        x: number;
        z: number;
        y: number;
    } | null;
    hitDone: 0 | 1 | 2;
}
type BoundedPouncerSave = { [Key in keyof BoundedPouncerSaveFields]: BoundedPouncerSaveFields[Key] };
