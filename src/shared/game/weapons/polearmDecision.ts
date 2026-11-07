/**
 * The spear's thrust / lance / javelin decisions, renderer-free (CI12: the Nalati tape steps the spear without its view or
 * the page runtime). It owns the decision state the admitted guest law (`HeldDecision`) reads and writes: the thrust,
 * wind-up and throw clocks, the queued thrust and release, the lance, what was asked since the last snapshot, and each
 * target's last seen place and last lance hit. `decide` builds the guest's frame and candidates from what the weapon
 * observes (the nearest six live aim targets, the nearest lying javelins) and returns the snapshot's events for the weapon
 * to act on, in order; `HeldPolearm` keeps the input, raycasts, javelin flight and view.
 *
 *   const law = new PolearmDecision(program, scope);
 *   law.attackPending = true; const out = law.decide(dt, t, frame);   // out?.start, out?.launch, out?.target …
 */
import type { Scope } from '@wildshard/engine/app/scope';
import * as schema from 'valibot';
import { HeldDecision } from './heldDecision';

interface Point { readonly x: number; readonly y: number; readonly z: number }
/** an aim target as the decision reads it */
export interface PolearmTarget { readonly position: Point; readonly alive: boolean; readonly hidden?: boolean | undefined }
/** a javelin slot: 2 = lying where it landed */
export interface PolearmJavelin { readonly state: number; readonly pos: Point }
export interface PolearmPolicy {
  readonly thrust: { readonly windup: number; readonly activeEnd: number; readonly total: number };
  readonly lance: { readonly reach: number; readonly cone: number; readonly minSpeed: number; readonly baseDamage: number; readonly speedDamage: number; readonly rehit: number };
}
export interface PolearmProjectile {
  readonly windup: number; readonly release: number; readonly recovery: number;
  readonly pickupRadius: number; readonly pickupHeight: number; readonly survive: number;
}
/** what the weapon observes at a decision */
export interface PolearmFrame<T extends PolearmTarget> {
  readonly player: Point;
  /** the facing the lance cone is measured from (the horse's when mounted) */
  readonly heading: number;
  readonly held: boolean; readonly enabled: boolean; readonly ads: boolean;
  readonly ammo: number; readonly capacity: number;
  readonly mount: { readonly speed: number } | null;
  readonly targets: Iterable<T>;
  readonly radius: (target: T) => number;
  readonly javelins: readonly PolearmJavelin[];
  readonly random: () => number;
  readonly policy: PolearmPolicy; readonly projectile: PolearmProjectile;
}
/** a snapshot's events, in the order the weapon acts on them */
export interface PolearmEvents<T> {
  readonly start: boolean; readonly dry: boolean; readonly charge: boolean; readonly launch: boolean; readonly strike: boolean;
  /** the lance's target this snapshot (and its damage), if any */
  readonly target: T | undefined; readonly damage: number;
  /** the javelin slot picked up (-1: none), and whether it went back in the quiver */
  readonly pickup: number; readonly recover: boolean;
}

/** three's Vector3.distanceToSquared, as the weapon sorted with it */
function distanceSquared(a: Point, b: Point): number { const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z; return dx * dx + dy * dy + dz * dz; }
/** three's MathUtils.clamp */
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }

const finite=schema.pipe(schema.number(),schema.finite()),id=schema.pipe(schema.string(),schema.minLength(1),schema.maxLength(128));
const PolearmStateSchema=schema.strictObject({thrustT:finite,windT:finite,throwT:finite,queued:schema.boolean(),releaseQueued:schema.boolean(),
  threw:schema.boolean(),hitDone:schema.boolean(),throwPrev:schema.boolean(),lanceActive:schema.boolean(),attackPending:schema.boolean(),tapPending:schema.boolean(),
  decisionT:schema.pipe(finite,schema.minValue(0)),cadence:schema.pipe(finite,schema.minValue(0)),
  rehit:schema.array(schema.tuple([id,finite])),previous:schema.array(schema.tuple([id,schema.strictObject({x:finite,y:finite,z:finite})]))});
/** Whole decision cursor. Stable body identities replace borrowed object keys. */
export interface PolearmState {
 readonly thrustT:number;readonly windT:number;readonly throwT:number;readonly queued:boolean;readonly releaseQueued:boolean;
 readonly threw:boolean;readonly hitDone:boolean;readonly throwPrev:boolean;readonly lanceActive:boolean;readonly attackPending:boolean;
 readonly tapPending:boolean;readonly decisionT:number;readonly cadence:number;
 readonly rehit:readonly (readonly [string,number])[];readonly previous:readonly (readonly [string,Point])[];
}

/** A retired target's history entry after a restore: its id only, an inert key no live target equals (`decide` reads only
 *  live targets' entries), kept in its place so the next snapshot names it again. */
class RetiredTarget { constructor(readonly key: string) {} }

export class PolearmDecision<T extends PolearmTarget = PolearmTarget> {
  thrustT = -1; windT = -1; throwT = -1; queued = false; releaseQueued = false; threw = false; hitDone = false; throwPrev = false;
  lanceActive = false; attackPending = false; tapPending = false;
  /** seconds since the last snapshot */
  decisionT = 0;
  private readonly law: HeldDecision;
  private readonly rehit = new Map<T | RetiredTarget, number>();
  private readonly prevPos = new Map<T | RetiredTarget, Point>();
  constructor(program: unknown, owner?: Scope) { this.law = new HeldDecision(program, owner); }

  /** Capture pending presses, both cadences and every target's observed history. */
  snapshot(key:(target:T)=>string):PolearmState{const name=(target:T|RetiredTarget):string=>target instanceof RetiredTarget?target.key:key(target);
    return {thrustT:this.thrustT,windT:this.windT,throwT:this.throwT,queued:this.queued,
    releaseQueued:this.releaseQueued,threw:this.threw,hitDone:this.hitDone,throwPrev:this.throwPrev,lanceActive:this.lanceActive,
    attackPending:this.attackPending,tapPending:this.tapPending,decisionT:this.decisionT,cadence:this.law.snapshot(),
    rehit:[...this.rehit].map(([target,time])=>[name(target),time]),previous:[...this.prevPos].map(([target,point])=>[name(target),{...point}])};}
  /** Resolve and validate the entire cursor before committing any replacement. `retired` (optional) names the targets the
   *  caller's owner has retired for good (a killed rider whose body is gone): their history entries keep only their ids, in
   *  their places, and every other key must still resolve. */
  restore(input:unknown,resolve:(key:string)=>T,retired?:(key:string)=>boolean):void{
    const saved=schema.parse(PolearmStateSchema,input);
    if(new Set(saved.rehit.map(([key])=>key)).size!==saved.rehit.length
      ||new Set(saved.previous.map(([key])=>key)).size!==saved.previous.length)throw new Error('Duplicate polearm continuation target');
    const inert=new Map<string,RetiredTarget>(),own=(key:string):T|RetiredTarget=>{
      if(retired?.(key)!==true)return resolve(key);
      const known=inert.get(key)??new RetiredTarget(key);inert.set(key,known);return known;
    };
    const rehit=saved.rehit.map(([key,time])=>[own(key),time] as const),previous=saved.previous.map(([key,point])=>[own(key),{...point}] as const);
    if(new Set(rehit.map(([target])=>target)).size!==rehit.length
      ||new Set(previous.map(([target])=>target)).size!==previous.length)throw new Error('Aliased polearm continuation target');
    this.law.restore(saved.cadence);this.thrustT=saved.thrustT;this.windT=saved.windT;this.throwT=saved.throwT;this.queued=saved.queued;
    this.releaseQueued=saved.releaseQueued;this.threw=saved.threw;this.hitDone=saved.hitDone;this.throwPrev=saved.throwPrev;
    this.lanceActive=saved.lanceActive;this.attackPending=saved.attackPending;this.tapPending=saved.tapPending;this.decisionT=saved.decisionT;
    this.rehit.clear();this.prevPos.clear();for(const [target,time] of rehit)this.rehit.set(target,time);
    for(const [target,point] of previous)this.prevPos.set(target,point);
  }

  /** The lance struck `target` at `t` (its rehit clock). */
  struck(target: T, t: number): void { this.rehit.set(target, t); }
  /** The weapon left the hand (or was disabled): a wind-up and a thrust out of hand end. */
  stow(inHand: boolean, enabled: boolean): void {
    if (!inHand || !enabled) {
      if (this.windT >= 0 && !inHand) { this.windT = -1; this.releaseQueued = false; }
      if (!inHand) { this.thrustT = -1; this.queued = false; }
    }
  }
  /** A snapshot at 10 Hz: null between snapshots (or while the guest holds one back), else its events. */
  decide(dt: number, t: number, frame: PolearmFrame<T>): PolearmEvents<T> | null {
    this.decisionT += dt; if (this.decisionT < .1 - 1e-9) return null;
    const p = frame.player, heading = frame.heading, fx = -Math.sin(heading), fz = -Math.cos(heading);
    const candidates: Record<string, number>[] = [], targets: T[] = [];
    for (const a of [...frame.targets].filter(target => target.alive && target.hidden !== true).sort((left, right) => distanceSquared(left.position, p) - distanceSquared(right.position, p))) {
      if (targets.length >= 6) break;
      const prev = this.prevPos.get(a), dx = a.position.x - p.x, dz = a.position.z - p.z, d = Math.hypot(dx, dz);
      const vx = prev === undefined ? 0 : (a.position.x - prev.x) / Math.max(this.decisionT, .001), vz = prev === undefined ? 0 : (a.position.z - prev.z) / Math.max(this.decisionT, .001);
      targets.push(a);
      candidates.push({ kind: 0, id: targets.length, live: Number(a.alive && a.hidden !== true && prev !== undefined), distance: d, radius: frame.radius(a), height: Math.abs(a.position.y - p.y),
        angle: Math.acos(clamp((dx * fx + dz * fz) / Math.max(d, .0001), -1, 1)), closing: -(vx * dx + vz * dz) / Math.max(d, .0001), since: t - (this.rehit.get(a) ?? -1e9) });
    }
    for (const [i, j] of [...frame.javelins.entries()].filter(([, slot]) => slot.state === 2).sort(([, left], [, right]) => distanceSquared(left.pos, p) - distanceSquared(right.pos, p))) {
      if (candidates.length >= 8) break;
      candidates.push({ kind: 1, id: i + 1, distance: Math.hypot(j.pos.x - p.x, j.pos.z - p.z), height: Math.abs(j.pos.y - p.y), random: frame.random() });
    }
    const policy = frame.policy, projectile = frame.projectile;
    const v = this.law.update(this.decisionT, { mode: 0, held: Number(frame.held), enabled: Number(frame.enabled), ads: Number(frame.ads), previousAds: Number(this.throwPrev),
      attack: Number(this.attackPending), tap: Number(this.tapPending), ammo: frame.ammo, capacity: frame.capacity, thrust: this.thrustT, wind: this.windT, throwing: this.throwT,
      queued: Number(this.queued), release: Number(this.releaseQueued), threw: Number(this.threw), hit: Number(this.hitDone), windup: policy.thrust.windup, activeEnd: policy.thrust.activeEnd,
      total: policy.thrust.total, throwWindup: projectile.windup, throwRelease: projectile.release, recovery: projectile.recovery, mounted: Number(frame.mount !== null),
      speed: frame.mount?.speed ?? 0, minSpeed: policy.lance.minSpeed, lanceReach: policy.lance.reach, cone: policy.lance.cone, rehit: policy.lance.rehit, baseDamage: policy.lance.baseDamage,
      speedDamage: policy.lance.speedDamage, pickupRadius: projectile.pickupRadius, pickupHeight: projectile.pickupHeight, survive: projectile.survive }, candidates);
    if (v === null) return null;
    for (const target of targets) this.prevPos.set(target, { x: target.position.x, y: target.position.y, z: target.position.z });
    this.decisionT = 0; this.attackPending = false; this.tapPending = false;
    this.thrustT = v['thrust'] ?? -1; this.windT = v['wind'] ?? -1; this.throwT = v['throwing'] ?? -1; this.queued = v['queued'] === 1; this.releaseQueued = v['release'] === 1;
    this.threw = v['threw'] === 1; this.hitDone = v['hit'] === 1; this.throwPrev = v['previousAds'] === 1; this.lanceActive = v['lance'] === 1;
    return { start: v['start'] === 1, dry: v['dry'] === 1, charge: v['charge'] === 1, launch: v['launch'] === 1, strike: v['strike'] === 1,
      target: targets[(v['target'] ?? 0) - 1], damage: v['damage'] ?? 0, pickup: (v['pickup'] ?? 0) - 1, recover: v['recover'] === 1 };
  }
}
