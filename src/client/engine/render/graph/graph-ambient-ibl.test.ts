import { expect, test } from 'vitest';
import { compileClassicGraph } from './glslMaterial';
import { ToonLook } from '../families/toon';
import type { GraphIr } from '@wildshard/format/materialGraph';

/** a lit graph's classic fragment source */
function fragment(model: 'standard' | 'ambient' | 'toon'): { source: string; envMap: boolean } {
  const graph: GraphIr = { version: 1, kind: 'material', model: model === 'ambient' ? 'standard' : model, nodes: {}, stages: { ...(model === 'ambient' ? { lighting: { sun: [0, 0, 0], sunSpecular: 1, ambient: [0.1, 0.2, 0.3] } } : {}), surface: { colour: [0.5, 0.5, 0.5], roughness: 1 } } };
  const toon = new ToonLook({ faceEdge: [0.15, 0.3], shadowEdge: [0.6, 0.85] });
  const material = compileClassicGraph(graph, { toon }).material;
  try { return { source: material.fragmentShader, envMap: 'envMap' in material.uniforms }; } finally { material.dispose(); }
}

test('toon ambient excludes IBL diffuse but keeps environment specular', () => {
  const standard = fragment('standard'), authored = fragment('ambient'), toon = fragment('toon');
  // the stock and authored-ambient programs keep three's indirect specular, IBL irradiance included
  for (const ordinary of [standard, authored]) expect(ordinary.source).not.toContain('#undef RE_IndirectSpecular');
  // toon replaces the IBL irradiance its specular reads with zero, keeping the radiance
  expect(toon.source).toContain('#define RE_IndirectSpecular( r, i, c, gp, gn, gv, gc, mat, rl ) RE_IndirectSpecular_Physical( r, vec3( 0.0 ), c, gp, gn, gv, gc, mat, rl )');
  // every program retains the real environment sampler: specular radiance survives
  for (const shader of [standard, authored, toon]) {
    expect(shader.envMap).toBe(true);
    expect(shader.source).toContain('#include <envmap_physical_pars_fragment>');
  }
});
