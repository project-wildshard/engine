import * as THREE from 'three';
import { fxMaterial, annulus, FX, type FxMaterial } from './groundFx';
import { terrainHeight as heightAt } from '../../../shared/engine/world/terrainHeight';
import { resourceScope } from '../../../shared/engine/app/resources';

/**
 * GroundTell — a terrain-draped telegraph decal (a ring at your feet, a lane across the grass), drawn over the grass
 * (depth test off: a tell must never hide) with the shared FX program. `ring(x, z, r, alpha)` / `lane(x0, z0, x1, z1,
 * width, alpha)` re-drape it (≤ 130 heightAt calls — only when it moves); `hide()`.
 */
/** Wedge-specific shader parameters are authored by the caller; geometry/draping is shared. */
export interface GroundTellWedgeStyle {
  cone: number;
  material: THREE.Material;
  /** the fill (0 at the feet .. 1 at the tip) and opacity the material reads: a uniform, or a port onto a look's params */
  fill: { value: number };
  alpha: { value: number };
}

export class GroundTell {
  readonly mesh: THREE.Mesh;
  private readonly mat: FxMaterial | null;
  private readonly base: Float32Array;
  private readonly pos: THREE.BufferAttribute;
  private readonly wedgeStyle: GroundTellWedgeStyle | undefined;
  constructor(scene: THREE.Scene, kind: 'ring' | 'lane' | 'wedge', color: THREE.ColorRepresentation, wedgeStyle?: GroundTellWedgeStyle) {
    this.wedgeStyle = wedgeStyle;
    const scope = resourceScope();
    if (scope.disposed || scope.disposing) throw new Error('Retired tell owner');
    let g: THREE.BufferGeometry;
    if (kind === 'ring') g = annulus(0.86, 1, 64);
    else if (kind === 'wedge') {
      if (wedgeStyle === undefined) throw new Error('GroundTell wedge needs a shader profile');
      const R = 7, N = 14, uv: number[] = [], idx: number[] = [];
      for (let r = 0; r <= R; r++) for (let n = 0; n <= N; n++) uv.push(n / N, r / R);
      for (let r = 0; r < R; r++) for (let n = 0; n < N; n++) { const a = r * (N + 1) + n, b = a + N + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
      g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(uv.length / 2 * 3), 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    } else {
      // a unit lane: x across (−0.5..0.5), z along (0..1); uv.x along, uv.y across (the ring look: a bright band)
      const seg = 24, P: number[] = [], U: number[] = [], N: number[] = [], I: number[] = [];
      for (let i = 0; i <= seg; i++) { const z = i / seg; P.push(-0.5, 0, z, 0.5, 0, z); U.push(z, 0, z, 1); N.push(0, 1, 0, 0, 1, 0); if (i < seg) { const k = i * 2; I.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); } }
      g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setIndex(I);
    }
    this.pos = g.getAttribute('position') as THREE.BufferAttribute;
    this.pos.setUsage(THREE.DynamicDrawUsage);
    this.base = new Float32Array(this.pos.array);
    if (kind === 'wedge' && wedgeStyle !== undefined) {
      this.mat = null;
      const R = 7, N = 14;
      for (let r = 0; r <= R; r++) for (let n = 0; n <= N; n++) {
        const a = (n / N - 0.5) * 2 * wedgeStyle.cone, rr = r / R, i = r * (N + 1) + n;
        // Retain the legacy two-component Float32 rounding before reach/yaw application.
        this.base[i * 3] = Math.sin(a) * rr; this.base[i * 3 + 2] = Math.cos(a) * rr;
      }
      this.mesh = new THREE.Mesh(g, wedgeStyle.material);
      this.mesh.renderOrder = 9;
    } else {
      this.mat = fxMaterial(FX.ring, color, 0);
      this.mat.uniforms.uP.value.x = kind === 'ring' ? 0.8 : 0.6;
      this.mat.depthTest = kind !== 'ring';
      this.mesh = new THREE.Mesh(g, this.mat);
      this.mesh.renderOrder = 30;
    }
    this.mesh.frustumCulled = false; this.mesh.visible = false;
    scope.own(g); if (this.mat !== null) scope.own(this.mat);
    scope.onDispose(() => { this.mesh.removeFromParent(); });
    scene.add(this.mesh);
  }
  setTime(t: number): void { if (this.mat !== null) this.mat.uniforms.uTime.value = t; }
  hide(): void { this.mesh.visible = false; }
  ring(x: number, z: number, r: number, alpha: number, lift = 0.35): void {
    const b = this.base, P = this.pos;
    for (let i = 0; i < P.count; i++) { const lx = (b[i * 3] ?? 0) * r, lz = (b[i * 3 + 2] ?? 0) * r; P.setXYZ(i, x + lx, heightAt(x + lx, z + lz) + lift, z + lz); }
    P.needsUpdate = true; this.show(alpha);
  }
  lane(x0: number, z0: number, x1: number, z1: number, width: number, alpha: number, lift = 0.35): void {
    const b = this.base, P = this.pos, dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz) || 1, ax = -dz / L, az = dx / L;
    for (let i = 0; i < P.count; i++) {
      const across = (b[i * 3] ?? 0) * width, along = b[i * 3 + 2] ?? 0;
      const x = x0 + dx * along + ax * across, z = z0 + dz * along + az * across;
      P.setXYZ(i, x, heightAt(x, z) + lift, z);
    }
    P.needsUpdate = true; this.show(alpha);
  }
  /** Animal yaw convention: forward = (sin, cos); fill runs from the feet toward the tip. */
  wedge(x: number, z: number, yaw: number, reach: number, fill: number, alpha: number, lift = 0.06): void {
    const profile = this.wedgeStyle;
    if (profile === undefined) throw new Error('GroundTell is not a wedge');
    const c = Math.cos(yaw), s = Math.sin(yaw), p = this.pos.array;
    for (let i = 0; i < this.pos.count; i++) {
      const lx = (this.base[i * 3] ?? 0) * reach, lz = (this.base[i * 3 + 2] ?? 0) * reach;
      const wx = x + lx * c + lz * s, wz = z - lx * s + lz * c;
      p[i * 3] = wx; p[i * 3 + 1] = heightAt(wx, wz) + lift; p[i * 3 + 2] = wz;
    }
    this.pos.needsUpdate = true; profile.fill.value = fill; profile.alpha.value = alpha; this.mesh.visible = true;
  }
  private show(alpha: number): void { if (this.mat !== null) this.mat.uniforms.uAlpha.value = alpha; this.mesh.visible = alpha > 0.01; }
}
