// DW23 (sp-x6's bisect, 180df449c9): a graph's `shadow.offset` moves where its received shadow is looked up. TSL applies it
// (receivedShadowPositionNode = positionWorld + offset); the classic GLSL program must too: at the world position three's
// per-vertex shadow coordinates are made from, restored after.
import { expect, test } from 'vitest';
import { validateGraph, type GraphIr } from '@wildshard/format/materialGraph';
import { emitClassicGraph, graphShaders } from './glslProgram';

const lit = (stages: GraphIr['stages']): GraphIr => ({ version: 1, kind: 'material', model: 'standard',
  params: { sunward: { type: 'vec3', value: [0.5, 0.25, 0] } },
  nodes: { sunwardP: { op: 'param', param: 'sunward' } }, stages: { surface: { colour: [0.8, 0.7, 0.6] }, ...stages } });

test('the GLSL shadow lookup moves by the graph\'s shadow.offset: every shadow position, never a spot light\'s map coordinates', () => {
  const vertex = graphShaders(emitClassicGraph(lit({ 'shadow.offset': { offset: 'sunwardP' } }))).vertexShader;
  expect(vertex).not.toContain('#include <shadowmap_vertex>');
  expect(vertex).toMatch(/vec3 wsShadowOffset = [^;]*sunward/u);
  expect(vertex).toContain('vSunShadowWorldPosition = vec4( worldPosition.xyz + wsShadowOffset,');
  expect(vertex).toContain('directionalLightShadows[ i ].shadowNormalBias + wsShadowOffset');
  expect(vertex).toContain('pointLightShadows[ i ].shadowNormalBias + wsShadowOffset');
  expect(vertex).toContain('spotLightShadows[ i ].shadowNormalBias + wsShadowOffset');
  // a map-only spot light's coordinates and the vertex's world position itself are never moved
  expect(vertex).toContain('shadowWorldPosition = worldPosition;');
  expect(vertex).not.toMatch(/worldPosition\s*(\.xyz)?\s*\+=/u);
});

test('a graph without shadow.offset keeps three\'s own shadow lookup untouched', () => {
  const vertex = graphShaders(emitClassicGraph(lit({}))).vertexShader;
  expect(vertex).toContain('#include <shadowmap_vertex>');
  expect(vertex).not.toContain('wsShadowOffset');
});

test('the offset is per vertex in the format: fragment-only reads refuse, a param or a vertex expression is admitted', () => {
  const offset = (nodes: GraphIr['nodes'], ref: string): GraphIr => ({ ...lit({ 'shadow.offset': { offset: ref } }), nodes: { ...lit({}).nodes, ...nodes } });
  expect(validateGraph(offset({}, 'sunwardP')).ok).toBe(true);
  expect(validateGraph(offset({ face: { op: 'frontFacing' }, pick: { op: 'select', in: ['face', 'sunwardP', [0, 0, 0]] } }, 'pick')).ok).toBe(false);
  expect(validateGraph(offset({ slope: { op: 'dFdx', in: ['sunwardP'] } }, 'slope')).ok).toBe(false);
});
