/**
 * Drawing a far proxy (SHARD-PLATFORM SF23): one mesh, one draw, its 16 regions hidden by a vertex-shader mask when the
 * render rings refine them (`RingView.mask`, regions x + 4z), and the grid's one mild distance haze toward the frame's air
 * (G631, `GRID_HAZE`). The material follows the shard's family: `toon` faceted Lambert (flat normals), `painterly` smooth Lambert,
 * `pbr` rough standard. The region rides in TEXCOORD_0.x (the baked GLB's only spare channel; `farProxy.ts`) and the
 * boundary-face flag in TEXCOORD_0.y (G222: 1 lip, 2 foot), where the material lays rock strata over the shard's cliff
 * palette.
 */
import { AdditiveBlending, NormalBlending, DataTexture, LinearFilter, LinearMipmapLinearFilter, Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshStandardMaterial, RedFormat, RepeatWrapping, Vector2, type BufferGeometry, type Material, type Object3D } from 'three';
import { diagnosticNow } from '@wildshard/engine/core/clock';
import { patchShader } from '@wildshard/engine/render/shaderPatches';
import { markDisplayColour } from '@wildshard/engine/render/displayColour';
import { geometryBoundsSteps } from '@wildshard/engine/world/geometryBounds';
import { CHUNK_HALF } from '@wildshard/engine/core/config';
import { GRID_HAZE, type FarLookRuntime } from '../../../shared/game/grid/farProxy';
import { NEAR_GRAIN_SIZE, nearGrainBytes } from './nearGrain';
import { installFarImpostor, type FarImpostorData } from './farImpostorView';

/**
 * SF23 / G90: how far (m) the foot of a proxy's border skirt steps in from the cell edge. The skirt keeps its top on the
 * edge and its −20 m floor (G121), but leans inward, so a seam's retaining wall (a face in the cell-edge plane, 6 m to H)
 * draws in front of it instead of sharing its plane. Applied in the vertex shader: the baked GLBs stay as they are.
 */
export const FAR_SKIRT_INSET = 3;
/**
 * G222: the strata the far material lays over a proxy's boundary face (the cliff-flagged vertices), measured from the
 * seam's rock grain (`seamLook.ts` `strata`, 256 px per 7 m): its soft bands repeat every 70 px (1.9 m) and its rows swing
 * 170–245 around a mean of 195, ±19 %. Seen from the road at 0.3–2.4 km the seam's 0.16 m rows are sub-pixel, so the far
 * face keeps the same contrast on beds twice the soft band (3.8 m), waved along the face and broken into blocks, fading
 * flat past `fade` metres where a bed is under two pixels.
 */
export const FAR_STRATA = { bed: 3.8, contrast: 0.19, block: 11, fade: [1200, 2200] } as const;
/**
 * Playtest round 2: the light floor of the boundary face, as a multiple of its rock colour added after lighting. A face that
 * turns away from the frame's sun got no light at all under a frame without an ambient term (any page where no admitted
 * shard brings its sky light), so every shaded cliff drew as a pitch-black 100 m slab beside the road; with the floor a
 * shaded face is the rock's own colour dimmed (×0.8) and a sunlit one only slightly brighter than before.
 */
export const FAR_CLIFF_FLOOR = 0.8;

/**
 * G342 near round 5 (sp-o67's open row 2: a surface finer than per-vertex colour): the near placeholder's grain. Its
 * baked vertex colour (the shard's own palette, ~2 m apart) keeps the hue; one small engine-owned noise texture (128²
 * R8, mipmapped, 21 KB) breaks it into ground detail: flat ground takes two rotated taps (`flat` metres a repeat, broad
 * patches then fine tufts), steep ground takes the texture stretched along the face (`steep`: long beds, so a flank reads
 * as layered rock), and both fade out between `fade` metres, where a tap is under a pixel. `amp` is the brightness swing
 * per material family: toon keeps its flat facets nearly clean, painterly gets soft brush patches, pbr the most. Two to
 * four texture taps a fragment on the near view only; the far proxy is unchanged.
 */
export const NEAR_GRAIN = { flat: [23, 5.3], steep: [17, 4.1, 3.7], fade: [260, 720], amp: { toon: 0.12, painterly: 0.3, pbr: 0.36 } } as const;
let grainTexture: DataTexture | null = null;
/** The shared grain: tileable value noise, three octaves, stretched to the full 0–255 range. Built once, never disposed. */
function nearGrainTexture(): DataTexture {
  if (grainTexture !== null) return grainTexture;
  const texture = new DataTexture(nearGrainBytes(), NEAR_GRAIN_SIZE, NEAR_GRAIN_SIZE, RedFormat);
  texture.wrapS = texture.wrapT = RepeatWrapping; texture.magFilter = LinearFilter; texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.needsUpdate = true; texture.name = 'near-grain';
  grainTexture = texture;
  return texture;
}

/** A drawn proxy: the rings' RingView shape plus its mesh. */
export interface FarProxyView {
  readonly mesh: Mesh; mask: (excluded: ReadonlySet<number>) => void; shadow: (enabled: boolean) => void; dispose: () => void;
  /** G539: the far tier's band share (0 proxy, 1 impostor, between a dithered cross-fade); absent without an impostor */
  band?: (share: number) => void;
}

/** The family material with the region mask patched in; `uniforms.farMask` holds 16 flags (`cells` 8, G748: a positional
 *  mask of 64, one per L0 tile x + 8z, the entered cell's far stand-in leaving out the tiles its render ring draws). */
export function farProxyMaterial(look: FarLookRuntime, positionalMask = false, grain = false, cells: 4 | 8 = 4): { material: MeshLambertMaterial | MeshStandardMaterial; setMask: (excluded: ReadonlySet<number>) => void; setBand: (share: number) => void } {
  if (cells === 8 && !positionalMask) throw new Error('An 8 x 8 far mask is positional');
  const material = look.family === 'pbr' ? new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }) : new MeshLambertMaterial({ vertexColors: true, flatShading: look.family === 'toon' });
  material.fog = false; // a home shard's near fog would hide its neighbours; the grid's own haze below (G631)
  const flags = cells * cells, mask = new Float32Array(flags);
  const uniforms = { farMask: { value: mask }, farBand: { value: 0 }, farHazeColour: GRID_HAZE.colour,
    ...(grain ? { farGrain: { value: nearGrainTexture() }, farGrainFade: { value: new Vector2(...NEAR_GRAIN.fade) } } : {}) };
  const f = (n: number): string => n.toFixed(2);
  const [flatA, flatB] = NEAR_GRAIN.flat, [steepAlong, steepUp, steepFine] = NEAR_GRAIN.steep;
  // round 5: the near grain after the strata (`NEAR_GRAIN`); object space is the cell frame (the mesh only translates)
  const grainFragment = grain ? `
{
  vec3 gn = normalize(vFarGrainN);
  float level = smoothstep(0.55, 0.85, abs(gn.y));
  vec2 ga = vFarGrainP.xz / ${f(flatA)}, gb = mat2(0.866, 0.5, -0.5, 0.866) * vFarGrainP.xz / ${f(flatB)};
  float flatG = texture2D(farGrain, ga).r * 0.55 + texture2D(farGrain, gb).r * 0.45;
  float along = abs(gn.x) > abs(gn.z) ? vFarGrainP.z : vFarGrainP.x;
  float steepG = texture2D(farGrain, vec2(along / ${f(steepAlong)}, vFarGrainP.y / ${f(steepUp)})).r * 0.6 + texture2D(farGrain, vec2(along, vFarGrainP.y) / ${f(steepFine)}).r * 0.4;
  diffuseColor.rgb *= 1.0 + ${f(NEAR_GRAIN.amp[look.family])} * 2.0 * (mix(steepG, flatG, level) - 0.5) * (1.0 - smoothstep(farGrainFade.x, farGrainFade.y, vFarDepth));
}` : '';
  patchShader(material, 'sf23-far', 0, (shader): void => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float farMask[${String(flags)}];\nvarying float vFarDepth;\nvarying float vFarCliff;\nvarying vec2 vFarStrata;${grain ? '\nvarying vec3 vFarGrainP;\nvarying vec3 vFarGrainN;' : ''}`)
      // the boundary face's foot (uv.y 2) steps inward from the cell edge; its strata ride the face (along it, up it)
      .replace('#include <begin_vertex>', (positionalMask
        ? '#include <begin_vertex>\nvFarCliff = 0.0;\nvFarStrata = transformed.xz;'
        : `#include <begin_vertex>\nvFarCliff = uv.y;\nvFarStrata = vec2(position.x + position.z, position.y);\nif (uv.y > 1.5) transformed.xz -= sign(transformed.xz) * step(vec2(${f(CHUNK_HALF - 0.01)}), abs(transformed.xz)) * ${FAR_SKIRT_INSET.toFixed(1)};`)
        + (grain ? '\nvFarGrainP = position;\nvFarGrainN = normal;' : ''))
      .replace('#include <project_vertex>', `#include <project_vertex>\nvFarDepth = -mvPosition.z;${positionalMask ? '' : '\nif (farMask[int(uv.x + 0.5)] > 0.5) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);'}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float farBand;\nuniform vec3 farHazeColour;\nvarying float vFarDepth;\nvarying float vFarCliff;\nvarying vec2 vFarStrata;\nfloat farHash(float n) { return fract(sin(n * 127.1 + 311.7) * 43758.5453); }${positionalMask ? `\nuniform float farMask[${String(flags)}];` : ''}${grain ? '\nuniform sampler2D farGrain;\nuniform vec2 farGrainFade;\nvarying vec3 vFarGrainP;\nvarying vec3 vFarGrainN;' : ''}`)
      // G539: the share of the band its impostor draws (the complementary screen-door dither, farImpostorView.ts)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\nif (fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) < farBand) discard;${positionalMask
        ? `\nvec2 farCell = clamp(floor((vFarStrata + ${f(CHUNK_HALF)}) / ${f(CHUNK_HALF * 2 / cells)}), vec2(0.0), vec2(${f(cells - 1)}));\nif (farMask[int(farCell.x + ${f(cells)} * farCell.y)] > 0.5) discard;` : ''}`)
      // G222: rock beds over the cliff palette, waved along the face, each bed broken into blocks, a lit top and a shadowed
      // underside per bed; mean ≈ 1 so the declared palette keeps its value
      .replace('#include <color_fragment>', `#include <color_fragment>
if (vFarCliff > 0.5) {
  float y = vFarStrata.y + 1.4 * sin(vFarStrata.x * 0.029) + 0.7 * sin(vFarStrata.x * 0.083 + 1.3), bed = y / ${f(FAR_STRATA.bed)}, layer = farHash(floor(bed));
  float block = farHash(floor(vFarStrata.x / ${f(FAR_STRATA.block)} + layer * 5.0) + floor(bed) * 17.0), u = fract(bed);
  float k = (1.0 + ${f(FAR_STRATA.contrast)} * (2.0 * layer - 1.0)) * (0.94 + 0.12 * block) * (1.0 + 0.1 * smoothstep(0.75, 1.0, u) - 0.12 * smoothstep(0.3, 0.0, u));
  diffuseColor.rgb *= mix(k, 1.0, smoothstep(${f(FAR_STRATA.fade[0])}, ${f(FAR_STRATA.fade[1])}, vFarDepth));
}${grainFragment}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\nif (vFarCliff > 0.5) totalEmissiveRadiance += diffuseColor.rgb * ${f(FAR_CLIFF_FLOOR)};`)
      .replace('#include <fog_fragment>', `#include <fog_fragment>\ngl_FragColor.rgb = mix(gl_FragColor.rgb, farHazeColour, smoothstep(${f(GRID_HAZE.near)}, ${f(GRID_HAZE.far)}, vFarDepth) * ${f(GRID_HAZE.max)});\ngl_FragColor.a = 1.0;`);
  }, { key: `sf23-far-${look.family}${positionalMask ? '-position' : ''}${grain ? '-grain' : ''}${cells === 8 ? '-tiles' : ''}` });
  return { material, setMask: (excluded) => { for (let r = 0; r < flags; r++) mask[r] = excluded.has(r) ? 1 : 0; }, setBand: (share) => { uniforms.farBand.value = share; } };
}

/** NM13: a near view's light layer (`NEAR_LIGHT`): its vertex colours added unlit over what is drawn (light pools, lit
 *  windows and lanterns), masked by the same 16 regions as the lit draw when it is masked by position. */
function farLightMaterial(mask: Float32Array, positionalMask: boolean, additive = true): MeshBasicMaterial {
  const material = new MeshBasicMaterial({ vertexColors: true, transparent: additive, blending: additive ? AdditiveBlending : NormalBlending, depthWrite: !additive, fog: false, toneMapped: additive });
  material.color.setScalar(additive ? 1.6 : 1); // opaque colour is already linear; only additive glow gets an intensity boost
  if (!additive) markDisplayColour(material);
  if (positionalMask) patchShader(material, 'nm13-near-light', 0, (shader): void => {
    shader.uniforms['farMask'] = { value: mask };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vFarLightP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFarLightP = transformed.xz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float farMask[16];\nvarying vec2 vFarLightP;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\nvec2 farCell = clamp(floor((vFarLightP + ${CHUNK_HALF.toFixed(2)}) / ${(CHUNK_HALF / 2).toFixed(2)}), vec2(0.0), vec2(3.0));\nif (farMask[int(farCell.x + 4.0 * farCell.y)] > 0.5) discard;`);
  }, { key: 'nm13-near-light' });
  return material;
}

/**
 * Install a proxy under a cell root (the rings' upload port). It never casts or receives shadows (§3.2: only near L0).
 * `decorate` patches its material before anything compiles it (G321 part 4: the horizon fade); `grain` adds the near
 * placeholder's ground detail (`NEAR_GRAIN`).
 */
export function installFarProxy(root: Object3D, geometry: BufferGeometry, look: FarLookRuntime, positionalMask = false, decorate?: (material: Material) => void, grain = false, impostorData: FarImpostorData | null = null, light: BufferGeometry | null = null, colour: BufferGeometry | null = null): FarProxyView {
  const { material, setMask, setBand } = farProxyMaterial(look, positionalMask, grain), mesh = new Mesh(geometry, material);
  // NM13: the light layer rides the lit draw (its child: shown, masked and retired with it)
  const lightMask = new Float32Array(16), lightMesh = light === null ? null : new Mesh(light, farLightMaterial(lightMask, positionalMask));
  if (lightMesh !== null) { lightMesh.name = 'far-proxy-light'; lightMesh.renderOrder = 1; lightMesh.frustumCulled = false; mesh.add(lightMesh); }
  const colourMesh = colour === null ? null : new Mesh(colour, farLightMaterial(lightMask, positionalMask, false));
  if (colourMesh !== null) { colourMesh.name = 'far-proxy-colour'; colourMesh.frustumCulled = false; mesh.add(colourMesh); }
  decorate?.(material);
  mesh.name = 'far-proxy'; mesh.castShadow = false; mesh.receiveShadow = false; mesh.matrixAutoUpdate = false; mesh.updateMatrix();
  const bounds = geometryBoundsSteps(geometry, 'sphere');
  while (!bounds.next().done) { /* proxy installation remains synchronous */ }
  root.add(mesh);
  const impostor = impostorData === null ? null : installFarImpostor(root, impostorData, decorate);
  let disposed = false;
  return {
    mesh,
    mask: (excluded) => { setMask(excluded); for (let r = 0; r < 16; r++) lightMask[r] = excluded.has(r) ? 1 : 0; mesh.visible = excluded.size < 16; },
    shadow: () => undefined,
    ...(impostor === null ? {} : { band: (share: number) => {
      // the proxy keeps the dither under the share and stops drawing once the impostor has it all; the impostor shows only
      // where the proxy would (a near view or an entered region covers both)
      setBand(share); material.visible = share < 1; if (lightMesh !== null) lightMesh.visible = share < 1; if (colourMesh !== null) colourMesh.visible = share < 1; impostor.band(share, mesh.visible);
    } }),
    dispose: () => { if (disposed) return; disposed = true; impostor?.dispose(); mesh.removeFromParent(); geometry.dispose(); material.dispose(); for (const layer of [lightMesh, colourMesh]) if (layer !== null) { layer.geometry.dispose(); const own: unknown = layer.material; if (own instanceof MeshBasicMaterial) own.dispose(); } },
  };
}

/** A fetched, parsed proxy waiting for its budgeted upload. */
export interface FarPrepared { readonly geometry: BufferGeometry; readonly look: FarLookRuntime; readonly positionalMask?: boolean; readonly impostor?: FarImpostorData | null;
  /** NM13: a near view's light layer, drawn additively over it */
  readonly light?: BufferGeometry;
  /** Opaque unlit linear colour, without additive glow or haze. */
  readonly colour?: BufferGeometry }
/** Scalar diagnostics only: fetching includes both file/decode work and hidden shader preparation. */
export interface FarPreparationWait { readonly instance: string; readonly phase: 'load' | 'prepare'; readonly ageMs: number; readonly phaseAgeMs: number }
/**
 * The rings' ports for level `far` (compose with the tile ports through SF18b's `levelPorts`): `load` fetches and parses
 * an instance's far.glb off the frame (GLTF parse, region in uv.x) with its far.json look. Optional `prepare` borrows
 * the admitted view while hidden; `upload` exposes that same view after preparation, and `discard` retires it.
 */
export function farRingPorts(options: { root: (instance: string) => Object3D; load: (instance: string) => Promise<FarPrepared>; prepare?: (view: FarProxyView, data: FarPrepared) => Promise<void>; decorate?: (material: Material) => void }): {
  waiting: () => readonly FarPreparationWait[];
  fetch: (tile: { instance: string }, done: (result: FarPrepared | Error) => void) => void;
  upload: (tile: { instance: string }, data: FarPrepared) => FarProxyView;
  discard: (tile: { instance: string }, data: FarPrepared) => void;
} {
  const staged = new WeakMap<FarPrepared, FarProxyView>();
  const pending = new Set<{ instance: string; phase: 'load' | 'prepare'; started: number; phaseStarted: number }>();
  return {
    waiting: () => {
      const now = diagnosticNow();
      return [...pending].map(row => ({ instance: row.instance, phase: row.phase, ageMs: Math.max(0, now - row.started), phaseAgeMs: Math.max(0, now - row.phaseStarted) }));
    },
    fetch: (tile, done) => {
      const now = diagnosticNow();
      // Each request owns its scalar record, including overlapping requests for one cell.
      const row: { instance: string; phase: 'load' | 'prepare'; started: number; phaseStarted: number } = { instance: tile.instance, phase: 'load', started: now, phaseStarted: now };
      pending.add(row);
      const run = async (): Promise<void> => {
        let result: FarPrepared | Error;
        try {
          const data = await options.load(tile.instance);
          if (options.prepare !== undefined) {
            row.phase = 'prepare'; row.phaseStarted = diagnosticNow();
            let view: FarProxyView | undefined;
            try {
              view = installFarProxy(options.root(tile.instance), data.geometry, data.look, data.positionalMask, options.decorate, false, data.impostor ?? null, data.light ?? null, data.colour ?? null);
              view.mesh.visible = false;
              await options.prepare(view, data);
              staged.set(data, view);
            } catch (error) {
              if (view === undefined) { data.geometry.dispose(); data.light?.dispose(); data.colour?.dispose(); } else view.dispose();
              throw error;
            }
          }
          result = data;
        } catch (error) { result = error instanceof Error ? error : new Error(String(error)); }
        finally { pending.delete(row); }
        done(result);
      };
      void run();
    },
    upload: (tile, data) => {
      const view = staged.get(data);
      if (view === undefined) return installFarProxy(options.root(tile.instance), data.geometry, data.look, data.positionalMask, options.decorate, false, data.impostor ?? null, data.light ?? null, data.colour ?? null);
      staged.delete(data); view.mesh.visible = true;
      return view;
    },
    discard: (_tile, data) => {
      const view = staged.get(data); staged.delete(data);
      if (view === undefined) { data.geometry.dispose(); data.light?.dispose(); data.colour?.dispose(); } else view.dispose();
    },
  };
}
