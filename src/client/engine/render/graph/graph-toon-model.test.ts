import { expect, test } from 'vitest';
import { ToonLook } from '../families/toon';
import { compileClassicGraph } from './glslMaterial';
import { validateGraph, type GraphIr } from '@wildshard/format/materialGraph';

test('toon graph lighting borrows the family bands without authored-name collisions', () => {
  const look = new ToonLook({ faceEdge: [0.15, 0.3], shadowEdge: [0.6, 0.85] });
  const graph: GraphIr = { version: 1, kind: 'material', model: 'toon',
    params: { face: { type: 'float', value: 0.2 } }, nodes: {
      face: { op: 'param', param: 'face' }, colour: { op: 'combine', in: ['face', 0.3, 0.4] },
    }, stages: { surface: { colour: 'colour', roughness: 0.3 } } };
  const compiled = compileClassicGraph(graph, { toon: look }), material = compiled.material;
  try {
    expect(material.fragmentShader).toContain('smoothstep(');
    // the family's band uniforms by reference; the authored `face` param keeps its own uniform
    expect(material.uniforms['famToonFace']).toBe(look.uniforms.famToonFace);
    expect(material.uniforms['famToonShadow']).toBe(look.uniforms.famToonShadow);
    expect(material.uniforms['wsP_face']).not.toBe(look.uniforms.famToonFace);
    compiled.setParam('face', 0.7);
    expect(material.uniforms['wsP_face']?.value).toBe(0.7);
    expect(look.uniforms.famToonFace.value.toArray()).toEqual([0.15, 0.3]);
    const clock = look.uniforms.famToonTime.value; look.tick(0.25);
    expect(look.uniforms.famToonTime.value).toBe(clock + 0.25);
    expect(validateGraph({ ...graph, stages: { ...graph.stages, lighting: { sun: [1, 1, 1] } } }).ok).toBe(false);
  } finally { material.dispose(); }
});
