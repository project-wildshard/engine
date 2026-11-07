import type { Material, Vector4 } from 'three';
import { patchShader, PATCH_ORDER, type ShaderPatchFn } from '@wildshard/engine/render/shaderPatches';
import type { DesaturateLook, FirelightLook, LeatherLook, StoneBandLook, SurfaceLook, SurfaceRgb, ViewerLightLook } from '@wildshard/format/surfaceLooks';

/**
 * Surface looks as declared rows (SHARD-PLATFORM SF72, look-family rows): small, named decorations a shard chains onto a
 * standard material (a loaded hero model's or a code-built part's), each a family of shader edits whose numbers are the
 * row. A shard lists its rows in its own `data/`; `applySurfaceLooks` installs them in order, each as one
 * `PATCH_ORDER.decorate` patch, so a row list compiles to one program source. The families:
 *
 * - `firelight`: each burning fire of a shared firelight uniform (`SurfaceInputs.lights`, a fire effect's
 *   `FireFx.lights`) warms the surface within `reach` metres, falling off as `(1 - d / reach) ^ falloff`;
 * - `viewerLight`: the viewer-side light of a held part (faces turned to the eye lit, edges falling off, more as the
 *   dusk uniform `SurfaceInputs.dusk` deepens) and a glancing sheen at the silhouette;
 * - `leather`: creases and a pebbled grain in the model's own space, as albedo and as a bump on the normal
 *   (screen-space derivatives, no tangents);
 * - `stoneBand`: the model below a height redrawn as rows of irregular fieldstones with mortar between (a plinth);
 * - `desaturate`: the map's colour pulled toward its own luma.
 *
 * Each row's numbers are baked into its GLSL (no per-frame uniform but the shared inputs), and each patch's program key
 * carries its row, so two rows of one family never share a program. The row types are `@wildshard/format/surfaceLooks`.
 */

/** The shared live inputs a row may read: the fires' light slots (xyz the flame, w its gain) and the dusk (0..1). */
export interface SurfaceInputs { readonly lights?: { value: readonly Vector4[] }; readonly dusk?: { value: number } }

/** A GLSL float literal: integers keep a `.0`. */
const f = (n: number): string => Number.isInteger(n) ? n.toFixed(1) : String(n);
const v3 = (c: SurfaceRgb): string => `vec3(${f(c[0])}, ${f(c[1])}, ${f(c[2])})`;

type Source = Parameters<ShaderPatchFn>[0];
const need = <T>(value: T | undefined, what: string): T => {
  if (value === undefined) throw new Error(`surface look: a ${what} row needs the shared ${what === 'firelight' ? 'lights' : 'dusk'} input`);
  return value;
};

function firelight(look: FirelightLook, inputs: SurfaceInputs): ShaderPatchFn {
  const lights = need(inputs.lights, 'firelight'), n = lights.value.length;
  return (shader: Source) => {
    shader.uniforms['uFireLights'] = lights;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vFireW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n  vFireW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nuniform vec4 uFireLights[${String(n)}];\nvarying vec3 vFireW;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  for (int i = 0; i < ${String(n)}; i++) {
    float fireD = length(vFireW - uFireLights[i].xyz);
    totalEmissiveRadiance += diffuseColor.rgb * ${v3(look.colour)} * uFireLights[i].w * pow(max(0.0, 1.0 - fireD / ${f(look.reach)}), ${f(look.falloff)}) * ${f(look.gain)};
  }`);
  };
}

function viewerLight(look: ViewerLightLook, inputs: SurfaceInputs): ShaderPatchFn {
  const dusk = need(inputs.dusk, 'viewerLight');
  return (shader: Source) => {
    shader.uniforms['uDusk'] = dusk;
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uDusk;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  totalEmissiveRadiance += diffuseColor.rgb * ${v3(look.gain)} * (${f(look.facing[0])} + ${f(look.facing[1])} * saturate(dot(normal, normalize(vViewPosition)))) * (1.0 + ${f(look.dusk)} * uDusk);
  totalEmissiveRadiance += ${v3(look.sheenColour)} * ${f(look.sheen)} * pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), ${f(look.sheenPower)}) * (1.0 - roughnessFactor * ${f(look.sheenDamp)});`);
  };
}

function leather(look: LeatherLook): ShaderPatchFn {
  return (shader: Source) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLeatherP;').replace('#include <begin_vertex>', '#include <begin_vertex>\n  vLeatherP = position;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vLeatherP;
float lHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float lNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(lHash(i), lHash(i + vec3(1, 0, 0)), f.x), mix(lHash(i + vec3(0, 1, 0)), lHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(lHash(i + vec3(0, 0, 1)), lHash(i + vec3(1, 0, 1)), f.x), mix(lHash(i + vec3(0, 1, 1)), lHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float leatherH() {
  float crease = 1.0 - abs(lNoise(vLeatherP * ${v3(look.crease)}) * 2.0 - 1.0);
  return ${f(look.mix[0])} * pow(crease, ${f(look.sharpness)}) + ${f(look.mix[1])} * lNoise(vLeatherP * ${f(look.grain)});
}`).replace('#include <map_fragment>', `#include <map_fragment>
  float leatherA = leatherH();
  diffuseColor.rgb *= ${f(look.albedo[0])} + ${f(look.albedo[1])} * (1.0 - leatherA);`).replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  {
    vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition);
    float dhx = dFdx(leatherA), dhy = dFdy(leatherA);
    vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx);
    float det = dot(dpx, r1);
    normal = normalize(abs(det) * normal - sign(det) * (dhx * r1 + dhy * r2) * ${f(look.depth)});
  }`);
  };
}

function stoneBand(look: StoneBandLook): ShaderPatchFn {
  const rows = f(look.rows), wave = `sin(atan(vStoneP.z, vStoneP.x) * ${f(look.wave[0])}) * ${f(look.wave[1])}`;
  return (shader: Source) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vStoneP;').replace('#include <begin_vertex>', '#include <begin_vertex>\n  vStoneP = position;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vStoneP;
float stoneH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`).replace('#include <map_fragment>', `#include <map_fragment>
  {
    float base = 1.0 - smoothstep(${f(look.below[0])}, ${f(look.below[1])}, vStoneP.y);
    float row = floor((vStoneP.y + 1.0) * ${rows} + ${wave}), ang = atan(vStoneP.z, vStoneP.x) / 6.2831853 + 0.5;
    vec2 cell = vec2(ang * (${f(look.perRow[0])} + stoneH(vec2(row, 3.0)) * ${f(look.perRow[1])}) + stoneH(vec2(row, 7.0)), (vStoneP.y + 1.0) * ${rows} + ${wave});
    vec2 id = floor(cell), f = fract(cell);
    float edge = min(min(f.x, 1.0 - f.x) * ${f(look.aspect)}, min(f.y, 1.0 - f.y));
    float mortar = 1.0 - smoothstep(${f(look.mortar[0])}, ${f(look.mortar[1])}, edge);
    float tone = stoneH(id + row * 1.7);
    vec3 stone = mix(${v3(look.dark)}, ${v3(look.light)}, tone) * (${f(look.speckle[0])} + ${f(look.speckle[1])} * stoneH(floor(cell * ${f(look.speckleScale)})));
    diffuseColor.rgb = mix(diffuseColor.rgb, mix(stone, ${v3(look.mortarColour)}, mortar), base);
  }`);
  };
}

function desaturate(look: DesaturateLook): ShaderPatchFn {
  return (shader: Source) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722))), ${f(look.amount)});`);
  };
}

function patchOf(look: SurfaceLook, inputs: SurfaceInputs): ShaderPatchFn {
  if (look.kind === 'firelight') return firelight(look, inputs);
  if (look.kind === 'viewerLight') return viewerLight(look, inputs);
  if (look.kind === 'leather') return leather(look);
  if (look.kind === 'stoneBand') return stoneBand(look);
  return desaturate(look);
}

/**
 * Chains each row onto `material` in order (one `PATCH_ORDER.decorate` patch a row, id `surface.<kind>`); the material
 * still needs `needsUpdate = true`. A patch's program-key text is its family and row (three keys a program on the
 * patch's text), so a row never borrows another row's program.
 */
export function applySurfaceLooks(material: Material, looks: readonly SurfaceLook[], inputs: SurfaceInputs = {}): void {
  for (const look of looks) {
    const patch = patchOf(look, inputs), key = `surface:${JSON.stringify(look)}`;
    const keyed: ShaderPatchFn = (shader, renderer) => { patch(shader, renderer); };
    keyed.toString = () => key;
    patchShader(material, `surface.${look.kind}`, PATCH_ORDER.decorate, keyed);
  }
}
