/**
 * Point lights that reach nowhere near a pixel cost nothing (E142, the heavy GPU lane).
 *
 * Pine Hollow keeps its point lights in a fixed pool (the 4 shared cabin lights that follow the nearest cabin on the phone,
 * the lookout's lamp): NUM_POINT_LIGHTS is a program define, so a light switched off or far away still runs three's whole
 * per-light loop in every lit fragment — the direct BRDF (GGX + Smith + Fresnel), the multi-scatter terms — only to add
 * zero. A pixel beyond a light's `distance` cutoff, or any pixel of a light at intensity 0 (the cabin lamps by day), gets
 * `directLight.color == 0` from getPointLightInfo (the cutoff window is exactly 0 there), and three already records that as
 * `directLight.visible = false`. This patch gates the BRDF on it: `if ( directLight.visible ) RE_Direct( … )` inside the
 * point-light loop. Mathematically the same frame (the skipped call would have added 0); the M5 ruler
 * (scripts/pine-hollow-gpu.mjs, 1206×2622) put the pool at 0.26–0.30 ms per frame away from the cabins (~9 % of the frame).
 *
 * Call after CSM has installed its own `lights_fragment_begin` (Sky.build) and before a material compiles. Pine Hollow only
 * (the other shards' programs stay byte for byte).
 */
import * as THREE from 'three';

const CALL = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';

/** gate the point-light loop's BRDF on `directLight.visible`; returns false when the chunk has no point-light loop to patch */
export function patchPointLightSkip(): boolean {
  const chunk = THREE.ShaderChunk.lights_fragment_begin;
  const start = chunk.indexOf('#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )');
  if (start === -1) return false;
  const end = chunk.indexOf('#pragma unroll_loop_end', start);
  const at = chunk.indexOf(CALL, start);
  if (end === -1 || at === -1 || at > end) return false;
  if (chunk.slice(start, at).includes('if ( directLight.visible )')) return true; // patched already
  THREE.ShaderChunk.lights_fragment_begin = `${chunk.slice(0, at)}if ( directLight.visible ) ${chunk.slice(at)}`;
  return true;
}
