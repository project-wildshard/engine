/**
 * wind — Driftwood Isle's one wind (remaster M5): a clock and a slow GUST (0 calm … 1 gusting) that everything that
 * sways reads — palm fronds, bushes, ground cover, sails, the lookout banner, hanging weed and flags — and that the sound
 * agent reads too (`palms.gust`). Palms.update(dt) advances it once a frame (main.ts already calls it).
 *
 * Geometry opts in through a vec2 vertex attribute `aSway` = (weight, phase): weight 0 never moves (a geometry without
 * the attribute reads 0), ~1 flutters like cloth. `patchSway(shader)` adds the displacement to any material's vertex
 * shader (call it from onBeforeCompile, before `sky.setupMaterial`); a shadow-pass depth material patched the same way
 * makes shadows move with what casts them.
 */
import * as THREE from 'three';
import { clockGust, fieldGustAt } from '../../../shared/engine/world/windField';

export const windUniforms = { uWindTime: { value: 0 }, uGust: { value: 0.5 } };
/** 0 … 1 wind the weather adds (Pine Hollow's rain, PH-L10: src/shards/pine-hollow/world/weather.ts); 0 = the wind exactly as before */
export const windBoost = { value: 0 };

/** advance the wind clock and the gust (a few incommensurate sines: long lulls, a stronger puff every half-minute or so) */
export function updateWind(dt: number): void {
  const t = (windUniforms.uWindTime.value += dt);
  windUniforms.uGust.value = clockGust(t, windBoost.value);
}

/** the prevailing wind (from the sea in the south-east), unit xz */
const WX = -0.55, WZ = 0.83;

const SWAY_GLSL = /* glsl */`
  {
    float sw = aSway.x;
    if (sw > 0.0) {
      vec4 wp4 = modelMatrix * vec4(position, 1.0);
      float ph = aSway.y + wp4.x * 0.21 + wp4.z * 0.17;
      float amp = (0.35 + 0.65 * uGust) * sw;
      float flap = sin(uWindTime * 2.1 + ph) * 0.55 + sin(uWindTime * 4.3 + ph * 1.9) * 0.25;
      float lean = 0.25 + 0.75 * uGust;
      vec2 d = vec2(${WX.toFixed(3)}, ${WZ.toFixed(3)}) * (lean * 0.12 + flap * 0.1) * amp;
      d += vec2(-${WZ.toFixed(3)}, ${WX.toFixed(3)}) * sin(uWindTime * 1.4 + ph * 1.3) * 0.05 * amp;
      // world-space offset → object space (the kit's meshes are world-space; the boat's is a moving group)
      vec3 off = (inverse(modelMatrix) * vec4(d.x, -abs(flap) * 0.02 * amp, d.y, 0.0)).xyz;
      transformed += off;
    }
  }`;

/** add the sway to a material's vertex shader (inside onBeforeCompile) */
export function patchSway(shader: { uniforms: Record<string, THREE.IUniform>; vertexShader: string }): void {
  shader.uniforms['uWindTime'] = windUniforms.uWindTime;
  shader.uniforms['uGust'] = windUniforms.uGust;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec2 aSway;\nuniform float uWindTime;\nuniform float uGust;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n${SWAY_GLSL}`);
}

/** an aSway attribute for a geometry: weight rises with height from 0 at `y0` to `w` at `y1` (a bush, a frond) or falls
 * from the top (hanging cloth: pass y0 > y1) */
export function swayByHeight(g: THREE.BufferGeometry, w: number, y0: number, y1: number, phase: number): void {
  const pos = g.getAttribute('position'), a = new Float32Array(pos.count * 2), span = y1 - y0 || 1;
  for (let i = 0; i < pos.count; i++) { a[i * 2] = w * Math.min(1, Math.max(0, (pos.getY(i) - y0) / span)); a[i * 2 + 1] = phase; }
  g.setAttribute('aSway', new THREE.BufferAttribute(a, 2));
}

// ---------------------------------------------------------------- the forest's wind field (Pine Hollow, PH-L6)
/*
 * The same clock and the same slow gust (`windUniforms`), spread over the ground as a GUST FRONT: a band of stronger
 * wind, FRONT_LEN metres from one to the next, rolling downwind at FRONT_SPEED m/s. Each front has a sharp leading edge
 * and a long tail (a warped cosine, squared), a second, shorter family breaks up the rhythm, and a slow cross-wind bend +
 * strength modulation keeps the fronts from being straight lines. Pines, grass, flowers and undergrowth all sample
 * `windGustAt(worldXZ)` (≈0.1 in a lull … ≈1 under a front in a gust), so one front visibly crosses the canopy and the
 * meadow together. Driftwood's `patchSway` above is untouched: this is a separate chunk on the same two uniforms.
 */
/** metres between gust fronts, their speed downwind (m/s), and the second front family's length (× FRONT_LEN) */
export const FRONT_LEN = 150, FRONT_SPEED = 11, FRONT2_LEN: number = 0.61 * FRONT_LEN;
/** the prevailing wind, unit xz, blowing toward (x, z) — the same as Driftwood's sway */
export const WIND_DIR: { readonly x: number; readonly z: number } = { x: WX, z: WZ };
const TAU = 6.283185307;

type GlslSource = string;

/** GLSL: `uWindTime`, `uGust`, `windDirXZ()`, `windGustAt(worldXZ)`; `windGustAt` below is its CPU mirror */
export const WIND_FIELD_GLSL: GlslSource = /* glsl */`
  uniform float uWindTime; uniform float uGust;
  vec2 windDirXZ() { return vec2( ${WX.toFixed(3)}, ${WZ.toFixed(3)} ); }
  // one front per unit of s: peak at s = 0, a quick rise just ahead of it, a long tail behind (w is monotonic in s)
  float windFront( float s ) {
    float f = fract( s );
    float w = f + 0.12 * ( 1.0 - cos( ${TAU} * f ) );
    float c = 0.5 + 0.5 * cos( ${TAU} * w );
    return c * c;
  }
  float windGustAt( vec2 p ) {
    vec2 d = windDirXZ();
    float along = dot( p, d ), across = dot( p, vec2( - d.y, d.x ) );
    float bend = 22.0 * sin( across * 0.021 + uWindTime * 0.043 ) + 9.0 * sin( across * 0.057 - uWindTime * 0.031 );
    float x = along + bend - uWindTime * ${FRONT_SPEED.toFixed(1)};
    float f = 0.75 * windFront( x / ${FRONT_LEN.toFixed(1)} ) + 0.25 * windFront( x / ${FRONT2_LEN.toFixed(2)} + 0.37 );
    float patchy = 0.62 + 0.38 * sin( across * 0.025 + along * 0.004 - uWindTime * 0.05 );
    return ( 0.3 + 0.7 * uGust ) * ( 0.3 + 0.9 * f * patchy );
  }
`;

/** add the wind field (uniforms + GLSL helpers) to a vertex shader, inside onBeforeCompile — the same uniform objects as
 * Driftwood's sway, so everything that sways is on one clock */
export function patchWindField(shader: { uniforms: Record<string, THREE.IUniform>; vertexShader: string }): void {
  shader.uniforms['uWindTime'] = windUniforms.uWindTime;
  shader.uniforms['uGust'] = windUniforms.uGust;
  shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${WIND_FIELD_GLSL}`);
}

const CPU_FIELD = { x: WX, z: WZ, frontLength: FRONT_LEN, frontSpeed: FRONT_SPEED, secondaryLength: FRONT2_LEN };
/** CPU mirror of the GLSL `windGustAt` (sound, tests): the gust strength at world (x, z) now, or at clock `t` / gust `gust` */
export function windGustAt(x: number, z: number, t: number = windUniforms.uWindTime.value, gust: number = windUniforms.uGust.value): number {
  return fieldGustAt(x, z, t, gust, CPU_FIELD);
}
