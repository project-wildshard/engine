import { expect, test } from 'vitest';
import * as THREE from 'three';
import type { TargetAnimal, TargetHit } from '@wildshard/engine/combat/types';
import { PolearmContact, type PolearmContactPorts } from '../../../shared/game/weapons/polearmContact';

interface Fake { readonly animal: TargetAnimal; readonly staggers: { dir: THREE.Vector3; strength: number }[] }
function fake(kind: string, x: number, z: number, alive = true): Fake {
  const staggers: { dir: THREE.Vector3; strength: number }[] = [];
  return { staggers, animal: { kind, alive, position: new THREE.Vector3(x, 0, z), applyDamage: () => false, damageFor: () => 0,
    stagger: (dir, strength) => { staggers.push({ dir: dir.clone(), strength }); } } };
}
const profile = { reach: 3, thrust: { damage: 40, stagger: 2, fan: { pitches: [0, -0.1], yaws: [0, 0.1, -0.1] } } };

test('the thrust takes the first fan ray the combat hit accepts, staggers along the aim and ends the stroke', () => {
  const dead = fake('deer', 0, -2, false), refused = fake('wolf', 0, -2), struck = fake('boar', 0, -2);
  const rays: number[][] = [], contacts: [string, number, string][] = [], events: [string, boolean][] = [];
  const order = [null, dead.animal, refused.animal, struck.animal];
  const ports: PolearmContactPorts<{ position: THREE.Vector3 }> = {
    raycast: (_o, dir) => { rays.push([dir.x, dir.y, dir.z]); const animal = order[rays.length - 1] ?? null;
      return animal === null ? null : { animal, point: new THREE.Vector3(0, 1, -2), distance: 2, headshot: false }; },
    contact: (animal, amount, _p, _d, _f, moveId) => { contacts.push([animal.kind, amount, moveId]); return animal === refused.animal ? null : { killed: false }; },
    same: () => true,
    struck: (hit, killed) => { events.push([hit.animal.kind, killed]); },
  };
  const decision = { hitDone: false, struck: (): void => undefined };
  const law = new PolearmContact(ports, decision);
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0, 'YXZ')), forward = new THREE.Vector3(0, 0, -1).applyQuaternion(rotation);
  const out = law.thrust(new THREE.Vector3(), rotation, forward, profile);
  expect(out?.hit.animal).toBe(struck.animal);
  expect(rays).toHaveLength(4); // pitch 0: yaw 0, 0.1, -0.1, then pitch -0.1, yaw 0
  const first = new THREE.Vector3(0, 0, -1).applyQuaternion(rotation);
  expect(rays[0]?.[0]).toBeCloseTo(first.x); expect(rays[0]?.[2]).toBeCloseTo(first.z);
  expect(contacts).toEqual([['wolf', 40, 'move.thrust'], ['boar', 40, 'move.thrust']]);
  expect(struck.staggers).toHaveLength(1); expect(struck.staggers[0]?.strength).toBe(2);
  expect(struck.staggers[0]?.dir.x).toBeCloseTo(forward.x); expect(struck.staggers[0]?.dir.z).toBeCloseTo(forward.z);
  expect(decision.hitDone).toBe(true); expect(events).toEqual([['boar', false]]);
  expect(new PolearmContact({ ...ports, raycast: null }, decision).thrust(new THREE.Vector3(), rotation, forward, profile)).toBeNull();
});

test('the lance strikes only its aimed target, starts its rehit clock and staggers it away from the rider', () => {
  const aimed = fake('deer', 3, -4), other = fake('wolf', 3, -4);
  const target = { position: aimed.animal.position, scale: 2, dims: { bodyY: 0.5 } };
  let hitAnimal: TargetAnimal = other.animal;
  const rays: { dir: THREE.Vector3; max: number }[] = [], clocks: [unknown, number][] = [];
  const ports: PolearmContactPorts<typeof target> = {
    raycast: (_o, dir, max): TargetHit => { rays.push({ dir: dir.clone(), max }); return { animal: hitAnimal, point: new THREE.Vector3(3, 1, -4), distance: 5, headshot: false }; },
    contact: (_a, amount, _p, _d, _f, moveId) => { expect([amount, moveId]).toEqual([55, 'move.lance']); return { killed: false }; },
    same: (animal, t) => animal.position === t.position,
    struck: () => undefined,
  };
  const law = new PolearmContact(ports, { hitDone: false, struck: (t, at) => { clocks.push([t, at]); } });
  const origin = new THREE.Vector3(0, 1, 0), rider = new THREE.Vector3(1, 0, 0);
  expect(law.lance(origin, target, 55, 7, rider)).toBeNull(); // the first animal on the ray is not the target
  hitAnimal = aimed.animal;
  expect(law.lance(origin, target, 55, 7, rider)?.killed).toBe(false);
  const to = new THREE.Vector3(3, 1, -4).sub(origin); // body height 0.5 × scale 2 above its feet
  expect(rays[1]?.dir.x).toBeCloseTo(to.x / to.length()); expect(rays[1]?.max).toBeCloseTo(to.length() + 1);
  expect(clocks).toEqual([[target, 7]]);
  const away = new THREE.Vector3(2, 0, -4).normalize();
  expect(aimed.staggers[0]?.dir.x).toBeCloseTo(away.x); expect(aimed.staggers[0]?.dir.z).toBeCloseTo(away.z); expect(aimed.staggers[0]?.strength).toBe(1);
});
