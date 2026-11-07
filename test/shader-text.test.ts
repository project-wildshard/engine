import * as THREE from 'three';
import { expect, test } from 'vitest';
import { finishShaderText } from '../src/client/engine/render/shaderText';

// three 0.186's own text passes (WebGLProgram.js: resolveIncludes, replaceLightNums, replaceClippingPlaneNums), copied
// as the oracle: finishShaderText must leave exactly their result, so three's passes then change nothing
type Counts = Parameters<typeof finishShaderText>[0];
const chunk: Readonly<Record<string, string | undefined>> = THREE.ShaderChunk;
const threeIncludes = (s: string): string => s.replaceAll(/^[ \t]*#include +<([\w\d./]+)>/gm, (_m: string, name: string) => {
  const text = chunk[name]; if (text === undefined) throw new Error(`no chunk ${name}`); return threeIncludes(text);
});
const threeCounts = (s: string, p: Counts): string => {
  const coords = p.numSpotLightShadows + p.numSpotLightMaps - p.numSpotLightShadowsWithMaps;
  return s.replaceAll('NUM_SUN_LIGHTS', String(p.numSunLights)).replaceAll('NUM_DIR_LIGHTS', String(p.numDirLights))
    .replaceAll('NUM_SPOT_LIGHTS', String(p.numSpotLights)).replaceAll('NUM_SPOT_LIGHT_MAPS', String(p.numSpotLightMaps))
    .replaceAll('NUM_SPOT_LIGHT_COORDS', String(coords)).replaceAll('NUM_RECT_AREA_LIGHTS', String(p.numRectAreaLights))
    .replaceAll('NUM_POINT_LIGHTS', String(p.numPointLights)).replaceAll('NUM_HEMI_LIGHTS', String(p.numHemiLights))
    .replaceAll('NUM_SUN_LIGHT_SHADOWS', String(p.numSunLightShadows)).replaceAll('NUM_DIR_LIGHT_SHADOWS', String(p.numDirLightShadows))
    .replaceAll('NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS', String(p.numSpotLightShadowsWithMaps))
    .replaceAll('NUM_SPOT_LIGHT_SHADOWS', String(p.numSpotLightShadows)).replaceAll('NUM_POINT_LIGHT_SHADOWS', String(p.numPointLightShadows))
    .replaceAll('NUM_CLIPPING_PLANES', String(p.numClippingPlanes))
    .replaceAll('UNION_CLIPPING_PLANES', String(p.numClippingPlanes - p.numClipIntersection));
};
const sets: Omit<Counts, 'vertexShader' | 'fragmentShader'>[] = [
  { numSunLights: 0, numDirLights: 0, numSpotLights: 0, numSpotLightMaps: 0, numRectAreaLights: 0, numPointLights: 0, numHemiLights: 0,
    numSunLightShadows: 0, numDirLightShadows: 0, numSpotLightShadowsWithMaps: 0, numSpotLightShadows: 0, numPointLightShadows: 0, numClippingPlanes: 0, numClipIntersection: 0 },
  { numSunLights: 1, numDirLights: 2, numSpotLights: 3, numSpotLightMaps: 1, numRectAreaLights: 1, numPointLights: 4, numHemiLights: 1,
    numSunLightShadows: 1, numDirLightShadows: 2, numSpotLightShadowsWithMaps: 1, numSpotLightShadows: 2, numPointLightShadows: 3, numClippingPlanes: 3, numClipIntersection: 1 },
];

test('finishShaderText leaves exactly what three makes of every ShaderLib shader, with nothing left for its passes', () => {
  let checked = 0;
  for (const [name, lib] of Object.entries(THREE.ShaderLib)) for (const counts of sets) for (const stage of ['vertexShader', 'fragmentShader'] as const) {
    const shader = { ...counts, vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader };
    finishShaderText(shader);
    const ours = shader[stage], theirs = threeCounts(threeIncludes(lib[stage]), { ...counts, vertexShader: '', fragmentShader: '' });
    expect(ours, `${name} ${stage}`).toBe(theirs);
    // three's passes on our text change nothing (and so copy nothing)
    expect(threeCounts(threeIncludes(ours), { ...counts, vertexShader: '', fragmentShader: '' })).toBe(ours);
    checked++;
  }
  expect(checked).toBeGreaterThan(40);
});

test('a replaced chunk is resolved afresh, and an unknown include is left for three', () => {
  const saved = THREE.ShaderChunk.fog_fragment, zero = sets[0];
  if (zero === undefined) throw new Error('no counts');
  try {
    const first = { ...zero, vertexShader: '', fragmentShader: '#include <fog_fragment>\n' };
    finishShaderText(first);
    THREE.ShaderChunk.fog_fragment = '// replaced NUM_DIR_LIGHTS\n';
    const second = { ...zero, vertexShader: '#include <not_a_chunk>\n', fragmentShader: '#include <fog_fragment>\n' };
    finishShaderText(second);
    expect(second.fragmentShader).toBe('// replaced 0\n\n');
    expect(second.vertexShader).toBe('#include <not_a_chunk>\n');
    expect(first.fragmentShader).not.toBe(second.fragmentShader);
  } finally { THREE.ShaderChunk.fog_fragment = saved; }
});

test('a program text finished before comes back as the same strings until a chunk it read changes', () => {
  const counts = sets[1]; if (counts === undefined) throw new Error('Missing count set');
  const raw = { vertexShader: '#include <common>\nvoid main() { NUM_DIR_LIGHTS; }', fragmentShader: '#include <packing>\nvoid main() { NUM_POINT_LIGHTS; }' };
  const first = { ...counts, ...raw }, second = { ...counts, ...raw };
  finishShaderText(first); finishShaderText(second);
  expect(second.vertexShader).toBe(first.vertexShader); expect(second.fragmentShader).toBe(first.fragmentShader);
  expect(second.vertexShader).toBe(threeCounts(threeIncludes(raw.vertexShader), { ...counts, ...raw }));
  // other counts are another program
  const other = { ...counts, numDirLights: 5, ...raw }; finishShaderText(other);
  expect(other.vertexShader).toBe(threeCounts(threeIncludes(raw.vertexShader), { ...counts, ...raw, numDirLights: 5 }));
  // a look that replaces a chunk the program read gets the new text
  const store: Record<string, string> = THREE.ShaderChunk, original = store['packing'] ?? '';
  try {
    store['packing'] = `${original}\n// replaced`;
    const third = { ...counts, ...raw }; finishShaderText(third);
    expect(third.fragmentShader).toContain('// replaced');
  } finally { store['packing'] = original; }
});
