import { expect, test } from 'vitest';
import * as THREE from 'three';
import { ExposureEffect, lampHalos, lookMotes } from '../src/client/engine/render/lookRender';
import { applyDetail, DETAIL_PROGRAM_KEY } from '../src/client/engine/render/families/detail';
import { mirrorPool, poolPlane, DEFAULT_MIRROR_TEXELS } from '../src/client/game/shardfile/reflectingWater';

// meta TEMPLATES-CLEANROOM M4: the render-match draws a look declares (halos, motes, exposure), the PBR detail layer
// and a pool's planar mirror.

const LAMP = { at: [1, 2, -3] as [number, number, number], colour: [1, 0.5, 0.1] as [number, number, number], intensity: 4, distance: 7 };

test('halos: one additive unfogged instanced draw for the lamps that declare one; none declared, no draw', () => {
  expect(lampHalos([LAMP])).toBeNull();
  const halos = lampHalos([LAMP, { ...LAMP, at: [5, 1, 0], halo: { size: 2, opacity: 0.5 } }]);
  expect(halos?.count).toBe(1);
  expect(halos?.material.blending).toBe(THREE.AdditiveBlending);
  expect([halos?.material.fog, halos?.material.depthWrite]).toEqual([false, false]);
  const m = new THREE.Matrix4(); halos?.getMatrixAt(0, m);
  const at = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(); m.decompose(at, q, s);
  expect([at.x, at.y, at.z, s.x]).toEqual([5, 1, 0, 2]);
});

test('motes: a fixed seed, every point inside its box, one additive points draw', () => {
  const motes = { count: 50, min: [0, 1, 2] as [number, number, number], max: [4, 2, 3] as [number, number, number], colour: [1, 0.8, 0.4] as [number, number, number], gain: 2, size: 0.1 };
  const a = lookMotes(motes), b = lookMotes(motes);
  const pa = a.geometry.getAttribute('position').array, pb = b.geometry.getAttribute('position').array;
  expect(Array.from(pa)).toEqual(Array.from(pb));
  for (let i = 0; i < motes.count; i++) for (let k = 0; k < 3; k++) {
    expect(pa[i * 3 + k]).toBeGreaterThanOrEqual(motes.min[k]!); expect(pa[i * 3 + k]).toBeLessThanOrEqual(motes.max[k]!);
  }
  expect(a.material.blending).toBe(THREE.AdditiveBlending);
});

test('exposure: 2^stops on the linear colour', () => {
  expect((new ExposureEffect(1).uniforms.get('uExposure')?.value as number)).toBe(2);
  expect((new ExposureEffect(-1).uniforms.get('uExposure')?.value as number)).toBe(0.5);
});

test('detail layer: one program for every detailed surface, its knobs uniforms, its patch on the albedo and the normal', () => {
  const a = new THREE.MeshStandardMaterial(), b = new THREE.MeshStandardMaterial();
  applyDetail(a, { scale: 0.5, mottle: 0.3, grain: 0.1, relief: 1 });
  applyDetail(b, { scale: 2, mottle: 0.1, grain: 0.2, relief: 0, moss: { colour: [0.3, 0.5, 0.2], amount: 0.4 } });
  expect(a.customProgramCacheKey()).toBe(DETAIL_PROGRAM_KEY);
  expect(b.customProgramCacheKey()).toBe(a.customProgramCacheKey());
  const shader = { uniforms: {} as Record<string, THREE.IUniform>, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  b.onBeforeCompile(shader as never, {} as never);
  expect(shader.fragmentShader).toContain('famDMoss');
  expect(shader.fragmentShader.indexOf('famDGrad')).toBeGreaterThan(shader.fragmentShader.indexOf('#include <normal_fragment_maps>'));
  expect(shader.vertexShader).toContain('vFamDPos = ');
  expect((shader.uniforms['famDK']?.value as THREE.Vector4).x).toBe(0.5);
  expect((shader.uniforms['famDMoss']?.value as THREE.Vector4).w).toBe(0.4);
});

test('planar pool: a mirror laid flat at the water level, the surface knobs as uniforms', () => {
  const surface = { reflect: 'planar' as const, tint: [0.01, 0.01, 0.02] as [number, number, number], fresnel: [0.35, 3] as [number, number], ripple: { scale: 3, amplitude: 0.002, speed: 1 } };
  const pool = mirrorPool({ kind: 'circle', x: 2, z: -4, radius: 3 }, 0.1, surface);
  expect(pool.mesh.position.y).toBe(0.1);
  expect(pool.mesh.rotation.x).toBeCloseTo(-Math.PI / 2, 6);
  const material = pool.mesh.material as THREE.ShaderMaterial;
  expect((material.uniforms['uFresnel']?.value as THREE.Vector2).toArray()).toEqual([0.35, 3]);
  pool.dispose();
  expect(DEFAULT_MIRROR_TEXELS).toBe(512);
  const plane = poolPlane({ kind: 'circle', x: 2, z: -4, radius: 3 }); plane.computeBoundingBox();
  const centre = plane.boundingBox!.getCenter(new THREE.Vector3());
  expect([centre.x, centre.y]).toEqual([2, 4]); // z negated: a −90° turn about x lays it back at z = −4
});

test('a grid cell carries an ACES look through its own display, its exposure folded in', async () => {
  const { AcesToneEffect } = await import('../src/client/engine/render/dataLook');
  expect(new AcesToneEffect(0.5).uniforms.get('uExposure')?.value).toBeCloseTo(2 ** 0.5, 9);
});
