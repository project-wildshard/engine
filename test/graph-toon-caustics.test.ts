import { expect, test } from 'vitest';
import type * as THREE from 'three';
import { vec3 } from 'three/tsl';
import { compileClassicGraph } from '../src/client/engine/render/graph/glslMaterial';
import { ToonLook } from '../src/client/engine/render/families/toon';
import { graph as authorGraph } from '../src/sharddev/materials';
import { validateGraph, type GraphIr } from '@wildshard/format/materialGraph';

/** a toon graph's classic program: its sources and the uniform objects it reads */
function program(graph: GraphIr, toon: ToonLook): THREE.ShaderMaterial {
  return compileClassicGraph(graph, { toon }).material;
}

test('one toon material omits the caustic term while its siblings keep the shared water and bands', () => {
  const look = new ToonLook({ caustics: { level: 0, strength: 0.7 } });
  const ir: GraphIr = { version: 1, kind: 'material', model: 'toon', nodes: {}, stages: { surface: { colour: [0.2, 0.5, 0.8] } } };
  const base = program(ir, look), surface = program({ ...ir, toonCaustics: false }, look);
  try {
    const has = (shader: THREE.ShaderMaterial, value: unknown): boolean => Object.values(shader.uniforms).some(u => u.value === value);
    expect(has(base, look.uniforms.famToonWater.value)).toBe(true);
    expect(base.fragmentShader).toContain('famToonWater');
    expect(has(surface, look.uniforms.famToonWater.value)).toBe(false);
    expect(surface.fragmentShader).not.toContain('famToonWater');
    expect(has(surface, look.uniforms.famToonFace.value)).toBe(true);
    // the look's own uniform objects: a change of the look moves every program that reads them
    expect(base.uniforms['famToonWater']).toBe(look.uniforms.famToonWater);
    look.set({ caustics: { level: 3, strength: 0.2 } });
    expect(has(base, look.uniforms.famToonWater.value)).toBe(true);
    expect(look.params.caustics.level).toBe(3);
  } finally { base.dispose(); surface.dispose(); }
  expect(authorGraph({ model: 'toon', toonCaustics: false, surface: { colour: vec3(1) } }).toonCaustics).toBe(false);
  expect(validateGraph({ ...ir, model: 'standard', toonCaustics: false }).ok).toBe(false);
  expect(validateGraph({ ...ir, toonCaustics: 'off' }).ok).toBe(false);
});
