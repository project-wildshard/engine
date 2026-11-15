// SHARD-SOURCE AP24b and AP28: a look's lamps are a fixed pool of point lights, given to the lamps nearest the eye, and a
// lamp may ride an actor or one of its bones.
import * as THREE from 'three';
import { expect, test } from 'vitest';
import type { LookLamp } from '@wildshard/format/look-light';
import { DESKTOP_LAMPS, PHONE_LAMPS, lampLights, lookLightManifest, setLampFollow } from './lookLight';

const lamp = (x: number, extra: Partial<LookLamp> = {}): LookLamp => ({ at: [x, 3, 0], colour: [1, 0.6, 0.3], intensity: 5, distance: 9, ...extra });
const lights = (group: THREE.Group): THREE.PointLight[] => group.children.filter((child): child is THREE.PointLight => child instanceof THREE.PointLight);
const litX = (group: THREE.Group): number[] => lights(group).filter((light) => light.intensity > 0).map((light) => light.position.x).sort((a, b) => a - b);

test('a few fixed lamps draw as before: one light each, nothing to update', () => {
  const group = lampLights([lamp(0), lamp(4), lamp(8, { decay: 1 })]);
  expect(group.update).toBeNull();
  expect(lights(group).map((light) => [light.position.x, light.intensity, light.decay])).toEqual([[0, 5, 2], [4, 5, 2], [8, 5, 1]]);
});

test('a street of 60 lamps lights the 16 nearest the eye, and the pool never grows (AP28)', () => {
  const street = Array.from({ length: 60 }, (_, i) => lamp(i * 4));
  const group = lampLights(street);
  expect(lights(group)).toHaveLength(DESKTOP_LAMPS);
  group.update?.(0, new THREE.Vector3(-10, 1.7, 0));
  expect(litX(group)).toEqual(Array.from({ length: 16 }, (_, i) => i * 4));
  group.update?.(0, new THREE.Vector3(118, 1.7, 0));
  expect(litX(group)).toEqual(Array.from({ length: 16 }, (_, i) => 88 + i * 4));
  expect(lights(group)).toHaveLength(DESKTOP_LAMPS);
  const phone = lampLights(street, PHONE_LAMPS);
  phone.update?.(0, new THREE.Vector3(41, 1.7, 0));
  expect(litX(phone)).toEqual([36, 40, 44, 48]);
  expect(lights(phone)).toHaveLength(PHONE_LAMPS);
});

test('a phone keeps every lamp and lights the nearest 4 (AP28)', () => {
  const street = Array.from({ length: 10 }, (_, i) => lamp(i * 4));
  const look = { light: { lamps: street }, grade: {} };
  expect(lookLightManifest(look, true, 'phone')).toMatchObject({ lampsLit: PHONE_LAMPS });
  expect(lookLightManifest(look, true, 'phone').lamps).toHaveLength(10);
  expect(lookLightManifest(look, true).lampsLit).toBe(DESKTOP_LAMPS);
});

test('a lamp follows its actor\'s bone, and is dark while that actor is absent (AP24b)', () => {
  const scene = new THREE.Scene(), boss = new THREE.Object3D(), head = new THREE.Bone();
  head.name = 'head'; head.position.set(0, 2, 0); boss.add(head); boss.position.set(10, 0, 5); boss.rotation.y = Math.PI / 2;
  let present = true;
  const undo = setLampFollow(scene, (actor, bone) => (present && actor === 'boss.warden' ? (bone === undefined ? boss : boss.getObjectByName(bone) ?? null) : null));
  const group = lampLights([lamp(0), lamp(0, { at: [0, 0.2, 0.5], follow: { actor: 'boss.warden', bone: 'head' } }), lamp(0, { at: [0, 1, 0], follow: { actor: 'boss.warden' } })]);
  scene.add(group, boss);
  expect(group.update).not.toBeNull();
  scene.updateMatrixWorld(true); group.update?.(0);
  const [, eyes, core] = lights(group);
  // the head's frame turned a quarter round Y: its +Z offset points along world +X
  expect(eyes?.position.toArray().map((n) => Math.round(n * 100) / 100)).toEqual([10.5, 2.2, 5]);
  expect(core?.position.toArray()).toEqual([10, 1, 5]);
  boss.position.x = 20; scene.updateMatrixWorld(true); group.update?.(0);
  expect(core?.position.x).toBe(20);
  present = false; group.update?.(0);
  expect(lights(group).map((light) => light.intensity)).toEqual([5, 0, 0]);
  undo();
});
