/**
 * A shard's haze band under the one frame (SHARD-PLATFORM SF19b, G94 / G95): a shard that declares a `band` in its far
 * look (Signal Dunes' warm dusk dust) shows its mood from the road through a tall band of its own haze rising from the
 * strip at its border, never a second sky. Drawn wherever the grid builds its one frame (G175). Under G158 the band
 * is the outside half of the shard's mood: on the road the neutral road look owns the frame, so the band is what reads
 * as Signal Dunes' dusk from there; once the player crosses its cell edge Signal Dunes owns the whole frame (its
 * declared air and grade, `frame.ts`) and the band is the dust wall it walked through.
 *
 * One draw per banded shard: a curtain quad on each of the cell's four edges, out at the kerb, unlit, dense at the
 * ground and thinning upward in soft vertical wisps, faded out near the camera so a traveller walks through it. It blends
 * colour only and keeps the destination alpha (a level may keep data there; the frame no longer reads it).
 */
import { BufferAttribute, BufferGeometry, Color, CustomBlending, DoubleSide, Mesh, OneFactor, OneMinusSrcAlphaFactor, ShaderMaterial, SrcAlphaFactor, ZeroFactor, type Object3D } from 'three';
import type { FarBand } from '../../../shared/game/grid/farProxy';

/**
 * How far (m) the band stands out from the cell edge into the strip: 2 m short of the road's kerb (the deck is the strip's
 * middle 15 m of 55), on the flat neutral buffer, so the gradient and a wall never hide its foot from the road.
 */
export const BAND_OUTSET = 18;

const vertex = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;
const fragment = /* glsl */ `
uniform vec3 uColour;
uniform float uOpacity;
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  float h = clamp(vUv.y, 0.0, 1.0);
  float rise = pow(1.0 - h, 1.5);
  float wisp = 0.72 + 0.28 * sin(vUv.x * 0.041 + 3.0 * sin(vUv.x * 0.011) + h * 2.3) * (0.6 + 0.4 * sin(vUv.x * 0.13 + h * 5.0));
  float near = smoothstep(2.0, 12.0, length(vWorld.xz - cameraPosition.xz));
  float a = uOpacity * rise * wisp * near;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColour * (1.0 + 0.25 * (1.0 - h)), a);
}`;

/** The band's curtain: four edge quads around a cell of half size `half`, `height` m tall; uv = (metres along, 0..1 up). */
export function bandGeometry(half: number, height: number): BufferGeometry {
  const r = half + BAND_OUTSET, corners = [[-r, -r], [r, -r], [r, r], [-r, r]] as const;
  const position: number[] = [], uv: number[] = [], index: number[] = [];
  corners.forEach(([x0, z0], side) => {
    const [x1, z1] = corners[(side + 1) % 4] ?? corners[0], base = position.length / 3, along = side * 2 * r;
    position.push(x0, 0, z0, x1, 0, z1, x1, height, z1, x0, height, z0);
    uv.push(along, 0, along + 2 * r, 0, along + 2 * r, 1, along, 1);
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  const geometry = new BufferGeometry().setAttribute('position', new BufferAttribute(Float32Array.from(position), 3)).setAttribute('uv', new BufferAttribute(Float32Array.from(uv), 2));
  geometry.setIndex(index); geometry.computeBoundingSphere();
  return geometry;
}

/** The band's material: colour blended over, destination alpha kept. */
export function bandMaterial(band: FarBand): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: vertex, fragmentShader: fragment, side: DoubleSide, transparent: true, depthWrite: false, fog: false, lights: false,
    uniforms: { uColour: { value: new Color(...band.colour) }, uOpacity: { value: Math.min(1, Math.max(0, band.opacity)) } },
    blending: CustomBlending, blendSrc: SrcAlphaFactor, blendDst: OneMinusSrcAlphaFactor, blendSrcAlpha: ZeroFactor, blendDstAlpha: OneFactor,
  });
}

/** Install a shard's band under its cell root (centred on the cell); returns its disposer. */
export function installHazeBand(root: Object3D, band: FarBand, half: number): () => void {
  const geometry = bandGeometry(half, band.height), material = bandMaterial(band), mesh = new Mesh(geometry, material);
  mesh.name = 'haze-band'; mesh.castShadow = false; mesh.receiveShadow = false; mesh.renderOrder = 2; mesh.matrixAutoUpdate = false; mesh.updateMatrix();
  root.add(mesh);
  let disposed = false;
  return () => { if (disposed) return; disposed = true; mesh.removeFromParent(); geometry.dispose(); material.dispose(); };
}
