// CI21 (J232): the SDK authoring assertion moved to sharddev test/graph-author-ops.test.ts; engine keeps its compile/runtime law.
import { expect, test, vi } from 'vitest';
import * as THREE from 'three';
import { classicShadowDepth, compileClassicGraph } from '../src/client/engine/render/graph/glslMaterial';
import { validateGraph, type GraphIr } from '@wildshard/format/materialGraph';

test('opted-in casters share live displacement and alpha, cache by material and release with it', () => {
  const graph: GraphIr = { version: 1, kind: 'material', model: 'unlit',
    params: { bend: { type: 'float', value: 0.2 }, cut: { type: 'texture', value: 'leaf', role: 'lent' } },
    nodes: { uv: { op: 'uv' }, cut: { op: 'texture', param: 'cut', in: ['uv'] },
      alpha: { op: 'swizzle', mask: 'w', in: ['cut'] }, bend: { op: 'param', param: 'bend' },
      offset: { op: 'mul', in: [[0, 1, 0], 'bend'] } },
    stages: { 'vertex.offset': { offset: 'offset', shadow: true }, surface: { colour: [0.2, 0.5, 0.1], alpha: 'alpha', alphaCutoff: 0.5 } } };
  const compiled = compileClassicGraph(graph), map = new THREE.DataTexture(new Uint8Array([255, 255, 255, 128]), 1, 1);
  compiled.setTexture('cut', map);
  const clone = compiled.material.clone(), geometry = new THREE.PlaneGeometry();
  const object: THREE.Mesh = new THREE.Mesh(geometry, compiled.material);
  object.receiveShadow = true;
  const shadowMap = new THREE.WebGLRenderTarget(16, 16);
  shadowMap.depthTexture = new THREE.DepthTexture(16, 16); shadowMap.depthTexture.compareFunction = THREE.LessEqualCompare;
  const stock = new THREE.MeshDepthMaterial(); stock.side = THREE.BackSide; stock.alphaTest = 0.5;
  try {
    const depth = classicShadowDepth(compiled.material, stock, object);
    if (!(depth instanceof THREE.ShaderMaterial)) throw new Error('an opted-in caster casts with its graph depth');
    expect(depth).not.toBe(stock); expect(depth.side).toBe(THREE.BackSide);
    // the caster's own displacement and cut: the graph's uniform objects, its vertex offset and its discard
    expect(depth.uniforms['wsP_bend']).toBe(compiled.material.uniforms['wsP_bend']);
    expect(depth.uniforms['wsT_cut']?.value).toBe(map);
    expect(depth.vertexShader).toContain('transformed = wsPositionLocal +');
    expect(depth.fragmentShader).toContain('discard');
    // a depth draw reads no shadow map
    expect(Object.values(depth.uniforms).some(u => u.value === shadowMap.texture || u.value === shadowMap.depthTexture)).toBe(false);
    expect(object.receiveShadow).toBe(true);
    // the live param moves the cached depth in place
    compiled.setParam('bend', 0.8);
    expect(classicShadowDepth(compiled.material, stock, object)).toBe(depth);
    expect(depth.uniforms['wsP_bend']?.value).toBe(0.8);
    const released = vi.fn(); depth.addEventListener('dispose', () => { released(); });
    // another variant of the graph (a multi-material slot) casts with its own depth
    object.material = [new THREE.MeshBasicMaterial(), clone];
    const variant = classicShadowDepth(clone, stock, object);
    expect(variant).not.toBe(depth); expect(variant).not.toBe(stock); expect(variant).not.toBe(null);
    compiled.material.dispose(); expect(released).toHaveBeenCalledOnce();
    // a graph without the shadow opt-in casts through the stock depth material (PF3)
    const plain = compileClassicGraph({ ...graph, stages: { ...graph.stages, 'vertex.offset': { offset: 'offset' } } });
    expect(plain.depth).toBe(null);
    expect(classicShadowDepth(plain.material, stock, object)).toBe(null);
    plain.material.dispose();
    expect(validateGraph({ ...graph, stages: { ...graph.stages, 'vertex.clip': { position: [0, 0, 0, 1] } } }).ok).toBe(false);
  } finally { clone.dispose(); compiled.material.dispose(); stock.dispose(); geometry.dispose(); map.dispose(); shadowMap.dispose(); }
});
