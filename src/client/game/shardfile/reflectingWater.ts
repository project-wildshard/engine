/**
 * A pool's declared surface (meta TEMPLATES-CLEANROOM M4.1/M4.6, `@wildshard/format/pool-surface`): how its water draws.
 *
 * - `reflect: 'planar'` on the desktop tier: a mirror of the scene (three's `Reflector`, one extra scene draw per frame
 *   while the pool is in view, at `resolution` texels, 512 absent), its UVs rippled in world space, a Fresnel blend of the
 *   reflection over the deep `tint` (face-on `fresnel[0]`, rising by the power `fresnel[1]` toward grazing).
 * - `reflect: 'sky'`, and `planar` on the phone tier: the engine's default water surface (`defaultWaterMaterial`), opaque
 *   in `tint` with the surface's Fresnel and ripple: the look's sky and sun reflected, no second scene draw.
 *
 * The cleanroom pond this ports (mossgate-cleanroom `src/main.js`) is a 1024² reflector, tint `#3a3458`, Fresnel 0.35 +
 * 0.65·(1 − v·y)³; the milky pond it replaces was the default surface's 0.7 alpha over a fog-coloured sky.
 */
import { CircleGeometry, Color, Shape, ShapeGeometry, Vector2, type BufferGeometry, type Mesh, type ShaderMaterial } from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import type { PoolSurface } from '@wildshard/format/pool-surface';

/** the mirror's texels on a side when the surface names none */
export const DEFAULT_MIRROR_TEXELS = 512;
/** how far the mirror's clip plane sits under the water (metres): keeps the bank's foot out of its own reflection */
const CLIP_BIAS = 0.003;

/** A pool's outline in its own x / y plane (z negated, so a −90° turn about x lays it on the ground as declared). */
export function poolPlane(shape: { readonly kind: 'circle'; readonly x: number; readonly z: number; readonly radius: number } | { readonly kind: 'polygon'; readonly points: readonly (readonly [number, number])[] }): BufferGeometry {
  if (shape.kind === 'circle') return new CircleGeometry(shape.radius, 32).translate(shape.x, -shape.z, 0);
  return new ShapeGeometry(new Shape(shape.points.map(([x, z]) => new Vector2(x, -z))), 12);
}

const VERTEX = /* glsl */`
  uniform mat4 textureMatrix;
  varying vec4 vMirror; varying vec3 vWorld;
  void main() {
    vMirror = textureMatrix * vec4(position, 1.0);
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
// linear out (the composer tone-maps): the rippled mirror over the tint, by Fresnel
const FRAGMENT = /* glsl */`
  uniform sampler2D tDiffuse; uniform vec3 color; uniform float uTime; uniform vec3 uTint; uniform vec2 uFresnel; uniform vec3 uRipple;
  varying vec4 vMirror; varying vec3 vWorld;
  void main() {
    vec2 w = vWorld.xz * uRipple.x, t = vec2(uTime * uRipple.z);
    vec2 d = vec2(sin(w.x * 1.03 + t.x * 1.3) + sin(w.y * 0.77 - t.x * 0.9), cos(w.y * 1.23 + t.x * 1.1) + sin(w.x * 0.57 + w.y * 0.7 + t.x)) * uRipple.y;
    vec4 uv = vMirror; uv.xy += d * uv.w;
    vec3 mirror = texture2DProj(tDiffuse, uv).rgb * color;
    vec3 v = normalize(cameraPosition - vWorld);
    float fresnel = uFresnel.x + (1.0 - uFresnel.x) * pow(1.0 - max(v.y, 0.0), uFresnel.y);
    gl_FragColor = vec4(mix(uTint, mirror, fresnel), 1.0);
  }`;

/** A planar-reflecting pool: a `Reflector` laid on the ground at `level`; `tick(dt)` runs its ripples on the game clock. */
export function mirrorPool(shape: Parameters<typeof poolPlane>[0], level: number, surface: PoolSurface): { mesh: Mesh; tick: (dt: number) => void; dispose: () => void } {
  const texels = surface.resolution ?? DEFAULT_MIRROR_TEXELS;
  const mirror = new Reflector(poolPlane(shape), {
    textureWidth: texels, textureHeight: texels, clipBias: CLIP_BIAS, multisample: 0,
    // a faint cool cast on the mirror, as the cleanroom's (0.82, 0.76, 0.84)
    color: new Color(0.82, 0.78, 0.86),
    shader: {
      name: 'engine.water.mirror',
      uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null }, uTime: { value: 0 },
        uTint: { value: new Color().setRGB(surface.tint[0], surface.tint[1], surface.tint[2]) },
        uFresnel: { value: new Vector2(surface.fresnel[0], surface.fresnel[1]) },
        uRipple: { value: [surface.ripple.scale, surface.ripple.amplitude, surface.ripple.speed] } },
      vertexShader: VERTEX, fragmentShader: FRAGMENT,
    },
  });
  mirror.rotation.x = -Math.PI / 2;
  mirror.position.y = level;
  mirror.updateMatrixWorld();
  const material = mirror.material as ShaderMaterial, time = material.uniforms['uTime'];
  let clock = 0;
  const tick = (dt: number): void => { clock += dt; if (time !== undefined) time.value = clock; };
  return { mesh: mirror, tick, dispose: () => { mirror.dispose(); mirror.geometry.dispose(); } };
}
