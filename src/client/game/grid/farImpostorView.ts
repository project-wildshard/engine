/**
 * The far tier's impostor at run time (G539: near = the full cell, mid = its far proxy, far = this). One quad under the
 * cell's root, turned about the vertical to face the camera in the vertex shader; it samples the two baked views
 * (`@wildshard/sharddev/bake/farImpostor`) nearest the camera's azimuth and blends them, then hazes exactly as the proxy does
 * (the proxy's own haze toward the frame's air, after tone mapping and the output conversion). The band between proxy
 * and impostor is a screen-door cross-fade: the proxy keeps the fragments under the band's dither and the impostor the
 * rest, so a cell never pops between them. The texels pack to RGBA 5551 (2 bytes, the bake's own quantisation) in a
 * worker, off the main thread, and leave the JS heap once uploaded. Generic: nothing here knows a shard.
 */
import { Box3, DataTexture, LinearFilter, Mesh, PlaneGeometry, RGBAFormat, ShaderMaterial, Sphere, UnsignedShort5551Type, Vector3, type Material, type Object3D } from 'three';
import { gpuOnlyTexture } from '@wildshard/engine/core/gpuOnly';
import type { FarImpostor } from '@wildshard/format/shardSections';
import type { FarImpostorDecodeReply, FarImpostorDecodeRequest } from './farImpostorPack';
import { GRID_HAZE } from '../../../shared/game/grid/farProxy';

/** A decoded impostor: its row and its packed texels. */
export interface FarImpostorData { readonly row: FarImpostor; readonly texels: Uint16Array; readonly width: number; readonly height: number }

/** The far tier's bands (m, camera to the cell's square): the proxy hands over to the impostor across `fade` about `from`. */
export const FAR_BANDS = { from: 2000, fade: 300 } as const;
/** The band share (0: proxy only, 1: impostor only) at a distance. */
export function farBandShare(distance: number): number {
  const t = (distance - (FAR_BANDS.from - FAR_BANDS.fade / 2)) / FAR_BANDS.fade;
  return Math.min(1, Math.max(0, t));
}

/** The one decode worker, started on first use (null where workers are missing: the cell keeps its proxy). */
let decoder: { worker: Worker; next: number; pending: Map<number, (reply: FarImpostorDecodeReply) => void> } | null | undefined;
function decodeWorker(): typeof decoder {
  if (decoder !== undefined) return decoder;
  if (typeof Worker !== 'function') { decoder = null; return decoder; }
  const worker = new Worker(new URL('farImpostorDecodeWorker.ts', import.meta.url), { type: 'module', name: 'g539-impostor-decode' });
  const pending = new Map<number, (reply: FarImpostorDecodeReply) => void>();
  worker.onmessage = (event: MessageEvent<FarImpostorDecodeReply>): void => { const done = pending.get(event.data.id); pending.delete(event.data.id); done?.(event.data); };
  decoder = { worker, next: 0, pending };
  return decoder;
}

/**
 * Decode a baked impostor image (PNG bytes) to packed RGBA 5551 texels in the decode worker (the main thread only
 * uploads). Null where it cannot (no Worker, a worker without OffscreenCanvas, a Node test): the cell keeps its proxy
 * at every distance.
 */
export async function decodeFarImpostor(row: FarImpostor, bytes: Uint8Array): Promise<FarImpostorData | null> {
  const pool = decodeWorker(); if (pool === null || pool === undefined) return null;
  const rows = Math.ceil(row.views / row.cols), width = row.cols * row.tile[0], height = rows * row.tile[1], id = pool.next++;
  const buffer = bytes.slice().buffer;
  const reply = await new Promise<FarImpostorDecodeReply>((resolve) => {
    pool.pending.set(id, resolve);
    pool.worker.postMessage({ id, bytes: buffer, width, height } satisfies FarImpostorDecodeRequest, [buffer]);
  });
  if ('error' in reply) { console.warn(`[grid] far impostor decode: ${reply.error}`); return null; }
  return { row, texels: reply.texels, width, height };
}

const vertex = /* glsl */ `
uniform vec4 uFrame;
uniform vec2 uGrid;
varying vec2 vUv;
varying vec4 vTiles;
varying float vMix;
varying float vFarDepth;
void main() {
  vec3 centre = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec2 d = cameraPosition.xz - centre.xz;
  float a = atan(d.x, d.y);
  vec3 world = centre + vec3(cos(a), 0.0, -sin(a)) * (position.x * uFrame.x) + vec3(0.0, mix(uFrame.y, uFrame.z, position.y), 0.0);
  float s = mod(a / 6.2831853 * uFrame.w + uFrame.w, uFrame.w), i0 = floor(s), i1 = mod(i0 + 1.0, uFrame.w);
  vMix = s - i0;
  vTiles = vec4(mod(i0, uGrid.x), floor(i0 / uGrid.x), mod(i1, uGrid.x), floor(i1 / uGrid.x));
  vUv = vec2(position.x + 0.5, position.y);
  vec4 mv = viewMatrix * vec4(world, 1.0);
  vFarDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const fragment = /* glsl */ `
uniform sampler2D uAtlas;
uniform vec2 uGrid;
uniform float uRange;
uniform float uBand;
uniform vec3 farHazeColour;
varying float vFarDepth;
varying vec2 vUv;
varying vec4 vTiles;
varying float vMix;
vec3 farDecode(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c)); }
void main() {
  if (fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) >= uBand) discard;
  vec4 c0 = texture2D(uAtlas, vec2((vTiles.x + vUv.x) / uGrid.x, 1.0 - (vTiles.y + 1.0 - vUv.y) / uGrid.y));
  vec4 c1 = texture2D(uAtlas, vec2((vTiles.z + vUv.x) / uGrid.x, 1.0 - (vTiles.w + 1.0 - vUv.y) / uGrid.y));
  float w0 = c0.a * (1.0 - vMix), w1 = c1.a * vMix, w = w0 + w1;
  if (w < 0.5) discard;
  gl_FragColor = vec4(farDecode((c0.rgb * w0 + c1.rgb * w1) / w) * uRange, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // G631: the grid's one mild haze, as its proxy's (farView.ts)
  gl_FragColor.rgb = mix(gl_FragColor.rgb, farHazeColour, smoothstep(${GRID_HAZE.near.toFixed(1)}, ${GRID_HAZE.far.toFixed(1)}, vFarDepth) * ${GRID_HAZE.max.toFixed(2)});
}`;

/** A drawn impostor: its mesh and the band share it draws at. */
export interface FarImpostorView { readonly mesh: Mesh; band: (share: number, shown: boolean) => void; dispose: () => void }

/** Install an impostor under a cell root. */
export function installFarImpostor(root: Object3D, data: FarImpostorData, decorate?: (material: Material) => void): FarImpostorView {
  const { row } = data, rows = Math.ceil(row.views / row.cols);
  const texture = new DataTexture(data.texels, data.width, data.height, RGBAFormat, UnsignedShort5551Type);
  texture.magFilter = LinearFilter; texture.minFilter = LinearFilter; texture.generateMipmaps = false; texture.needsUpdate = true; texture.name = 'far-impostor';
  gpuOnlyTexture(texture, 'far-impostor');
  const material = new ShaderMaterial({
    vertexShader: vertex, fragmentShader: fragment, fog: false, lights: false,
    uniforms: { uAtlas: { value: texture }, uGrid: { value: [row.cols, rows] }, uFrame: { value: [row.width, row.bottom, row.top, row.views] }, uRange: { value: row.range },
      uBand: { value: 0 }, farHazeColour: GRID_HAZE.colour },
  });
  material.name = 'far-impostor';
  decorate?.(material);
  // the quad is placed in the vertex shader: x across (−½ … ½ of the width), y up (0 … 1 of the span)
  const geometry = new PlaneGeometry(1, 1).translate(0, 0.5, 0);
  geometry.boundingBox = new Box3(new Vector3(-row.width / 2, row.bottom, -row.width / 2), new Vector3(row.width / 2, row.top, row.width / 2));
  geometry.boundingSphere = new Sphere(new Vector3(0, (row.bottom + row.top) / 2, 0), Math.hypot(row.width / 2, (row.top - row.bottom) / 2));
  const mesh = new Mesh(geometry, material);
  mesh.name = 'far-impostor'; mesh.castShadow = false; mesh.receiveShadow = false; mesh.matrixAutoUpdate = false; mesh.visible = false;
  mesh.updateMatrix(); root.add(mesh);
  const band = material.uniforms['uBand'];
  let disposed = false;
  return {
    mesh,
    band: (share, shown) => { if (band !== undefined) band.value = share; mesh.visible = shown && share > 0; },
    dispose: () => { if (disposed) return; disposed = true; mesh.removeFromParent(); geometry.dispose(); material.dispose(); texture.dispose(); },
  };
}
