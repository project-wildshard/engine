import { expect, test } from 'vitest';
import * as v from 'valibot';
import { Group, MeshStandardMaterial, ShaderLib, type Mesh, type WebGLProgramParametersWithUniforms, type WebGLRenderer } from 'three';
import { WaterSchema } from '@wildshard/format/water';
import { Scope } from '../src/shared/engine/app/scope';
import { installClientWater } from '../src/client/game/shardfile/clientWater';

// LF1-3 (TEMPLATE-E2E-PLAN): a no-code shard declares its pool in `water` and has no client plan to draw it, so the
// stand-in plane is its only surface. It was a flat matte grey (roughness 1, no reflection): Mossgate's pond read as a grey
// crater. A declared pool with no look `water` material now gets a water surface lit from the shard's own sky: the fog
// colour at the horizon, the hemisphere's sky colour above it, a sun glint, Fresnel-weighted, see-through when looked into.
const water = v.parse(WaterSchema, [
  { id: 'pond', kind: 'pool', level: 0, shape: { kind: 'circle', x: 25, z: 20, radius: 5 } },
  { id: 'tarn', kind: 'pool', level: 1, shape: { kind: 'polygon', points: [[0, 0], [4, 0], [4, 3]] } },
]);
/** three's standard program text, run through the material's compile hooks (what the renderer would hand the GPU) in a
 *  scene with one hemisphere light and one key light (the engine's runner resolves the light counts itself). */
function compiled(material: MeshStandardMaterial): { vertex: string; fragment: string; uniforms: Record<string, unknown> } {
  const shader = { vertexShader: ShaderLib.physical.vertexShader, fragmentShader: ShaderLib.physical.fragmentShader, uniforms: {},
    numDirLights: 1, numHemiLights: 1, numPointLights: 0, numSpotLights: 0, numRectAreaLights: 0, numSpotLightMaps: 0, numSpotLightShadows: 0,
    numSpotLightShadowsWithMaps: 0, numDirLightShadows: 0, numSunLights: 0, numSunLightShadows: 0, numPointLightShadows: 0, numLightProbes: 0, numClippingPlanes: 0, numClipIntersection: 0 } as unknown as WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as WebGLRenderer);
  return { vertex: shader.vertexShader, fragment: shader.fragmentShader, uniforms: shader.uniforms };
}

test('a declared pool with no look water material draws a sky-reflecting, see-through surface, not a matte grey plane', () => {
  const scope = new Scope('lf13.default'), root = new Group();
  const meshes = installClientWater(water, { root, scope });
  expect(meshes.map(mesh => mesh.name)).toEqual(['water:pond', 'water:tarn']);
  const material = meshes[0]?.material as MeshStandardMaterial;
  // one shared material (one program) for every undrawn body
  expect(meshes[1]?.material).toBe(material);
  expect(material).toBeInstanceOf(MeshStandardMaterial);
  expect(material.transparent).toBe(true);
  expect(material.roughness).toBeLessThan(0.3);
  expect(material.depthWrite).toBe(false);
  const { vertex, fragment } = compiled(material);
  // the reflection reads the shard's own light: the hemisphere's sky colour and the fog colour, guarded so a scene
  // without either still compiles, and the key light for the glint
  expect(fragment).toContain('wsWaterSky');
  expect(fragment).toMatch(/#if (NUM_HEMI_LIGHTS|1) > 0\s*wsZenith = hemisphereLights\[ ?0 ?\]\.skyColor/u);
  expect(fragment).toMatch(/#ifdef USE_FOG\s*wsHorizon = fogColor;/u);
  expect(fragment).toMatch(/#if (NUM_DIR_LIGHTS|1) > 0\s*float wsSun = max\(dot\(wsR, directionalLights\[ ?0 ?\]\.direction/u);
  // Fresnel: opaque-ish at a grazing look, see-through straight down (the sunken stones show)
  expect(fragment).toContain('diffuseColor.a');
  // before three's output (opaque_fragment, resolved by the runner): the reflection and alpha are what the GPU writes
  const out = fragment.lastIndexOf('gl_FragColor = vec4( outgoingLight, diffuseColor.a )');
  expect(out).toBeGreaterThan(0);
  expect(fragment.lastIndexOf('diffuseColor.a = mix(diffuseColor.a, 1.0, wsFres)')).toBeLessThan(out);
  expect(fragment.lastIndexOf('diffuseColor.a = mix(diffuseColor.a, 1.0, wsFres)')).toBeGreaterThan(0);
  expect(vertex).toContain('vWsWaterWorld');
  scope.dispose();
  expect(root.children).toHaveLength(0);
});

test('a look that declares a water material still wins over the default surface', () => {
  const scope = new Scope('lf13.look'), root = new Group(), own = new MeshStandardMaterial({ color: 0x123456 });
  const meshes: readonly Mesh[] = installClientWater(water, { root, scope, materials: new Map([['water', own]]) });
  expect(meshes.every(mesh => mesh.material === own)).toBe(true);
  scope.dispose();
});
