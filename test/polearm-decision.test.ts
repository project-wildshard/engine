// CI12 Nalati spear: the thrust / lance / javelin decisions, split out of HeldPolearm (PolearmDecision, renderer-free), decide
// exactly as the weapon's inline decide did: every snapshot's events and the whole decision state equal, over a fight
// with deer walking by, taps, aimed throws, pickups and a mounted lance, with the weapon acting on each side's events.
import { afterEach, beforeEach, expect, test } from 'vitest';
import { MathUtils, Vector3 } from 'three';
import { Scope } from '../src/shared/engine/app/scope';
import { HeldDecision } from '../src/shared/game/weapons/heldDecision';
import { PolearmDecision, type PolearmTarget } from '../src/shared/game/weapons/polearmDecision';
import { lendNalatiHeld } from './fixtures/nalati-held-loan';
import { originalHeldMetadata } from './fixtures/nalati-held-original';

const { held: rows } = originalHeldMetadata();
let scope: Scope;
beforeEach(() => { scope = new Scope('polearm-decision'); lendNalatiHeld(scope); });
afterEach(() => { scope.dispose(); });

const policy = { thrust: { windup: .12, activeEnd: .22, total: .35 }, lance: { reach: 2.5, cone: Math.PI / 12, minSpeed: 8, baseDamage: 40, speedDamage: 6, rehit: 1.2 } };
const projectile = { windup: .4, release: .2, recovery: .3, pickupRadius: 1.5, pickupHeight: 2, survive: .8 };
interface Deer extends PolearmTarget { position: Vector3; alive: boolean; hidden?: boolean | undefined }
interface Slot { state: number; pos: Vector3 }
const radius = (): number => .5;

/** HeldPolearm's decide before the split (heldPolearm.ts, before CI12), on its own guest and state */
class Inline {
  thrustT = -1; windT = -1; throwT = -1; queued = false; releaseQueued = false; threw = false; hitDone = false; throwPrev = false; lanceActive = false;
  attackPending = false; tapPending = false; decisionT = 0;
  readonly rehit = new Map<object, number>(); private readonly prevPos = new Map<object, Vector3>();
  constructor(private readonly law: HeldDecision) {}
  decide(dt: number, t: number, w: { player: Vector3; heading: number; held: boolean; ads: boolean; ammo: number; mount: { speed: number } | null; deer: Deer[]; javs: Slot[]; random: () => number }) {
    this.decisionT += dt; if (this.decisionT < .1 - 1e-9) return null;
    const p = w.player, heading = w.heading, fx = -Math.sin(heading), fz = -Math.cos(heading);
    const candidates: Record<string, number>[] = [], targets: Deer[] = [];
    for (const a of [...w.deer].filter(target => target.alive && target.hidden !== true).sort((left, right) => left.position.distanceToSquared(p) - right.position.distanceToSquared(p))) {
      if (targets.length >= 6) break;
      const prev = this.prevPos.get(a), dx = a.position.x - p.x, dz = a.position.z - p.z, d = Math.hypot(dx, dz);
      const vx = prev === undefined ? 0 : (a.position.x - prev.x) / Math.max(this.decisionT, .001), vz = prev === undefined ? 0 : (a.position.z - prev.z) / Math.max(this.decisionT, .001);
      targets.push(a); candidates.push({ kind: 0, id: targets.length, live: Number(a.alive && a.hidden !== true && prev !== undefined), distance: d, radius: radius(), height: Math.abs(a.position.y - p.y), angle: Math.acos(MathUtils.clamp((dx * fx + dz * fz) / Math.max(d, .0001), -1, 1)), closing: -(vx * dx + vz * dz) / Math.max(d, .0001), since: t - (this.rehit.get(a) ?? -1e9) });
    }
    for (const [i, j] of [...w.javs.entries()].filter(([, slot]) => slot.state === 2).sort(([, left], [, right]) => left.pos.distanceToSquared(p) - right.pos.distanceToSquared(p))) { if (candidates.length >= 8) break; candidates.push({ kind: 1, id: i + 1, distance: Math.hypot(j.pos.x - p.x, j.pos.z - p.z), height: Math.abs(j.pos.y - p.y), random: w.random() }); }
    const v = this.law.update(this.decisionT, { mode: 0, held: Number(w.held), enabled: 1, ads: Number(w.ads), previousAds: Number(this.throwPrev), attack: Number(this.attackPending), tap: Number(this.tapPending), ammo: w.ammo, capacity: 3, thrust: this.thrustT, wind: this.windT, throwing: this.throwT, queued: Number(this.queued), release: Number(this.releaseQueued), threw: Number(this.threw), hit: Number(this.hitDone), windup: policy.thrust.windup, activeEnd: policy.thrust.activeEnd, total: policy.thrust.total, throwWindup: projectile.windup, throwRelease: projectile.release, recovery: projectile.recovery, mounted: Number(w.mount !== null), speed: w.mount?.speed ?? 0, minSpeed: policy.lance.minSpeed, lanceReach: policy.lance.reach, cone: policy.lance.cone, rehit: policy.lance.rehit, baseDamage: policy.lance.baseDamage, speedDamage: policy.lance.speedDamage, pickupRadius: projectile.pickupRadius, pickupHeight: projectile.pickupHeight, survive: projectile.survive }, candidates);
    if (v === null) return null;
    for (const target of targets) this.prevPos.set(target, target.position.clone()); this.decisionT = 0; this.attackPending = false; this.tapPending = false;
    this.thrustT = v['thrust'] ?? -1; this.windT = v['wind'] ?? -1; this.throwT = v['throwing'] ?? -1; this.queued = v['queued'] === 1; this.releaseQueued = v['release'] === 1; this.threw = v['threw'] === 1; this.hitDone = v['hit'] === 1; this.throwPrev = v['previousAds'] === 1; this.lanceActive = v['lance'] === 1;
    return { start: v['start'] === 1, dry: v['dry'] === 1, charge: v['charge'] === 1, launch: v['launch'] === 1, strike: v['strike'] === 1, target: targets[(v['target'] ?? 0) - 1], damage: v['damage'] ?? 0, pickup: (v['pickup'] ?? 0) - 1, recover: v['recover'] === 1 };
  }
}

/** a weapon acting on one side's events: the quiver, the lying javelins, the thrust's hit and the lance's rehit clock */
class Side {
  ammo = 3; readonly javs: Slot[] = [0, 1, 2].map(() => ({ state: 0, pos: new Vector3() }));
  private seed = 7;
  readonly random = (): number => { this.seed = (this.seed * 16807) % 2147483647; return this.seed / 2147483647; };
  act(out: NonNullable<ReturnType<Inline['decide']>>, t: number, player: Vector3, deer: Deer[], hit: () => void, struck: (d: Deer) => void): string {
    if (out.launch && this.ammo > 0) { this.ammo--; const slot = this.javs.find(j => j.state === 0); if (slot !== undefined) { slot.state = 2; slot.pos.set(player.x + 1, player.y, player.z - 1); } }
    if (out.strike && deer.some(d => d.alive && d.position.distanceTo(player) < 2.5)) hit();
    if (out.target !== undefined) struck(out.target);
    const j = this.javs[out.pickup]; if (j !== undefined) { j.state = 0; if (out.recover) this.ammo++; }
    return `${[out.start, out.dry, out.charge, out.launch, out.strike, out.recover].map(Number).join('')}:${out.target === undefined ? -1 : deer.indexOf(out.target)}:${out.damage}:${out.pickup}@${t.toFixed(3)}`;
  }
}

test('the decision kernel decides as the inline weapon did, snapshot by snapshot', () => {
  const old = new Inline(new HeldDecision(rows.programs.polearm, scope)), law = new PolearmDecision<Deer>(rows.programs.polearm, scope);
  const deerOf = (): Deer[] => [0, 1, 2, 3].map(i => ({ position: new Vector3(4 + i * 3, 0, -6 - i * 2), alive: true, hidden: false }));
  const oldDeer = deerOf(), newDeer = deerOf(), a = new Side(), b = new Side(), player = new Vector3();
  const events: string[] = [], seen = new Set<string>();
  let t = 0;
  for (let f = 0; f < 900; f++) {
    const dt = f % 41 === 0 ? .07 : 1 / 30; t += dt;
    // the player walks, then rides (a lance) through the herd; the deer drift; one dies, one hides for a while
    const riding = f >= 500 && f < 700, mount = riding ? { speed: 9 + (f % 50) / 10 } : null, heading = Math.sin(t * .4) * .8;
    player.set(Math.sin(t * .3) * 6, 0, -t * (riding ? .9 : .1));
    for (const herd of [oldDeer, newDeer]) herd.forEach((d, i) => { d.position.set(4 + i * 3 + Math.sin(t + i) * 2, Math.sin(t * .5 + i) * .3, -6 - i * 2 - t * (riding ? .9 : .1)); d.alive = !(i === 1 && f > 300); d.hidden = i === 2 && f > 400 && f < 450; });
    const ads = f % 160 > 100 && f % 160 < 130;
    if (f % 23 === 0) { old.attackPending = true; law.attackPending = true; }
    if (f % 160 === 131) { old.tapPending = true; law.tapPending = true; }
    const want = old.decide(dt, t, { player, heading, held: true, ads, ammo: a.ammo, mount, deer: oldDeer, javs: a.javs, random: a.random });
    const got = law.decide(dt, t, { player, heading, held: true, enabled: true, ads, ammo: b.ammo, capacity: 3, mount, targets: newDeer, radius, javelins: b.javs, random: b.random, policy, projectile });
    expect(got === null).toBe(want === null);
    if (want !== null && got !== null) {
      const x = a.act(want, t, player, oldDeer, () => { old.hitDone = true; }, d => { old.rehit.set(d, t); });
      const y = b.act(got, t, player, newDeer, () => { law.hitDone = true; }, d => { law.struck(d, t); });
      expect(y).toBe(x); events.push(x); seen.add(x.slice(0, 6));
    }
    const state = (s: Inline | PolearmDecision<Deer>): number[] => [s.thrustT, s.windT, s.throwT, Number(s.queued), Number(s.releaseQueued), Number(s.threw), Number(s.hitDone), Number(s.throwPrev), Number(s.lanceActive), Number(s.attackPending), Number(s.tapPending), s.decisionT];
    expect(state(law)).toEqual(state(old)); expect(b.ammo).toBe(a.ammo);
  }
  // the run exercised the decisions it compares: thrusts started and struck, a javelin thrown, a lance hit
  const all = events.join('\n');
  expect(events.some(e => e.startsWith('1'))).toBe(true);
  expect(events.some(e => e[4] === '1')).toBe(true);
  expect(events.some(e => e[3] === '1')).toBe(true);
  expect(/:[0-3]:\d/u.test(all)).toBe(true);
});

test('stowing ends a wind-up and a thrust out of hand, as the weapon did', () => {
  const law = new PolearmDecision(rows.programs.polearm, scope);
  law.windT = .2; law.releaseQueued = true; law.thrustT = .1; law.queued = true;
  law.stow(true, false); expect([law.windT, law.thrustT, law.queued]).toEqual([.2, .1, true]);
  law.stow(false, true); expect([law.windT, law.releaseQueued, law.thrustT, law.queued]).toEqual([-1, false, -1, false]);
});

test('a polearm checkpoint keeps pending input, cadences and actual target history',()=>{
  const first=new PolearmDecision<Deer>(rows.programs.polearm,scope),restored=new PolearmDecision<Deer>(rows.programs.polearm,scope);
  const deer:Deer={position:new Vector3(0,0,-2),alive:true},player=new Vector3();
  const key=(target:Deer):string=>{if(target!==deer)throw new Error('Foreign polearm target');return 'deer';};
  const resolve=(id:string):Deer=>{if(id!=='deer')throw new Error('Missing polearm target');return deer;};
  const frame={player,heading:0,held:true,enabled:true,ads:false,ammo:3,capacity:3,mount:{speed:9},targets:[deer],radius,
    javelins:[],random:()=>.5,policy,projectile};
  first.attackPending=true;first.decide(.04,.04,frame);first.struck(deer,.04);first.tapPending=true;
  restored.restore(first.snapshot(key),resolve);
  for(let tick=0;tick<40;tick++){
    deer.position.z-=.01;const time=.04+(tick+1)*.03;
    expect(restored.decide(.03,time,frame)).toEqual(first.decide(.03,time,frame));expect(restored.snapshot(key)).toEqual(first.snapshot(key));
  }
  const before=restored.snapshot(key);expect(()=>restored.restore({...before,cadence:Number.NaN},resolve)).toThrow();expect(restored.snapshot(key)).toEqual(before);
});

test('a retired target restores as its id alone, in place: strict by default, exact with the retired predicate',()=>{
  const first=new PolearmDecision<Deer>(rows.programs.polearm,scope),restored=new PolearmDecision<Deer>(rows.programs.polearm,scope);
  const rider:Deer={position:new Vector3(.3,0,-1.5),alive:true},deer:Deer={position:new Vector3(0,0,-2),alive:true},player=new Vector3();
  const ids=new Map<Deer,string>([[rider,'creature:50'],[deer,'deer']]);
  const key=(target:Deer):string=>{const id=ids.get(target);if(id===undefined)throw new Error('Foreign polearm target');return id;};
  const live=new Map<string,Deer>([['deer',deer]]),resolve=(id:string):Deer=>{const target=live.get(id);if(target===undefined)throw new Error('Missing polearm target');return target;};
  const frame=(targets:Deer[])=>({player,heading:0,held:true,enabled:true,ads:false,ammo:3,capacity:3,mount:{speed:9},targets,radius,javelins:[],random:()=>.5,policy,projectile});
  // the rider is seen and struck first, then killed and its body retired: the original keeps its history
  first.attackPending=true;first.decide(.1,.1,frame([rider,deer]));first.struck(rider,.1);first.decide(.1,.2,frame([rider,deer]));
  rider.alive=false;first.decide(.1,.3,frame([deer]));
  const saved=first.snapshot(key);
  expect(saved.rehit.map(([id])=>id)).toEqual(['creature:50']);expect(saved.previous.map(([id])=>id)).toEqual(['creature:50','deer']);
  expect(()=>restored.restore(saved,resolve)).toThrow('Missing polearm target');expect(restored.snapshot(key).previous).toEqual([]);
  restored.restore(saved,resolve,id=>id==='creature:50');
  expect(restored.snapshot(key)).toEqual(saved);
  for(let tick=0;tick<40;tick++){
    deer.position.z-=.01;const time=.3+(tick+1)*.03;
    if(tick===10){first.struck(deer,time);restored.struck(deer,time);first.attackPending=true;restored.attackPending=true;}
    expect(restored.decide(.03,time,frame([deer]))).toEqual(first.decide(.03,time,frame([deer])));expect(restored.snapshot(key)).toEqual(first.snapshot(key));
  }
});
