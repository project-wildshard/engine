import { expect, test } from 'vitest';
import * as THREE from 'three';
import { compileClassicGraph } from './glslMaterial';
import type { GraphIr } from '@wildshard/format/materialGraph';

test('existing batches share graph placement with live renderer-owned textures and draw-ID fallback', () => {
  const ir: GraphIr = { version: 1, kind: 'material', model: 'standard', nodes: {
    origin: { op: 'objectOrigin' }, carried: { op: 'varying', in: ['origin'] },
  }, stages: { 'vertex.offset': { offset: [0, 0.25, 0], shadow: true }, surface: { colour: 'carried', alpha: 0.75, alphaCutoff: 0.5 } } };
  const compiled = compileClassicGraph(ir), material = compiled.material;
  const a = new THREE.BatchedMesh(2, 24, 36, material), b = new THREE.BatchedMesh(2, 24, 36, material);
  const box = new THREE.BoxGeometry();
  const ai = a.addInstance(a.addGeometry(box)), bi = b.addInstance(b.addGeometry(box));
  a.setColorAt(ai, new THREE.Color(0xff0000)); b.setColorAt(bi, new THREE.Color(0x00ff00));
  try {
    // one program for both batches: placement reads three's batching texture through the draw ID (three's
    // batching_pars_vertex defines the gl_DrawID fallback), never a graph buffer
    const vertex = material.vertexShader;
    expect(vertex).toContain('#include <batching_pars_vertex>');
    expect(vertex).toContain('#include <batching_vertex>');
    expect(vertex).toMatch(/#ifdef USE_BATCHING\n {2}v = getBatchingMatrix\( getIndirectIndex\( gl_DrawID \) \) \* v;\n#endif/u);
    expect(vertex).toContain('getBatchingColor( getIndirectIndex( gl_DrawID ) )');
    expect(material.fragmentShader).toContain('#include <color_fragment>');
    expect(THREE.ShaderChunk.batching_pars_vertex).toContain('#define gl_DrawID _gl_DrawID');
    // Updating placement writes the existing texture, without a graph buffer or rebuild.
    const texture: unknown = Reflect.get(a, '_matricesTexture');
    if (!(texture instanceof THREE.Texture)) throw new Error('Missing batch matrix texture');
    const version = texture.version;
    a.setMatrixAt(ai, new THREE.Matrix4().makeTranslation(3, 2, 1));
    expect(texture.version).toBeGreaterThan(version);
    expect(Reflect.get(a, '_matricesTexture')).not.toBe(Reflect.get(b, '_matricesTexture'));
    expect(Reflect.get(material.userData, 'graphShadowDepth')).toBe(true);
    expect(compiled.depth?.vertexShader).toContain('#include <batching_vertex>');
  } finally { a.dispose(); b.dispose(); box.dispose(); material.dispose(); }
});
