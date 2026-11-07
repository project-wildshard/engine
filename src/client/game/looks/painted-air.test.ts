import * as THREE from 'three';
import { afterEach, expect, test } from 'vitest';
import { wind } from '@wildshard/engine/world/steppeWind';
import { installAtmosphere } from '@wildshard/engine/world/Atmosphere';
import { paintedAir } from './paintedLook';

// A made-up moor (painted air's fixture second user): bigger, fainter cloud shadows that drift slower.
const moor = { tile: 800, threshold: 0.6, strength: 0.4, softness: 0.1, drift: [1, 0.5] };
const chunks = { ...THREE.ShaderChunk };
afterEach(() => { Object.assign(THREE.ShaderChunk, chunks); });

test('a second shard\'s cloud shadows install once, even when its region installs them again', () => {
  installAtmosphere();
  const air = paintedAir(moor);
  air.install(); air.install(); paintedAir(moor).install();
  expect(THREE.ShaderChunk.fog_pars_fragment.split('float pCloudShadow()').length).toBe(2);
  const field = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  air.sky.build?.({} as Parameters<NonNullable<typeof air.sky.build>>[0], field);
  air.sky.build?.({} as Parameters<NonNullable<typeof air.sky.build>>[0], field);
  expect(THREE.ShaderChunk.lights_fragment_begin.split('directLight.color *= pCloudShadow();').length).toBeGreaterThan(1);
  const patched = THREE.ShaderChunk.lights_fragment_begin;
  air.sky.build?.({} as Parameters<NonNullable<typeof air.sky.build>>[0], field);
  expect(THREE.ShaderChunk.lights_fragment_begin).toBe(patched);
  expect([air.sky.clouds, air.sky.planet, air.sky.ownSky]).toEqual([false, false, true]);
});

test('the sun loop is left alone until the air is installed; the field drifts downwind at its own rate', () => {
  const air = paintedAir(moor), before = THREE.ShaderChunk.lights_fragment_begin, field = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  air.sky.build?.({} as Parameters<NonNullable<typeof air.sky.build>>[0], field);
  expect(THREE.ShaderChunk.lights_fragment_begin).toBe(before);
  const step = (wind.speed + 0.5) * 2 / 800, x = wind.dirX, z = wind.dirZ;
  air.sky.update?.(2);
  expect(air.offset.x).toBeCloseTo(-x * step, 9); expect(air.offset.y).toBeCloseTo(-z * step, 9);
  expect(() => paintedAir({ ...moor, strength: 2 })).toThrow();
});
