import * as THREE from 'three';
import type { Projectiles } from './projectile';
import { sstep } from '../../player/viewmodelTextures';

const ARC_MAX = 56, ARC_SPACING = 0.8, ARC_SKIP = 0.5, ARC_BLEND = 11;
const _up = new THREE.Vector3(0, 1, 0);
export class DropArc {
  readonly points: THREE.Points;
  readonly ring: THREE.Mesh;
  private readonly buf = new Float32Array(ARC_MAX * 3);
  private readonly attr: THREE.BufferAttribute;
  private readonly uAlpha: THREE.IUniform<number> = { value: 0 };
  private readonly uPx: THREE.IUniform<number> = { value: 6 };
  private readonly ringMat: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene, colour: number) {
    const g = new THREE.BufferGeometry();
    this.attr = new THREE.BufferAttribute(this.buf, 3); this.attr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.attr);
    g.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uAlpha: this.uAlpha, uPx: this.uPx, uColor: { value: new THREE.Color(colour) } },
      vertexShader: `uniform float uPx; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = uPx * clamp(8.0 / max(0.1, -mv.z), 0.6, 1.0); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float uAlpha; uniform vec3 uColor; void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d) * 2.0; if (r > 1.0) discard; gl_FragColor = vec4(uColor, uAlpha * (1.0 - smoothstep(0.55, 1.0, r))); }`,
      transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false; this.points.renderOrder = 998; this.points.visible = false; // under the viewmodel (999 clears depth, 1000 draws it)
    this.ringMat = new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false, fog: false, side: THREE.DoubleSide });
    const rg = new THREE.RingGeometry(0.62, 1, 36); rg.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(rg, this.ringMat);
    this.ring.frustumCulled = false; this.ring.renderOrder = 998; this.ring.visible = false;
    scene.add(this.points, this.ring);
  }

  hide(): void { this.points.visible = false; this.ring.visible = false; }

  /** `from` = where the dots start (the nocked arrow's tip): the arc leaves the bow like the mockup's and blends onto the
   *  true flight over ARC_BLEND m — seen from the eye the true path is almost end-on, a stroke under the crosshair. The
   *  landing ring is the true landing point. */
  show(arrows: Projectiles, origin: THREE.Vector3, vel: THREE.Vector3, from: THREE.Vector3, alpha: number, camPos: THREE.Vector3, dpr: number): void {
    const n = arrows.predict(origin, vel, this.buf, ARC_MAX, ARC_SPACING, ARC_SKIP);
    const ox = from.x - origin.x, oy = from.y - origin.y, oz = from.z - origin.z, b = this.buf;
    for (let i = 0; i < n; i++) {
      const j = i * 3;
      const px = b[j] ?? 0, py = b[j + 1] ?? 0, pz = b[j + 2] ?? 0;
      const d = Math.hypot(px - origin.x, py - origin.y, pz - origin.z);
      const k = 1 - sstep(0, ARC_BLEND, d);
      b[j] = px + ox * k; b[j + 1] = py + oy * k; b[j + 2] = pz + oz * k;
    }
    this.attr.clearUpdateRanges(); this.attr.addUpdateRange(0, n * 3); this.attr.needsUpdate = true;
    this.points.geometry.setDrawRange(0, n);
    this.uAlpha.value = alpha * 0.85; this.uPx.value = 8.5 * dpr;
    this.points.visible = n > 0;
    this.ring.visible = arrows.landed;
    if (arrows.landed) {
      const d = arrows.landing.distanceTo(camPos);
      this.ring.position.copy(arrows.landing).addScaledVector(arrows.landingNormal, 0.05);
      this.ring.quaternion.setFromUnitVectors(_up, arrows.landingNormal);
      this.ring.scale.setScalar(0.2 + d * 0.013);
      this.ringMat.opacity = alpha * 0.85;
    }
  }
}
