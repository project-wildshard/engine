import { afterEach, expect, test } from 'vitest';
import * as THREE from 'three';
import { familyMaterial } from '../src/client/engine/render/families/registry';
import { EmissiveLook } from '../src/client/engine/render/families/emissive';
import { ToonLook } from '../src/client/engine/render/families/toon';
import { sceneSurfaceChannels } from '../src/client/engine/render/families/sceneSurface';
import { lampLights } from '../src/client/engine/render/lookLight';
import { SWING_TILT_MAX, SwingField, setLampSwings, swingQuaternion, swingUniforms, type SwingRow } from '../src/client/engine/world/swings';
import { WIND_DIR, windUniforms } from '../src/client/engine/world/wind';
import { Scope } from '../src/shared/engine/app/scope';

// Meta SHARD-SOURCE SS8c (format `look.light.swings`, `_SWING`): hanging lanterns lean in the wind, swing when a body
// brushes them and settle; their surfaces, cards and lamps turn round the same pivot.

const noTextures = (): THREE.Texture => new THREE.Texture();
const ctx = (): Parameters<typeof familyMaterial>[1] => ({ toon: new ToonLook(), emissive: new EmissiveLook(), textures: noTextures, scope: new Scope('ss8c.test') });
function compiled(material: THREE.Material, lib: 'standard' | 'basic'): { vertex: string; uniforms: Record<string, THREE.IUniform>; key: string } {
  const shader = { uniforms: {} as Record<string, THREE.IUniform>, vertexShader: THREE.ShaderLib[lib].vertexShader, fragmentShader: THREE.ShaderLib[lib].fragmentShader };
  material.onBeforeCompile(shader as never, {} as never);
  return { vertex: shader.vertexShader, uniforms: shader.uniforms, key: material.customProgramCacheKey() };
}
const lantern: SwingRow = { pivot: [2, 3, -1], length: 0.8, rate: 0.7, amount: 0.15, reach: 0.4 };
const gust = windUniforms.uGust.value;
afterEach(() => { windUniforms.uGust.value = gust; });

test('a hanging body turns rigidly round its pivot: its bob moves the way it leans', () => {
  const q = swingQuaternion(0.2, 0, new THREE.Quaternion()), down = new THREE.Vector3(0, -1, 0).applyQuaternion(q);
  expect(down.x).toBeCloseTo(Math.sin(0.2), 6);
  const q2 = swingQuaternion(0, 0.2, new THREE.Quaternion()), down2 = new THREE.Vector3(0, -1, 0).applyQuaternion(q2);
  expect(down2.z).toBeCloseTo(Math.sin(0.2), 6);
});

test('a swing leans downwind in a gust and settles there; a still air leaves it hanging', () => {
  windUniforms.uGust.value = 1;
  const field = new SwingField([lantern, { ...lantern, amount: 0 }]);
  for (let i = 0; i < 60 * 30; i++) field.update(1 / 60);
  const leaned = field.tilt(0), still = field.tilt(1);
  // downwind: along the prevailing wind, within the declared lean (the gust field and flutter vary it)
  expect(leaned.x * WIND_DIR.x + leaned.z * WIND_DIR.z).toBeGreaterThan(0);
  expect(Math.hypot(leaned.x, leaned.z)).toBeLessThanOrEqual(lantern.amount * 1.3);
  expect([still.x, still.z]).toEqual([0, 0]);
  field.dispose();
});

test('a body brushing a lantern kicks it along its stride; it rocks and settles back', () => {
  windUniforms.uGust.value = 0;
  const field = new SwingField([{ ...lantern, amount: 0 }]);
  const bobY = lantern.pivot[1] - lantern.length - 1.2;
  // a walker at 4 m/s passing right under the lantern, its head at the bob
  for (let i = 0; i < 30; i++) field.update(1 / 60, [{ id: 'player', x: 1 + i * (4 / 60), y: bobY, z: -1, radius: 0.45 }]);
  const kicked = field.tilt(0);
  expect(kicked.x).toBeGreaterThan(0.02);
  expect(Math.hypot(kicked.x, kicked.z)).toBeLessThanOrEqual(SWING_TILT_MAX);
  for (let i = 0; i < 60 * 20; i++) field.update(1 / 60, []);
  expect(Math.hypot(field.tilt(0).x, field.tilt(0).z)).toBeLessThan(0.005);
  // a body standing still never kicks, nor one out of reach above the bob
  const quiet = new SwingField([{ ...lantern, amount: 0 }]);
  for (let i = 0; i < 30; i++) quiet.update(1 / 60, [{ id: 'still', x: 2, y: bobY, z: -1, radius: 0.45 }, { id: 'far', x: 1 + i * 0.1, y: 6, z: -1, radius: 0.45 }]);
  expect(quiet.tilt(0)).toEqual({ x: 0, z: 0 });
  field.dispose(); quiet.dispose();
});

test('the uniforms carry each pivot and tilt; dispose stills them', () => {
  windUniforms.uGust.value = 1;
  const field = new SwingField([lantern]);
  for (let i = 0; i < 120; i++) field.update(1 / 60);
  expect(swingUniforms.wsSwingPivot.value[0]?.toArray()).toEqual([2, 3, -1, 1]);
  expect(swingUniforms.wsSwingTilt.value[0]?.w).toBeLessThan(1);
  // a point on the lantern goes where the shader puts it: pivot + q (p - pivot)
  const at = new THREE.Vector3(2, 2.2, -1), placed = field.place(0, at, new THREE.Vector3());
  const t = swingUniforms.wsSwingTilt.value[0] ?? new THREE.Vector4(), q = new THREE.Quaternion(t.x, t.y, t.z, t.w);
  expect(placed.toArray()).toEqual(at.clone().sub(new THREE.Vector3(2, 3, -1)).applyQuaternion(q).add(new THREE.Vector3(2, 3, -1)).toArray());
  field.dispose();
  expect(swingUniforms.wsSwingTilt.value[0]?.toArray()).toEqual([0, 0, 0, 1]);
});

test('a swinging pbr surface, glass and glow card read _SWING and bind the shared swing uniforms', () => {
  const surface = compiled(familyMaterial({ family: 'pbr', swing: true }, ctx()), 'standard');
  expect(surface.vertex).toContain('attribute float wsSwing;');
  expect(surface.vertex).toContain('objectNormal = inverse( wsSwingL )');
  expect(surface.vertex).toContain('wsSwingAt( ( modelMatrix * vec4( transformed, 1.0 ) ).xyz, wsSwingN )');
  expect(surface.uniforms['wsSwingTilt']).toBe(swingUniforms.wsSwingTilt);
  expect(surface.key).toContain('w');
  const glass = compiled(familyMaterial({ family: 'emissive', swing: true }, ctx()), 'basic');
  expect(glass.vertex).toContain('wsSwingAt(');
  const card = compiled(familyMaterial({ family: 'emissive', card: true, swing: true }, ctx()), 'basic');
  expect(card.vertex).toContain('wsSeat = ( inverse( modelMatrix ) * vec4( wsSwingAt(');
  expect(card.vertex.indexOf('vec3 wsSeat = transformed;')).toBeLessThan(card.vertex.indexOf('wsSwingAt( ( modelMatrix * vec4( wsSeat'));
  // a swaying, swinging banner keeps both, the sway first
  const banner = compiled(familyMaterial({ family: 'pbr', swing: true, sway: { rate: 1, direction: [1, 0] } }, ctx()), 'standard');
  expect(banner.vertex.indexOf('wsSwayAmt')).toBeLessThan(banner.vertex.indexOf('wsSwingAt( ( modelMatrix'));
  // channels: each surface reads its own, and a plain one none
  expect(sceneSurfaceChannels({ family: 'pbr', swing: true })).toEqual({ _swing: { attribute: 'wsSwing', itemSize: 1 } });
  expect(sceneSurfaceChannels({ family: 'emissive', card: true, swing: true })).toEqual({ _corner: { attribute: 'wsCorner', itemSize: 2 }, _swing: { attribute: 'wsSwing', itemSize: 1 } });
  expect(compiled(familyMaterial({ family: 'pbr' }, ctx()), 'standard').vertex).not.toContain('wsSwing');
});

test("a lamp on a swing moves with its lantern; a lamp off it stays put", () => {
  windUniforms.uGust.value = 0;
  const field = new SwingField([{ ...lantern, amount: 0 }]), undo = setLampSwings(field);
  const lamps = lampLights([
    { at: [2, 2.2, -1], colour: [1, 0.6, 0.3], intensity: 3, distance: 6, swing: 0 },
    { at: [8, 2, 8], colour: [1, 0.6, 0.3], intensity: 3, distance: 6 },
  ]);
  expect(lamps.update).not.toBeNull();
  for (let i = 0; i < 20; i++) field.update(1 / 60, [{ id: 'p', x: 1 + i * 0.07, y: 0.4, z: -1, radius: 0.45 }]);
  lamps.update?.(0);
  const [swung, fixed] = lamps.children as THREE.PointLight[];
  const want = field.place(0, new THREE.Vector3(2, 2.2, -1), new THREE.Vector3());
  expect(swung?.position.toArray()).toEqual(want.toArray());
  expect(swung?.position.x).toBeGreaterThan(2);
  expect(fixed?.position.toArray()).toEqual([8, 2, 8]);
  undo(); field.dispose();
  lamps.update?.(0);
  expect(swung?.position.toArray()).toEqual([2, 2.2, -1]);
});
