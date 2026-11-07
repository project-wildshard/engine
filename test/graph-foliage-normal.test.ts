import { expect, test } from 'vitest';
import * as THREE from 'three';
import { vec3 } from 'three/tsl';
import { compileClassicGraph } from '../src/client/engine/render/graph/glslMaterial';
import { graph as authorGraph } from '../src/sharddev/materials';
import { validateGraph, type GraphIr } from '@wildshard/format/materialGraph';

/** the classic program's front-face undo: three's normal chunk flips a back face's normal; foliage multiplies it back */
const FRONT_FACE_BASIS = '#ifdef DOUBLE_SIDED\n  normal *= faceDirection;\n#endif';
/** the borrowed tangent-space normal map's sample */
const NORMAL_MAP_SAMPLE = 'texture2D( normalMap, vNormalMapUv )';

test('foliage keeps a front-face normal basis without changing two-sided draws or borrowed normal maps', () => {
  const ir: GraphIr = { version: 1, kind: 'material', model: 'standard', doubleSided: true,
    nodes: {}, stages: { surface: { colour: [0.2, 0.5, 0.1] } } };
  const classic = compileClassicGraph(ir), foliage = compileClassicGraph({ ...ir, flipBackfaceNormals: false });
  const normal = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
  try {
    // three's stock normal chunk flips a back face (gl_FrontFacing via faceDirection); only foliage undoes it
    expect(classic.material.fragmentShader).toContain('#include <normal_fragment_begin>');
    expect(classic.material.fragmentShader).not.toContain(FRONT_FACE_BASIS);
    expect(foliage.material.fragmentShader).toContain(FRONT_FACE_BASIS);
    expect(foliage.material.side).toBe(THREE.DoubleSide);
    foliage.material.normalMap = normal;
    // the borrowed map is sampled after the basis is fixed, so it bends the front-face normal
    const text = foliage.material.fragmentShader;
    expect(text.indexOf(NORMAL_MAP_SAMPLE)).toBeGreaterThan(text.indexOf(FRONT_FACE_BASIS));
    expect(foliage.material.side).toBe(THREE.DoubleSide);
    expect(foliage.material.normalMap).toBe(normal);
    const clone = foliage.material.clone();
    try {
      // a clone keeps the same program, its borrowed map and its two-sided draw
      expect(clone.fragmentShader).toBe(foliage.material.fragmentShader);
      expect(clone.normalMap).toBe(normal);
      expect(clone.side).toBe(THREE.DoubleSide);
    } finally { clone.dispose(); }
    const authored = authorGraph({ doubleSided: true, flipBackfaceNormals: false, surface: { colour: vec3(1) } });
    expect(authored.flipBackfaceNormals).toBe(false);
    expect(validateGraph({ ...ir, flipBackfaceNormals: 'no' }).ok).toBe(false);
    expect(validateGraph({ version: 1, kind: 'post', flipBackfaceNormals: false, nodes: {}, stages: { post: { colour: [1, 1, 1] } } }).ok).toBe(false);
  } finally { classic.material.dispose(); foliage.material.dispose(); normal.dispose(); }
});
