import { expect, test } from 'vitest';
import { Object3D, PointLight, Vector3 } from 'three';
import { SiteLights } from './SiteLights';

test('Pine waystones and Sunscar braziers publish ignition before the shared pool visits', () => {
  for (const row of [{ color: 0xffb060, intensity: 9, distance: 12, kind: 'lamp' as const },
    { color: 0xff7a30, intensity: 9, distance: 10, kind: 'fire' as const }]) {
    const lights = new SiteLights({ flicker: { depth: 1, waves: [[11, 0, 0.07], [23, 1, 0.05]] } });
    const light = lights.addLight(new PointLight()), near = new Object3D(), far = new Object3D();
    near.position.set(2, 0, 0); far.position.set(20, 0, 0);
    const state = { lit: false };
    lights.addLamp(near, row.color, row.intensity, row.distance, state, row.kind);
    lights.addLamp(far, 0xffd27a, 5, 10);
    lights.step(0, new Vector3());
    expect(light.position.x).toBe(20);
    state.lit = true;
    lights.step(0, new Vector3());
    expect(light.position.x).toBe(2);
    expect(light.color.getHex()).toBe(row.color);
    expect(light.distance).toBe(row.distance);
    expect(light.intensity).toBeGreaterThan(0);
    state.lit = false;
    lights.step(0, new Vector3());
    expect(light.position.x).toBe(20);
    light.dispose();
  }
});

test('a dark state box removes a room site and extinguishes an unused shared slot', () => {
  const lights = new SiteLights({ flicker: { depth: 0, waves: [] }, indoor: { doorRadius: 2, ranks: [1, 0] } });
  const root = new Object3D(), outside = new Object3D(), inside = new Object3D(), state = { lit: true };
  outside.position.x = 4; inside.position.x = 1;
  const light = lights.addLight(new PointLight());
  const anchor = { color: 0xffb060, intensity: 9, distance: 12, decay: 2, seed: 0, kind: 'lamp' as const };
  lights.addSite({ root, state, rooms: [{ x: 0, z: 0, hw: 2, hd: 2 }], door: [0, 2],
    anchors: [{ ...anchor, anchor: outside, rank: 0 }, { ...anchor, anchor: inside, rank: 1 }] });
  lights.step(0, new Vector3());
  expect(light.position.x).toBe(1);
  state.lit = false;
  lights.step(0, new Vector3());
  expect(light.intensity).toBe(0);
  light.dispose();
});
