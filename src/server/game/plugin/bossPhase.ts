import { ScriptBossProfileSchema, type BossProfile } from '@wildshard/format/bossProfiles';
import { EliteScriptLane } from './brain';
import { bodyBossFight, type BodyBossActor, type HeldBossFight, type HeldBossPorts, type HeldBossRow, type SpawnedBossFight, type SpawnedBossPorts, type SpawnedBossRow } from '../../../shared/game/plugin/bodyBoss';
import { createRoamingBossFight } from "../shardfile/phasedBossRoaming";
import type { BossScript } from '@wildshard/engine/ai/BossBrain';
import { MathUtils, Vector3 } from 'three';
import * as v from 'valibot';

/**
 * A phased boss fight (SHARD-PLATFORM SF27): the richer sibling of `markedBossFight`. One body fought through declared
 * phases; a declared state machine of modes (each with its damage rule, its hp lock, its motion and its timed beats);
 * attack patterns as strike rows (a cut combo, a charged burst, a roar); invulnerability windows; adds that step out in
 * waves while the boss is shielded; arena hazards (expanding rings, timed pours, a sweeping beam); and named VIEW
 * bindings (`arena.lid.open`, `hazard.sweep`, …) the shard binds to its own view code. The fight's logic is platform and
 * view-free; the shard keeps its rows, its arena (floor heights, drifts) and its views.
 *
 * Other bosses fit the same table: a mode per stance, a strike row per attack, a hazard per arena trick, a view per
 * dressing change.
 */

/** A declared view call as data: the view's name and its numeric arguments (`['arena.shaft', 0, 0.38]`). */
export type BossViewCall = readonly [string, ...number[]];
/** The shard's view bindings: one function per declared view name, numeric arguments only (positions are world space). */
export type BossViewBinding = Readonly<Record<string, (...args: number[]) => void>>;

/** What a mode change does, applied in this order: the mode clock, the attack cancel, memory, yaw, motion, hp lock, views, adds, cooldowns, a feed line. */
export interface BossEffect {
  /** The new mode's clock (default 0). */
  readonly modeT?: number;
  /** Cancel the attack in progress (the act field drops to 0 with it when `mem` says so). */
  readonly cancel?: boolean;
  /** Memory fields written on the body (the body's animation reads them). */
  readonly mem?: Readonly<Record<string, number>>;
  /** Snap the body's yaw. */
  readonly yaw?: number;
  /** The body's motion: yaw, speed, turn rate. */
  readonly motion?: readonly [number, number, number];
  /** Lock hp where it stands (shielded modes and beats restore it every tick). */
  readonly lockHp?: boolean;
  /** View calls. */
  readonly views?: readonly BossViewCall[];
  /** Spawn a wave of adds. */
  readonly wave?: boolean;
  /** Cooldowns set. */
  readonly cooldowns?: Readonly<Record<string, number>>;
  /** A feed line. */
  readonly line?: string;
}

/** A mode's motion in the 10 Hz think: hold still, fight (attacks then chase), face the player or a yaw, or walk to a spot. */
export type BossMotion =
  | { readonly kind: 'hold' }
  | { readonly kind: 'fight' }
  | { readonly kind: 'face'; readonly yaw?: number; readonly turn: number }
  | { readonly kind: 'goto'; readonly spot: 'shield'; readonly speed: number; readonly turn: number; readonly arrive: number; readonly roarTurn: number; readonly next: string };

/** A mode's timed beat: after `seconds` in the mode (and only in `phase` when given), go to `to` with `effect`. */
export interface BossTimeout { readonly seconds: number; readonly to: string; readonly phase?: number; readonly effect?: BossEffect }

/** One mode of the fight's state machine. */
export interface BossModeRow {
  /** Damage taken: 0 = immune, 1 = normal, above 1 = a soft opening (a stun). */
  readonly damage: number;
  /** The bar shimmers and hp is locked every tick. */
  readonly shielded: boolean;
  /** The body looks at the player (1) or not (0). */
  readonly look: number;
  /** The mode drives the body's glow (the intro's modes leave it to the intro). */
  readonly glows: boolean;
  readonly motion: BossMotion;
  readonly timeouts?: readonly BossTimeout[];
  /** Entering the mode through `enter` (a goto's arrival, a resume) applies this. */
  readonly enter?: BossEffect;
}

/** A cut in a combo: its damage, reach multiplier, arc half-width (rad), the shove on a hit, and whether its arc is painted. */
export interface BossCutRow { readonly damage: number; readonly reachMul: number; readonly arc: number; readonly shove: number; readonly painted: boolean }

/** The fight's attack patterns (strike rows), tried in order each think: the burst, then the combo, else the chase. Pairs are [normal, enraged]. */
export interface BossAttackRows {
  /** The charged burst: its act id, range (min, max m), wind-up seconds, the fraction it fires at, how many rings, the cooldown after (base + rng × spread). */
  readonly burst: {
    readonly act: number; readonly min: number; readonly max: number; readonly seconds: readonly [number, number]; readonly fireAt: number;
    readonly rings: readonly [number, number]; readonly after: readonly [readonly [number, number], readonly [number, number]]; readonly comboFloor: number;
    readonly lines: readonly [string, string];
  };
  /** The combo: its act id, reach (m), how far past reach it engages, the cuts (count per stance), wind-up seconds per cut, contact fraction, chain range past reach, rest after. */
  readonly combo: {
    readonly act: number; readonly reach: number; readonly engage: number; readonly count: readonly [number, number]; readonly seconds: readonly [number, number];
    readonly hitAt: number; readonly chain: number; readonly rest: readonly [number, number]; readonly cuts: readonly BossCutRow[]; readonly above: number;
  };
  /** Committed attacks turn slowly through the wind-up (`turn[0]` before `windup`), barely through the cut. */
  readonly commit: { readonly windup: number; readonly turn: readonly [number, number] };
  /** The chase between attacks: stop distance, speed per stance, turn rate. */
  readonly chase: { readonly stop: number; readonly speed: readonly [number, number]; readonly turn: number };
}

/** A phase change's roar: its act id and length, and a memory field it sheds (fades 1 → 0 past `from` at `rate`/s, 0 at the end). */
export interface BossRoarRow { readonly act: number; readonly seconds: number; readonly shed?: { readonly field: string; readonly from: number; readonly rate: number } }

/** One phase: its hp share at the checkpoint, its memory at reset, how a fight resumed at it begins, and what entering it does. */
export interface BossPhaseRow {
  readonly at: number;
  /** Memory written at a reset to this checkpoint. */
  readonly mem?: Readonly<Record<string, number>>;
  /** A fight resumed at this checkpoint: placed at the shield spot and entering `mode`, its memory, the sweep started. */
  readonly resume?: { readonly shieldSpot?: boolean; readonly mode?: string; readonly mem?: Readonly<Record<string, number>>; readonly sweep?: boolean };
  /** Entering this phase mid-fight. */
  readonly enter?: {
    readonly roar?: BossRoarRow; readonly line?: string; readonly mode: string; readonly modeT: number; readonly views?: readonly BossViewCall[];
    readonly pourDelay?: number; readonly pourStop?: boolean; readonly sweep?: boolean; readonly crownReset?: boolean; readonly lineFirst?: boolean;
    readonly cooldowns?: Readonly<Record<string, number>>;
  };
}

/** The expanding ring hazard (a burst's): start radius, gap between rings (s), speed (m/s), last radius, contact band, jump clearance, damage, push. */
export interface BossRingRow {
  readonly count: number; readonly start: number; readonly gap: number; readonly speed: number; readonly max: number; readonly band: number;
  readonly jump: number; readonly damage: number; readonly push: number; readonly pushTime: number; readonly strike: string;
}
/** The timed pour hazard: its spots (arena-local), the phase it runs in, the pick interval, tell and pour lengths, fades, what it piles, how it hurts. */
export interface BossPourRow {
  readonly spots: readonly { readonly x: number; readonly z: number }[]; readonly phase: number; readonly every: readonly [number, number];
  readonly tell: number; readonly pour: number; readonly fadeIn: number; readonly fadeOut: readonly [number, number];
  readonly pile: { readonly r: number; readonly rate: number; readonly cap: number };
  readonly hitRadius: number; readonly hitRate: number; readonly damage: number; readonly strike: string; readonly reset: number;
}
/** The sweeping beam hazard: its arc (radius, z squash, z offset, angular speed, limit, start), ease, what it hurts and how often, and its burn on the boss. */
export interface BossSweepRow {
  readonly radius: number; readonly squash: number; readonly offset: number; readonly speed: number; readonly limit: number; readonly start: number;
  readonly ease: number; readonly hitRadius: number; readonly damage: number; readonly every: number; readonly strike: string;
  readonly boss: { readonly damage: number; readonly every: number; readonly extra: number; readonly line: string };
}
/** Adds: their spots (arena-local, pushed out by `push` along x), the pairs that alternate, the shielded mode they guard, the reinforce wait, the retire delay and the beat when the last falls. */
export interface BossAddsRow {
  readonly spots: readonly { readonly x: number; readonly z: number; readonly yaw: number }[]; readonly push: number;
  readonly pairs: readonly [readonly number[], readonly number[]]; readonly mode: string; readonly reinforce: number; readonly retireAfter: number;
  readonly cleared: { readonly to: string; readonly effect: BossEffect };
}

/** A phased boss fight's row: everything but the views and the arena, as data. */
export interface PhasedBossRow {
  /** The arena's frame (world): every arena-local spot is relative to it. */
  readonly origin: { readonly x: number; readonly y: number; readonly z: number };
  /** The body stays within ±`bounds` m of the origin. */
  readonly bounds: number;
  /** Its rest (arena-local): where it wakes, the floor there (plinth + lift above the origin), the rest box (half sizes less `inset`). */
  readonly rest: { readonly x: number; readonly z: number; readonly plinth: number; readonly lift: number; readonly halfW: number; readonly halfL: number; readonly inset: number; readonly focusY: number };
  /** Where it kneels to shield (arena-local). */
  readonly shieldSpot: { readonly x: number; readonly z: number };
  /** The phase from which it is enraged (the second of every pair). */
  readonly enragedFrom: number;
  readonly phases: readonly BossPhaseRow[];
  readonly modes: Readonly<Record<string, BossModeRow>>;
  /** The modes the fight starts, rises, fights and dies in. */
  readonly modeNames: { readonly rest: string; readonly rising: string; readonly fight: string; readonly dead: string };
  readonly attacks: BossAttackRows;
  /** The memory fields the fight drives: the attack's act, the cut's index, its hit latch, the floor height, the smoothed floor, the rise and the pose. */
  readonly fields: { readonly act: string; readonly strike: string; readonly hitDone: string; readonly floorY: string; readonly floorS: string; readonly rise: string; readonly pose: string };
  /** The reset: memory, cooldowns (base + rng × spread for `burst`), the drifts piled from `drifts.fromPhase`, the view calls. */
  readonly reset: {
    readonly mem: Readonly<Record<string, number>>; readonly combo: number; readonly burst: readonly [number, number]; readonly pourDelay: number;
    readonly drifts: { readonly fromPhase: number; readonly height: number; readonly cap: number; readonly at: readonly (readonly [number, number, number])[] };
    readonly views: readonly BossViewCall[]; readonly glow: number;
  };
  /** The intro (long, short): the lid's window, the rise's window, the shaft's pulse length; the shaft and the glow's waking. */
  readonly intro: {
    readonly long: { readonly lid: readonly [number, number]; readonly rise: readonly [number, number]; readonly pulse: number };
    readonly short: { readonly lid: readonly [number, number]; readonly rise: readonly [number, number]; readonly pulse: number };
    readonly shaft: { readonly index: number; readonly base: number; readonly amp: number };
    readonly glow: { readonly base: number; readonly peak: number; readonly lead: number; readonly fade: number };
  };
  /** The fight begins: memory, cooldowns (burst base + rng × spread), view calls, the resting glow. */
  readonly begin: { readonly mem: Readonly<Record<string, number>>; readonly combo: number; readonly burst: readonly [number, number]; readonly views: readonly BossViewCall[] };
  /** The glow: resting, the glint's and charge's weights and fades, the enraged burn. */
  readonly glow: { readonly base: number; readonly glint: number; readonly charge: number; readonly glintFade: number; readonly chargeFade: number; readonly burn: readonly [number, number, number] };
  /** Damage: the head sphere (radius × scale + pad), the armour melee breaks (range, hits, ranged share until broken, line). */
  readonly hits: { readonly head: readonly [number, number]; readonly armour: { readonly melee: number; readonly breaks: number; readonly ranged: number; readonly line: string } };
  /** A weak point worn by headshots from `fromPhase`: its hp, the memory field it lives on, the beat when it breaks. */
  readonly crown: { readonly hp: number; readonly fromPhase: number; readonly field: string; readonly to: string; readonly effect: BossEffect };
  readonly rings: BossRingRow;
  readonly pour: BossPourRow;
  readonly sweep: BossSweepRow;
  readonly adds: BossAddsRow;
  /** The victory: its view calls, when the body crumbles (s) and how fast the arena drains. */
  readonly victory: { readonly views: readonly BossViewCall[]; readonly crumble: number; readonly drain: number };
  /** Every view name the fight may call (the binding must bind exactly these). */
  readonly views: readonly string[];
}

/** The body a phased boss fight drives: the engine's animal (browser or headless) structurally. */
export interface PhasedBossBody {
  readonly position: Vector3;
  yaw: number;
  hp: number;
  readonly maxHp: number;
  readonly alive: boolean;
  hidden: boolean;
  readonly mem: Record<string, number>;
  readonly attackPhase: number;
  readonly scale: number;
  readonly lookTarget: Vector3;
  lookWeight: number;
  startAttack: (seconds: number) => void;
  cancelAttack: () => void;
  setMotion: (yaw: number, speed: number, turn?: number) => void;
  place: (x: number, z: number, yaw: number) => void;
  headWorld: (out: Vector3) => Vector3;
  applyDamage: (amount: number, point: Vector3, dir: Vector3) => boolean;
}

/** The boss body's brain the species forwards to: the 10 Hz think, the per-frame act and the damage rule. */
export interface PhasedBossBrain<A extends PhasedBossBody> {
  think: (a: A, c: { dt: number; player: Vector3 }) => void;
  act: (a: A, c: { player: Vector3 }) => void;
  damageMul: (a: A, point: Vector3) => number;
}

/** What a phased boss fight is lent: the arena, the bodies, the player, the hit resolvers, the rng, the feed and the views. */
export interface PhasedBossPorts<A extends PhasedBossBody> {
  readonly arena: {
    /** The walkable height at a world point (the drifts included), undefined off the arena. */
    readonly floorAt: (x: number, z: number) => number | undefined;
    /** Pile drift (arena-local): a mound of radius r rising by dh, capped. */
    readonly pile: (x: number, z: number, r: number, dh: number, cap: number) => void;
    readonly clear: () => void;
    readonly drain: (dt: number, rate: number) => void;
    readonly inArena: (p: Vector3) => boolean;
    readonly seal: (on: boolean) => void;
  };
  readonly body: {
    /** Spawn the boss body at a world point (herd, footing set). */
    readonly spawn: (x: number, z: number) => A | null;
    /** Out of the fight for good (hidden, out of every list). */
    readonly retire: (a: A) => void;
    readonly bind: (a: A, brain: PhasedBossBrain<A>) => void;
    /** Shown and footed at the reset (its floor height). */
    readonly ready: (a: A, floorY: number) => void;
  };
  /** Spawn the add for spot `i` at a world point and yaw. */
  readonly spawnAdd: (i: number, x: number, z: number, yaw: number) => A;
  readonly player: { readonly position: Vector3; readonly dash: (x: number, z: number, seconds: number) => void };
  /** The player takes `damage` (through walls for hazards). */
  readonly hurt: (damage: number, throughWalls?: boolean) => void;
  /** Resolve the combo's cut `i` from the body (true when it connects; `onHit` deals it). */
  readonly cut: (i: number, a: A, onHit: () => void) => boolean;
  /** Resolve a hazard's contact from a world point (the shard's strike row by name). */
  readonly hazard: (strike: string, from: Vector3, onHit: () => void, opts?: { ringRadius: number }) => void;
  readonly rng: () => number;
  readonly feed: (line: string) => void;
  readonly views: BossViewBinding;
  /** Where the reward floats and where a dead player comes back. */
  readonly rewardPoint: () => Vector3;
  readonly respawnPoint: () => { pos: Vector3; yaw: number };
}

interface Ring { r: number; delay: number; active: boolean; hit: boolean; cx: number; cz: number }
interface Stream { st: number; t: number }
interface Add<A> { a: A; niche: number; deadT: number }

/** A phased boss fight's continuation: its mode and clocks, cooldowns, glow, armour and crown, adds, hazards and victory clock. */
export interface PhasedBossState {
  mode: string; phase: number; invuln: boolean; lockHp: number; modeT: number; comboLeft: number; comboCd: number; burstCd: number;
  glow: number; glint: number; plaques: number; chestOpen: boolean; headHp: number; lastHp: number; lastHeadHit: boolean;
  waves: number; waveT: number; rings: Ring[]; streams: Stream[]; streamT: number;
  beamOn: boolean; beamA: number; beamDir: number; beamHitCd: number; beamKingCd: number; beamK: number; victoryT: number;
}

/** Complete fixed-arena continuation. Bodies retain their native owner's
 * identities; restoring never resets an encounter or manufactures an actor. */
export interface PhasedBossContinuation {
  readonly version: 1; readonly state: PhasedBossState; readonly king: string | null;
  readonly adds: readonly { readonly id: string; readonly niche: number; readonly deadT: number }[];
}
const phaseFinite = v.pipe(v.number(), v.finite());
const phaseCount = v.pipe(phaseFinite, v.integer(), v.minValue(0));
const phaseIdentity = v.pipe(v.string(), v.minLength(1), v.maxLength(512));
const PhasedContinuationSchema = v.strictObject({version:v.literal(1),king:v.nullable(phaseIdentity),
  adds:v.array(v.strictObject({id:phaseIdentity,niche:phaseCount,deadT:v.pipe(phaseFinite,v.minValue(0))})),
  state:v.strictObject({mode:phaseIdentity,phase:phaseCount,invuln:v.boolean(),lockHp:phaseFinite,modeT:phaseFinite,
    comboLeft:phaseCount,comboCd:phaseFinite,burstCd:phaseFinite,glow:phaseFinite,glint:phaseFinite,plaques:phaseCount,
    chestOpen:v.boolean(),headHp:phaseFinite,lastHp:phaseFinite,lastHeadHit:v.boolean(),waves:phaseCount,waveT:phaseFinite,
    rings:v.array(v.strictObject({r:phaseFinite,delay:phaseFinite,active:v.boolean(),hit:v.boolean(),cx:phaseFinite,cz:phaseFinite})),
    streams:v.array(v.strictObject({st:v.picklist([0,1,2]),t:phaseFinite})),streamT:phaseFinite,beamOn:v.boolean(),beamA:phaseFinite,
    beamDir:v.picklist([-1,1]),beamHitCd:phaseFinite,beamKingCd:phaseFinite,beamK:phaseFinite,victoryT:phaseFinite})});

/** A phased boss fight: the engine's `BossScript`, the body's brain, its bodies and its continuation. */
export interface PhasedBossFight<A extends PhasedBossBody> {
  readonly script: BossScript;
  readonly brain: PhasedBossBrain<A>;
  /** The boss body (null before the first reset). */
  readonly body: () => A | null;
  /** The live adds' bodies. */
  readonly adds: () => readonly A[];
  readonly mode: () => string;
  readonly phase: () => number;
  /** The armour is broken (melee tore it). */
  readonly armourBroken: () => boolean;
  readonly snapshot: () => PhasedBossState;
  /** Detached scalar state plus the host's original body identities. */
  readonly continuation: (identify: (body: A) => string) => PhasedBossContinuation;
  /** Quietly adopt already restored native bodies, after complete validation. */
  readonly restore: (saved: unknown, find: (id: string) => A | null) => void;
  /** Debug: kill the boss now. */
  readonly kill: () => void;
}

/**
 * A phased boss fight from its row (SF27): the declared modes, phases, attack rows, adds and hazards, view-free; the
 * shard lends the arena, the bodies and the view bindings. `script` runs under the engine's `BossBrain`; the species
 * forwards its think / act / damage rule to `brain`. Every rng draw, spawn and view call keeps the shipped order.
 */
function fixedPhasedBossFight<A extends PhasedBossBody>(row: PhasedBossRow, ports: PhasedBossPorts<A>): PhasedBossFight<A> {
  const declared = new Set(row.views);
  for (const name of row.views) if (typeof ports.views[name] !== 'function') throw new Error(`phased boss: view ${name} is not bound`);
  for (const name of Object.keys(ports.views)) if (!declared.has(name)) throw new Error(`phased boss: view ${name} is not declared`);
  const view = (name: string, ...args: number[]): void => {
    const fn = ports.views[name];
    if (fn === undefined || !declared.has(name)) throw new Error(`phased boss: view ${name} is not declared`);
    fn(...args);
  };
  const views = (calls: readonly BossViewCall[] | undefined): void => { if (calls) for (const [name, ...args] of calls) view(name, ...args); };
  const o = row.origin, F = row.fields, atk = row.attacks, names = row.modeNames, rest = row.rest;
  const _v = new Vector3(), _w = new Vector3(), _h = new Vector3(), _focus = new Vector3();
  const modeRow = (name: string): BossModeRow => { const m = row.modes[name]; if (m === undefined) throw new Error(`phased boss: no mode ${name}`); return m; };
  const s: PhasedBossState = {
    mode: names.rest, phase: 0, invuln: false, lockHp: 0, modeT: 0, comboLeft: 0, comboCd: 1.5, burstCd: 6, glow: 0, glint: 0,
    plaques: 0, chestOpen: false, headHp: row.crown.hp, lastHp: 0, lastHeadHit: false, waves: 0, waveT: 0,
    rings: Array.from({ length: row.rings.count }, () => ({ r: 0, delay: 0, active: false, hit: false, cx: 0, cz: 0 })),
    streams: row.pour.spots.map(() => ({ st: 0, t: 0 })), streamT: row.pour.reset,
    beamOn: false, beamA: row.sweep.start, beamDir: 1, beamHitCd: 0, beamKingCd: 0, beamK: 0, victoryT: -1,
  };
  let king: A | null = null;
  let adds: Add<A>[] = [];
  const enraged = (): boolean => s.phase >= row.enragedFrom;
  const pick = <T>(pair: readonly [T, T]): T => enraged() ? pair[1] : pair[0];

  const setCooldown = (key: string, value: number): void => { if (key === 'combo') s.comboCd = value; else if (key === 'burst') s.burstCd = value; else throw new Error(`phased boss: no cooldown ${key}`); };
  const spawnWave = (): void => {
    const A = row.adds, pair = s.waves % 2 === 0 ? A.pairs[0] : A.pairs[1];
    for (const i of pair) {
      const n = A.spots[i];
      if (!n) continue;
      const sx = Math.sign(n.x);
      _v.set(o.x + (n.x + sx * A.push), o.y + 0, o.z + n.z);
      const a = ports.spawnAdd(i, _v.x, _v.z, n.yaw);
      view('adds.spot', i, 0);
      adds.push({ a, niche: i, deadT: 0 });
    }
    s.waves++; s.waveT = 0;
  };

  const apply = (k: A, to: string, e: BossEffect | undefined): void => {
    s.mode = to; s.modeT = e?.modeT ?? 0;
    if (e === undefined) return;
    if (e.cancel === true) k.cancelAttack();
    if (e.mem) for (const [key, value] of Object.entries(e.mem)) k.mem[key] = value;
    if (e.yaw !== undefined) k.yaw = e.yaw;
    if (e.motion) k.setMotion(e.motion[0], e.motion[1], e.motion[2]);
    if (e.lockHp === true) s.lockHp = k.hp;
    views(e.views);
    if (e.wave === true) spawnWave();
    if (e.cooldowns) for (const [key, value] of Object.entries(e.cooldowns)) setCooldown(key, value);
    if (e.line !== undefined) ports.feed(e.line);
  };
  const enter = (to: string): void => { if (king) apply(king, to, modeRow(to).enter); };

  const startStrike = (a: A, i: number): void => {
    const m = a.mem;
    m[F.act] = atk.combo.act; m[F.strike] = i; m[F.hitDone] = 0;
    s.comboLeft--;
    a.startAttack(pick(atk.combo.seconds));
    s.glint = 1;
    if (atk.combo.cuts[i]?.painted === true) view('strike.arc', a.position.x, a.mem[F.floorY] ?? o.y, a.position.z, a.yaw);
  };

  const shove = (a: A, speed: number): void => {
    const pl = ports.player.position, dx = pl.x - a.position.x, dz = pl.z - a.position.z, l = Math.max(0.1, Math.hypot(dx, dz));
    ports.player.dash(dx / l * speed, dz / l * speed, 0.15);
  };

  const fightTick = (a: A, dist: number, toPlayer: number): void => {
    const m = a.mem, b = atk.burst, c = atk.combo;
    if (a.attackPhase >= 0) return;
    if (s.burstCd <= 0 && dist < b.max && dist > b.min) { m[F.act] = b.act; m[F.hitDone] = 0; a.startAttack(pick(b.seconds)); return; }
    if (dist <= c.reach + c.engage && s.comboCd <= 0) { s.comboLeft = pick(c.count); startStrike(a, 0); return; }
    a.setMotion(toPlayer, dist > atk.chase.stop ? pick(atk.chase.speed) : 0, atk.chase.turn);
  };

  const fireRings = (a: A, n: number): void => {
    for (let i = 0; i < n; i++) {
      const r = s.rings[i];
      if (!r) continue;
      r.active = true; r.hit = false; r.r = row.rings.start; r.delay = i * row.rings.gap;
      r.cx = a.position.x; r.cz = a.position.z;
    }
    ports.feed(n > 1 ? atk.burst.lines[1] : atk.burst.lines[0]);
  };

  const roarOf = (act: number): BossRoarRow | undefined => { for (const p of row.phases) if (p.enter?.roar?.act === act) return p.enter.roar; return undefined; };

  const think = (a: A, c: { dt: number; player: Vector3 }): void => {
    const m = a.mem, mode = modeRow(s.mode);
    const lx = a.position.x - o.x, lz = a.position.z - o.z;
    const inRest = Math.abs(lx - rest.x) < rest.halfW - rest.inset && Math.abs(lz - rest.z) < rest.halfL - rest.inset;
    m[F.floorY] = inRest ? o.y + rest.plinth + rest.lift : ports.arena.floorAt(a.position.x, a.position.z) ?? o.y;
    a.lookTarget.copy(c.player); a.lookWeight = mode.look;
    const dx = c.player.x - a.position.x, dz = c.player.z - a.position.z, dist = Math.hypot(dx, dz), toPlayer = Math.atan2(dx, dz);
    s.comboCd -= c.dt; s.burstCd -= c.dt;
    const motion = mode.motion;
    switch (motion.kind) {
      case 'hold': a.setMotion(a.yaw, 0, 1); break;
      case 'fight': fightTick(a, dist, toPlayer); break;
      case 'goto': {
        if (a.attackPhase >= 0 && a.attackPhase < 1) { a.setMotion(toPlayer, 0, motion.roarTurn); break; }
        if (a.attackPhase >= 1) a.cancelAttack();
        _v.set(o.x + row.shieldSpot.x, o.y + 0, o.z + row.shieldSpot.z);
        const hx = _v.x - a.position.x, hz = _v.z - a.position.z, hd = Math.hypot(hx, hz);
        // A long capsule lies along its heading, so a boss walking head-on at its plinth can stop short of the spot for good.
        // No walk crosses the arena's diagonal for longer than this: past it, he has arrived and the fight goes on.
        if (hd < motion.arrive || s.modeT > 2 * Math.SQRT2 * row.bounds / motion.speed) enter(motion.next);
        else a.setMotion(Math.atan2(hx, hz), motion.speed, motion.turn);
        break;
      }
      case 'face': a.setMotion(motion.yaw ?? toPlayer, 0, motion.turn); break;
      default: break;
    }
    const lim = row.bounds;
    a.position.x = MathUtils.clamp(a.position.x, o.x - lim, o.x + lim);
    a.position.z = MathUtils.clamp(a.position.z, o.z - lim, o.z + lim);
  };

  const act = (a: A, c: { player: Vector3 }): void => {
    if (s.mode !== names.fight) return;
    if (a.attackPhase < 0) return;
    const m = a.mem, which = m[F.act] ?? 0, phase = a.attackPhase, b = atk.burst, cb = atk.combo;
    const dx = c.player.x - a.position.x, dz = c.player.z - a.position.z, dist = Math.hypot(dx, dz), toPlayer = Math.atan2(dx, dz);
    a.setMotion(toPlayer, 0, phase < atk.commit.windup ? atk.commit.turn[0] : atk.commit.turn[1]);
    if (which === cb.act) {
      const i = m[F.strike] ?? 0;
      if (phase >= cb.hitAt && m[F.hitDone] !== 1) {
        m[F.hitDone] = 1;
        view('strike.arc.off');
        let off = toPlayer - a.yaw; off = Math.atan2(Math.sin(off), Math.cos(off));
        const cut = cb.cuts[i] ?? cb.cuts[0], pl = ports.player.position;
        if (cut !== undefined && dist <= cb.reach * cut.reachMul && Math.abs(off) < cut.arc && pl.y < a.position.y + cb.above) {
          const damage = cb.cuts[i]?.damage ?? cut.damage;
          if (ports.cut(i, a, () => { ports.hurt(damage); })) shove(a, cut.shove);
        }
      }
      if (phase >= 1) {
        a.cancelAttack();
        if (s.comboLeft > 0 && dist < cb.reach + cb.chain) startStrike(a, i + 1);
        else { s.comboLeft = 0; s.comboCd = pick(cb.rest); m[F.act] = 0; }
      }
    } else if (which === b.act) {
      s.glow = Math.min(1, phase / b.fireAt);
      if (phase >= b.fireAt && m[F.hitDone] !== 1) { m[F.hitDone] = 1; fireRings(a, pick(b.rings)); }
      if (phase >= 1) {
        a.cancelAttack(); m[F.act] = 0;
        const [base, spread] = pick(b.after);
        s.burstCd = base + ports.rng() * spread; s.comboCd = Math.max(s.comboCd, b.comboFloor);
      }
    } else {
      const shed = roarOf(which)?.shed;
      if (phase >= 1) { if (shed) m[shed.field] = 0; a.cancelAttack(); m[F.act] = 0; }
      else if (shed && phase > shed.from) m[shed.field] = Math.max(0, 1 - (phase - shed.from) * shed.rate);
    }
  };

  const damageMul = (a: A, hitPoint: Vector3): number => {
    const mode = modeRow(s.mode);
    if (s.invuln || mode.damage === 0) return 0;
    a.headWorld(_h);
    const soft = mode.damage, H = row.hits;
    if (_h.distanceTo(hitPoint) < H.head[0] * a.scale + H.head[1]) { s.lastHeadHit = true; return soft; }
    const pl = ports.player.position;
    const melee = Math.hypot(hitPoint.x - pl.x, hitPoint.z - pl.z) < H.armour.melee;
    if (melee) {
      s.plaques++;
      if (s.plaques === H.armour.breaks && !s.chestOpen) { s.chestOpen = true; ports.feed(H.armour.line); }
      return soft;
    }
    return (s.chestOpen ? 1 : H.armour.ranged) * soft;
  };
  const brain: PhasedBossBrain<A> = { think, act, damageMul };

  const updateRings = (dt: number): void => {
    const R = row.rings, pl = ports.player.position;
    for (let i = 0; i < s.rings.length; i++) {
      const r = s.rings[i];
      if (!r || !r.active) continue;
      if (r.delay > 0) { r.delay -= dt; view('hazard.ring.off', i); continue; }
      r.r += R.speed * dt;
      const floorY = ports.arena.floorAt(pl.x, pl.z) ?? o.y;
      const dp = Math.hypot(pl.x - r.cx, pl.z - r.cz);
      if (!r.hit && Math.abs(dp - r.r) < R.band && pl.y - floorY < R.jump) {
        r.hit = true;
        ports.hazard(R.strike, _v.set(r.cx, pl.y, r.cz), () => { ports.hurt(R.damage, true); }, { ringRadius: r.r });
        ports.player.dash((pl.x - r.cx) / Math.max(0.1, dp) * R.push, (pl.z - r.cz) / Math.max(0.1, dp) * R.push, R.pushTime);
      }
      view('hazard.ring', i, r.cx, r.cz, r.r);
      if (r.r >= R.max) { r.active = false; view('hazard.ring.off', i); }
    }
  };

  const updateAdds = (dt: number): void => {
    const A = row.adds;
    let alive = 0;
    for (const b of adds) {
      if (b.a.alive) { alive++; continue; }
      b.deadT += dt;
      if (b.deadT > A.retireAfter && !b.a.hidden) ports.body.retire(b.a);
    }
    if (s.mode === A.mode && king) {
      s.waveT += dt;
      if (s.waves % 2 === 1 && s.waveT > A.reinforce && alive > 0) spawnWave();
      if (alive === 0 && adds.length > 0 && adds.every((b) => !b.a.alive)) {
        const e = A.cleared.effect;
        views(e.views);
        s.mode = A.cleared.to; s.modeT = e.modeT ?? 0;
        if (e.mem) for (const [key, value] of Object.entries(e.mem)) king.mem[key] = value;
        adds = adds.filter((b) => !b.a.hidden);
        if (e.line !== undefined) ports.feed(e.line);
      }
    }
  };

  const updatePour = (dt: number): void => {
    const P = row.pour, pouring = s.phase === P.phase && s.mode !== names.dead;
    if (pouring) {
      s.streamT -= dt;
      if (s.streamT <= 0) {
        s.streamT = P.every[0] + ports.rng() * P.every[1];
        const free = s.streams.map((st, i) => (st.st === 0 ? i : -1)).filter((i) => i >= 0);
        const pickI = free[Math.floor(ports.rng() * free.length)];
        const st = pickI !== undefined ? s.streams[pickI] : undefined;
        if (st) { st.st = 1; st.t = 0; }
      }
    }
    for (let i = 0; i < s.streams.length; i++) {
      const st = s.streams[i], spot = P.spots[i];
      if (!st || !spot) continue;
      if (st.st === 0) { view('hazard.pour.off', i); continue; }
      st.t += dt;
      if (st.st === 1) {
        view('hazard.pour.tell', i, st.t);
        if (st.t > P.tell) { st.st = 2; st.t = 0; }
      } else {
        const k = Math.min(1, st.t * P.fadeIn) * (1 - MathUtils.smoothstep(st.t, P.fadeOut[0], P.fadeOut[1]));
        view('hazard.pour.fall', i, k);
        ports.arena.pile(spot.x, spot.z, P.pile.r, P.pile.rate * dt * k, P.pile.cap);
        const pl = ports.player.position;
        if (Math.hypot(pl.x - o.x - spot.x, pl.z - o.z - spot.z) < P.hitRadius && ports.rng() < dt * P.hitRate) {
          ports.hazard(P.strike, _v.set(o.x + spot.x, pl.y, o.z + spot.z), () => { ports.hurt(P.damage, true); });
        }
        if (st.t > P.pour || !pouring) { st.st = 0; st.t = 0; }
      }
    }
  };

  const updateSweep = (dt: number): void => {
    const W = row.sweep;
    s.beamK += ((s.beamOn && s.mode !== names.dead ? 1 : 0) - s.beamK) * Math.min(1, dt * W.ease);
    if (s.beamK < 0.01) { view('hazard.sweep.off'); return; }
    s.beamA += s.beamDir * W.speed * dt;
    if (s.beamA > W.limit || s.beamA < -W.limit) s.beamDir *= -1;
    const cx = Math.sin(s.beamA) * W.radius, cz = Math.cos(s.beamA) * W.radius * W.squash + W.offset;
    view('hazard.sweep', cx, cz, s.beamA, s.beamDir, s.beamK);
    const pl = ports.player.position;
    s.beamHitCd -= dt; s.beamKingCd -= dt;
    if (s.beamHitCd <= 0 && Math.hypot(pl.x - o.x - cx, pl.z - o.z - cz) < W.hitRadius) {
      s.beamHitCd = W.every;
      ports.hazard(W.strike, _v.set(o.x + cx, pl.y, o.z + cz), () => { ports.hurt(W.damage, true); });
    }
    const k = king;
    if (k && k.alive && s.beamKingCd <= 0 && !s.invuln && Math.hypot(k.position.x - o.x - cx, k.position.z - o.z - cz) < W.hitRadius + W.boss.extra) {
      s.beamKingCd = W.boss.every;
      k.headWorld(_h);
      k.applyDamage(W.boss.damage, _h, _w.set(0, -1, 0));
      ports.feed(W.boss.line);
    }
  };

  const startSweep = (): void => { s.beamOn = true; s.beamA = row.sweep.start; s.beamDir = 1; };
  const resetStreams = (all: boolean): void => { for (const st of s.streams) if (all || st.st !== 0) { st.st = 0; st.t = 0; } };

  const script: BossScript = {
    get hpFrac() { return king ? Math.max(0, king.hp / king.maxHp) : 0; },
    get shielded() { return modeRow(s.mode).shielded; },
    get dead() { return king !== null && !king.alive; },
    inArena: (p) => ports.arena.inArena(p),
    seal: (on) => { ports.arena.seal(on); },
    clampHp: (frac) => { if (king) { king.hp = Math.max(1, Math.round(king.maxHp * frac)); s.lockHp = king.hp; s.lastHp = king.hp; } },
    setInvulnerable: (on) => { s.invuln = on; if (on && king) s.lockHp = king.hp; },
    rewardPoint: () => ports.rewardPoint(),
    respawnPoint: () => ports.respawnPoint(),
    reset: (phase) => {
      s.phase = phase;
      let k = king;
      if (k === null || !k.alive) {
        if (k !== null) ports.body.retire(k);
        _v.set(o.x + rest.x, o.y + 0, o.z + rest.z);
        k = ports.body.spawn(_v.x, _v.z);
        if (k === null) throw new Error('The declared boss body could not be spawned');
        king = k;
      }
      ports.body.bind(k, brain);
      const ph = row.phases[phase], at = ph?.at ?? 1;
      k.hp = Math.round(k.maxHp * at); s.lastHp = k.hp; s.lockHp = k.hp;
      _v.set(o.x + rest.x, o.y + 0, o.z + rest.z);
      k.place(_v.x, _v.z, 0);
      k.cancelAttack(); k.setMotion(0, 0, 1); k.lookWeight = 0;
      const m = k.mem;
      for (const [key, value] of Object.entries(row.reset.mem)) m[key] = value;
      if (ph?.mem) for (const [key, value] of Object.entries(ph.mem)) m[key] = value;
      const floorY = o.y + rest.plinth + rest.lift;
      m[F.floorY] = floorY; m[F.floorS] = floorY;
      k.hidden = false;
      ports.body.ready(k, floorY);
      s.mode = names.rest; s.modeT = 0; s.invuln = false;
      s.comboLeft = 0; s.comboCd = row.reset.combo; s.burstCd = row.reset.burst[0] + ports.rng() * row.reset.burst[1];
      s.plaques = 0; s.chestOpen = false; s.headHp = row.crown.hp; s.glow = 0; s.glint = 0;
      for (const b of adds) ports.body.retire(b.a);
      adds = []; s.waves = 0; s.waveT = 0;
      for (let i = 0; i < row.adds.spots.length; i++) view('adds.spot', i, 1);
      for (const r of s.rings) r.active = false;
      resetStreams(true);
      s.streamT = row.reset.pourDelay; s.beamOn = false; s.beamK = 0; s.victoryT = -1;
      view('arena.fx.hide');
      ports.arena.clear();
      const D = row.reset.drifts;
      if (phase >= D.fromPhase) for (const [x, z, r] of D.at) ports.arena.pile(x, z, r, D.height, D.cap);
      views(row.reset.views);
      view('boss.glow', row.reset.glow);
    },
    intro: (t, short) => {
      const k = king, I = row.intro, w = short ? I.short : I.long;
      view('arena.lid.open', MathUtils.clamp((t - w.lid[0]) / (w.lid[1] - w.lid[0]), 0, 1));
      view('arena.shaft', I.shaft.index, I.shaft.base + I.shaft.amp * Math.sin(Math.min(1, t / w.pulse) * Math.PI));
      if (k) {
        s.mode = names.rising;
        const [r0, r1] = w.rise, G = I.glow;
        k.mem[F.rise] = MathUtils.clamp((t - r0) / (r1 - r0), 0, 1);
        view('boss.glow', G.base + G.peak * MathUtils.smoothstep(t, r1 - G.lead, r1) * (1 - MathUtils.smoothstep(t, r1, r1 + G.fade)));
        k.headWorld(_focus);
        return _focus;
      }
      return _focus.set(o.x + rest.x, o.y + rest.focusY, o.z + rest.z);
    },
    begin: (phase) => {
      const k = king;
      if (!k) return;
      views(row.begin.views);
      for (const [key, value] of Object.entries(row.begin.mem)) k.mem[key] = value;
      s.mode = names.fight; s.modeT = 0;
      s.comboCd = row.begin.combo; s.burstCd = row.begin.burst[0] + ports.rng() * row.begin.burst[1];
      view('boss.glow', row.glow.base);
      const resume = row.phases[phase]?.resume;
      if (resume) {
        if (resume.mem) for (const [key, value] of Object.entries(resume.mem)) k.mem[key] = value;
        if (resume.shieldSpot === true) { _v.set(o.x + row.shieldSpot.x, o.y + 0, o.z + row.shieldSpot.z); k.place(_v.x, _v.z, 0); }
        if (resume.mode !== undefined) enter(resume.mode);
        if (resume.sweep === true) startSweep();
      }
    },
    enterPhase: (phase) => {
      s.phase = phase;
      const k = king;
      if (!k) return;
      k.cancelAttack(); s.comboLeft = 0; view('strike.arc.off');
      const e = row.phases[phase]?.enter;
      if (!e) return;
      if (e.roar) { k.mem[F.act] = e.roar.act; k.startAttack(e.roar.seconds); }
      if (e.lineFirst === true && e.line !== undefined) ports.feed(e.line);
      s.mode = e.mode; s.modeT = e.modeT;
      views(e.views);
      if (e.pourStop === true) resetStreams(false);
      if (e.pourDelay !== undefined) s.streamT = e.pourDelay;
      if (e.sweep === true) { startSweep(); s.beamK = 0; }
      if (e.crownReset === true) s.headHp = row.crown.hp;
      if (e.lineFirst !== true && e.line !== undefined) ports.feed(e.line);
      if (e.cooldowns) for (const [key, value] of Object.entries(e.cooldowns)) setCooldown(key, value);
    },
    victory: () => {
      s.mode = names.dead; s.victoryT = 0;
      s.beamOn = false;
      for (const r of s.rings) r.active = false;
      resetStreams(true);
      for (const b of adds) ports.body.retire(b.a);
      adds = [];
      views(row.victory.views);
    },
    update: (dt, t, fighting) => {
      const k = king;
      if (k) {
        if ((s.invuln || modeRow(s.mode).shielded) && k.alive && k.hp < s.lockHp) k.hp = s.lockHp;
        if (s.lastHeadHit) {
          const lost = s.lastHp - k.hp, C = row.crown;
          if (lost > 0 && k.alive && s.mode !== names.dead && s.phase >= C.fromPhase && (k.mem[C.field] ?? 1) > 0) {
            s.headHp -= lost;
            if (s.headHp <= 0) { k.mem[C.field] = 0; apply(k, C.to, C.effect); }
          }
          s.lastHeadHit = false;
        }
        s.lastHp = k.hp;
        const G = row.glow, b = atk.burst;
        s.glint = Math.max(0, s.glint - dt * G.glintFade);
        if ((k.mem[F.act] ?? 0) !== b.act) s.glow = Math.max(0, s.glow - dt * G.chargeFade);
        const burn = enraged() && s.mode !== names.dead ? G.burn[0] + G.burn[1] * Math.sin(t * G.burn[2]) : 0;
        if (modeRow(s.mode).glows) view('boss.glow', G.base + G.glint * s.glint + G.charge * s.glow + burn);
        const tell = s.rings[1];
        if (tell && !tell.active && (k.mem[F.act] ?? 0) === b.act && k.attackPhase >= 0 && k.attackPhase < b.fireAt) {
          view('hazard.ring.tell', k.position.x, k.mem[F.floorS] ?? o.y, k.position.z, k.attackPhase / b.fireAt);
        } else if (tell && !tell.active) view('hazard.ring.off', 1);
        s.modeT += dt;
        for (const out of modeRow(s.mode).timeouts ?? []) {
          if ((out.phase === undefined || out.phase === s.phase) && s.modeT > out.seconds) { apply(k, out.to, out.effect); break; }
        }
        if (s.mode === row.adds.mode) view('arena.shield.at', k.position.x, k.mem[F.floorS] ?? o.y, k.position.z);
      }
      if (fighting || s.mode === names.dead) { updateRings(dt); updateAdds(dt); updatePour(dt); updateSweep(dt); }
      if (s.victoryT >= 0 && k) {
        s.victoryT += dt;
        if (s.victoryT > row.victory.crumble && !k.hidden) { view('victory.heap', 1, k.position.x, k.position.z); ports.body.retire(k); }
        ports.arena.drain(dt, row.victory.drain);
      }
    },
  };

  return {
    script, brain, body: () => king, adds: () => adds.map((b) => b.a), mode: () => s.mode, phase: () => s.phase, armourBroken: () => s.chestOpen,
    snapshot: () => structuredClone(s),
    continuation: identify => ({version:1,state:structuredClone(s),king:king===null?null:identify(king),
      adds:adds.map(({a,niche,deadT})=>({id:identify(a),niche,deadT}))}),
    restore: (input,find) => {
      const saved=v.parse(PhasedContinuationSchema,input),state=saved.state;
      if(row.modes[state.mode]===undefined||state.phase>=row.phases.length||state.rings.length!==s.rings.length
        ||state.streams.length!==s.streams.length||saved.adds.some(add=>add.niche>=row.adds.spots.length))
        throw new Error('Incompatible phased boss continuation');
      const ids=[...(saved.king===null?[]:[saved.king]),...saved.adds.map(add=>add.id)];
      if(new Set(ids).size!==ids.length)throw new Error('Duplicate phased boss body');
      const bodies=new Map(ids.map(id=>{const body=find(id);if(body===null)throw new Error('Missing phased boss body');return [id,body] as const;}));
      if(new Set(bodies.values()).size!==bodies.size)throw new Error('Aliased phased boss body');
      const restoredKing=saved.king===null?null:bodies.get(saved.king);
      if(restoredKing===undefined)throw new Error('Missing phased boss king');
      const restoredAdds=saved.adds.map(add=>{const a=bodies.get(add.id);if(a===undefined)throw new Error('Missing phased boss add');
        return {a,niche:add.niche,deadT:add.deadT};});
      // Actor memory, hp, attacks and physics were restored by their owner.
      // Do not replay reset/intro/view calls, retire actors or consume RNG.
      if(restoredKing!==null)ports.body.bind(restoredKing,brain);
      Object.assign(s,structuredClone(state));king=restoredKing;adds=restoredAdds;
    },
    kill: () => { const k = king; if (k?.alive === true) { s.invuln = false; s.mode = names.fight; k.headWorld(_h); k.applyDamage(k.hp + 10, _h, _w.set(0, 0, -1)); } },
  };
}

/** Minimal world-space body for a roaming phased encounter, independent of a rendered model. */
export interface RoamingBossBody {
  readonly entityId: string;
  readonly position: Vector3; readonly lookTarget: Vector3; readonly mem: Record<string, number>; lookWeight: number; yaw: number; hp: number;
  readonly maxHp: number; readonly alive: boolean; herd: number;
  place: (x: number, z: number, yaw: number) => void;
  setMotion: (yaw: number, speed: number, turn: number) => void;
  startAttack: (duration: number) => void; cancelAttack: () => void;
}
/** A lent charge runner; its actual strike law and continuation remain owned by the host. */
export interface RoamingBossLane<B, L> {
  readonly state: string; readonly t: number; readonly busy: boolean;
  idle: () => boolean; start: (a: B, x: number, z: number, tell: number) => void;
  update: (a: B, dt: number, t: number, player: Vector3, hurt: (damage: number) => void) => void;
  cancel: () => void; recoverNow: () => void; snapshot: () => L; restore: (state: L) => void;
}
/** A falling arena hazard, including its deterministic damage accumulator. */
export interface RoamingBossHazard { x: number; z: number; y: number; fallT: number; acc: number }
/** One expanding ring's live state; a host may attach its own view to the same object. */
export interface RoamingBossRing { r: number; on: boolean; hit: boolean; delay: number }
/** One phase's movement, openings, summons and arena changes. */
export interface RoamingBossPhase {
  readonly at: number; readonly beginMode: string; readonly chaseSpeed: number; readonly recoverySeconds: number;
  readonly burstCooldown: number; readonly summons: boolean; readonly rings: number; readonly darkness: boolean;
  readonly enter?: { readonly mode: string; readonly drop?: boolean; readonly summonDelay?: number; readonly resetChain?: boolean; readonly roar?: boolean };
}
/** A stance's policy and damage rule; mode names are authored, not interpreted as content identities. */
export interface RoamingBossMode {
  readonly kind: 'idle'|'intro'|'pursue'|'strike'|'burst'|'wait-rings'|'recover'|'summon'|'lanes'|'dead';
  readonly damage: number;
}
/** Roaming encounters use authored strike clocks, lane chains, falling hazards and roaming adds on the same phasedBoss entry. */
export interface RoamingBossRow<K extends string, A extends string, Q extends string> {
  /** Admitted guest fields; the arena owner applies requests without selecting actions. */
  readonly decision: { readonly mode: string; readonly request: string; readonly rings: string; readonly adds: string; readonly lane: string;
    readonly phase: string; readonly fight: string; readonly modeT: string; readonly strikeCd: string; readonly burstCd: string; readonly summonCd: string; readonly chain: string; readonly modes: readonly string[] };
  readonly kind: 'roaming'; readonly origin: { readonly x: number; readonly z: number };
  readonly phases: readonly RoamingBossPhase[]; readonly modes: Readonly<Record<string, RoamingBossMode>>;
  readonly names: { readonly idle: string; readonly intro: string; readonly dead: string; readonly pursue: string; readonly strike: string; readonly burst: string; readonly wait: string; readonly recover: string; readonly summon: string };
  readonly arena: { readonly entry: number; readonly wall: number; readonly fog: number; readonly leash: number; readonly wallPad: number; readonly clampPad: number; readonly shoveBase: number; readonly shoveGain: number; readonly shoveDistance: number; readonly shoveSpan: number; readonly epsilon: number };
  readonly seal: { readonly inSeconds: number; readonly outSeconds: number; readonly darkIn: number; readonly darkOut: number };
  readonly opening: { readonly mode: string; readonly lanesMode: string; readonly inRate: number; readonly outRate: number; readonly inactiveRate: number };
  readonly damage: { readonly invulnerable: number; readonly weakOpen: number; readonly weakClosed: number; readonly opening: number };
  readonly initial: { readonly strikeCd: number; readonly burstCd: number; readonly summonCd: number };
  readonly recoveryTurn: number;
  readonly reset: { readonly glow: number; readonly strikeCd: number; readonly burstCd: number; readonly summonCd: number; readonly herd: number };
  readonly intro: { readonly short: number; readonly long: number; readonly glowStart: number; readonly glowEnd: number; readonly lookEnd: number; readonly roarAt: number; readonly crossingStep: number; readonly absentHeight: number };
  readonly begin: { readonly glow: number; readonly summonDelay: number }; readonly victoryGlow: number;
  readonly points: { readonly rewardZ: number; readonly rewardY: number; readonly respawnZ: number; readonly respawnYaw: number };
  readonly strike: { readonly id: string; readonly clip: { readonly duration: number; readonly hitPhase: number }; readonly action: A; readonly reach: number; readonly chaseNear: number; readonly chaseTurn: number; readonly turn: number; readonly radius: number; readonly cooldown: number; readonly tell: readonly [number,number,number,number,number]; readonly trauma: number; readonly contactTrauma: number };
  readonly burst: { readonly clip: { readonly duration: number; readonly hitPhase: number }; readonly action: A; readonly after: number; readonly turn: number; readonly radius: number; readonly tell: readonly [number,number,number,number,number]; readonly trauma: number };
  readonly rings: { readonly gap: number; readonly speed: number; readonly trauma: number; readonly strike: string };
  readonly summon: { readonly clip: { readonly duration: number; readonly hitPhase: number }; readonly action: A; readonly count: number; readonly limit: number; readonly cooldown: number; readonly turn: number };
  readonly lanes: { readonly stop: number; readonly speed: number; readonly turn: number; readonly burstRange: number; readonly after: number; readonly tell: number; readonly action: A; readonly batch: number; readonly rest: number; readonly chainRest: number; readonly soundTicks: number; readonly trauma: number };
  readonly adds: { readonly kinds: readonly K[]; readonly radius: number; readonly far: number; readonly near: number; readonly fast: number; readonly slow: number; readonly turn: number; readonly chargeRange: number; readonly rate: number; readonly tell: number; readonly trauma: number; readonly leashPad: number };
  readonly hazards: { readonly count: number; readonly angleStart: number; readonly angleStep: number; readonly angleOffset: number; readonly radius: number; readonly radiusStep: number; readonly fallSeconds: number; readonly every: number; readonly damage: number; readonly strike: string; readonly fromPhase: number };
  readonly sounds: { readonly intro: Q; readonly roar: Q; readonly burst: Q; readonly add: Q; readonly charge: Q };
}
/** The host lends bodies, collision/strike resolvers, separate random streams and named presentation effects. */
export interface RoamingBossPorts<B extends RoamingBossBody, L, R, K extends string, A extends string, Q extends string> {
  readonly player: { readonly position: Vector3; readonly onGround: boolean; shove: (x: number,z: number,speed: number) => void };
  readonly groundAt: (x: number,z: number) => number;
  readonly body: { readonly make: () => B; readonly retire: (a: B) => void; readonly park: (a: B) => void; readonly unpark: (a: B) => void };
  readonly adds: { readonly spawn: (kind: K,x: number,z: number,yaw: number) => B; readonly retire: (a: B) => void; readonly lanes: () => readonly RoamingBossLane<B,L>[] };
  readonly lane: () => RoamingBossLane<B,L>; readonly rings: () => RoamingBossRing[];
  readonly random: { readonly call: { next: () => number; snapshot: () => R; restore: (r: R) => void }; readonly charge: { next: () => number; snapshot: () => R; restore: (r: R) => void } };
  readonly contact: (a: B,strike: string,hit: (damage: number) => void,options?: { readonly ringRadius?: number; readonly airborne?: boolean; readonly origin?: {x: number;y: number;z: number} }) => boolean;
  readonly weakPoint: (p: Vector3) => boolean; readonly hurt: (a: B,damage: number,throughWalls?: boolean) => void;
  readonly trauma: (v: number) => void; readonly shot: (sound: Q,at: Vector3) => void;
  readonly views: {
    readonly glow: (v: number) => void; readonly hung: (on: boolean) => void; readonly focus: (a: B,out: Vector3) => Vector3;
    readonly room: (dt: number,t: number) => void; readonly light: (on: boolean) => void;
    readonly action: (a: B,move: A) => void; readonly roar: (a: B) => void; readonly burst: (a: B) => void;
    readonly hazard: (i: number,f: RoamingBossHazard,t: number,event: 'drop'|'fall'|'land'|'burn'|'out'|'placed') => void;
    readonly add: (a: B,event: 'in'|'out') => void; readonly ring: (i: number,t: number,at: Vector3|null) => void;
    readonly tell: { setTime: (t: number) => void; ring: (x: number,z: number,radius: number,alpha: number) => void; hide: () => void };
  };
}
/** Exact roaming continuation: the serializer names bodies and the host owns lane and RNG schemas. */
export interface RoamingBossState<L,R> {
  body: string|null; present: boolean; sealed: boolean; sealK: number; darkK: number; glow: number; invuln: boolean; lockHp: number; won: boolean;
  phase: number; mode: string; modeT: number; strikeCd: number; burstCd: number; summonCd: number; chain: number; open: number;
  decision?: string;
  lane: L; rings: RoamingBossRing[]; hazards: RoamingBossHazard[];
  adds: {a: string;lane: number;mode: 'approach'|'charge'}[]; addLanes: L[]; rngs: R[];
}
/** A roaming fight exposes live scalar/view state and an exact save/restore port alongside its BossScript. */
export interface RoamingBossFight<B extends RoamingBossBody,L,R> extends BossScript {
  body: B|null; present: boolean; phase: number; mode: string;
  readonly sealK: number; readonly darkK: number; readonly glow: number; readonly open: number; readonly won: boolean;
  readonly hazards: readonly RoamingBossHazard[];
  readonly adds: readonly {a:B;lane:RoamingBossLane<B,L>;mode:'approach'|'charge'}[];
  spawn: () => B;
  setPresent: (on: boolean) => void;
  snapshot: () => RoamingBossState<L,R>;
  restore: (state: RoamingBossState<L,R>,bodies: ReadonlyMap<string,B>) => void;
  damageMul: (body: B,point: Vector3) => number;
}

/** An existing AS policy row, preserving the complete ordered slot/contact/action declaration. */
export type ScriptBossProfile = Extract<BossProfile, { pattern: 'script' }>;
/** The AS host's immutable admitted module bytes and its actual owned random stream. */
export interface ScriptBossPorts { readonly bytes: Uint8Array; readonly random: () => number }

/** One boss declaration selects its native arena, roaming, spawned or held pattern; ports cannot select a different pattern. */
export type BossFightProfile<K extends string = string, A extends string = string, Q extends string = string> =
  | { readonly kind: 'boss'; readonly pattern: 'arena'; readonly fight: PhasedBossRow }
  | { readonly kind: 'boss'; readonly pattern: 'roaming'; readonly fight: RoamingBossRow<K,A,Q> }
  | { readonly kind: 'boss'; readonly pattern: 'spawned'; readonly fight: SpawnedBossRow }
  | { readonly kind: 'boss'; readonly pattern: 'held'; readonly fight: HeldBossRow };

const bossKind = (kind: unknown): boolean => kind === 'boss';

/** Run the complete fixed-arena boss law on the host's actual bodies, strikes and views. */
export function bossFight<B extends PhasedBossBody>(profile: Extract<BossFightProfile,{pattern:'arena'}>, ports: PhasedBossPorts<B>): PhasedBossFight<B>;
/** Run roaming strikes, hazards, adds and native lane/RNG continuation without changing their clock. */
export function bossFight<B extends RoamingBossBody,L,R,K extends string,A extends string,Q extends string>(profile: Extract<BossFightProfile<K,A,Q>,{pattern:'roaming'}>, ports: RoamingBossPorts<B,L,R,K,A,Q>): RoamingBossFight<B,L,R>;
/** Run a fresh-body checkpoint pattern with native marks, weather and exact retirement order. */
export function bossFight<B extends BodyBossActor>(profile: Extract<BossFightProfile,{pattern:'spawned'}>, ports: SpawnedBossPorts<B>): SpawnedBossFight<B>;
/** Run a retained-body checkpoint pattern with its native brain restart and absent-body semantics. */
export function bossFight<B extends BodyBossActor>(profile: Extract<BossFightProfile,{pattern:'held'}>, ports: HeldBossPorts<B>): HeldBossFight;
/** Run an admitted existing AS fight policy with its original lane clock, rewind law and command order. */
export function bossFight(profile: ScriptBossProfile, ports: ScriptBossPorts): EliteScriptLane;
/** Strict pattern-to-host resolution happens before allocation, RNG, actor changes or view calls. */
export function bossFight<B extends PhasedBossBody,C extends RoamingBossBody,D extends BodyBossActor,L,R,K extends string,A extends string,Q extends string>(profile: BossFightProfile<K,A,Q>|ScriptBossProfile,ports: PhasedBossPorts<B>|RoamingBossPorts<C,L,R,K,A,Q>|SpawnedBossPorts<D>|HeldBossPorts<D>|ScriptBossPorts): PhasedBossFight<B>|RoamingBossFight<C,L,R>|SpawnedBossFight<D>|HeldBossFight|EliteScriptLane {
  if (!bossKind(profile.kind)) throw new Error('Unknown boss row kind');
  if (profile.pattern === 'script' && 'bytes' in ports && ports.bytes instanceof Uint8Array && 'random' in ports && typeof ports.random === 'function') {
    const admitted = v.parse(ScriptBossProfileSchema, profile);
    return new EliteScriptLane(admitted.fight, ports.bytes, ports.random);
  }
  if (profile.pattern === 'arena' && 'arena' in ports) return fixedPhasedBossFight(profile.fight,ports);
  if (profile.pattern === 'roaming' && 'random' in ports && 'body' in ports) return createRoamingBossFight(profile.fight,ports);
  if (profile.pattern === 'spawned' && 'rewardPoint' in ports && 'victory' in ports) return bodyBossFight(profile,ports);
  if (profile.pattern === 'held' && 'brain' in ports) return bodyBossFight(profile,ports);
  throw new Error('Boss row/host policy mismatch');
}

/** Run a fixed arena or roaming phased encounter from its data and actual host ports. */
export function phasedBossFight<B extends RoamingBossBody,L,R,K extends string,A extends string,Q extends string>(row: RoamingBossRow<K,A,Q>,ports: RoamingBossPorts<B,L,R,K,A,Q>): RoamingBossFight<B,L,R>;
/** Run the original fixed-arena policy; its arithmetic and ordered view effects are unchanged. */
export function phasedBossFight<B extends PhasedBossBody>(row: PhasedBossRow,ports: PhasedBossPorts<B>): PhasedBossFight<B>;
/** Select the admitted fixed or roaming policy, refusing mismatched host ports. */
export function phasedBossFight<B extends PhasedBossBody,C extends RoamingBossBody,L,R,K extends string,A extends string,Q extends string>(row: PhasedBossRow|RoamingBossRow<K,A,Q>,ports: PhasedBossPorts<B>|RoamingBossPorts<C,L,R,K,A,Q>): PhasedBossFight<B>|RoamingBossFight<C,L,R> {
  if ('kind' in row && 'random' in ports) return bossFight({kind:'boss',pattern:'roaming',fight:row},ports);
  if ('kind' in row || 'random' in ports) throw new Error('Phased boss row/host policy mismatch');
  return bossFight({kind:'boss',pattern:'arena',fight:row},ports);
}
