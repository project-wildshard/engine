import { expect, test } from 'vitest';
import { compileClassicGraph } from './glslMaterial';
import { installAtmosphere } from '../../world/Atmosphere';
import { validateGraph, type GraphIr } from '@wildshard/format/materialGraph';

test('vertex factors reach directional light and both engine fog blends', () => {
  installAtmosphere({ weather: true });
  const graph: GraphIr = { version: 1, kind: 'material', model: 'standard', nodes: {
    factor: { op: 'attribute', name: 'aSeed', type: 'float' },
    dx: { op: 'dFdx', in: ['factor'] },
  }, stages: { 'vertex.scale': { sun: 'factor', fog: 'factor' }, surface: { colour: [1, 1, 1] } } };
  const scaled = compileClassicGraph(graph).material, neutral = compileClassicGraph({ ...graph, stages: { surface: { colour: [1, 1, 1] } } }).material;
  try {
    expect(scaled.vertexShader).toContain('wsVSunScale = clamp(aSeed, 0.0, 1.0);');
    expect(scaled.vertexShader).toContain('wsVFogScale = clamp(aSeed, 0.0, 1.0);');
    // the sun factor scales the directional light's colour in the program's own direct-light hook
    expect(scaled.fragmentShader).toMatch(/float scale = wsVSunScale;[^]*scaled\.color \*= scale;/u);
    expect(scaled.fragmentShader).toContain('#define RE_Direct wsGraphDirect');
    // the fog factor blends between the colour before three's fog chunk (scene fog and the weather patch on it) and after
    const main = scaled.fragmentShader.slice(scaled.fragmentShader.indexOf('void main()'));
    const before = main.indexOf('vec3 wsBeforeFog = gl_FragColor.rgb;'), fog = main.indexOf('#include <fog_fragment>');
    expect(before).toBeGreaterThan(-1);
    expect(fog).toBeGreaterThan(before);
    expect(main.indexOf('gl_FragColor.rgb = mix( wsBeforeFog, gl_FragColor.rgb, wsVFogScale );')).toBeGreaterThan(fog);
    expect(neutral.vertexShader).not.toContain('wsVSunScale');
    expect(neutral.fragmentShader).not.toContain('wsVFogScale');
  } finally { scaled.dispose(); neutral.dispose(); }
  expect(validateGraph({ ...graph, model: 'unlit' }).ok).toBe(false);
  expect(validateGraph({ ...graph, stages: { 'vertex.scale': { fog: 'dx' } } }).ok).toBe(false);
});
