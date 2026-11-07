/**
 * The coarse prop proxy's quadrant mask (SHARD-PLATFORM SF15a): while fine (L0) tiles cover part of a coarse (L1) tile,
 * the coarse tile's props skip those quadrants in the fragment shader, so the proxy keeps its one draw per mesh (instanced
 * meshes stay instanced) and never doubles up with the fine props under it. The patch is shared source with per-tile
 * uniforms, so every coarse tile compiles to one program. The proxy never casts shadows (only near L0 tiles do).
 * Equal surfaces share one material across tiles (`installDeclaredProps`), so each coarse tile draws with its own variant
 * (`familyVariant`: the family's patches and key kept) carrying its own mask uniforms; the shared material is never patched.
 */
import { GLSL3, Mesh, Uniform, Vector2, Vector4, type Material, type Matrix4, type Object3D } from 'three';
import { patchShader, PATCH_ORDER } from '../render/shaderPatches';
import { familyVariant } from '../render/families/registry';
import { CHUNK_HALF } from '../../../shared/engine/core/config';
import type { Scope } from '../../../shared/engine/app/scope';
import { drawNeutral, isDrawNeutral } from '../render/drawNeutral';

/** a coarse tile is 125 m (four per cell side), so a quadrant is 62.5 m */
const COARSE_SIZE = 125;

function isMesh(object: Object3D): object is Mesh { return object instanceof Mesh; }

/**
 * The world x / z of coarse tile `x`, `z`'s cell-local −x −z corner under its root's world matrix (written to `out`). The
 * mask's shaders compare world positions with it; a cell away from the render origin (every neighbour) sits translated,
 * so a cell-local origin put every fragment of a tile in one quadrant: the tile hid all of itself or none (round 38).
 */
export function coarseMaskOrigin(world: Matrix4, x: number, z: number, out: Vector2): Vector2 {
  const lx = -CHUNK_HALF + x * COARSE_SIZE, lz = -CHUNK_HALF + z * COARSE_SIZE, e = world.elements;
  return out.set(e[0] * lx + e[8] * lz + e[12], e[2] * lx + e[10] * lz + e[14]);
}

/**
 * Mask a coarse tile's props by quadrant in one draw per mesh; returns the updater for the hidden quadrants.
 * `root` holds the props of coarse tile `x`, `z` (0..3, cell-local). The updater hides the quadrants in its set
 * (0 = −x −z, 1 = +x −z, 2 = −x +z, 3 = +x +z); all four hide the root. The patches go with `scope`. The origin follows the
 * root's world matrix before each draw (a render-origin shift moves the cell).
 */
export function coarseTileMask(root: Object3D, x: number, z: number, scope: Scope): (excluded: ReadonlySet<number>) => void {
  if (![x, z].every((n) => Number.isInteger(n) && n >= 0 && n < (CHUNK_HALF * 2) / COARSE_SIZE)) throw new Error('coarse tile mask: tile coordinates are 0..3');
  // nothing hidden until the rings mask a quadrant (three's Vector4 starts at w = 1, which hid +x +z on every coarse tile
  // without children; round 38)
  const origin = new Uniform(coarseMaskOrigin(root.matrixWorld, x, z, new Vector2())), mask = new Uniform(new Vector4(0, 0, 0, 0));
  const half = (COARSE_SIZE / 2).toFixed(2);
  const own = new Map<Material, Material>();
  // one variant per tile: three uploads a non-ShaderMaterial's uniforms only when the material switches
  const variant = (base: Material): Material => {
    const known = own.get(base); if (known !== undefined) return known;
    const material = familyVariant(base, scope);
    own.set(base, material);
    scope.onDispose(() => { material.dispose(); });
    return material;
  };
  root.traverse((object) => {
    if (!isMesh(object)) return;
    object.castShadow = false;
    const before = object.material, draw: unknown = Reflect.get(object, 'onBeforeRender');
    if (typeof draw !== 'function') throw new Error('coarse tile mask: a mesh without its draw hook');
    object.material = Array.isArray(before) ? before.map(variant) : variant(before);
    const onBeforeRender = function onBeforeRender(this: Object3D, ...args: Parameters<Object3D['onBeforeRender']>): void {
      coarseMaskOrigin(root.matrixWorld, x, z, origin.value); Reflect.apply(draw, this, args);
    };
    // the mask only sets its origin uniform: draw-neutral when the hook it wraps is (or is the default)
    object.onBeforeRender = draw === Mesh.prototype.onBeforeRender || isDrawNeutral(draw) ? drawNeutral(onBeforeRender) : onBeforeRender;
    scope.onDispose(() => { object.material = before; Reflect.set(object, 'onBeforeRender', draw); });
  });
  for (const material of own.values()) {
    patchShader(material, 'engine.coarse-tile-mask', PATCH_ORDER.decorate, (shader) => {
      Object.assign(shader.uniforms, { wsCoarseOrigin: origin, wsCoarseMask: mask });
      // Raw GLSL3 gets no classic renderer compatibility aliases or precision prefix.
      const raw3 = shader.isRawShaderMaterial && shader.glslVersion === GLSL3;
      const vertexVarying = raw3 ? 'out highp' : 'varying';
      const fragmentVarying = raw3 ? 'in highp' : 'varying';
      const precision = raw3 ? 'highp ' : '';
      shader.vertexShader = `${vertexVarying} vec2 wsCoarseXZ;\n${shader.vertexShader}`.replace('#include <project_vertex>', `
        vec4 wsCoarsePosition = vec4(transformed, 1.0);
        #ifdef USE_BATCHING
          wsCoarsePosition = batchingMatrix * wsCoarsePosition;
        #endif
        #ifdef USE_INSTANCING
          wsCoarsePosition = instanceMatrix * wsCoarsePosition;
        #endif
        wsCoarseXZ = (modelMatrix * wsCoarsePosition).xz;
        #include <project_vertex>
      `);
      shader.fragmentShader = `${fragmentVarying} vec2 wsCoarseXZ; uniform ${precision}vec2 wsCoarseOrigin; uniform ${precision}vec4 wsCoarseMask;\n${shader.fragmentShader}`.replace('#include <clipping_planes_fragment>', `
        vec2 wsCoarseHalf = step(vec2(${half}), wsCoarseXZ - wsCoarseOrigin);
        float wsCoarseHidden = mix(mix(wsCoarseMask.x, wsCoarseMask.y, wsCoarseHalf.x), mix(wsCoarseMask.z, wsCoarseMask.w, wsCoarseHalf.x), wsCoarseHalf.y);
        if (wsCoarseHidden > 0.5) discard;
        #include <clipping_planes_fragment>
      `);
      // G587: its own program. Under a family's explicit key (the open plots' survey floor: family.pbr.measure.v1) the
      // masked variant kept the unmasked tiles' key, so the fine tiles drew with this program and never uploaded the mask:
      // they kept the last coarse tile's, which hides exactly their quadrants, and the floor vanished by view direction.
    }, { scope, key: prior => `${prior}|engine.coarse-tile-mask` });
  }
  return (excluded) => {
    for (const quadrant of excluded) if (!Number.isInteger(quadrant) || quadrant < 0 || quadrant > 3) throw new Error('coarse tile mask: a quadrant is 0..3');
    mask.value.set(Number(excluded.has(0)), Number(excluded.has(1)), Number(excluded.has(2)), Number(excluded.has(3)));
    root.visible = excluded.size !== 4;
  };
}
