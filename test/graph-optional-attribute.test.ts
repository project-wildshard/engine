// CI21 (J232): the SDK authoring assertion moved to sharddev test/graph-author-ops.test.ts; engine keeps its compile/runtime law.
import { expect, test } from 'vitest';
import * as THREE from 'three';
import { compileClassicGraph } from '../src/client/engine/render/graph/glslMaterial';
import { validateGraph, type GraphIr } from '@wildshard/format/materialGraph';

test('optional attributes share one shader across present/missing channels and carry their constants to every variant', () => {
  // The IR the SDK authors for graph({ model: 'unlit', attributeDefaults: { aSway: [0, 0] }, vertex: { offset:
  // vec3(attribute('aSway', 'vec2'), 0), shadow: true }, surface: { colour: vec3(1) } }); sharddev proves it still does.
  const ir: GraphIr = { version: 1, kind: 'material',
    nodes: { n0: { op: 'attribute', default: [0, 0], name: 'aSway', type: 'vec2' }, n1: { op: 'combine', in: ['n0', 0] } },
    stages: { 'vertex.offset': { offset: 'n1', shadow: true }, surface: { colour: [1, 1, 1] } }, model: 'unlit' };
  const compiled = compileClassicGraph(ir), clone = compiled.material.clone(), empty = new THREE.PlaneGeometry(), present = empty.clone();
  present.setAttribute('aSway', new THREE.Float32BufferAttribute(new Float32Array(present.getAttribute('position').count * 2).fill(0.5), 2));
  try {
    // one program for meshes with and without the channel: the classic source is fixed at compile (no per-geometry build),
    // declares the channel, and three binds the geometry's buffer or the material's constant
    expect(clone.vertexShader).toMatch(/attribute vec2 aSway;/u);
    expect(clone.vertexShader).toBe(compiled.material.vertexShader);
    expect(empty.hasAttribute('aSway')).toBe(false);
    // the declared default (not three's generic zero vector) is what a mesh without the channel reads, on every variant
    expect(Reflect.get(clone.defaultAttributeValues ?? {}, 'aSway')).toEqual([0, 0]);
    expect(Reflect.get(compiled.material.defaultAttributeValues ?? {}, 'aSway')).toEqual([0, 0]);
    expect(Reflect.get(compiled.depth?.defaultAttributeValues ?? {}, 'aSway')).toEqual([0, 0]);
    expect(validateGraph({ ...ir, nodes: { sway: { op: 'attribute', name: 'aSway', type: 'vec2', default: 0 } },
      stages: { surface: { colour: 'sway' } } }).ok).toBe(false);
  } finally { empty.dispose(); present.dispose(); clone.dispose(); compiled.material.dispose(); }
});
