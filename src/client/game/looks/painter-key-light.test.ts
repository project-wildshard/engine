import { expect, test } from 'vitest';
import { Color, HemisphereLight, Vector3 } from 'three';
import type { SkyRig } from '@wildshard/engine/world/skyRig';
import { PainterKeyLight } from './painterlyLook';

// A made-up coast (the painter's key's fixture second user): a gentler swing, a sea-blue fill and a sand bounce.
const coast = { turn: 20, lift: 10, ease: [0, 10], sky: [0.2, 0.4, 0.8], ground: [0.6, 0.5, 0.3], mix: 0.5, fill: 0.8 };
function rig(): { sky: SkyRig; keys: { dir: Vector3; intensity: number }[] } {
  const keys: { dir: Vector3; intensity: number }[] = [], hemi = new HemisphereLight();
  const sky = { hemi, setKeyLight: (dir: Vector3, _colour: Color, intensity: number) => { keys.push({ dir: dir.clone(), intensity }); },
    sunDir: new Vector3(0, 1, 0), csm: { lights: [] } } as Pick<SkyRig, 'hemi' | 'setKeyLight' | 'sunDir'> as SkyRig;
  return { sky, keys };
}
const look = (sunDir: Vector3, moon = 0) => ({ sunDir, keyColor: new Color(1, 0.9, 0.8), keyIntensity: 2, moon, hemiSky: new Color(1, 1, 1), hemiGround: new Color(0, 0, 0), hemiIntensity: 1, saturation: 1.1 });

test('a second shard swings its key round and up while the sun is high, and mixes its own fill', () => {
  const { sky, keys } = rig(), saturation = { value: 1 }, key = new PainterKeyLight(coast, sky, 1, saturation);
  const high = new Vector3(0, Math.sin(30 * Math.PI / 180), Math.cos(30 * Math.PI / 180));   // north, 30° up
  key.apply(look(high));
  const dir = keys[0]?.dir; if (dir === undefined) throw new Error('No key set');
  expect(Math.asin(dir.y) * 180 / Math.PI).toBeCloseTo(40, 5);
  expect(Math.atan2(-dir.x, dir.z) * 180 / Math.PI).toBeCloseTo(20, 5);
  expect(keys[0]?.intensity).toBe(2);
  expect(sky.hemi.color.toArray()).toEqual([0.6, 0.7, 0.9]); expect(sky.hemi.groundColor.toArray()).toEqual([0.3, 0.25, 0.15]);
  expect(sky.hemi.intensity).toBe(0.8); expect(saturation.value).toBeCloseTo(1.1, 9);
});

test('the key eases onto a setting sun and leaves the moon alone', () => {
  const { sky, keys } = rig(), key = new PainterKeyLight(coast, sky, 1, { value: 1 });
  key.apply(look(new Vector3(0, 0, 1)));
  const set = keys[0]?.dir; expect(set?.x).toBeCloseTo(0, 9); expect(set?.y).toBeCloseTo(0, 9); expect(set?.z).toBeCloseTo(1, 9);
  key.apply(look(new Vector3(0, 1, 0), 1)); expect(keys).toHaveLength(1);
  expect(() => new PainterKeyLight({ ...coast, mix: 2 }, sky, 1, { value: 1 })).toThrow();
});
