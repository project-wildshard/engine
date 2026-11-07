import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Sphere, Vector3 } from 'three';

export interface SlashTrailProfile { samples: number; subdivisions: number; movementSq: number; channel: 'age' | 'alpha' }

/** A point-following trail: null cadence appends accepted points; timed
 * sampling keeps newest-first history for a camera-facing ribbon. */
export interface FollowTrailProfile {
  readonly kind: 'fx.trail'; readonly points: number;
  readonly every: number | null; readonly movementSq: number;
}
/** Client-only point sampling shared by world ribbons and projected lines.
 * Rendering, material ownership and source clocks remain with their hosts. */
export class FollowPointTrail {
  readonly head: Vector3 = new Vector3(); readonly previous: Vector3 = new Vector3();
  private readonly history: Vector3[];
  private clock = 0; private seeded = false;
  private readonly profile: FollowTrailProfile;
  count = 0;
  constructor(profile: FollowTrailProfile) {
    if (!Number.isInteger(profile.points) || profile.points < 2 || profile.points > 2048
      || !Number.isFinite(profile.movementSq) || profile.movementSq < 0
      || (profile.every !== null && (!Number.isFinite(profile.every) || profile.every <= 0))) throw new RangeError('Invalid point trail profile');
    this.profile = profile;
    this.history = profile.every === null ? [] : Array.from({ length: profile.points }, () => new Vector3());
  }
  /** Retain the sampling-clock remainder across despawn, as across frames. */
  reset(): void { this.count = 0; this.seeded = false; }
  follow(point: Vector3, alive: boolean, dt: number): boolean {
    if (!alive) { this.reset(); return false; }
    if (this.profile.every === null) {
      if (this.count >= this.profile.points || (this.count > 0 && point.distanceToSquared(this.head) < this.profile.movementSq)) return false;
      this.previous.copy(this.head); this.head.copy(point); this.count++; return true;
    }
    if (!this.seeded) { for (const p of this.history) p.copy(point); this.seeded = true; this.count = this.profile.points; }
    this.clock += dt;
    if (this.clock >= this.profile.every) { this.clock = 0; for (let i = this.history.length - 1; i > 0; i--) this.history[i]?.copy(this.history[i - 1] ?? point); }
    this.history[0]?.copy(point); return true;
  }
  /** Write the same indexed two-vertex strip each frame, in its local frame. */
  face(camera: Vector3, width: number, minimum: number, positions: Float32Array): void {
    if (this.history.length === 0 || positions.length !== this.history.length * 6) throw new RangeError('Point trail requires a ribbon buffer');
    for (let i = 0; i < this.history.length; i++) {
      const p = this.history[i]; if (p === undefined) break;
      const q = this.history[Math.min(this.history.length - 1, i + 1)] ?? p;
      this.previous.subVectors(p, q); if (this.previous.lengthSq() < 1e-6) this.previous.set(0, 0, 1);
      this.head.subVectors(camera, p).crossVectors(this.previous, this.head).normalize().multiplyScalar(width * (1 - i / (this.history.length - 1)) * 0.5 + minimum);
      positions.set([p.x + this.head.x, p.y + this.head.y, p.z + this.head.z, p.x - this.head.x, p.y - this.head.y, p.z - this.head.z], i * 6);
    }
  }
}

/** Shared blade-sample ring and Catmull-Rom ribbon; callers supply their material and age/alpha profile. */
export class SlashTrail {
  /** Point-following profile alongside the existing two-point blade ribbon. */
  static follow(profile: FollowTrailProfile): FollowPointTrail { return new FollowPointTrail(profile); }
  readonly geometry: BufferGeometry = new BufferGeometry();
  readonly pos: BufferAttribute;
  readonly value: BufferAttribute;
  readonly uv: BufferAttribute | null;
  private readonly A: Float32Array;
  private readonly B: Float32Array;
  private readonly T: Float32Array;
  private head = 0;
  count = 0;
  private readonly a0 = new Vector3(); private readonly b0 = new Vector3();
  private readonly a1 = new Vector3(); private readonly b1 = new Vector3();

  private readonly profile: SlashTrailProfile;
  constructor(profile: SlashTrailProfile) {
    this.profile = profile;
    const quads = (profile.samples - 1) * profile.subdivisions;
    this.A = new Float32Array(profile.samples * 3); this.B = new Float32Array(profile.samples * 3);
    this.T = new Float32Array(profile.samples).fill(-1);
    this.pos = new BufferAttribute(new Float32Array(quads * 6 * 3), 3).setUsage(DynamicDrawUsage);
    this.value = new BufferAttribute(new Float32Array(quads * 6), 1).setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('position', this.pos);
    this.geometry.setAttribute(profile.channel === 'age' ? 'aAge' : 'aAlpha', this.value);
    if (profile.channel === 'age') {
      this.uv = new BufferAttribute(new Float32Array(quads * 6 * 2), 2).setUsage(DynamicDrawUsage);
      this.geometry.setAttribute('aUv', this.uv);
    } else {
      this.uv = null;
      const edge = new Float32Array(quads * 6);
      for (let q = 0; q < quads; q++) { edge[q * 6] = 0; edge[q * 6 + 1] = 1; edge[q * 6 + 2] = 1; edge[q * 6 + 3] = 0; edge[q * 6 + 4] = 1; edge[q * 6 + 5] = 0; }
      this.geometry.setAttribute('aEdge', new BufferAttribute(edge, 1));
    }
    this.geometry.boundingSphere = new Sphere(new Vector3(), 1e6);
    this.geometry.setDrawRange(0, 0);
  }
  get newest(): number { return this.T[(this.head - 1 + this.profile.samples) % this.profile.samples] ?? -1; }
  reset(): void { this.count = 0; }
  sample(inner: Vector3, tip: Vector3, time: number): void {
    if (this.count > 0) {
      const l = (this.head - 1 + this.profile.samples) % this.profile.samples;
      const dx = tip.x - (this.B[l * 3] ?? 0), dy = tip.y - (this.B[l * 3 + 1] ?? 0), dz = tip.z - (this.B[l * 3 + 2] ?? 0);
      if (dx * dx + dy * dy + dz * dz < this.profile.movementSq) return;
    }
    const i = this.head;
    this.head = (this.head + 1) % this.profile.samples;
    this.count = Math.min(this.profile.samples, this.count + 1);
    this.A.set([inner.x, inner.y, inner.z], i * 3); this.B.set([tip.x, tip.y, tip.z], i * 3); this.T[i] = time;
  }
  private idx(k: number): number { const c = k < 0 ? 0 : k >= this.count ? this.count - 1 : k; return (this.head - this.count + c + this.profile.samples) % this.profile.samples; }

  private cr(src: Float32Array, k: number, u: number, out: Vector3): Vector3 {
    const i0 = this.idx(k - 1) * 3, i1 = this.idx(k) * 3, i2 = this.idx(k + 1) * 3, i3 = this.idx(k + 2) * 3;
    const u2 = u * u, u3 = u2 * u;
    const b0 = -0.5 * u3 + u2 - 0.5 * u, b1 = 1.5 * u3 - 2.5 * u2 + 1, b2 = -1.5 * u3 + 2 * u2 + 0.5 * u, b3 = 0.5 * u3 - 0.5 * u2;
    return out.set(
      (src[i0] ?? 0) * b0 + (src[i1] ?? 0) * b1 + (src[i2] ?? 0) * b2 + (src[i3] ?? 0) * b3,
      (src[i0 + 1] ?? 0) * b0 + (src[i1 + 1] ?? 0) * b1 + (src[i2 + 1] ?? 0) * b2 + (src[i3 + 1] ?? 0) * b3,
      (src[i0 + 2] ?? 0) * b0 + (src[i1 + 2] ?? 0) * b1 + (src[i2 + 2] ?? 0) * b2 + (src[i3 + 2] ?? 0) * b3,
    );
  }

  /** Rebuild in the caller's clock domain; return whether any gap remains live. */
  rebuild(time: number, life: number, alpha = 1): boolean {
    const P = this.pos.array, V = this.value.array, U = this.uv?.array;
    const { a0, b0, a1, b1 } = this;
    let q = 0, live = 0, dist = 0;
    const age = this.profile.channel === 'age';
    for (let k = 0; k < this.count - 1; k++) {
      const t0 = this.T[this.idx(k)] ?? 0, t1 = this.T[this.idx(k + 1)] ?? 0;
      const g0 = age ? Math.min(1, (time - t0) / life) : Math.min(1, Math.max(0, 1 - (time - t0) / life));
      const g1 = age ? Math.min(1, (time - t1) / life) : Math.min(1, Math.max(0, 1 - (time - t1) / life));
      if (age ? g0 >= 1 && g1 >= 1 : g0 <= 0 && g1 <= 0) continue;
      live++;
      for (let s = 0; s < this.profile.subdivisions; s++) {
        const u0 = s / this.profile.subdivisions, u1 = (s + 1) / this.profile.subdivisions;
        this.cr(this.A, k, u0, a0); this.cr(this.B, k, u0, b0);
        this.cr(this.A, k, u1, a1); this.cr(this.B, k, u1, b1);
        const ga = (g0 + (g1 - g0) * u0) * alpha, gb = (g0 + (g1 - g0) * u1) * alpha;
        const d0 = dist, d1 = dist + b0.distanceTo(b1); dist = d1;
        const o = q * 18, ou = q * 12, ov = q * 6;
        const put = (j: number, p: Vector3, x: number, y: number, value: number): void => {
          P[o + j * 3] = p.x; P[o + j * 3 + 1] = p.y; P[o + j * 3 + 2] = p.z;
          if (U !== undefined) { U[ou + j * 2] = x; U[ou + j * 2 + 1] = y; }
          V[ov + j] = value;
        };
        const innerA = age ? ga : ga * ga / Math.max(alpha, 1e-3), innerB = age ? gb : gb * gb / Math.max(alpha, 1e-3);
        put(0, a0, 0, d0, innerA); put(1, b0, 1, d0, ga); put(2, b1, 1, d1, gb);
        put(3, a0, 0, d0, innerA); put(4, b1, 1, d1, gb); put(5, a1, 0, d1, innerB);
        q++;
      }
    }
    this.geometry.setDrawRange(0, q * 6);
    if (live > 0) { this.pos.needsUpdate = true; this.value.needsUpdate = true; if (this.uv !== null) this.uv.needsUpdate = true; }
    return live > 0;
  }
  dispose(): void { this.geometry.dispose(); }
}
