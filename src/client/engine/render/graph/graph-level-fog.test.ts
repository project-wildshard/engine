import { expect, test } from 'vitest';
import * as THREE from 'three';
import { compileClassicGraph } from './glslMaterial';
import { FogPatchRegistry, installFogPatch } from '../fogPatches';
import { installAtmosphere } from '../../world/Atmosphere';
import type { GraphIr } from '@wildshard/format/materialGraph';

test('a classic graph draws the page fog chunk; fog patches install in order and refuse a late lower order', () => {
  const chunks = { ...THREE.ShaderChunk };
  try {
    installAtmosphere();
    let classicInstalls = 0;
    installFogPatch('test.distance', 300, () => { classicInstalls++; THREE.ShaderChunk.fog_fragment = `${THREE.ShaderChunk.fog_fragment}\n// test.distance`; }, 'test.distance');
    expect(classicInstalls).toBe(1);
    expect(THREE.ShaderChunk.fog_fragment).toContain('// test.distance');
    // the graph program draws three's fog chunk, so the page's ordered replacement reaches it with no graph rebuild
    const graph: GraphIr = { version: 1, kind: 'material', model: 'unlit', nodes: {}, stages: { surface: { colour: [1, 1, 1] } } };
    const material = compileClassicGraph(graph).material;
    try {
      expect(material.fog).toBe(true);
      expect(material.fragmentShader).toContain('#include <fog_fragment>');
      expect(material.fragmentShader).toContain('#include <fog_pars_fragment>');
    } finally { material.dispose(); }
    const registry = new FogPatchRegistry();
    registry.install('classic', 100, () => { classicInstalls++; });
    expect(classicInstalls).toBe(2);
    expect(registry.patches()).toEqual([{ id: 'classic', order: 100 }]);
    expect(() => registry.install('late', 50, () => { throw new Error('Must not run'); })).toThrow('installs after');
    expect(registry.patches()).toEqual([{ id: 'classic', order: 100 }]);
  } finally { Object.assign(THREE.ShaderChunk, chunks); }
});
