/**
 * Shader text before three builds a program (js-heap H10). three's WebGLProgram rewrites a classic material's source with
 * one regex replace per light and clipping count (13 + 2) after resolving its `#include`s afresh, and each replace that
 * finds its token copies the whole shader: the Template's boot made ~25 MiB of short-lived shader strings that way.
 *
 *   finishShaderText(shader)   resolve its includes (each chunk's resolution cached) and fill every count in one pass;
 *                              a program text it finished before (three asks once per material, not per program) comes
 *                              back as the same strings, with nothing copied
 *
 * The result is exactly what three's own passes make, so its passes then find nothing to replace and copy nothing; its
 * loop unrolling still runs after, as before. It runs last in a material's `onBeforeCompile` (shaderPatches' runner,
 * after every patch, since the patches find their place by the unresolved `#include` lines). A chunk three does not
 * know (a deprecated name) stays an include line for three to resolve or refuse.
 */
import * as THREE from 'three';

type ShaderText = Pick<THREE.WebGLProgramParametersWithUniforms, 'vertexShader' | 'fragmentShader' | 'numSunLights' | 'numDirLights'
  | 'numSpotLights' | 'numSpotLightMaps' | 'numRectAreaLights' | 'numPointLights' | 'numHemiLights' | 'numSunLightShadows'
  | 'numDirLightShadows' | 'numSpotLightShadowsWithMaps' | 'numSpotLightShadows' | 'numPointLightShadows' | 'numClippingPlanes'
  | 'numClipIntersection'>;

/** three's include line (WebGLProgram's `includePattern`) */
const INCLUDE = /^[ \t]*#include +<([\w\d./]+)>/gm;
/** every count three fills, longest first where one name starts another (its sequential order gives the same text) */
const COUNT = /NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS|NUM_SPOT_LIGHT_SHADOWS|NUM_SPOT_LIGHT_MAPS|NUM_SPOT_LIGHT_COORDS|NUM_SPOT_LIGHTS|NUM_SUN_LIGHT_SHADOWS|NUM_SUN_LIGHTS|NUM_DIR_LIGHT_SHADOWS|NUM_DIR_LIGHTS|NUM_POINT_LIGHT_SHADOWS|NUM_POINT_LIGHTS|NUM_RECT_AREA_LIGHTS|NUM_HEMI_LIGHTS|NUM_CLIPPING_PLANES|UNION_CLIPPING_PLANES/g;

/** each chunk's resolved text, kept while the chunk's own text is the same (a look may replace a chunk) */
const chunks = new Map<string, { raw: string; resolved: string }>();
const chunkText: Readonly<Record<string, string | undefined>> = THREE.ShaderChunk;

/** the chunks (name, raw text) a resolution read, recorded while one program is finished */
let reads: Map<string, string> | undefined;
function resolved(name: string): string | undefined {
  const raw = chunkText[name];
  if (raw === undefined) return undefined;
  reads?.set(name, raw);
  const known = chunks.get(name);
  if (known !== undefined && known.raw === raw) return known.resolved;
  const text = resolveIncludes(raw);
  chunks.set(name, { raw, resolved: text });
  return text;
}

/** three's resolveIncludes, each chunk resolved once */
export function resolveIncludes(source: string): string {
  return source.replaceAll(INCLUDE, (line: string, name: string) => resolved(name) ?? line);
}

/** three's replaceLightNums and replaceClippingPlaneNums in one pass */
export function fillCounts(source: string, shader: ShaderText): string {
  const values: Record<string, number> = {
    NUM_SUN_LIGHTS: shader.numSunLights, NUM_DIR_LIGHTS: shader.numDirLights, NUM_SPOT_LIGHTS: shader.numSpotLights,
    NUM_SPOT_LIGHT_MAPS: shader.numSpotLightMaps,
    NUM_SPOT_LIGHT_COORDS: shader.numSpotLightShadows + shader.numSpotLightMaps - shader.numSpotLightShadowsWithMaps,
    NUM_RECT_AREA_LIGHTS: shader.numRectAreaLights, NUM_POINT_LIGHTS: shader.numPointLights, NUM_HEMI_LIGHTS: shader.numHemiLights,
    NUM_SUN_LIGHT_SHADOWS: shader.numSunLightShadows, NUM_DIR_LIGHT_SHADOWS: shader.numDirLightShadows,
    NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS: shader.numSpotLightShadowsWithMaps, NUM_SPOT_LIGHT_SHADOWS: shader.numSpotLightShadows,
    NUM_POINT_LIGHT_SHADOWS: shader.numPointLightShadows, NUM_CLIPPING_PLANES: shader.numClippingPlanes,
    UNION_CLIPPING_PLANES: shader.numClippingPlanes - shader.numClipIntersection,
  };
  return source.replaceAll(COUNT, (name: string) => String(values[name]));
}

interface Finished { readonly vertex: string; readonly fragment: string; readonly chunks: ReadonlyMap<string, string> }
/** finished program texts by their raw vertex, raw fragment and count values; a look that changes a chunk retires the
 *  entries that read it, and the cache is dropped whole past its bound (a scene has a few dozen programs) */
const finished = new Map<string, Map<string, Map<string, Finished>>>();
let entries = 0;
const FINISHED_BOUND = 512;
function countKey(shader: ShaderText): string {
  return [shader.numSunLights, shader.numDirLights, shader.numSpotLights, shader.numSpotLightMaps, shader.numRectAreaLights,
    shader.numPointLights, shader.numHemiLights, shader.numSunLightShadows, shader.numDirLightShadows, shader.numSpotLightShadowsWithMaps,
    shader.numSpotLightShadows, shader.numPointLightShadows, shader.numClippingPlanes, shader.numClipIntersection].join(',');
}

/** Resolve a program's includes and fill its counts, as three would, before three builds it. */
export function finishShaderText(shader: ShaderText): void {
  const counts = countKey(shader), byFragment = finished.get(shader.vertexShader)?.get(shader.fragmentShader), known = byFragment?.get(counts);
  if (known !== undefined && [...known.chunks].every(([name, raw]) => chunkText[name] === raw)) {
    shader.vertexShader = known.vertex; shader.fragmentShader = known.fragment; return;
  }
  const vertexRaw = shader.vertexShader, fragmentRaw = shader.fragmentShader, read = new Map<string, string>();
  reads = read;
  try {
    shader.vertexShader = fillCounts(resolveIncludes(vertexRaw), shader);
    shader.fragmentShader = fillCounts(resolveIncludes(fragmentRaw), shader);
  } finally { reads = undefined; }
  if (entries >= FINISHED_BOUND) { finished.clear(); entries = 0; }
  let fragments = finished.get(vertexRaw);
  if (fragments === undefined) { fragments = new Map(); finished.set(vertexRaw, fragments); }
  let byCounts = fragments.get(fragmentRaw);
  if (byCounts === undefined) { byCounts = new Map(); fragments.set(fragmentRaw, byCounts); }
  if (!byCounts.has(counts)) entries++;
  byCounts.set(counts, { vertex: shader.vertexShader, fragment: shader.fragmentShader, chunks: read });
}
