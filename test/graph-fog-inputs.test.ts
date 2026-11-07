import { expect, test } from 'vitest';
import * as THREE from 'three';
import { compileClassicGraph } from '../src/client/engine/render/graph/glslMaterial';
import { captureFogUniforms, ColourRampFog, fogUniforms } from '../src/client/engine/world/Atmosphere';
import { graph as authorGraph, graphInputs } from '../src/sharddev/materials';
import type { GraphIr } from '@wildshard/format/materialGraph';

test('atmosphere and ramp graph inputs borrow the live day owners and define a no-ramp default', () => {
  const ir: GraphIr = { version: 1, kind: 'material', model: 'unlit', nodes: {
    dir: { op: 'atmosphereSunDirection' }, sun: { op: 'atmosphereSunColour' }, zenith: { op: 'fogZenithColour' },
    sky: { op: 'add', in: ['sun', 'zenith'] }, colour: { op: 'add', in: ['sky', 'dir'] },
  }, stages: { surface: { colour: 'colour' } } };
  const material = compileClassicGraph(ir).material;
  try {
    // the atmosphere's own day uniforms, by reference: the day clock moves every graph reading them
    expect(material.uniforms['wsAtmosphereSunDirection']).toBe(fogUniforms.fogSunDir);
    expect(material.uniforms['wsAtmosphereSunColour']).toBe(fogUniforms.fogSunColor);
    // the zenith is the level's ramp fog's where its chunk declares one, else the fog's colour (the no-ramp default)
    expect(material.fragmentShader).toContain('#if defined( USE_FOG ) && defined( WS_FOG_RAMP_ZENITH )\n#define wsFogZenithColour fogRampZenith\n#elif defined( USE_FOG )\n#define wsFogZenithColour fogColor\n');
    expect(material.fragmentShader).toContain('#include <fog_pars_fragment>');
  } finally { material.dispose(); }
  // the ramp's install declares that zenith and lends its own live colour object to the fogged programs
  const ramp = new ColourRampFog({ start: 1, end: 100, near: [0.2, 0.27, 0.33], zenith: [0.2, 0.3, 0.5] });
  const pars = THREE.ShaderChunk.fog_pars_fragment, fragment = THREE.ShaderChunk.fog_fragment;
  try {
    const sets = captureFogUniforms(ramp.model(300).install);
    expect(THREE.ShaderChunk.fog_pars_fragment).toContain('#define WS_FOG_RAMP_ZENITH');
    expect(sets.some(set => set['fogRampZenith'] === ramp.zenith)).toBe(true);
    ramp.zenith.value.setRGB(0.4, 0.2, 0.1);
    expect(sets.some(set => set['fogRampZenith']?.value === ramp.zenith.value)).toBe(true);
  } finally { THREE.ShaderChunk.fog_pars_fragment = pars; THREE.ShaderChunk.fog_fragment = fragment; }
  const authored = authorGraph({ model: 'unlit', surface: { colour: graphInputs.atmosphereSunColour.add(graphInputs.atmosphereSunDirection).add(graphInputs.fogZenithColour).add(graphInputs.fogColour) } });
  expect(Object.values(authored.nodes).map(n => n.op)).toEqual(expect.arrayContaining(['atmosphereSunColour', 'atmosphereSunDirection', 'fogZenithColour', 'fogColour']));
});
