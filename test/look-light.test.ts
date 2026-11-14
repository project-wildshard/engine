import { expect, test } from 'vitest';
import * as THREE from 'three';
import { bounceLight, environmentScene, lampLights, lookLightManifest, lightPools, rimPatch, LOOK_RIM_PATCH, PHONE_LAMPS } from '../src/client/engine/render/lookLight';
import { lookLightOn } from '../src/client/engine/ui/lookLightOption';
import { jsonSlot } from '../src/client/engine/saves/slots';

// TEMPLATE-E2E LF1-4: optional light and post settings for any shard's look (`look.light`, `look.grade.bloom`). Each is
// off when absent, and all of them wait behind Settings ▸ Debug ▸ Look ▸ "Look light" (default on for the desktop tier
// since TEMPLATES-CLEANROOM B2): with the row off a look that declares every setting draws exactly as one that declares none.

const LIGHT = {
  ao: { intensity: 2, radius: 1.5 },
  rim: { colour: [1, 0.7, 0.4] as [number, number, number], strength: 0.4, power: 3 },
  heightFog: { density: 0.08, height: -1, falloff: 0.6 },
  pools: { colour: [1, 0.6, 0.2] as [number, number, number], intensity: 1, radius: 3, at: [[0, 0, -9], [3, 0, -6]] as [number, number, number][] },
};
const OFF = { atmosphere: { fogHeight: -20, fogHeightFalloff: 0, fogHeightDensity: 0 }, bloom: { intensity: 0, threshold: 1, radius: null }, ao: null, rim: null, pools: null, lamps: null, bounce: null, environment: null, shadow: null, motes: null };
const B2 = {
  lamps: [{ at: [1, 2, -3] as [number, number, number], colour: [1, 0.4, 0.06] as [number, number, number], intensity: 4, distance: 7 }],
  bounce: { colour: [1, 0.28, 0.16] as [number, number, number], intensity: 0.35, lift: 0.25 },
  environment: { intensity: 0.5, ground: [1, 0.25, 0.1] as [number, number, number] },
};

test('the Debug row off: every setting is ignored, the look is as before', () => {
  expect(lookLightManifest({ light: { ...LIGHT, ...B2 }, grade: { bloom: { intensity: 0.8, threshold: 0.6 } } }, false)).toEqual(OFF);
});

test('B2: lamps, bounce and environment resolve with the row on', () => {
  const resolved = lookLightManifest({ light: B2, grade: {} }, true);
  expect(resolved.lamps).toEqual(B2.lamps);
  expect(resolved.bounce).toEqual(B2.bounce);
  expect(resolved.environment).toEqual(B2.environment);
});

test('B2 lamps: one shadowless point light per lamp, physical decay, at its point', () => {
  const group = lampLights(B2.lamps);
  expect(group.children).toHaveLength(1);
  const light = group.children[0] as THREE.PointLight;
  expect(light).toBeInstanceOf(THREE.PointLight);
  expect([light.position.x, light.position.y, light.position.z]).toEqual([1, 2, -3]);
  expect([light.intensity, light.distance, light.decay, light.castShadow]).toEqual([4, 7, 2, false]);
  expect(group.update).toBeNull();
});

test('M4.3 lamps: a declared decay, and a flicker that swings the intensity round its base', () => {
  const group = lampLights([{ ...B2.lamps[0]!, decay: 1.2, flicker: { rate: 8, amount: 0.3 } }]);
  const light = group.children[0] as THREE.PointLight;
  expect(light.decay).toBe(1.2);
  const seen = new Set<number>();
  for (let t = 0; t < 2; t += 0.05) { group.update?.(t); seen.add(Number(light.intensity.toFixed(3))); expect(light.intensity).toBeGreaterThanOrEqual(4 * 0.7 - 1e-9); expect(light.intensity).toBeLessThanOrEqual(4 + 1e-9); }
  expect(seen.size).toBeGreaterThan(10);
});

test('B2 bounce: a shadowless directional light from the anti-sun heading, lifted', () => {
  const { light, aim } = bounceLight(B2.bounce);
  aim(new THREE.Vector3(-0.79, 0.53, -0.32).normalize());
  const dir = light.position.clone().sub(light.target.position).normalize();
  expect(light.castShadow).toBe(false);
  expect(dir.x).toBeGreaterThan(0.8); // the sun is to -x: the bounce comes from +x
  expect(dir.y).toBeCloseTo(0.25, 5);
  expect(light.intensity).toBe(0.35);
});

test('B2 environment: the dome over a ground disc, for one PMREM', () => {
  const dome = new THREE.Mesh(new THREE.SphereGeometry(600, 8, 4), new THREE.MeshBasicMaterial());
  const made = environmentScene(dome, B2.environment);
  const meshes = made.scene.children.filter((o): o is THREE.Mesh => o instanceof THREE.Mesh);
  expect(meshes).toHaveLength(2);
  expect(meshes[0]?.material).toBe(dome.material); // the look's own sky, not a copy
  const floor = meshes[1]?.material as THREE.MeshBasicMaterial;
  expect(floor.color.r).toBeCloseTo(1, 5);
  made.dispose();
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
  expect(lookLightManifest({ grade: { bloom: { intensity: 0.8, threshold: 0.6 } } }, true).bloom).toEqual({ intensity: 0.8, threshold: 0.6, radius: null });
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

test('M4.9: the phone tier keeps the cheap settings: no bloom or AO, at most PHONE_LAMPS lamps, half the motes', () => {
  const slot = jsonSlot('debug.lookLight', 'device');
  slot.write('on');
  try {
    expect(lookLightOn('desktop')).toBe(true);
    expect(lookLightOn('phone')).toBe(true);
  } finally { slot.write('off'); }
  expect(lookLightOn('phone')).toBe(false);
  const lamps = Array.from({ length: PHONE_LAMPS + 2 }, (_, i) => ({ ...B2.lamps[0]!, at: [i, 2, -3] as [number, number, number] }));
  const motes = { count: 160, min: [0, 0, 0] as [number, number, number], max: [1, 1, 1] as [number, number, number], colour: [1, 0.8, 0.4] as [number, number, number], gain: 1, size: 0.1 };
  const look = { light: { ...LIGHT, ...B2, lamps, motes, shadow: { intensity: 0.6, radius: 3, normalBias: 0.03 } }, grade: { bloom: { intensity: 0.8, threshold: 0.6 } } };
  const phone = lookLightManifest(look, true, 'phone'), desktop = lookLightManifest(look, true, 'desktop');
  expect(phone.bloom.intensity).toBe(0); expect(phone.ao).toBeNull();
  expect(phone.lamps).toHaveLength(PHONE_LAMPS); expect(desktop.lamps).toHaveLength(PHONE_LAMPS + 2);
  expect(phone.motes?.count).toBe(80); expect(desktop.motes?.count).toBe(160);
  expect(phone.environment).toEqual(B2.environment); expect(phone.shadow).toEqual(desktop.shadow);
});

test('B2: the row is on by default (M4.9: on the phone tier too); only a saved off turns it off', () => {
  const slot = jsonSlot('debug.lookLight', 'device');
  slot.reset();
  try {
    expect(lookLightOn('desktop')).toBe(true);
    expect(lookLightOn('phone')).toBe(true);
    slot.write('off');
    expect(lookLightOn('desktop')).toBe(false);
  } finally { slot.reset(); }
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
