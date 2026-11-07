import { expect, test } from 'vitest';
import * as THREE from 'three';
import { compileClassicGraph } from './glslMaterial';
import type { GraphIr } from '@wildshard/format/materialGraph';

const glow = (effectState: NonNullable<GraphIr['effectState']>, doubleSided = true): GraphIr =>
  ({ version: 1, kind: 'material', model: 'unlit', nodes: {}, stages: { surface: { colour: [1, 0.5, 0] } }, doubleSided, effectState });

test('an additive double-sided graph that writes no depth draws in one pass (O14)', () => {
  const material = compileClassicGraph(glow({ blend: 'additive', depthWrite: false })).material;
  expect(material.blending).toBe(THREE.AdditiveBlending);
  expect(material.side).toBe(THREE.DoubleSide);
  expect(material.forceSinglePass).toBe(true);
  material.dispose();
});

// NF18: the retired node back-end split order-dependent double-sided blends into three's back/front passes. The shipped
// classic program is a ShaderMaterial, whose forceSinglePass is three's default `true`: every graph blend has drawn in
// one pass since the GLSL switch (EP4), and NF18 keeps that shipped look rather than reintroducing the split.
test('classic graph blends keep their declared state and draw in one pass', () => {
  for (const [ir, blending, side] of [[glow({ blend: 'alpha', depthWrite: false }), THREE.NormalBlending, THREE.DoubleSide],
    [glow({ blend: 'additive' }), THREE.AdditiveBlending, THREE.DoubleSide],
    [glow({ blend: 'additive', depthWrite: false }, false), THREE.AdditiveBlending, THREE.FrontSide]] as const) {
    const material = compileClassicGraph(ir).material;
    expect(material.blending).toBe(blending); expect(material.side).toBe(side);
    expect(material.forceSinglePass).toBe(true);
    material.dispose();
  }
});
