import { expect, test } from 'vitest';
import { compileClassicGraph } from './glslMaterial';
import { ToonLook } from '../families/toon';
import type { GraphIr } from '@wildshard/format/materialGraph';

// D189: a cut-out card cloned for a cell clip must keep its alpha cutoff, or it draws as an opaque quad
test.each(['standard', 'unlit', 'toon'] as const)('a compiled %s graph\'s clone keeps its alpha cutoff', model => {
  const ir: GraphIr = { version: 1, kind: 'material', model, nodes: {}, stages: { surface: { colour: [1, 1, 1], alpha: 0.75, alphaCutoff: 0.5 } } };
  const toon = new ToonLook({ faceEdge: [0.15, 0.3], shadowEdge: [0.6, 0.85] });
  const material = compileClassicGraph(ir, { toon }).material, copy = material.clone();
  try {
    expect(material.alphaTest).toBe(0.5);
    expect(copy.alphaTest).toBe(0.5);
    expect(copy.uniforms['wsAlphaCutoff']?.value).toBe(0.5);
    expect(copy.constructor).toBe(material.constructor);
  } finally { material.dispose(); copy.dispose(); }
});
