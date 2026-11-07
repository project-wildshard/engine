import { expect, test } from 'vitest';
import { compileClassicGraph } from './glslMaterial';
import { validateGraph, type GraphIr } from '@wildshard/format/materialGraph';

test('fogColour borrows the current scene colour and follows its live updates', () => {
  const graph: GraphIr = { version: 1, kind: 'material', model: 'unlit',
    nodes: { fog: { op: 'fogColour' } }, stages: { surface: { colour: 'fog' } } };
  const compiled = compileClassicGraph(graph), material = compiled.material;
  try {
    // the program reads three's own fogColor uniform, which the renderer refreshes from scene.fog.color every draw
    // (refreshFogUniforms): it borrows the live colour, never a copy; without fog it reads black
    expect(material.fog).toBe(true);
    expect(material.uniforms['fogColor']).toBeDefined();
    expect(material.fragmentShader).toMatch(/vec3 wsFogColour\(\) \{\n#ifdef USE_FOG\n {2}return fogColor;\n#else\n {2}return vec3\( 0\.0 \);\n#endif/u);
    const fragment = material.fragmentShader;
    expect(fragment.slice(fragment.indexOf('void main()'))).toContain('wsFogColour()');
  } finally { material.dispose(); }
  expect(validateGraph(graph).ok).toBe(true);
  expect(validateGraph({ ...graph, stages: { 'vertex.offset': { offset: 'fog' }, surface: { colour: 'fog' } } }).ok).toBe(true);
});
