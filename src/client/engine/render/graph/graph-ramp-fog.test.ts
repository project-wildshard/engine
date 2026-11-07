import { expect, test } from 'vitest';
import * as THREE from 'three';
import { compileClassicGraph } from './glslMaterial';
import { attachFogUniforms, ColourRampFog, installAtmosphere } from '../../world/Atmosphere';
import type { GraphIr } from '@wildshard/format/materialGraph';

test('a ColourRampFog lends one set of uniforms to the classic chunk and the map shot', () => {
  const chunks = { ...THREE.ShaderChunk };
  try {
    installAtmosphere();
    const engine = THREE.ShaderChunk.fog_fragment;
    const fog = new ColourRampFog({ start: 180, end: 1700, near: [0.5, 0.6, 0.98], zenith: [0.055, 0.2, 0.78] });
    const model = fog.model(200);
    expect(model.order).toBe(200);
    model.install();
    expect(THREE.ShaderChunk.fog_fragment).not.toBe(engine);
    for (const name of ['fogRampStart', 'fogRampEnd', 'fogRampNear', 'fogRampZenith']) {
      expect(THREE.ShaderChunk.fog_fragment).toContain(name);
      expect(THREE.ShaderChunk.fog_pars_fragment).toContain(`uniform ${name === 'fogRampNear' || name === 'fogRampZenith' ? 'vec3' : 'float'} ${name};`);
    }
    const shader = { uniforms: {} as Record<string, THREE.IUniform> };
    attachFogUniforms(shader);
    expect(shader.uniforms['fogRampNear']).toBe(fog.near);
    expect(shader.uniforms['fogRampZenith']).toBe(fog.zenith);
    fog.control.suspend();
    expect(shader.uniforms['fogRampStart']?.value).toBe(1e6);
    fog.control.resume();
    expect([fog.start.value, fog.end.value]).toEqual([180, 1700]);
  } finally { Object.assign(THREE.ShaderChunk, chunks); }
});

test('a panorama ColourRampFog (an unrelated painted dusk desert) colours the classic chunk from its live LUT and tint', () => {
  const chunks = { ...THREE.ShaderChunk };
  const lut = new THREE.DataTexture(new Uint8Array([200, 120, 80, 255, 90, 60, 140, 255]), 2, 1);
  try {
    installAtmosphere();
    const engine = THREE.ShaderChunk.fog_fragment;
    const tint = { key: { value: new THREE.Color(1, 0.8, 0.6) }, moon: { value: 0 }, light: { value: new THREE.Color(1, 1, 1) },
      veil: { value: 0.2 }, veilColour: { value: new THREE.Color(0.3, 0.2, 0.2) }, flash: { value: 0 } };
    const panorama = { lut: { value: lut }, aerial: { value: new THREE.Vector4(0.004, 40, 0, 0.001) }, edge: { value: new THREE.Vector4(0.8, 500, 560, 30) }, tint };
    const fog = new ColourRampFog({ start: 0, end: 1, near: [0.4, 0.3, 0.3], zenith: [0.2, 0.25, 0.5], panorama });
    const model = fog.model(300);
    model.install();
    expect(THREE.ShaderChunk.fog_fragment).not.toBe(engine);
    expect(THREE.ShaderChunk.fog_fragment).not.toContain('fogRampStart');
    for (const name of ['fogPanoLut', 'fogPanoAerial', 'fogPanoEdge', 'fogPanoKey', 'fogPanoVeil', 'fogPanoFlash']) {
      expect(THREE.ShaderChunk.fog_fragment).toContain(name);
      expect(THREE.ShaderChunk.fog_pars_fragment).toContain(name);
    }
    const shader = { uniforms: {} as Record<string, THREE.IUniform> };
    attachFogUniforms(shader);
    expect(shader.uniforms['fogPanoLut']).toBe(panorama.lut);
    expect(shader.uniforms['fogPanoKey']).toBe(tint.key);
    tint.veil.value = 0.9;
    expect(shader.uniforms['fogPanoVeil']?.value).toBe(0.9);
    // a classic graph program draws the installed chunk and takes its uniforms like any fogged program
    const graph: GraphIr = { version: 1, kind: 'material', model: 'unlit', nodes: {}, stages: { surface: { colour: [1, 1, 1] } } };
    const material = compileClassicGraph(graph).material;
    try {
      expect(material.fragmentShader).toContain('#include <fog_fragment>');
      const drawn = { uniforms: material.uniforms };
      attachFogUniforms(drawn);
      expect(drawn.uniforms['fogPanoKey']).toBe(tint.key);
      expect(drawn.uniforms['fogPanoEdge']).toBe(panorama.edge);
    } finally { material.dispose(); }
  } finally { Object.assign(THREE.ShaderChunk, chunks); lut.dispose(); }
});
