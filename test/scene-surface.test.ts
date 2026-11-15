import { expect, test } from 'vitest';
import * as THREE from 'three';
import { familyMaterial } from '../src/client/engine/render/families/registry';
import { EmissiveLook } from '../src/client/engine/render/families/emissive';
import { ToonLook } from '../src/client/engine/render/families/toon';
import { sceneSurfaceChannels } from '../src/client/engine/render/families/sceneSurface';
import { Scope } from '../src/shared/engine/app/scope';

// Meta SHARD-SOURCE AP10 to AP12 (format `scene-render`): a scene's alpha surfaces, decal offsets, sway, uv scroll,
// camera-facing cards and their declared motion are plain material data the family draws; absent, nothing changes.

const noTextures = (): THREE.Texture => new THREE.Texture();
const ctx = (): Parameters<typeof familyMaterial>[1] => ({ toon: new ToonLook(), emissive: new EmissiveLook(), textures: noTextures, scope: new Scope('ap10.test') });
function compiled(material: THREE.Material, lib: 'standard' | 'basic'): { vertex: string; fragment: string; uniforms: Record<string, THREE.IUniform> } {
  const shader = { uniforms: {} as Record<string, THREE.IUniform>, vertexShader: THREE.ShaderLib[lib].vertexShader, fragmentShader: THREE.ShaderLib[lib].fragmentShader };
  material.onBeforeCompile(shader as never, {} as never);
  return { vertex: shader.vertexShader, fragment: shader.fragmentShader, uniforms: shader.uniforms };
}

test('a plain pbr surface is opaque, unoffset and unpatched by the scene', () => {
  const m = familyMaterial({ family: 'pbr' }, ctx()) as THREE.MeshStandardMaterial;
  expect([m.transparent, m.depthWrite, m.polygonOffset]).toEqual([false, true, false]);
  expect(compiled(m, 'standard').vertex).not.toContain('wsSway');
  expect(sceneSurfaceChannels({ family: 'pbr' })).toBeNull();
});

test('an alpha decal sorts after the opaque world and is pulled toward the camera', () => {
  const m = familyMaterial({ family: 'pbr', blend: 'alpha', opacity: 0.9, depthOffset: -2 }, ctx()) as THREE.MeshStandardMaterial;
  expect([m.transparent, m.depthWrite, m.opacity]).toEqual([true, false, 0.9]);
  expect([m.polygonOffset, m.polygonOffsetFactor, m.polygonOffsetUnits]).toEqual([true, -2, -2]);
  // a prop's GLB (opaque by default) never turns it opaque again: declaredProps reads this mark
  expect(m.userData['sceneAlpha']).toBe(true);
  expect(familyMaterial({ family: 'pbr' }, ctx()).userData['sceneAlpha']).toBeUndefined();
});

test('a swaying frond reads its sway channel and moves on the emissive look clock', () => {
  const c = ctx(), m = familyMaterial({ family: 'pbr', sway: { rate: 0.8, direction: [0.8, 0.6] }, uvScroll: [0.1, 0] }, c);
  const out = compiled(m, 'standard');
  expect(out.vertex).toContain('attribute float wsSway;');
  expect(out.vertex).toContain('vMapUv += wsUvScroll * wsSceneTime;');
  c.emissive?.tick(2);
  expect(out.uniforms['wsSceneTime']?.value).toBe(2);
  expect(sceneSurfaceChannels({ family: 'pbr', sway: { rate: 1, direction: [1, 0] } })).toEqual({ _sway: { attribute: 'wsSway', itemSize: 1 } });
});

test('a card faces the camera from its seat and carries its motion as uniforms', () => {
  const m = familyMaterial({ family: 'emissive', blend: 'alpha', card: true, intensity: 2, motion: { kind: 'rise', rate: 0.4, height: 2.6, spread: 0.5 } }, ctx()) as THREE.MeshBasicMaterial;
  expect([m.transparent, m.depthWrite]).toEqual([true, false]);
  const out = compiled(m, 'basic');
  expect(out.vertex).toContain('attribute vec2 wsCorner;');
  expect(out.vertex).toContain('mvPosition.xy += wsC;');
  expect(out.vertex).not.toContain('#include <project_vertex>');
  expect(out.fragment).toContain('outgoingLight *= wsCardFade;');
  expect((out.uniforms['wsCardMotion']?.value as THREE.Vector4).toArray()).toEqual([3, 0.4, 2.6, 0.5]);
  expect(sceneSurfaceChannels({ family: 'emissive', card: true })).toEqual({ _corner: { attribute: 'wsCorner', itemSize: 2 } });
});

test('sway moves a scaled mesh its declared world metres: the wind goes into the mesh frame by the inverse (ss4d)', () => {
  const out = compiled(familyMaterial({ family: 'pbr', sway: { rate: 0.8, direction: [1, 0] } }, ctx()), 'standard');
  expect(out.vertex).toContain('inverse( mat3( wsSwayM ) ) * vec3( wsSwayWind.x, 0.0, wsSwayWind.y )');
  expect(out.vertex).not.toContain('transpose( mat3( wsSwayM ) )');
  // the shader's sum, done on the CPU for a frond scaled 3x and turned: the inverse moves it 1 m in the world, the transpose 9 m
  const model = new THREE.Matrix4().compose(new THREE.Vector3(), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.7), new THREE.Vector3(3, 3, 3));
  const wind = new THREE.Vector3(1, 0, 0), m3 = new THREE.Matrix3().setFromMatrix4(model);
  const moved = (local: THREE.Vector3): number => local.clone().applyMatrix3(m3).length();
  expect(moved(wind.clone().applyMatrix3(m3.clone().invert()))).toBeCloseTo(1);
  expect(moved(wind.clone().applyMatrix3(m3.clone().transpose()))).toBeCloseTo(9);
});
