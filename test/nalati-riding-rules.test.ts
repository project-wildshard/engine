import { Vector3 } from 'three';
import { afterEach,beforeEach,expect,test } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import { ReturnProgram } from '../src/shared/game/population/returnProgram';
import type { TamingHerd,TamingHorse,TamingServices } from '../src/shared/game/riding/bindingTypes';
import { TamingSession as TamingBinding } from '../src/shared/game/riding/taming';
import rows from './fixtures/engine-lift/nalati-assembly-input.json' with { type: 'json' };
import { lendNalatiRiding,NALATI_RIDING_PROGRAMS as programs } from './fixtures/engine-lift/pins';

let scope:Scope;
beforeEach(()=>{scope=new Scope('taming-rules');lendNalatiRiding(scope);});
afterEach(()=>{scope.dispose();});

function rig() {
  const horse: TamingHorse = { entityId: 'wild', kind: 'horse', scale: 1, alive: true, yaw: 0, position: new Vector3(), mem: {}, headWorld: out => out.set(0, 2, 0), setMotion: () => undefined };
  let stallion: TamingHorse | null = horse;
  const hud = { offer: true, lean: 0 };
  const herd: TamingHerd<TamingHorse> = { get stallion() { return stallion; }, stallionState: 'beaten', cx: 0, cz: 0, trust: 100, alert: 0, alertOwned: false, mode: 'graze',
    addTrust(value) { this.trust = Math.max(0, Math.min(100, this.trust + value)); }, leadAway() { this.mode = 'flee'; }, releaseStallion() { stallion = null; } };
  let mounted: TamingHorse | null = null, damage = 0, saved: string | null = null, hidden = false, retired = false;
  const ports: TamingServices<TamingHorse, TamingHerd<TamingHorse>> = { profile: { ...rows.constants.nativeTaming.binding, bonds: ['1', 'argymaq'], names: ['Tulpar', 'Argymaq'], offset: [2.6, 3.5], labels: { ...rows.constants.nativeTaming.binding.labels, bonded: ['Bonded', 'Upgraded'] } }, programs, bond: { read: () => saved, write: value => { saved = value; } },
    player: { position: new Vector3(0, 0, 2), crouching: true, yaw: 0, pitch: 0, keys: new Set(), camera: { position: new Vector3(0, 2, 2), getWorldDirection: out => out.set(0, 0, -1) } },
    mount: { get mounted() { return mounted !== null; }, get horse() { return mounted; }, breakShake: 0, breakRoll: 0, mount: a => { mounted = a; return true; }, dismount: () => { mounted = null; }, addMountable: () => undefined, removeMountable: () => undefined },
    hud, herds: () => [herd], rest: { x: 0, z: 0, face: { x: 1, z: 0 } }, wind: () => ({ x: 0, z: 1, strength: 1 }), random: () => .25,
    spawnBonded: (x, z, yaw, argymaq) => ({ ...horse, entityId: 'bonded', kind: argymaq ? 'argymaq' : 'horse', position: new Vector3(x, 0, z), yaw }), hideStallion: () => { hidden = true; }, retireBonded: () => { retired = true; }, hurt: value => { damage += value; } };
  return { horse, herd, ports, hud, law: new TamingBinding(ports,scope), result: () => ({ mounted, damage, saved, hidden, retired }) };
}

test('approach selects the closest eligible live stallion and spends trust from observations', () => {
  const law = ReturnProgram.page(programs.approach,scope);
  const candidates = [{ x: 0, y: 0, z: 0, alive: 1, argymaq: 0 }, { x: 0, y: 0, z: 10, alive: 1, argymaq: 1 }];
  expect(law.project('select', { count: 2, px: 0, py: 0, pz: 1, bonded: 0, argymaq: 0 }, undefined, candidates)['index']).toBe(0);
  expect(law.project('select', { count: 2, px: 0, py: 0, pz: 1, bonded: 1, argymaq: 0 }, undefined, candidates)['index']).toBe(1);
  expect(law.project('select', { count: 2, px: 0, py: 0, pz: 1, bonded: 1, argymaq: 1 }, undefined, candidates)['index']).toBe(-1);
  expect(law.project('select', { count: 2, px: 100, py: 0, pz: 1, bonded: 0, argymaq: 0 }, undefined, candidates)['active']).toBe(0);
  const row = law.project('approach', { scale: 1, dt: .1, distance: 2, beaten: 0, mounted: 0, speed: 0, dot: 0, lookT: 0, offer: 1, alert: 0, trust: 99, crouched: 1, downwind: 1, strength: 1, flee: 0 });
  expect(row['trust']).toBe(1.5); expect(row['radius']).toBe(3.6);
  expect(law.project('event', { x: 0, z: 0, cx: 0, cz: 0, px: 0, pz: 0, shot: 1, alert: 0 })).toEqual({ trust: -30, alert: 100 });
});

test('native binding completes five rounds, adopts once, and restricts the second bond to Argymaq', () => {
  const { law, hud, horse, result } = rig(); law.update(.1); expect(law.interactable.radius).toBe(3.6); law.startBreaking();
  let previous = 0;
  const rounds = new Set<number>();
  for (let i = 0; i < 220 && law.phase === 'breaking'; i++) {
    const b = law.view.balance;
    hud.lean = Math.max(-1, Math.min(1, b * 8 + (b - previous) * 10 * 2)); previous = b;
    law.update(.1);
    if (law.view.round !== null) rounds.add(law.view.round);
  }
  expect([...rounds]).toEqual([1, 2, 3, 4, 5]);
  expect(law.phase).toBe('bonded'); expect(result().hidden).toBe(true); expect(result().saved).toBe('1'); expect(result().mounted?.entityId).toBe('bonded'); expect(result().damage).toBe(0);
  expect(law.canTame(horse)).toBe(false); expect(law.canTame({ ...horse, kind: 'argymaq' })).toBe(true);
});

test('throwing applies health and trust effects; mid-round numeric state reconnects without spawning', () => {
  const a = rig(); a.law.update(.1); a.law.startBreaking(); a.law.update(.1);
  const wire = a.law.snapshot(); a.law.restore(wire, [a.horse]); expect(a.law.snapshot()).toBe(wire);
  for (let i = 0; i < 200 && a.law.phase === 'breaking'; i++) { a.hud.lean = -1; a.law.update(.1); }
  expect(a.law.phase).toBe('wild'); expect(a.result().damage).toBe(10); expect(a.herd.trust).toBe(60); expect(a.result().saved).toBeNull();
});

// A scheduled buck can fall on the same sample as a round boundary.
test.each([1, 5])('round %i publishes one next-buck channel at the boundary', round => {
  const law = ReturnProgram.page(programs.breaking,scope);
  const row = law.project('step', { ...programs.initial, round, roundT: 3.4, next: 3.45, dt: .1, lean: 0, r0: .25, r1: .25, r2: .25 });
  expect(row['round']).toBe(round + 1);
  expect(row['roundT']).toBe(0);
  expect(row['next']).toBe(.55);
  expect(row['outcome']).toBe(round === 5 ? 1 : 0);
});

test('bucking holds its published pose between 10 Hz decisions', () => {
  const { law } = rig();
  law.update(.1); law.startBreaking();
  const before = law.snapshot(); law.update(1 / 60);
  expect(law.view.balance).toBe(0); expect(law.snapshot()).not.toBe(before);
  expect(law.phase).toBe('breaking');
  expect(law.view.round).toBe(1);
});
