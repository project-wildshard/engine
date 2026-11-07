import { Vector3 } from 'three';
import { expect, test } from 'vitest';
import { MountCompanions, companionToName, type CompanionActor, type CompanionPrompt } from '../src/shared/game/riding/companions';

// The companion law as Mount ran it inline before companions.ts (mount.ts addMountable / rename / nameOf / canRide /
// whistle / update), kept here as the reference the kernel must match draw for draw.
const BOLT_AT = 0.2, REST_TIME = 180, WHISTLE_RANGE = 150;
interface Row { a: Horse; name: string; it: CompanionPrompt; restT: number; bolting: boolean; comeT: number; key: string }
class Reference {
  readonly rows: Row[] = [];
  horse: Horse | null = null;
  readonly events: string[] = [];
  constructor(private readonly opts: Profile, private readonly now: () => number) {}
  add(a: Horse, fallback: string, savedKey?: string): void {
    const key = savedKey ?? `${fallback}|${a.kind}:${a.variant}`;
    if (this.rows.some((m) => m.a === a)) return;
    const name = this.opts.names[key] ?? fallback;
    if (name !== fallback) a.label = name;
    a.mem['owned'] = 1;
    this.rows.push({ a, name, it: { label: `Mount ${name}`, radius: 3.3 }, restT: 0, bolting: false, comeT: 0, key });
  }
  rename(a: Horse, name: string): void {
    const m = this.rows.find((x) => x.a === a);
    if (m === undefined || name.length === 0) return;
    m.name = name; a.label = name;
    this.opts.names[m.key] = name;
  }
  nameOf(id: string): string | null { return this.rows.find((x) => x.a.entityId === id)?.name ?? null; }
  canRide(a: Horse): boolean { const m = this.rows.find((x) => x.a === a); return a.alive && (m === undefined || (m.restT <= 0 && !m.bolting)); }
  whistle(p: Vector3): Horse | null {
    if (this.horse !== null) return null;
    let best: Row | null = null, bd = WHISTLE_RANGE;
    for (const m of this.rows) {
      if (!this.canRide(m.a) || (m.a.mem['whistle'] ?? 0) === 0) continue;
      const d = m.a.position.distanceTo(p);
      if (d < bd) { bd = d; best = m; }
    }
    if (best === null) return null;
    best.comeT = 30;
    return best.a;
  }
  update(dt: number, p: Vector3): void {
    for (const m of this.rows) {
      const a = m.a;
      if (!a.alive) continue;
      if (!m.bolting && m.restT <= 0 && a.hp < a.maxHp * BOLT_AT) {
        m.bolting = true; m.comeT = 0;
        if (this.horse === a) { this.horse = null; this.events.push('thrown'); }
        a.mem['rear'] = 1;
        this.events.push(`bolt ${a.entityId} ${m.name}`);
      }
      if (m.bolting) {
        a.mem['rear'] = Math.max(0, (a.mem['rear'] ?? 0) - dt * 1.2);
        const r = this.opts.restAt;
        const tx = r?.x ?? a.position.x, tz = r?.z ?? a.position.z;
        const d = Math.hypot(tx - a.position.x, tz - a.position.z);
        if (d > 3 && r !== undefined) { a.state = 'flee'; a.setMotion(Math.atan2(tx - a.position.x, tz - a.position.z), d > 20 ? this.opts.speeds.gallop * 0.9 : this.opts.speeds.trot, 2); }
        else { m.bolting = false; m.restT = REST_TIME; a.setMotion(a.yaw, 0, 1); a.state = 'graze'; }
      } else if (m.restT > 0) {
        m.restT -= dt;
        a.state = 'graze';
        if (m.restT <= 0) a.hp = a.maxHp;
      } else if (this.horse !== a && m.comeT > 0) {
        m.comeT -= dt;
        const d = Math.hypot(p.x - a.position.x, p.z - a.position.z);
        if (d > 3.2) { a.state = d > 12 ? 'flee' : 'wander'; a.setMotion(Math.atan2(p.x - a.position.x, p.z - a.position.z), d > 25 ? this.opts.speeds.gallop * 0.85 : d > 8 ? this.opts.speeds.canter * 0.7 : this.opts.speeds.walk, 2.5); }
        else { m.comeT = 0; a.setMotion(Math.atan2(p.x - a.position.x, p.z - a.position.z), 0, 2); a.state = 'idle'; a.mem['toss'] = 1; }
      } else if (this.horse !== a) {
        if (a.speed < 0.1) a.state = Math.sin(this.now() * 0.2 + a.seed * 9) > 0.1 ? 'graze' : 'idle';
        a.lookTarget.copy(p); a.lookWeight = a.position.distanceTo(p) < 6 && a.state !== 'graze' ? 0.6 : 0;
      }
      m.it.label = this.horse === a ? 'Dismount' : m.restT > 0 || m.bolting ? `${m.name} is resting` : `Mount ${m.name}`;
      m.it.radius = this.horse === a ? 3.6 : m.restT > 0 || m.bolting ? 0 : 3.3;
    }
  }
}

interface Profile { names: Record<string, string>; restAt?: { x: number; z: number }; speeds: { walk: number; trot: number; canter: number; gallop: number } }
/** A horse body that moves along its last motion each step, as a simulation's body would. */
class Horse implements CompanionActor {
  readonly kind = 'horse'; alive = true; hp = 100; readonly maxHp = 100; readonly mem: Record<string, number> = {};
  readonly position: Vector3; state = 'idle'; yaw = 0; speed = 0; scale = 1; label: string; lookWeight = 0; readonly lookTarget = new Vector3();
  readonly motions: number[][] = [];
  constructor(readonly entityId: string, readonly variant: string, readonly seed: number, x: number, z: number) { this.position = new Vector3(x, 0, z); this.label = entityId; }
  setMotion = (yaw: number, speed: number, turnRate = 0): void => { this.motions.push([yaw, speed, turnRate]); this.yaw = yaw; this.speed = speed; };
  step(dt: number): void { this.position.x += Math.sin(this.yaw) * this.speed * dt; this.position.z += Math.cos(this.yaw) * this.speed * dt; }
}

const speeds = { walk: 1.6, trot: 3.4, canter: 6, gallop: 11 };
const herd = (): Horse[] => [new Horse('h1', 'bay', 0.13, 10, 0), new Horse('h2', 'grey', 0.71, 40, 30), new Horse('h3', 'dun', 0.4, 200, 0), new Horse('h4', 'black', 0.9, -6, 4)];
const view = (horses: readonly Horse[], rows: readonly { name: string; it: CompanionPrompt; restT: number; bolting: boolean; comeT: number; key: string }[]) => ({
  horses: horses.map((h) => ({ id: h.entityId, x: h.position.x, z: h.position.z, state: h.state, hp: h.hp, label: h.label, mem: { ...h.mem }, look: h.lookWeight, motions: h.motions.length, last: h.motions.at(-1) ?? null })),
  rows: rows.map((m) => ({ name: m.name, label: m.it.label, radius: m.it.radius, restT: m.restT, bolting: m.bolting, comeT: m.comeT, key: m.key })),
});

test('the companion kernel runs the inline Mount law: names, whistle, bolt, rest, come, labels', () => {
  const names = { 'Tulpar|horse:bay': 'Saule' }, clock = { t: 0 };
  const refHorses = herd(), kerHorses = herd();
  const refProfile: Profile = { names: { ...names }, restAt: { x: -60, z: -40 }, speeds }, kerProfile: Profile = { names: { ...names }, restAt: { x: -60, z: -40 }, speeds };
  const ref = new Reference(refProfile, () => clock.t);
  const ker = new MountCompanions<Horse, CompanionPrompt>(kerProfile), kerEvents: string[] = [];
  let kerRidden: Horse | null = null;
  for (const [i, fallback] of ['Tulpar', 'Ak', 'Kok', 'Kara'].entries()) {
    const r = refHorses[i], k = kerHorses[i]; if (r === undefined || k === undefined) throw new Error('herd');
    ref.add(r, fallback); ker.add(k, fallback, undefined, (name) => ({ label: `Mount ${name}`, radius: 3.3 }));
    ref.add(r, fallback); expect(ker.add(k, fallback, undefined, (name) => ({ label: `Mount ${name}`, radius: 3.3 }))).toBeNull();
  }
  // h1 and h3 are bonded; h4 is bonded but will be ridden
  for (const hs of [refHorses, kerHorses]) for (const i of [0, 2, 3]) { const h = hs[i]; if (h !== undefined) h.mem['whistle'] = 1; }
  const player = new Vector3(0, 0, 0);
  const frame = (dt: number): void => {
    clock.t += dt;
    ref.update(dt, player);
    ker.update(dt, player, { ridden: () => kerRidden, now: () => clock.t, throwRider: () => { kerRidden = null; kerEvents.push('thrown'); },
      bolted: (m) => { kerEvents.push(`bolt ${m.a.entityId} ${m.name}`); } });
    for (const h of [...refHorses, ...kerHorses]) h.step(dt);
    expect(view(kerHorses, ker.list)).toEqual(view(refHorses, ref.rows));
    expect(kerEvents).toEqual(ref.events);
  };
  for (let i = 0; i < 20; i++) frame(1 / 30);
  // a whistle answers from the nearest bonded, rideable horse in range (h4 at 7 m), not h3 (200 m) or unbonded h2
  const rw = ref.whistle(player), kw = ker.whistle(player, (a) => a.alive && ker.free(a));
  expect(kw?.entityId).toBe(rw?.entityId); expect(kw?.entityId).toBe('h4');
  for (let i = 0; i < 300; i++) frame(1 / 30);
  // rename into the save's names; blank and unknown names change nothing
  const r1 = refHorses[0], r4 = refHorses[3], k1 = kerHorses[0], k4 = kerHorses[3];
  if (r1 === undefined || k1 === undefined || r4 === undefined || k4 === undefined) throw new Error('herd');
  ref.rename(r1, 'Boz'); ker.rename(k1, 'Boz'); ref.rename(r4, ''); ker.rename(k4, '');
  expect(kerProfile.names).toEqual(refProfile.names); expect(ker.nameOf('h1')).toBe(ref.nameOf('h1')); expect(ker.nameOf('nobody')).toBeNull();
  // ride h1, hurt it: it throws the rider, rears, bolts to its rest spot, rests 180 s, heals; meanwhile it may not be ridden
  ref.horse = r1; kerRidden = k1; r1.hp = 10; k1.hp = 10;
  for (let i = 0; i < 30 * 30; i++) frame(1 / 30);
  expect(ker.free(k1)).toBe(ref.canRide(r1));
  for (let i = 0; i < 30 * 200; i++) frame(1 / 30);
  expect(k1.hp).toBe(100); expect(ker.free(k1)).toBe(true);
  // the whistle from far away: h1 (now rested) comes across the bands (gallop, canter, walk) and stops beside the player
  player.set(120, 0, 60);
  expect(ker.whistle(player, (a) => a.alive && ker.free(a))?.entityId).toBe(ref.whistle(player)?.entityId);
  for (let i = 0; i < 30 * 40; i++) frame(1 / 30);
  expect(kerEvents.length).toBeGreaterThan(0);
});

test('the naming rail picks the companion whose name projection is nearest, with that row', () => {
  const ker = new MountCompanions<Horse, CompanionPrompt>({ names: {}, speeds });
  const horses = herd(); for (const h of horses) ker.add(h, h.entityId, undefined, (name) => ({ label: name, radius: 3.3 }));
  const project = (_signal: string, o: Readonly<Record<string, number>>): Readonly<Record<string, number>> => {
    const d = Math.hypot((o['x'] ?? 0) - (o['cx'] ?? 0), (o['z'] ?? 0) - (o['cz'] ?? 0));
    return d < 50 ? { distance: d, x: o['x'] ?? 0, z: o['z'] ?? 0, radius: 2 } : { distance: 1e12 };
  };
  expect(companionToName(ker.list, project, { x: 35, z: 25 }, { x: 0, z: 0 })?.actor.entityId).toBe('h2');
  expect(companionToName(ker.list, project, { x: -5, z: 3 }, { x: 0, z: 0 })?.row['distance']).toBeCloseTo(Math.hypot(1, 1));
  expect(companionToName(ker.list, project, { x: 900, z: 900 }, { x: 0, z: 0 })).toBeNull();
});
