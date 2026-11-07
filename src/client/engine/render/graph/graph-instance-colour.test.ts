import { expect, test } from 'vitest';
import * as THREE from 'three';
import { compileClassicGraph } from './glslMaterial';

/** three's stock vertex colour step, which multiplies the instance colour into vColor */
const STOCK_STEP = '#include <color_vertex>';

test('three\'s stock vertex colour step multiplies by the instance colour', () => {
  expect(THREE.ShaderChunk.color_vertex).toMatch(/#ifdef USE_INSTANCING_COLOR\s+vColor\.rgb \*= instanceColor\.rgb;/u);
});

test('a graph that reads the instance colour owns the tint: stock diffuse setup does not multiply by it again', () => {
  // NR15: Nine's facade graph tints its glazed tiles itself; the stock multiply darkened the whole rooftop dressing
  const tinted = compileClassicGraph({ version: 1, kind: 'material', model: 'unlit',
    nodes: { t: { op: 'instanceColour' }, c: { op: 'varying', in: ['t'] } }, stages: { surface: { colour: 'c' } }, effectState: { fog: false } });
  try {
    expect(tinted.material.instanceColour).toBe(true);
    expect(tinted.material.vertexShader).not.toContain(STOCK_STEP);
    expect(tinted.material.vertexShader).not.toMatch(/vColor\.rgb \*= instanceColor/u);
    expect(tinted.material.vertexShader).toContain('return instanceColor;');
  } finally { tinted.material.dispose(); }
});

test('a graph that does not read the instance colour keeps the stock instance tint', () => {
  const plain = compileClassicGraph({ version: 1, kind: 'material', model: 'unlit',
    nodes: { origin: { op: 'objectOrigin' }, c: { op: 'varying', in: ['origin'] } }, stages: { surface: { colour: 'c' } }, effectState: { fog: false } });
  try {
    expect(plain.material.instanceColour).toBe(false);
    expect(plain.material.vertexShader).toContain(STOCK_STEP);
  } finally { plain.material.dispose(); }
});
