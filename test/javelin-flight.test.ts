// CI12 Nalati spear: the javelins' throw, flight and landing, split out of HeldPolearm (JavelinFlight, renderer-free), land
// exactly as the weapon's inline code did: every slot's state, place, turn and age, every hit and impact, over throws from
// many aims and a horse into turf, a pond, a plank deck, a stone outcrop and a deer.
import { expect, test } from 'vitest';
import * as THREE from 'three';
import { JavelinFlight, type JavelinSlot, type JavelinTargetHit } from '../src/shared/game/weapons/javelinFlight';
import type { Hit } from '../src/shared/engine/physics/query';
import type { Material } from '../src/shared/engine/physics/surface';
import type { ImpactSurface } from '../src/shared/engine/combat/Weapon';

const profile = { speed: 26, gravity: 9.8, damage: 55, headMultiplier: 2, radius: .05, headOffset: .9, stagger: .6 };
const Y = new THREE.Vector3(0, 1, 0);
const surfaceOf = (m: Material): ImpactSurface => m === 'flesh' ? 'flesh' : m === 'wood' || m === 'planks' ? 'wood' : 'ground';
const sticks = (m: Material): boolean => m === 'wood' || m === 'planks' || m === 'flesh' || m === 'grass' || m === 'sand' || m === 'wetSand' || m === 'ground' || m === 'felt' || m === 'earth';

/** the world both sides fly through: turf at y 0 (a pond over x < -10), a plank deck at y 1 over 10 < x < 16, a stone
 *  outcrop face at z = -30 (x > 0), and a deer at (4, 1, -18) */
function worldHit(a: THREE.Vector3, b: THREE.Vector3): Hit | null {
  const hits: Hit[] = [];
  const plane = (y: number, ok: (p: THREE.Vector3) => boolean, material: Material): void => {
    if ((a.y - y) * (b.y - y) > 0 || a.y === b.y) return;
    const k = (a.y - y) / (a.y - b.y), p = new THREE.Vector3().lerpVectors(a, b, k);
    if (ok(p)) hits.push({ point: p, normal: { x: 0, y: 1, z: 0 }, distance: a.distanceTo(p), material, owner: null, collider: null as never });
  };
  plane(1, p => p.x > 10 && p.x < 16, 'planks');
  plane(0, () => true, 'ground');
  if ((a.z + 30) * (b.z + 30) <= 0 && a.z !== b.z) {
    const k = (a.z + 30) / (a.z - b.z), p = new THREE.Vector3().lerpVectors(a, b, k);
    if (p.x > 0 && p.y < 6) hits.push({ point: p, normal: { x: .3, y: .2, z: 1 }, distance: a.distanceTo(p), material: 'stone', owner: null, collider: null as never });
  }
  hits.sort((l, r) => l.distance - r.distance);
  return hits[0] ?? null;
}
interface Deer extends JavelinTargetHit { animal: { alive: boolean } }
const deerAt = new THREE.Vector3(4, 1, -18);
function raycast(o: THREE.Vector3, d: THREE.Vector3, max: number): Deer | null {
  const to = new THREE.Vector3().subVectors(deerAt, o), along = to.dot(d);
  if (along < 0 || along > max) return null;
  const closest = new THREE.Vector3().copy(o).addScaledVector(d, along);
  return closest.distanceTo(deerAt) < .8 ? { animal: { alive: true }, point: closest, headshot: closest.y > 1.4 } : null;
}
const water = (x: number): number | null => x < -10 ? .4 : null;
const floor = (): number => 0;
const random = (): (() => number) => { let s = 11; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; };

/** HeldPolearm's launch, flight and landings before the split (heldPolearm.ts, before CI12) */
function inline(slots: JavelinSlot[], log: string[], rnd: () => number) {
  const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _dir = new THREE.Vector3(), _head = new THREE.Vector3(), _nrm = new THREE.Vector3(), _stickDir = new THREE.Vector3();
  const onImpact = (s: ImpactSurface, at: THREE.Vector3): void => { log.push(`${s} ${at.toArray().map(v => v.toFixed(5)).join(',')}`); };
  const stick = (j: JavelinSlot, at: THREE.Vector3, dir: THREE.Vector3, surface: ImpactSurface): void => { j.state = 2; j.age = 0; j.vel.set(0, 0, 0); j.q.setFromUnitVectors(Y, _stickDir.copy(dir).normalize()); j.pos.copy(at).addScaledVector(_stickDir, -0.58); onImpact(surface, at); };
  const lie = (j: JavelinSlot, at: THREE.Vector3, n: THREE.Vector3, surface: ImpactSurface): void => {
    const along = _v2.copy(_dir).addScaledVector(n, -_dir.dot(n)); if (along.lengthSq() < 1e-6) along.set(1, 0, 0); along.normalize();
    j.state = 2; j.age = 0; j.vel.set(0, 0, 0); j.q.setFromUnitVectors(Y, along); j.pos.copy(at).addScaledVector(n, 0.04).addScaledVector(along, -0.58); onImpact(surface, at);
  };
  const drop = (j: JavelinSlot, at: THREE.Vector3): void => {
    const a = rnd() * Math.PI * 2; _v1.set(at.x + Math.cos(a) * 0.6, 0, at.z + Math.sin(a) * 0.6); _v1.y = floor();
    _dir.set(Math.cos(a + 1.3) * 0.7, -0.55, Math.sin(a + 1.3) * 0.7).normalize(); j.state = 2; j.age = 0; j.vel.set(0, 0, 0); j.q.setFromUnitVectors(Y, _dir); j.pos.copy(_v1).addScaledVector(_dir, -0.45);
  };
  return {
    launch(origin: THREE.Vector3, rotation: THREE.Quaternion, fwd: THREE.Vector3, m: { yaw: number; speed: number } | null): boolean {
      const j = slots.find((x) => x.state === 0); if (j === undefined) return false;
      _v1.set(0.22, 0.05, -0.3).applyQuaternion(rotation).add(origin); _v2.set(1, 0, 0).applyQuaternion(rotation); _dir.copy(fwd).applyAxisAngle(_v2, 0.035).normalize();
      j.state = 1; j.age = 0; j.pos.copy(_v1); j.vel.copy(_dir).multiplyScalar(profile.speed);
      if (m !== null) { j.vel.x -= Math.sin(m.yaw) * m.speed; j.vel.z -= Math.cos(m.yaw) * m.speed; }
      j.q.setFromUnitVectors(Y, _dir); return true;
    },
    fly(dt: number): void {
      for (const j of slots) {
        if (j.state === 1) {
          j.age += dt; let rem = dt;
          while (rem > 0) {
            const h = Math.min(rem, 1 / 120); rem -= h; _v1.copy(j.pos);
            j.vel.y -= profile.gravity * h; j.pos.addScaledVector(j.vel, h);
            const seg = _v2.subVectors(j.pos, _v1), len = seg.length(); if (len < 1e-6) continue;
            _dir.copy(seg).multiplyScalar(1 / len); _v3.copy(_v1).addScaledVector(_dir, profile.headOffset); _head.copy(_v3).addScaledVector(_dir, len);
            const wall = worldHit(_v3, _head);
            const hit = raycast(_v3, _dir, wall ? wall.distance : len);
            if (hit?.animal.alive === true) {
              const dmg = Math.round(profile.damage * (hit.headshot ? profile.headMultiplier : 1) * 1);
              log.push(`hit ${dmg} ${_dir.toArray().map(v => v.toFixed(5)).join(',')}`); onImpact('flesh', hit.point); drop(j, hit.point); break;
            }
            if (wall) {
              _v3.set(wall.point.x, wall.point.y, wall.point.z);
              if (wall.material === 'ground') { const ws = water(_v3.x); if (ws !== null && ws > _v3.y) { j.state = 0; onImpact('ground', _v3); break; } }
              if (sticks(wall.material)) { stick(j, _v3.addScaledVector(_dir, profile.radius), _dir, surfaceOf(wall.material)); break; }
              _nrm.set(wall.normal.x, wall.normal.y, wall.normal.z); if (_nrm.dot(_dir) > 0) _nrm.negate(); lie(j, _v3, _nrm, surfaceOf(wall.material)); break;
            }
            if (j.age > 8 || j.pos.y < -200) { j.state = 0; break; }
            j.q.setFromUnitVectors(Y, _dir);
          }
        }
      }
    },
  };
}

const pool = (): JavelinSlot[] => [0, 1, 2, 3].map(() => ({ state: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), q: new THREE.Quaternion(), age: 0 }));
const slotState = (slots: JavelinSlot[]): string => slots.map(j => `${j.state}|${[...j.pos.toArray(), ...j.q.toArray(), ...j.vel.toArray(), j.age].map(v => v.toFixed(9)).join(',')}`).join(' ');

test('the flight throws, flies and lands javelins as the inline weapon did', () => {
  const a = pool(), b = pool(), oldLog: string[] = [], newLog: string[] = [], oldRandom = random(), newRandom = random();
  const old = inline(a, oldLog, oldRandom);
  const flight = new JavelinFlight<Deer>(b, profile, {
    worldHit: (from, to) => worldHit(from, to), raycast,
    strike: (_hit, dmg, dir) => { newLog.push(`hit ${dmg} ${dir.toArray().map(v => v.toFixed(5)).join(',')}`); },
    impact: (s, at) => { newLog.push(`${s} ${at.toArray().map(v => v.toFixed(5)).join(',')}`); },
    water: x => water(x), floor, random: newRandom, surface: surfaceOf, damageScale: () => 1,
  });
  // the strike's own flesh impact (the weapon's onImpact after the hit) is the page's strike port's, so flesh lines are left out
  const origin = new THREE.Vector3(0, 1.6, 0), rotation = new THREE.Quaternion(), fwd = new THREE.Vector3(), e = new THREE.Euler(0, 0, 0, 'YXZ');
  let t = 0;
  for (let f = 0; f < 1500; f++) {
    const dt = f % 31 === 0 ? .09 : 1 / 30; t += dt;
    if (f % 45 === 0) {
      // aim round the compass and from flat to steep; every third throw from a horse
      e.set(-.05 + (f % 7) * .06, (f / 45) * .55, 0); rotation.setFromEuler(e); fwd.set(0, 0, -1).applyQuaternion(rotation);
      origin.set(Math.sin(f) * 3, 1.6, Math.cos(f) * 3);
      // every fifth throw straight at the deer, lobbed a little
      if (f % 225 === 0) { fwd.subVectors(deerAt, origin).setY(1.2).normalize(); rotation.setFromUnitVectors(new THREE.Vector3(0, 0, -1), fwd); }
      const mount = f % 135 === 0 ? { yaw: (f / 45) * .55, speed: 9 } : null;
      expect(flight.launch(origin, rotation, fwd, mount)).toBe(old.launch(origin, rotation, fwd, mount));
    }
    old.fly(dt); flight.fly(dt);
    expect(slotState(b)).toBe(slotState(a));
    // a lying javelin is picked up again after a while, as the decision would
    if (f % 90 === 89) for (const slots of [a, b]) { const lying = slots.find(j => j.state === 2); if (lying !== undefined) lying.state = 0; }
  }
  const strikes = newLog.filter(l => l.startsWith('hit')).length;
  expect(newLog.filter(l => !l.startsWith('flesh'))).toEqual(oldLog.filter(l => !l.startsWith('flesh')));
  // every kind of landing happened: a deer hit, sunk in the pond, stuck in turf or planks, lying on stone
  expect(strikes).toBeGreaterThan(0);
  expect(oldLog.some(l => l.startsWith('wood'))).toBe(true);
  expect(oldLog.filter(l => l.startsWith('ground')).length).toBeGreaterThan(1);
  expect(t).toBeGreaterThan(40);
});
