/**
 * A look's render-match draws (meta TEMPLATES-CLEANROOM M4.7/M4.8, `@wildshard/format/look-render`): what a cleanroom
 * three.js scene adds round its lamps and in its air, and the exposure its renderer applies before tone mapping.
 *
 * - `lampHalos`: one instanced, additive, unfogged billboard per lamp that declares a `halo` (one draw, one program).
 * - `lookMotes`: fireflies, sparks or dust, one additive points draw; each mote wanders round its seed point and breathes.
 * - `ExposureEffect`: `2^exposure` on the scene's linear colour, ahead of the tone curve (`look.grade.exposure`, in stops;
 *   0 adds no effect).
 */
import * as THREE from 'three';
import { Effect } from 'postprocessing';
import type { LookLamp } from '@wildshard/format/look-light';
import type { LookMotes } from '@wildshard/format/look-render';

const linear = (rgb: readonly [number, number, number]): THREE.Color => new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2], THREE.LinearSRGBColorSpace);

/** The halos of the lamps that declare one; null when none does. Each lamp's halo is its colour × `opacity`, `size` m across. */
export function lampHalos(lamps: readonly LookLamp[]): THREE.InstancedMesh<THREE.PlaneGeometry, THREE.ShaderMaterial> | null {
  const glowing = lamps.filter((lamp) => lamp.halo !== undefined);
  if (glowing.length === 0) return null;
  const geometry = new THREE.PlaneGeometry(1, 1), glow = new Float32Array(glowing.length * 3);
  glowing.forEach((lamp, i) => { const c = linear(lamp.colour).multiplyScalar(lamp.halo?.opacity ?? 0); glow.set([c.r, c.g, c.b], i * 3); });
  geometry.setAttribute('aGlow', new THREE.InstancedBufferAttribute(glow, 3));
  const material = new THREE.ShaderMaterial({
    name: 'engine.look.halos', transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      attribute vec3 aGlow; varying vec3 vGlow; varying vec2 vDisc;
      void main() {
        vGlow = aGlow; vDisc = position.xy * 2.0;
        vec4 centre = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float size = length(instanceMatrix[0].xyz);
        centre.xy += position.xy * size;
        gl_Position = projectionMatrix * centre;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vGlow; varying vec2 vDisc;
      void main() { float r = clamp(1.0 - length(vDisc), 0.0, 1.0); gl_FragColor = vec4(vGlow * r * r * r, 1.0); }`,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, glowing.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  glowing.forEach((lamp, i) => { const size = lamp.halo?.size ?? 1; mesh.setMatrixAt(i, m.compose(p.set(lamp.at[0], lamp.at[1], lamp.at[2]), q, s.set(size, size, size))); });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.name = 'look-light-halos'; mesh.renderOrder = 2; mesh.castShadow = false; mesh.receiveShadow = false; mesh.frustumCulled = false;
  return mesh;
}

/** a mote's wander (metres) round its seed point */
const MOTE_WANDER = 0.45;

/** The look's motes: `count` points seeded (fixed, so a capture repeats) through the box, one additive draw; they move on
 *  the look's clock (`tickGlow`). */
export function lookMotes(motes: LookMotes): THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> {
  const at = new Float32Array(motes.count * 3), seed = new Float32Array(motes.count);
  let s = 0x2f6b1d;
  const next = (): number => { s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x297a2d39) >>> 0; return s / 4294967296; };
  for (let i = 0; i < motes.count; i++) {
    for (let k = 0; k < 3; k++) at[i * 3 + k] = (motes.min[k] ?? 0) + ((motes.max[k] ?? 0) - (motes.min[k] ?? 0)) * next();
    seed[i] = next() * 100;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(at, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const material = new THREE.ShaderMaterial({
    name: 'engine.look.motes', transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uColour: { value: linear(motes.colour).multiplyScalar(motes.gain) }, uSize: { value: motes.size }, uScale: { value: 500 } },
    vertexShader: /* glsl */`
      uniform float uTime, uSize, uScale; attribute float aSeed; varying float vBreath;
      void main() {
        vec3 p = position + vec3(sin(uTime * 0.31 + aSeed), sin(uTime * 0.23 + aSeed * 1.7) * 0.6, cos(uTime * 0.27 + aSeed * 0.7)) * ${MOTE_WANDER.toFixed(2)};
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vBreath = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * 1.7 + aSeed * 3.1), 2.0);
        gl_PointSize = max(1.0, uSize * uScale / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColour; varying float vBreath;
      void main() { float r = clamp(1.0 - length(gl_PointCoord * 2.0 - 1.0), 0.0, 1.0); gl_FragColor = vec4(uColour * vBreath * r * r, 1.0); }`,
  });
  const points = new THREE.Points(geometry, material);
  points.name = 'look-light-motes'; points.frustumCulled = false; points.renderOrder = 2;
  const size = new THREE.Vector2();
  points.onBeforeRender = (renderer, _scene, camera) => {
    const scale = material.uniforms['uScale'];
    // pixels per metre at 1 m: the drawing buffer's height over the view's vertical extent
    if (scale !== undefined && camera instanceof THREE.PerspectiveCamera) scale.value = renderer.getDrawingBufferSize(size).y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  };
  return points;
}

/** Set the look's clock (seconds since the look went in) on its glow draws (the motes' wander and breath). */
export function tickGlow(draws: readonly THREE.Object3D[], time: number): void {
  for (const draw of draws) {
    const material = (draw as Partial<THREE.Mesh>).material;
    if (material instanceof THREE.ShaderMaterial) { const uTime = material.uniforms['uTime']; if (uTime !== undefined) uTime.value = time; }
  }
}

/** `look.grade.exposure` (stops) on the scene's linear colour, ahead of the tone curve. */
export class ExposureEffect extends Effect {
  constructor(stops: number) {
    super('ExposureEffect', 'uniform float uExposure; void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) { outputColor = vec4(inputColor.rgb * uExposure, inputColor.a); }',
      { uniforms: new Map([['uExposure', new THREE.Uniform(2 ** stops)]]) });
  }
}
