import { expect, test } from 'vitest';
import * as THREE from 'three';
import { compileClassicGraph } from '../src/client/engine/render/graph/glslMaterial';
import { syncGraphEnvironment } from '../src/client/engine/render/graph/glslProgram';
import { ToonLook } from '../src/client/engine/render/families/toon';
import type { GraphIr } from '@wildshard/format/materialGraph';

/** a classic PMREM environment of one atlas height */
function pmrem(height: number): THREE.Texture {
  const texture = new THREE.Texture({ width: 768, height });
  texture.mapping = THREE.CubeUVReflectionMapping;
  return texture;
}

test('a toon program reads the scene PMREM, and a new PMREM rebinds its uniform in place without a rebuild', () => {
  const ir: GraphIr = { version: 1, kind: 'material', model: 'toon', nodes: {}, stages: { surface: { colour: [0.2, 0.5, 0.8] } } };
  const material = compileClassicGraph(ir, { toon: new ToonLook({}) }).material;
  const scene = new THREE.Scene(), before = pmrem(1024), after = pmrem(1024), smaller = pmrem(512);
  try {
    // the lit toon program samples three's prefiltered environment (its stock env-map chunks, the lit uniforms)
    expect(material.lights).toBe(true);
    expect(material.fragmentShader).toContain('#include <envmap_physical_pars_fragment>');
    scene.environment = before; syncGraphEnvironment(material, scene);
    expect(material.envMap).toBe(before);
    const uniform = material.uniforms['envMap'];
    expect(uniform?.value).toBe(before);
    // the same-sized atlas moves the same uniform object, with no rebuild of the material
    const version = material.version, fragment = material.fragmentShader;
    scene.environment = after; syncGraphEnvironment(material, scene);
    expect(material.uniforms['envMap']).toBe(uniform);
    expect(uniform?.value).toBe(after);
    expect([material.version, material.fragmentShader]).toEqual([version, fragment]);
    // another atlas size is a new env map on the material: three's program parameters (its cube-UV height) refresh it
    scene.environment = smaller; syncGraphEnvironment(material, scene);
    expect(material.envMap).toBe(smaller);
    // a non-prefiltered environment is not the graph's image light
    scene.environment = new THREE.Texture(); syncGraphEnvironment(material, scene);
    expect(material.envMap).toBe(null);
  } finally { material.dispose(); before.dispose(); after.dispose(); smaller.dispose(); }
});
