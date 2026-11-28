// SHARD-SOURCE AP24b and AP28: a look's lamps are a fixed pool of point lights, given to the lamps nearest the eye, and a
// lamp may ride an actor or one of its bones.
import * as THREE from 'three';
import { expect, test } from 'vitest';
import type { LookLamp } from '@wildshard/format/look-light';
import { DESKTOP_LAMPS, LAMP_CARD_GLOW, LAMP_CARD_SIZE, LAMP_FADE_S, PHONE_LAMPS, lampLights, lookLightManifest, setLampFollow, setLampPanels } from './lookLight';

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

// meta MOSSGATE-ZONE MZ34 (for MZ7, QA 11-19 rows 29, 30): a lamp naming a panel lights with it: a brazier's fire glows once its
// letter burns, and goes dark with its flames.
test('a lamp naming a panel is lit only while that panel shows', () => {
  const scene = new THREE.Scene(), shown = new Set<string>();
  const undo = setLampPanels(scene, (panel) => shown.has(panel));
  const group = lampLights([lamp(0), lamp(4, { panel: 'mossgate.flame-a', flicker: { amount: 0, rate: 1 } }), lamp(8, { panel: 'mossgate.flame-b' })]);
  scene.add(group);
  expect(group.update).not.toBeNull();
  group.update?.(0);
  expect(litX(group), 'every brazier cold').toEqual([0]);
  shown.add('mossgate.flame-a'); group.update?.(0);
  expect(litX(group), 'A burns').toEqual([0, 4]);
  shown.add('mossgate.flame-b'); shown.delete('mossgate.flame-a'); group.update?.(0);
  expect(litX(group), 'A out, B burns').toEqual([0, 8]);
  undo(); group.update?.(0);
  expect(litX(group), 'no page lookup: dark').toEqual([0]);
});

// QA 11-25 row 153: a grid page lights at most its reserve of a crowded look's lamps, so as the eye walks the lights move
// between lamps; they fade across, with hysteresis, and never pop.
test('walking a crowded street, no light pops: each fades out of the lamp it leaves and into the next', () => {
  const street = Array.from({ length: 16 }, (_, i) => lamp(i * 4));
  const group = lampLights(street, 5);
  const eye = new THREE.Vector3(0, 1.7, 0);
  group.update?.(0, eye);
  expect(litX(group)).toEqual([0, 4, 8, 12, 16]);
  let before = lights(group).map((light) => light.intensity), worst = 0, handed = 0;
  const seen = new Set<number>();
  for (let frame = 1; frame <= 600; frame++) {
    eye.x = frame * 0.1; // 6 m/s at 60 fps
    group.update?.(frame / 60, eye);
    const now = lights(group).map((light) => light.intensity);
    now.forEach((value, i) => { worst = Math.max(worst, Math.abs(value - (before[i] ?? 0))); });
    for (const light of lights(group)) if (light.intensity > 0) seen.add(light.position.x);
    handed += now.filter((value, i) => value > 0 && (before[i] ?? 0) === 0).length;
    before = now;
  }
  // a frame moves a light by at most its fade step (5 / 0.25 s / 60 fps), never the lamp's whole intensity
  expect(worst).toBeLessThanOrEqual(5 / (LAMP_FADE_S * 60) + 1e-9);
  expect(handed).toBeGreaterThan(5);
  expect(Math.max(...seen)).toBeGreaterThanOrEqual(60);
});

test('a lamp on the edge of the lit set does not flicker in and out as the eye stands between two', () => {
  const street = Array.from({ length: 8 }, (_, i) => lamp(i * 4));
  const group = lampLights(street, 2);
  const eye = new THREE.Vector3(5.9, 1.7, 0);
  group.update?.(0, eye);
  expect(litX(group)).toEqual([4, 8]);
  // swaying round the midpoint between lamps 0 and 12 (4 and 8 always nearest): the held pair never changes
  for (let frame = 1; frame <= 120; frame++) {
    eye.x = 6 + Math.sin(frame / 5) * 0.4;
    group.update?.(frame / 60, eye);
    expect(litX(group)).toEqual([4, 8]);
  }
  // just past the line where lamp 12 is nearer than lamp 4, the light stays on 4 (hysteresis) ...
  eye.x = 8.2; for (let frame = 121; frame <= 180; frame++) group.update?.(frame / 60, eye);
  expect(litX(group)).toEqual([4, 8]);
  // ... and moves once 12 is clearly nearer
  eye.x = 10.5; for (let frame = 181; frame <= 240; frame++) group.update?.(frame / 60, eye);
  expect(litX(group)).toEqual([8, 12]);
  expect(Math.min(...lights(group).map((light) => light.intensity))).toBe(5);
});

test('a teleport sets the nearest lamps at once, at full strength', () => {
  const street = Array.from({ length: 30 }, (_, i) => lamp(i * 4));
  const group = lampLights(street, 3);
  group.update?.(0, new THREE.Vector3(0, 1.7, 0));
  group.update?.(1 / 60, new THREE.Vector3(0, 1.7, 0));
  group.update?.(2, new THREE.Vector3(100, 1.7, 0));
  expect(litX(group)).toEqual([96, 100, 104]);
  expect(lights(group).map((light) => light.intensity)).toEqual([5, 5, 5]);
});

// QA 11-25 row 153 (Jake, 11-26: 5 lights + glow cards): every lamp past the reserve keeps a glow card, so it still reads lit
const cards = (group: THREE.Group): THREE.InstancedMesh => {
  const mesh = group.children.find((child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh);
  if (mesh === undefined) throw new Error('no glow cards');
  return mesh;
};
const cardGlow = (group: THREE.Group): number[] => {
  const glow = cards(group).geometry.getAttribute('aGlow');
  return Array.from({ length: glow.count }, (_, i) => Number(glow.getX(i).toFixed(4)));
};

test('a crowded look gives every lamp past the lit reserve a glow card, and the lit ones none', () => {
  const street = Array.from({ length: 8 }, (_, i) => lamp(i * 4));
  const group = lampLights(street, 3);
  expect(group.lights).toHaveLength(3);
  expect(cards(group).count).toBe(8);
  group.update?.(0, new THREE.Vector3(0, 1.7, 0));
  expect(litX(group)).toEqual([0, 4, 8]);
  const card = Number(LAMP_CARD_GLOW.toFixed(4));
  expect(cardGlow(group)).toEqual([0, 0, 0, card, card, card, card, card]);
  // a card sits at its lamp, its halo's size or the default
  const at = new THREE.Matrix4();
  cards(group).getMatrixAt(5, at);
  expect(new THREE.Vector3().setFromMatrixPosition(at).toArray()).toEqual([20, 3, 0]);
  expect(new THREE.Vector3().setFromMatrixScale(at).x).toBeCloseTo(LAMP_CARD_SIZE);
});

test('a card fades out as its lamp takes a light and in as the lamp gives it up, never popping', () => {
  const street = Array.from({ length: 16 }, (_, i) => lamp(i * 4));
  const group = lampLights(street, 5);
  const eye = new THREE.Vector3(0, 1.7, 0);
  group.update?.(0, eye);
  let before = cardGlow(group), worst = 0;
  for (let frame = 1; frame <= 600; frame++) {
    eye.x = frame * 0.1;
    group.update?.(frame / 60, eye);
    const now = cardGlow(group);
    now.forEach((value, i) => { worst = Math.max(worst, Math.abs(value - (before[i] ?? 0))); });
    // a lamp's light and its card add up to one lamp's worth of glow: never both whole, never neither
    lights(group).forEach((light) => { expect(light.intensity).toBeLessThanOrEqual(5 + 1e-9); });
    before = now;
  }
  expect(worst).toBeLessThanOrEqual(LAMP_CARD_GLOW / (LAMP_FADE_S * 60) + 1e-3);
});

test('a dark lamp shows no card, and a page that draws halos leaves a fixed haloed lamp to its halo', () => {
  const street = [...Array.from({ length: 4 }, (_, i) => lamp(i * 4)), lamp(40, { panel: 'mossgate.flame-a' }), lamp(44, { halo: { size: 2, opacity: 0.5 } })];
  const group = lampLights(street, 2, undefined, { halos: true });
  group.update?.(0, new THREE.Vector3(0, 1.7, 0));
  const glow = cardGlow(group);
  expect(glow[4]).toBe(0); // its panel is shut: dark
  expect(glow[5]).toBe(0); // its halo glows instead
  expect(glow[2]).toBeGreaterThan(0);
  const grid = lampLights(street, 2);
  grid.update?.(0, new THREE.Vector3(0, 1.7, 0));
  expect(cardGlow(grid)[5]).toBeGreaterThan(0); // a grid page draws no halos: its card glows
  const at = new THREE.Matrix4();
  cards(grid).getMatrixAt(5, at);
  expect(new THREE.Vector3().setFromMatrixScale(at).x).toBeCloseTo(2);
});

test('a look within its reserve has no cards and draws as before', () => {
  const group = lampLights([lamp(0), lamp(4)], 5);
  expect(group.children.some((child) => child instanceof THREE.InstancedMesh)).toBe(false);
  expect(group.lights).toHaveLength(2);
});
