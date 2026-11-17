import * as THREE from 'three';
import type { SpriteViews } from '../render/spriteViews';

/**
 * ONE-FORMAT CC55: far sprites. Past the far distance a creature draws as a card from its baked views: the rest pose
 * rendered once from `views` bearings round it into one atlas row, then every far animal of the model is one instance of
 * one upright, camera-facing card that picks the view nearest its bearing from the camera. One draw for the whole herd,
 * no skeleton, no pose; it lets the phone show a herd at 150 to 300 m, where it hid them (tier `animalHideDist`). The
 * views are shot by `render/spriteViews.ts`.
 */

/** The view an animal facing `yaw` shows a camera in direction (`toCamX`, `toCamZ`) from it: view v was shot from
 *  bearing v · 2π / views in the animal's own frame (0 = from +z, its front for a rig facing +z). */
export function spriteView(toCamX: number, toCamZ: number, yaw: number, views: number): number {
  const step = (Math.PI * 2) / views, a = Math.atan2(toCamX, toCamZ) - yaw;
  return ((Math.round(a / step) % views) + views) % views;
}

const VERTEX = /* glsl */ `
uniform float spriteViews;
attribute float spriteYaw;
varying vec2 vUv;
void main() {
  vec4 centre = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float scale = length(instanceMatrix[0].xyz);
  vec2 toCam = cameraPosition.xz - centre.xz;
  float len = max(length(toCam), 1e-4);
  vec3 right = vec3(toCam.y / len, 0.0, -toCam.x / len);
  vec3 world = centre.xyz + right * position.x * scale + vec3(0.0, position.y * scale, 0.0);
  float step = 6.28318530718 / spriteViews;
  float v = mod(floor((atan(toCam.x, toCam.y) - spriteYaw) / step + 0.5), spriteViews);
  vUv = vec2((v + uv.x) / spriteViews, uv.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`;
const FRAGMENT = /* glsl */ `
uniform sampler2D spriteMap;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(spriteMap, vUv);
  if (c.a < 0.5) discard;
  gl_FragColor = vec4(c.rgb / c.a, 1.0); // the views were shot over clear black: filtered texels are premultiplied
  #include <colorspace_fragment>
}`;

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();

/** One model's far herd as cards: `capacity` instances of one card, one draw. */
export class HerdSprites {
  readonly mesh: THREE.InstancedMesh;
  private readonly yaw: THREE.InstancedBufferAttribute;
  private dirty = true;

  constructor(views: SpriteViews, capacity: number) {
    const geometry = new THREE.PlaneGeometry(views.width, views.height);
    geometry.translate(0, views.height / 2 + views.offsetY, 0);
    this.yaw = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    geometry.setAttribute('spriteYaw', this.yaw);
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, views.height / 2 + views.offsetY, 0), Math.hypot(views.width, views.height));
    const material = new THREE.ShaderMaterial({
      uniforms: { spriteMap: { value: views.texture }, spriteViews: { value: views.views } },
      vertexShader: VERTEX, fragmentShader: FRAGMENT, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.count = 0;
  }

  /** Card `i` stands at `position`, its animal facing `yaw`, `scale`d. */
  place(i: number, position: THREE.Vector3, yaw: number, scale: number): void {
    _m.compose(position, _q.identity(), _s.setScalar(scale));
    this.mesh.setMatrixAt(i, _m);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.yaw.setX(i, yaw);
    this.yaw.needsUpdate = true;
    if (i >= this.mesh.count) this.mesh.count = i + 1;
    this.dirty = true;
  }

  /** Draw only the first `n` cards. */
  setCount(n: number): void { if (n !== this.mesh.count) { this.mesh.count = n; this.dirty = true; } }

  update(): void { if (this.dirty) { this.mesh.computeBoundingSphere(); this.dirty = false; } }

  dispose(): void {
    this.mesh.geometry.dispose();
    for (const m of Array.isArray(this.mesh.material) ? this.mesh.material : [this.mesh.material]) m.dispose();
  }
}
