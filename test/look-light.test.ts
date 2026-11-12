import { expect, test } from 'vitest';
import * as THREE from 'three';
import { lookLightManifest, lightPools, rimPatch, LOOK_RIM_PATCH } from '../src/client/engine/render/lookLight';
import { lookLightOn } from '../src/client/engine/ui/lookLightOption';
import { jsonSlot } from '../src/client/engine/saves/slots';

// TEMPLATE-E2E LF1-4: optional light and post settings for any shard's look (`look.light`, `look.grade.bloom`). Each is
// off when absent, and all of them wait behind Settings ▸ Debug ▸ Look ▸ "Look light" (default off) until Jake picks:
// with the row off a look that declares every setting draws exactly as one that declares none.

const LIGHT = {
  ao: { intensity: 2, radius: 1.5 },
  rim: { colour: [1, 0.7, 0.4] as [number, number, number], strength: 0.4, power: 3 },
  heightFog: { density: 0.08, height: -1, falloff: 0.6 },
  pools: { colour: [1, 0.6, 0.2] as [number, number, number], intensity: 1, radius: 3, at: [[0, 0, -9], [3, 0, -6]] as [number, number, number][] },
};
const OFF = { atmosphere: { fogHeight: -20, fogHeightFalloff: 0, fogHeightDensity: 0 }, bloom: { intensity: 0, threshold: 1 }, ao: null, rim: null, pools: null };

test('the Debug row off: every setting is ignored, the look is as before', () => {
  expect(lookLightManifest({ light: LIGHT, grade: { bloom: { intensity: 0.8, threshold: 0.6 } } }, false)).toEqual(OFF);
});

test('no settings declared: the row on changes nothing', () => {
  expect(lookLightManifest({ grade: {} }, true)).toEqual(OFF);
});

test('ao: the engine AO on the desktop tier at the declared intensity and radius', () => {
  expect(lookLightManifest({ light: { ao: LIGHT.ao }, grade: {} }, true).ao).toEqual({ intensity: 2, radius: 1.5 });
});

test('heightFog: the engine fog program’s height term (mist pooled low), not more distance fog', () => {
  expect(lookLightManifest({ light: { heightFog: LIGHT.heightFog }, grade: {} }, true).atmosphere).toEqual({ fogHeight: -1, fogHeightFalloff: 0.6, fogHeightDensity: 0.08 });
});

test('grade.bloom: a shardfile shard turns bloom on', () => {
  expect(lookLightManifest({ grade: { bloom: { intensity: 0.8, threshold: 0.6 } } }, true).bloom).toEqual({ intensity: 0.8, threshold: 0.6 });
});

test('rim: a fresnel term added after the lit colour, its values uniforms (one shader text for any rim)', () => {
  const shader = { uniforms: {} as Record<string, THREE.IUniform>, fragmentShader: THREE.ShaderLib.standard.fragmentShader, vertexShader: THREE.ShaderLib.standard.vertexShader };
  rimPatch(LIGHT.rim)(shader as never);
  expect(shader.fragmentShader).toContain('wsRimColour');
  expect(shader.fragmentShader.indexOf('wsRimColour * wsRimStrength')).toBeGreaterThan(shader.fragmentShader.indexOf('#include <opaque_fragment>'));
  expect(shader.uniforms['wsRimStrength']?.value).toBe(0.4);
  // upright faces only: the term is weighted by how far the normal is from world up
  expect(shader.fragmentShader).toContain('wsRimSide');
  const other = { uniforms: {} as Record<string, THREE.IUniform>, fragmentShader: THREE.ShaderLib.standard.fragmentShader, vertexShader: '' };
  rimPatch({ ...LIGHT.rim, strength: 1, power: 5 })(other as never);
  expect(other.fragmentShader).toBe(shader.fragmentShader);
  // an unlit or custom shader (no view position or normal) is left alone
  const dome = { uniforms: {} as Record<string, THREE.IUniform>, fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }', vertexShader: '' };
  rimPatch(LIGHT.rim)(dome as never);
  expect(dome.fragmentShader).toBe('void main() { gl_FragColor = vec4(1.0); }');
  expect(LOOK_RIM_PATCH).toBe('engine.look.rim');
});

test('pools: one additive instanced decal draw for every lamp, no light objects', () => {
  const pools = lightPools(LIGHT.pools);
  expect(pools).toBeInstanceOf(THREE.InstancedMesh);
  expect(pools.count).toBe(2);
  expect(pools.material.blending).toBe(THREE.AdditiveBlending);
  expect(pools.material.depthWrite).toBe(false);
  expect(pools.material.fog).toBe(false);
  const m = new THREE.Matrix4(), at = new THREE.Vector3();
  pools.getMatrixAt(1, m); at.setFromMatrixPosition(m);
  expect([at.x, at.z]).toEqual([3, -6]);
  expect(at.y).toBeGreaterThan(0);
  let lights = 0; pools.traverse((o) => { if (o instanceof THREE.Light) lights++; });
  expect(lights).toBe(0);
});

test('the phone tier draws none of the settings, even with the row on (its 30 fps lock and programs stay)', () => {
  const slot = jsonSlot('debug.lookLight', 'device');
  slot.write('on');
  try {
    expect(lookLightOn('desktop')).toBe(true);
    expect(lookLightOn('phone')).toBe(false);
  } finally { slot.write('off'); }
  expect(lookLightOn('desktop')).toBe(false);
});

test('rim: every lit three shader takes it (toon, lambert, phong, standard), an unlit one does not', () => {
  for (const kind of ['toon', 'lambert', 'phong', 'standard'] as const) {
    const shader = { uniforms: {} as Record<string, THREE.IUniform>, fragmentShader: THREE.ShaderLib[kind]?.fragmentShader ?? '', vertexShader: '' };
    rimPatch(LIGHT.rim)(shader as never);
    expect(shader.fragmentShader, kind).toContain('wsRimSide');
  }
  const basic = { uniforms: {} as Record<string, THREE.IUniform>, fragmentShader: THREE.ShaderLib.basic.fragmentShader, vertexShader: '' };
  rimPatch(LIGHT.rim)(basic as never);
  expect(basic.fragmentShader).toBe(THREE.ShaderLib.basic.fragmentShader);
});
