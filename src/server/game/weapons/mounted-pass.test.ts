import { expect, test } from 'vitest';
import { Vector3 } from 'three';
import { MountedPassLaw, type MountedPassRows, type MountedPassTarget } from '../../../shared/game/weapons/mountedPass';

const rows: MountedPassRows = { chainWindow: 1.4, sense: 3.2, behind: 0.6, speedDivisor: 9, chainMax: 4, chainStep: 0.25, cooldown: 0.45 };

test('a pending attack, hit and partial cadence continue without consuming an extra edge',()=>{
  const make=()=>new MountedPassLaw({update:(dt,observed)=>({cooldown:Math.max(0,(observed['cooldown']??0)-dt),
    chain:observed['chain']??0,links:(observed['links']??0)+(observed['hits']??0),
    side:observed['attack']===1?1:0,damage:observed['baseDamage']??0})});
  const first=make(),restored=make(),frame={player:{position:new Vector3(),yaw:0},mount:{speed:9,yaw:0},charging:false,baseDamage:20,rows,targets:[]};
  first.attack();first.hit();expect(first.decide(.05,frame)).toBeNull();restored.restore(first.snapshot());
  for(let tick=0;tick<40;tick++){
    if(tick%14===0){first.attack();restored.attack();first.hit();restored.hit();}
    expect(restored.decide(.03,frame)).toEqual(first.decide(.03,frame));expect(restored.snapshot()).toEqual(first.snapshot());
  }
  const before=restored.snapshot();expect(()=>restored.restore({...before,pendingHits:Number.NaN})).toThrow();expect(restored.snapshot()).toEqual(before);
});

/** HeldDecision's clock over a deterministic stand-in for the sabre's guest (its observations and candidates recorded) */
function decision(seed: number, seen: string[]): { update: (dt: number, o: Readonly<Record<string, number>>, c?: readonly Readonly<Record<string, number>>[]) => Readonly<Record<string, number>> | null } {
  let elapsed = 0, s = seed;
  const rnd = (): number => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  return { update: (dt, o, c = []) => {
    elapsed += dt; if (elapsed < .1 - 1e-9) return null;
    seen.push(JSON.stringify([elapsed, o, c])); elapsed = 0;
    if (rnd() < 0.15) return { cooldown: rnd(), chain: rnd() * 2, links: Math.floor(rnd() * 4) };
    return { cooldown: rnd(), chain: rnd() * 2, links: Math.floor(rnd() * 4), side: [0, -1, 1, 1][Math.floor(rnd() * 4)] ?? 0, ...(rnd() < 0.5 ? { damage: Math.round(rnd() * 40) } : {}) };
  } };
}

/** MountedSword's pass decision as it was inline before the kernel (the swing recorded instead of struck) */
class Inline {
  mount: { speed: number; yaw: number } | null = null; passChain = 0; chainT = 0; mountCd = 0; pendingAttack = false; pendingHits = 0; elapsed = 0; strikes: string[] = [];
  constructor(private readonly law: ReturnType<typeof decision>) {}
  decide(dt: number, player: { position: Vector3; yaw: number }, charging: boolean, base: number, targets: readonly MountedPassTarget[]): void {
    this.elapsed += dt; if (this.elapsed < .1 - 1e-9) return;
    const m = this.mount, p = player.position, yaw = m?.yaw ?? player.yaw, fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const candidates: Record<string, number>[] = [];
    for (const target of [...targets].filter(body => body.alive && body.hidden !== true).sort((a, b) => a.position.distanceToSquared(p) - b.position.distanceToSquared(p))) {
      if (candidates.length >= 8) break; const dx = target.position.x - p.x, dz = target.position.z - p.z;
      candidates.push({ live: Number(target.alive && target.hidden !== true), distance: Math.hypot(dx, dz), forward: dx * fx + dz * fz, side: dx * rx + dz * rz >= 0 ? 1 : -1 });
    }
    const v = this.law.update(this.elapsed, { mode: 1, cooldown: this.mountCd, chain: this.chainT, links: this.passChain, hits: this.pendingHits, chainWindow: rows.chainWindow, attack: Number(this.pendingAttack),
      charging: Number(charging), mounted: Number(m !== null), sense: rows.sense, behind: rows.behind, look: Math.atan2(Math.sin(player.yaw - yaw), Math.cos(player.yaw - yaw)), baseDamage: base,
      speed: m?.speed ?? 0, speedDivisor: rows.speedDivisor, chainMax: rows.chainMax, chainStep: rows.chainStep, passCooldown: rows.cooldown }, candidates);
    this.elapsed = 0; if (v === null) return; this.pendingAttack = false; this.pendingHits = 0;
    this.mountCd = v['cooldown'] ?? 0; this.chainT = v['chain'] ?? 0; this.passChain = v['links'] ?? 0;
    if (v['side'] !== 0 && v['side'] !== undefined) this.strikes.push(`${(v['side'] ?? 0) < 0 ? 'left' : 'right'} ${String(v['damage'] ?? base)}`);
  }
}

test('the mounted pass kernel reads, decides and swings exactly as the inline sabre did', () => {
  const seenA: string[] = [], seenB: string[] = [], a = new Inline(decision(9, seenA)), b = new MountedPassLaw(decision(9, seenB)), strikes: string[] = [];
  let mount: { speed: number; yaw: number } | null = null, seed = 4;
  const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const targets: { alive: boolean; hidden?: boolean; position: Vector3 }[] = Array.from({ length: 12 }, (_, i) => ({ alive: true, ...(i % 5 === 0 ? { hidden: true } : {}), position: new Vector3(i * 3 - 18, 0, i % 3 * 4 - 4) }));
  const player = { position: new Vector3(), yaw: 0 };
  for (let frame = 0; frame < 2000; frame++) {
    const dt = rnd() < 0.05 ? 0.25 : 1 / 30;
    if (frame % 400 === 0) mount = mount === null ? { speed: 0, yaw: 0 } : null;
    if (mount !== null) { mount.speed = rnd() * 14; mount.yaw += (rnd() - 0.5) * 0.2; }
    a.mount = mount; player.yaw += (rnd() - 0.5) * 0.3; player.position.x += (rnd() - 0.5) * 2; player.position.z += (rnd() - 0.5) * 2;
    for (const t of targets) { t.position.x += (rnd() - 0.5); t.alive = rnd() > 0.02 || t.alive; }
    if (rnd() < 0.1) { a.pendingAttack = true; b.attack(); }
    if (rnd() < 0.05) { a.pendingHits++; b.hit(); }
    const charging = rnd() < 0.2, base = 18;
    a.decide(dt, player, charging, base, targets);
    const strike = b.decide(dt, { player, mount, charging, baseDamage: base, rows, targets });
    if (strike !== null) strikes.push(`${strike.side < 0 ? 'left' : 'right'} ${String(strike.damage)}`);
    expect([b.passChain, b.chainT, b.mountCd]).toEqual([a.passChain, a.chainT, a.mountCd]);
  }
  expect(seenB).toEqual(seenA); expect(strikes).toEqual(a.strikes); expect(strikes.length).toBeGreaterThan(100);
  const swapped = new MountedPassLaw(decision(1, [])); swapped.carry(b);
  expect([swapped.passChain, swapped.chainT, swapped.mountCd]).toEqual([b.passChain, b.chainT, b.mountCd]);
});
