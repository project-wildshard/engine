/** Client-only native grapple rope and ribbon presentation, selected by look ids. */
import {
  BufferGeometryLoader, Mesh, Vector2, Vector3, CustomBlending, AddEquation, OneFactor, ZeroFactor,
} from 'three';
import { lentLook, setLentParam } from '../shardfile/lentLooks';
import { uniformsFrom } from '../plugin/shaderFamily';
import type { GrappleFilamentUniforms } from '@wildshard/format/grapple';


export class Rope {
  readonly n: number;
  readonly p: Float32Array;
  private readonly q: Float32Array;
  private live = false;
  /** how long the line is allowed to be, as a factor of the anchor distance */
  slack = 1.1;
  gravity = 9.8;
  damping = 0.985;
  /** 0..1: how stiffly the first nodes leave the muzzle (the line is fed out under tension, it never droops there) */
  feed = 0.6;

  constructor(n = 24) {
    if (!Number.isInteger(n) || n < 2 || n > 128) throw new Error('Invalid grapple rope size');
    this.n = n;
    this.p = new Float32Array(n * 3);
    this.q = new Float32Array(n * 3);
  }

  get active(): boolean { return this.live; }

  /** lay the rope out straight from a to b (the moment the claw leaves the muzzle) */
  reset(a: Vector3, b: Vector3): void {
    for (let i = 0; i < this.n; i++) {
      const t = i / (this.n - 1);
      const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, z = a.z + (b.z - a.z) * t;
      this.p[i * 3] = this.q[i * 3] = x;
      this.p[i * 3 + 1] = this.q[i * 3 + 1] = y;
      this.p[i * 3 + 2] = this.q[i * 3 + 2] = z;
    }
    this.live = true;
  }

  off(): void { this.live = false; }

  /** one fixed step: integrate, then satisfy the segment lengths with both ends pinned */
  step(dt: number, a: Vector3, b: Vector3): void {
    if (!this.live) return;
    const n = this.n, p = this.p, q = this.q;
    const g = this.gravity * dt * dt;
    for (let i = 1; i < n - 1; i++) {
      const k = i * 3;
      for (let c = 0; c < 3; c++) {
        const x = p[k + c] ?? 0, px = q[k + c] ?? 0;
        q[k + c] = x;
        p[k + c] = x + (x - px) * this.damping - (c === 1 ? g : 0);
      }
    }
    const dist = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    const seg = (dist * Math.max(this.slack, 1.0)) / (n - 1);
    for (let it = 0; it < 8; it++) {
      p[0] = a.x; p[1] = a.y; p[2] = a.z;
      const e = (n - 1) * 3;
      p[e] = b.x; p[e + 1] = b.y; p[e + 2] = b.z;
      for (let i = 0; i < n - 1; i++) {
        const k0 = i * 3, k1 = k0 + 3;
        const dx = (p[k1] ?? 0) - (p[k0] ?? 0), dy = (p[k1 + 1] ?? 0) - (p[k0 + 1] ?? 0), dz = (p[k1 + 2] ?? 0) - (p[k0 + 2] ?? 0);
        const d = Math.hypot(dx, dy, dz);
        if (d < 1e-6) continue;
        // a rope only resists stretching
        if (d <= seg) continue;
        const f = (d - seg) / d;
        const w0 = i === 0 ? 0 : 0.5, w1 = i + 1 === n - 1 ? 0 : 0.5;
        const s0 = w0 + w1 > 0 ? w0 / (w0 + w1) : 0, s1 = w0 + w1 > 0 ? w1 / (w0 + w1) : 0;
        p[k0] = (p[k0] ?? 0) + dx * f * s0; p[k0 + 1] = (p[k0 + 1] ?? 0) + dy * f * s0; p[k0 + 2] = (p[k0 + 2] ?? 0) + dz * f * s0;
        p[k1] = (p[k1] ?? 0) - dx * f * s1; p[k1 + 1] = (p[k1 + 1] ?? 0) - dy * f * s1; p[k1 + 2] = (p[k1 + 2] ?? 0) - dz * f * s1;
      }
    }
    p[0] = a.x; p[1] = a.y; p[2] = a.z;
    const e = (n - 1) * 3;
    p[e] = b.x; p[e + 1] = b.y; p[e + 2] = b.z;
    // the feed: the first k nodes leave the muzzle in a straight run toward node k
    const k = 7;
    if (this.feed > 0) {
      const kx = p[k * 3] ?? 0, ky = p[k * 3 + 1] ?? 0, kz = p[k * 3 + 2] ?? 0;
      for (let i = 1; i < k; i++) {
        const t = i / k, w = this.feed * (1 - t);
        const o = i * 3;
        p[o] = (p[o] ?? 0) + (a.x + (kx - a.x) * t - (p[o] ?? 0)) * w;
        p[o + 1] = (p[o + 1] ?? 0) + (a.y + (ky - a.y) * t - (p[o + 1] ?? 0)) * w;
        p[o + 2] = (p[o + 2] ?? 0) + (a.z + (kz - a.z) * t - (p[o + 2] ?? 0)) * w;
      }
    }
  }

  /** a copy of the node positions (for a restart point) */
  save(): { p: Float32Array; q: Float32Array; live: boolean } { return { p: this.p.slice(), q: this.q.slice(), live: this.live }; }
  load(s: { p: Float32Array; q: Float32Array; live: boolean }): void { this.p.set(s.p); this.q.set(s.q); this.live = s.live; }
}

/** the ribbon that draws a Rope (node positions pushed every frame) */
export class Filament {
  readonly mesh: Mesh;
  readonly u: ReturnType<typeof uniformsFrom<GrappleFilamentUniforms>>;
  private readonly pos: Float32Array;
  private readonly prev: Float32Array;
  private readonly next: Float32Array;
  private readonly n: number;
  private readonly names = ['uRes', 'uProjection', 'uCorePx', 'uHaloPx', 'uI', 'uPulse', 'uLen', 'uTime', 'uCore', 'uHalo'] as const;
  private readonly pair = [0, 0];
  private readonly triple = [0, 0, 0];

  constructor(n: number, topology: unknown, private readonly look: string, uniforms: GrappleFilamentUniforms) {
    this.n = n; this.u = uniformsFrom(uniforms);
    if (!Number.isInteger(n) || n < 2 || n > 128) throw new Error('Invalid grapple ribbon size');
    const g = new BufferGeometryLoader().parse(topology);
    const pos = g.getAttribute('position').array, prev = g.getAttribute('aPrev').array, next = g.getAttribute('aNext').array;
    if (!(pos instanceof Float32Array) || !(prev instanceof Float32Array) || !(next instanceof Float32Array)
      || [pos, prev, next].some(values => values.length !== n * 6)) throw new Error('Rope ribbon topology differs');
    this.pos = pos; this.prev = prev; this.next = next;
    const m = lentLook(look); m.transparent = true; m.depthWrite = false; m.toneMapped = false;
    m.blending = CustomBlending; m.blendEquation = m.blendEquationAlpha = AddEquation;
    m.blendSrc = m.blendDst = m.blendDstAlpha = OneFactor; m.blendSrcAlpha = ZeroFactor;
    this.mesh = new Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }

  /** push the rope's nodes into the ribbon */
  update(r: Rope): void {
    const n = this.n, p = r.p;
    let len = 0;
    for (let i = 0; i < n; i++) {
      const ip = Math.max(0, i - 1), inx = Math.min(n - 1, i + 1);
      for (let s = 0; s < 2; s++) {
        const o = (i * 2 + s) * 3;
        for (let c = 0; c < 3; c++) {
          this.pos[o + c] = p[i * 3 + c] ?? 0;
          this.prev[o + c] = p[ip * 3 + c] ?? 0;
          this.next[o + c] = p[inx * 3 + c] ?? 0;
        }
      }
      if (i > 0) len += Math.hypot((p[i * 3] ?? 0) - (p[ip * 3] ?? 0), (p[i * 3 + 1] ?? 0) - (p[ip * 3 + 1] ?? 0), (p[i * 3 + 2] ?? 0) - (p[ip * 3 + 2] ?? 0));
    }
    this.u.uLen.value = len;
    for (const name of this.names) {
      const value = this.u[name].value;
      if (value instanceof Vector2) {
        this.pair[0] = value.x; this.pair[1] = value.y; setLentParam(this.look, name, this.pair);
      } else if (value instanceof Vector3) {
        this.triple[0] = value.x; this.triple[1] = value.y; this.triple[2] = value.z; setLentParam(this.look, name, this.triple);
      } else setLentParam(this.look, name, value);
    }
    const g = this.mesh.geometry;
    for (const k of ['position', 'aPrev', 'aNext'] as const) {
      const at = g.getAttribute(k);
      at.needsUpdate = true;
    }
  }
}
