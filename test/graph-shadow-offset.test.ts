import { expect, test } from 'vitest';
import * as THREE from 'three';
import { vec3 } from 'three/tsl';
import { compileClassicGraph } from '../src/client/engine/render/graph/glslMaterial';
import { graph as authorGraph } from '../src/sharddev/materials';
import { validateGraph, type GraphIr } from '@wildshard/format/materialGraph';

test('receiver offsets reach the shadow lookups and live uniforms without moving the caster', () => {
  const ir: GraphIr = { version: 1, kind: 'material', model: 'standard', params: { shift: { type: 'vec3', value: [0.12, 0.07, -0.03] } },
    nodes: { shift: { op: 'param', param: 'shift' } }, stages: { surface: { colour: [0.2, 0.5, 0.8] }, 'shadow.offset': { offset: 'shift' } } };
  const compiled = compileClassicGraph(ir), plain = compileClassicGraph({ ...ir, stages: { surface: ir.stages.surface } });
  try {
    const outputs = compiled.glsl.program?.outputs;
    // the caster stays where it is: no vertex move, no displaced shadow depth; only the received lookups shift
    expect([outputs?.position, outputs?.offset, compiled.depth]).toEqual([null, null, null]);
    expect(outputs?.shadowOffset).not.toBe(null);
    expect(compiled.material.vertexShader).toMatch(/vec3 wsShadowOffset = [^;]*wsP_shift/u);
    expect(compiled.material.vertexShader).toContain('vSunShadowWorldPosition = vec4( worldPosition.xyz + wsShadowOffset,');
    expect(compiled.material.vertexShader).not.toMatch(/worldPosition\s*(\.xyz)?\s*\+=/u);
    expect(plain.material.vertexShader).not.toContain('wsShadowOffset');
    expect(plain.material.vertexShader).toContain('#include <shadowmap_vertex>');
    const shift = compiled.material.uniforms['wsP_shift'], version = compiled.material.version;
    expect(shift?.value).toEqual(new THREE.Vector3(0.12, 0.07, -0.03));
    compiled.setParam('shift', [0.2, 0.1, 0.3]); expect(shift?.value).toEqual(new THREE.Vector3(0.2, 0.1, 0.3));
    expect(compiled.material.version).toBe(version);
    const clone = compiled.material.clone();
    try { expect(clone.uniforms['wsP_shift']).toBe(shift); expect(clone.vertexShader).toBe(compiled.material.vertexShader); }
    finally { clone.dispose(); }
    expect(authorGraph({ model: 'standard', shadow: { offset: vec3(0, 0.1, 0) }, surface: { colour: vec3(1) } }).stages['shadow.offset']).toBeDefined();
    expect(validateGraph({ ...ir, model: 'unlit' }).ok).toBe(false);
    expect(validateGraph({ ...ir, kind: 'post', stages: { post: { colour: [1, 1, 1] }, 'shadow.offset': { offset: 'shift' } } }).ok).toBe(false);
  } finally { compiled.material.dispose(); plain.material.dispose(); }
});
