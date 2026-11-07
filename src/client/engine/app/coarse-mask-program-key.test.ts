import { expect, test } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Object3D, Vector2, Vector4 } from 'three';
import { Scope } from '../../../shared/engine/app/scope';
import { coarseMaskOrigin, coarseTileMask } from '../world/coarseTileMask';
import { PATCH_ORDER, patchShader } from '../render/shaderPatches';

// G587 (live 616ea317b): an open plot's survey floor family sets an explicit program key; its coarse tiles' masked
// variants kept that key, so the fine tiles drew with the masked program and the last coarse tile's mask: the floor
// vanished by view direction. A masked variant compiles its own program.
test('a coarse tile mask gives its variant its own program key under a family explicit key', () => {
  const scope = new Scope('coarse-key'), base = new MeshStandardMaterial(), geometry = new BoxGeometry();
  patchShader(base, 'family.measure', PATCH_ORDER.decorate, () => undefined, { key: 'family.pbr.measure.v1', scope });
  const fine = new Mesh(geometry, base), coarse = new Group(), tile = new Mesh(geometry, base); coarse.add(tile);
  coarseTileMask(coarse, 1, 2, scope)(new Set([0, 3]));
  const variant = tile.material;
  if (Array.isArray(variant)) throw new Error('Expected one material');
  expect(variant).not.toBe(base);
  expect(fine.material.customProgramCacheKey()).toBe('family.pbr.measure.v1');
  expect(variant.customProgramCacheKey()).not.toBe(base.customProgramCacheKey());
  expect(variant.customProgramCacheKey()).toContain('coarse-tile-mask');
  scope.dispose(); geometry.dispose(); base.dispose();
});

// Round 38: a grid neighbour's cell root sits translated from the render origin (Night Market at −555, 555); the mask's
// shaders compare world positions, so its origin follows the root's world matrix, not the cell-local corner.
test('a coarse tile mask origin follows its root into world space', () => {
  const cell = new Group(), root = new Group(); cell.position.set(-555, 0, 555); cell.add(root); cell.updateMatrixWorld(true);
  expect(coarseMaskOrigin(root.matrixWorld, 0, 0, new Vector2()).toArray()).toEqual([-805, 305]);
  expect(coarseMaskOrigin(root.matrixWorld, 3, 2, new Vector2()).toArray()).toEqual([-555 + 125, 555]);
  expect(coarseMaskOrigin(new Object3D().matrixWorld, 1, 1, new Vector2()).toArray()).toEqual([-125, -125]);
});

// Round 38: three's Vector4 starts at (0, 0, 0, 1), so a coarse tile no fine tile had covered yet hid its +x +z quadrant
// (Night Market's six beige squares from above). A fresh mask hides nothing until the rings mask a quadrant.
test('a fresh coarse tile mask hides no quadrant, and a mask call sets exactly its quadrants', () => {
  const scope = new Scope('coarse-fresh'), geometry = new BoxGeometry(), base = new MeshStandardMaterial(), root = new Group(), tile = new Mesh(geometry, base);
  root.add(tile);
  const update = coarseTileMask(root, 2, 1, scope), variant = tile.material;
  if (Array.isArray(variant)) throw new Error('Expected one material');
  const shader = { uniforms: {}, vertexShader: '#include <project_vertex>', fragmentShader: '#include <clipping_planes_fragment>', isRawShaderMaterial: false, glslVersion: null };
  const compile: unknown = Reflect.get(variant, 'onBeforeCompile');
  if (typeof compile !== 'function') throw new Error('Expected the patch runner');
  Reflect.apply(compile, variant, [shader, null]);
  const mask: unknown = Reflect.get(Reflect.get(shader.uniforms, 'wsCoarseMask') ?? {}, 'value');
  if (!(mask instanceof Vector4)) throw new Error('Expected the mask uniform');
  expect(mask.toArray()).toEqual([0, 0, 0, 0]);
  update(new Set([3])); expect(mask.toArray()).toEqual([0, 0, 0, 1]);
  update(new Set()); expect(mask.toArray()).toEqual([0, 0, 0, 0]);
  scope.dispose(); geometry.dispose(); base.dispose();
});

test('a coarse tile mask wraps each mesh draw and restores it with its scope', () => {
  const scope = new Scope('coarse-origin'), geometry = new BoxGeometry(), base = new MeshStandardMaterial(), root = new Group(), tile = new Mesh(geometry, base);
  root.add(tile); const hook = (): unknown => Reflect.get(tile, 'onBeforeRender'), draw = hook();
  coarseTileMask(root, 0, 0, scope);
  expect(hook()).not.toBe(draw);
  scope.dispose();
  expect(hook()).toBe(draw); expect(tile.material).toBe(base);
  geometry.dispose(); base.dispose();
});
