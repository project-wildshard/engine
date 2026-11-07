import { expect, test } from 'vitest';
import * as THREE from 'three';
import { Scope } from '../../../../shared/engine/app/scope';
import { compileClassicGraph, GraphShaderMaterial } from './glslMaterial';
import { bindGraphMeshMap, graphMeshMapBase } from '../graphBackend';
import { validateGraph, type GraphIr } from '@wildshard/format/materialGraph';

test('mapped lit graphs retain native PBR slots and shared uniforms', () => {
  const normal = new THREE.DataTexture(), roughness = new THREE.DataTexture(), ao = new THREE.DataTexture();
  const source = new THREE.MeshStandardMaterial({ normalMap: normal, roughnessMap: roughness, aoMap: ao, normalScale: new THREE.Vector2(0.5, 0.7), aoMapIntensity: 0.6 });
  const other = new THREE.MeshStandardMaterial({ normalMap: ao });
  const graph: GraphIr = { version: 1, kind: 'material', model: 'standard', nodes: {},
    stages: { surface: { colour: [0.2, 0.3, 0.4], roughness: 0.4, occlusion: 0.8 } } };
  const compiled = compileClassicGraph(graph), scope = new Scope('map-owner');
  try {
    const mapped = bindGraphMeshMap(compiled.material, source, scope);
    expect(bindGraphMeshMap(compiled.material, source, scope)).toBe(mapped);
    expect(bindGraphMeshMap(compiled.material, other, scope)).not.toBe(mapped);
    expect(graphMeshMapBase(mapped)).toBe(compiled.material);
    expect(Reflect.get(mapped, 'normalMap')).toBe(normal);
    expect(Reflect.get(mapped, 'roughnessMap')).toBe(roughness);
    expect(Reflect.get(mapped, 'aoMap')).toBe(ao);
    const scale: unknown = Reflect.get(mapped, 'normalScale');
    expect(scale).not.toBe(source.normalScale);
    if (!(scale instanceof THREE.Vector2)) throw new Error('Missing normal scale');
    expect(scale.toArray()).toEqual([0.5, 0.7]);
    // the loaned maps are the variant's own sampler uniforms, never the base's
    if (!(mapped instanceof GraphShaderMaterial)) throw new Error('Missing classic variant');
    for (const texture of [normal, roughness, ao]) expect(Object.values(mapped.uniforms).some(uniform => uniform.value === texture)).toBe(true);
    expect(Object.values(compiled.material.uniforms).some(uniform => uniform.value === normal)).toBe(false);
    expect(source.normalMap).toBe(normal);
  } finally { scope.dispose(); compiled.material.dispose(); source.dispose(); other.dispose(); normal.dispose(); roughness.dispose(); ao.dispose(); }
});

test('colour-or-vertex map loans preserve source sRGB and use the baked linear mean only without a map', () => {
  const graph: GraphIr = { version: 1, kind: 'material', model: 'unlit', effectState: { fog: false, output: 'colour' },
    nodes: { image: { op: 'meshMap', name: 'colourOrVertex' }, rgb: { op: 'swizzle', in: ['image'], mask: 'xyz' } },
    stages: { surface: { colour: 'rgb' } } };
  expect(validateGraph(graph).ok).toBe(true);
  const texture = new THREE.DataTexture(new Uint8Array([18, 24, 43, 255]), 1, 1);
  texture.colorSpace = THREE.SRGBColorSpace;
  const scope = new Scope('poster-map'), compiled = compileClassicGraph(graph);
  try {
    expect(compiled.material.userData['graphMeshMap']).toBe(true);
    const mapped = bindGraphMeshMap(compiled.material, texture, scope);
    expect(bindGraphMeshMap(compiled.material, texture, scope)).toBe(mapped);
    expect(graphMeshMapBase(mapped)).toBe(compiled.material);
    expect(Reflect.get(mapped, 'map')).toBe(texture);
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(Reflect.get(mapped, 'fog')).toBe(false);
    expect(mapped.userData['graphRawOutput']).not.toBe(true);
    if (!(mapped instanceof GraphShaderMaterial)) throw new Error('Missing classic variant');
    // with a map the program samples it (WS_MESH_MAP); without one it reads the vertex colour (the baked mean)
    expect(mapped.defines['WS_MESH_MAP']).toBe('');
    expect(compiled.material.defines['WS_MESH_MAP']).toBeUndefined();
    expect(Object.values(mapped.uniforms).some(uniform => uniform.value === texture)).toBe(true);
    const fragment = mapped.fragmentShader, main = fragment.slice(fragment.indexOf('void main()'));
    expect(fragment).toMatch(/#ifdef WS_MESH_MAP/u);
    expect(mapped.vertexShader).toContain('wsVertexColour()');
    // the explicit colour output encodes the display without tone mapping
    expect(main).toContain('#include <colorspace_fragment>');
    expect(main).not.toContain('#include <tonemapping_fragment>');
  } finally { scope.dispose(); compiled.material.dispose(); texture.dispose(); }
});
