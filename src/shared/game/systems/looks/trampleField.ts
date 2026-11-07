/**
 * The trample map's state and law without the GPU (SF72, P1-E1): what the grass trample stamps, recovers and saves, and
 * the player trail that feeds it. Native wildlife and the headless host push into a TrampleField and read `amountAt`
 * (grass height for stealth and AI); the page's GrassTrample (`trample.ts`) adds the live-mover uniforms and the RG8
 * texture over it.
 */
import type { SimHost, SimValue } from '@wildshard/engine/sim';
import * as schema from 'valibot';

const SIZE = 256;
const TEXEL = 0.5;
const SPAN = SIZE * TEXEL;       // 128 m
/** seconds a fully flattened patch takes to stand back up (design: 20 s) */
export const RECOVER = 20;

/** the map's side in texels and the window's span in metres, for the page's RG8 texture (`trample.ts`) */
export const TRAMPLE_SIZE: number = SIZE;
export const TRAMPLE_SPAN: number = SPAN;

/**
 * A trample map's whole continuation as plain JSON values (TrampleField.snapshot / restore, SF72): every flattened texel as
 * `[index, amount, angle]` triples in index order (a texel at 0 holds no state: its stale angle is never read and the next
 * stamp rewrites it), the window's origin in texels (null before the first update), its centre, the flags and the 10 Hz
 * recovery's accumulated seconds. Float32 values round-trip exactly through a double.
 */
export interface TrampleState {
  cells: number[]; origin: [number, number] | null; centre: [number, number]; anyFlat: boolean; dirty: boolean; tick: number;
}

const trailPair = schema.tuple([schema.number(), schema.number()]);
const TrailContinuation: schema.ObjectSchema<{ readonly trail: schema.NullableSchema<schema.TupleSchema<[schema.NumberSchema<undefined>, schema.NumberSchema<undefined>], undefined>, undefined>; readonly map: schema.ObjectSchema<{ readonly cells: schema.ArraySchema<schema.NumberSchema<undefined>, undefined>; readonly origin: schema.NullableSchema<schema.TupleSchema<[schema.NumberSchema<undefined>, schema.NumberSchema<undefined>], undefined>, undefined>; readonly centre: schema.TupleSchema<[schema.NumberSchema<undefined>, schema.NumberSchema<undefined>], undefined>; readonly anyFlat: schema.BooleanSchema<undefined>; readonly dirty: schema.BooleanSchema<undefined>; readonly tick: schema.NumberSchema<undefined>; }, undefined>; }, undefined> = schema.object({ trail: schema.nullable(trailPair), map: schema.object({ cells: schema.array(schema.number()),
  origin: schema.nullable(trailPair), centre: trailPair, anyFlat: schema.boolean(), dirty: schema.boolean(), tick: schema.number() }) });
/** Player trail observations over a concrete map. Pushes precede the owner's
 * existing map update; teleport filtering never advances another clock. */
/** The other players' trails, beside the first's. */
const TrailSeats = schema.object({ others: schema.optional(schema.record(schema.string(), schema.nullable(schema.tuple([schema.number(), schema.number()])))) });
export class TrampleTrail {
  private lastX = Number.NaN;
  private lastZ = Number.NaN;
  constructor(private readonly map: TrampleField, private readonly speedLimit: number) {
    if (!Number.isFinite(speedLimit) || speedLimit <= 0) throw new Error('Invalid trail speed limit');
  }
  push(dt: number, at: { readonly x: number; readonly z: number }, radius: number, strength = 1): void {
    const vx = Number.isNaN(this.lastX) || dt <= 0 ? 0 : (at.x - this.lastX) / dt;
    const vz = Number.isNaN(this.lastZ) || dt <= 0 ? 0 : (at.z - this.lastZ) / dt;
    this.lastX = at.x; this.lastZ = at.z;
    if (vx * vx + vz * vz < this.speedLimit * this.speedLimit) this.map.push(at.x, at.z, radius, strength, vx, vz);
  }
  /** The historic trail/map wire shape, detached from the live field. */
  snapshot(): schema.InferOutput<typeof TrailContinuation> {
    return { trail: Number.isNaN(this.lastX) ? null : [this.lastX, this.lastZ], map: { ...this.map.snapshot() } };
  }
  /** Where this trail last was, for another player's line in the save. */
  last(): [number, number] | null { return Number.isNaN(this.lastX) ? null : [this.lastX, this.lastZ]; }
  /** Set a trail saved beside the first. */
  resume(at: readonly [number, number] | null): void { [this.lastX, this.lastZ] = at ?? [Number.NaN, Number.NaN]; }
  /** Refuse the whole map before changing the saved trail position. */
  restore(input: SimValue): void {
    const saved = schema.parse(TrailContinuation, input);
    this.map.restore(saved.map);
    [this.lastX, this.lastZ] = saved.trail ?? [Number.NaN, Number.NaN];
  }
}
/** Server-safe fixed-step binding of numeric trail rows to the native player.
 * The map and its trail retain one snapshot adapter under the declared id. */
export function installTrampleTrail(host: SimHost, map: TrampleField, rows: { id: string; radius: number; strength: number; speedLimit: number }): void {
  const limit = rows.speedLimit, trail = new TrampleTrail(map, limit), others = new Map<string, TrampleTrail>();
  host.onStep(rows.id, dt => {
    // the window follows one player, as it does on a page; everyone flattens what falls inside it
    let window: { readonly x: number; readonly z: number } | null = null;
    for (const player of host.players.values()) {
      const at = player.position;
      if (window === null) { window = at; trail.push(dt, at, rows.radius, rows.strength); continue; }
      let own = others.get(player.id);
      if (own === undefined) { own = new TrampleTrail(map, limit); others.set(player.id, own); }
      own.push(dt, at, rows.radius, rows.strength);
    }
    if (window !== null) map.update(dt, window);
  }, { snapshot: () => others.size === 0 ? trail.snapshot() : { ...trail.snapshot(), others: Object.fromEntries([...others].map(([id, own]) => [id, own.last()])) },
    restore: saved => {
      trail.restore(saved); others.clear();
      const { others: seats } = schema.parse(TrailSeats, saved);
      for (const [id, at] of Object.entries(seats ?? {})) { const own = new TrampleTrail(map, limit); own.resume(at); others.set(id, own); }
    } });
}

/**
 * The trample map's state and law without the GPU (SF72): the 256² flatten amount and lie angle over the 128 m window that
 * follows the player, the pushes that stamp it, the tracked movers and the recovery at 10 Hz. GrassTrample (the page's)
 * adds the live-mover uniforms and the RG8 texture over it; a renderer-free host keeps its own.
 */
export class TrampleField {
  private amount = new Float32Array(SIZE * SIZE);
  private angle = new Float32Array(SIZE * SIZE);
  private ox = 0x7fffffff;  // window origin, texel units
  private oz = 0x7fffffff;
  private anyFlat = false;
  private dirty = false;
  // FC CPU cut: every texel the recovery may change (amount > 0 when listed). A texel off the list has amount 0 and its RG8
  // texel at rest (128, 128), so the recovery walks the list, not all 65,536; a restore or a whole-window clear asks for
  // one full walk, which rebuilds the list
  private readonly active: number[] = [];
  private readonly listed = new Uint8Array(SIZE * SIZE);
  private full = true;
  private tick = 0;
  /** the window centre: the player at the last update */
  protected cx = 0;
  protected cz = 0;
  private tracked: { p: { x: number; z: number }; r: number; s: number; on: (() => boolean) | undefined; px: number; pz: number }[] = [];

  /**
   * A mover at (x, z) this frame: stamps the trample map within ~0.8 × `radius` m. `strength` 1 = a person / wolf, 1.5 = a
   * horse. (vx, vz) = its velocity (m/s) — trampled blades lie the way it went; standing still they lie outward.
   */
  push(x: number, z: number, radius: number, strength = 1, vx = 0, vz = 0): void {
    this.stamp(x, z, radius * 0.8, Math.min(1, strength), vx, vz);
  }

  /**
   * Push `pos` every frame from now on (an animal, the horse): its velocity comes from where it was last frame.
   * `active` (optional) gates it (a dead wolf, a stabled horse). Returns a function that stops tracking.
   */
  track(pos: { x: number; z: number }, radius: number, strength = 1, active?: () => boolean): () => void {
    const e = { p: pos, r: radius, s: strength, on: active, px: pos.x, pz: pos.z };
    this.tracked.push(e);
    return () => { const i = this.tracked.indexOf(e); if (i !== -1) this.tracked.splice(i, 1); };
  }

  /** 0..1 how flattened the grass is at (x, z) (0 outside the 128 m window) */
  amountAt(x: number, z: number): number {
    if (Math.abs(x - this.cx) > SPAN / 2 - 1 || Math.abs(z - this.cz) > SPAN / 2 - 1) return 0;
    const ix = Math.floor(x / TEXEL), iz = Math.floor(z / TEXEL);
    return this.amount[this.idx(ix, iz)] ?? 0;
  }

  update(dt: number, playerPos: { x: number; z: number }): void {
    this.cx = playerPos.x; this.cz = playerPos.z;
    this.scroll(playerPos.x, playerPos.z);
    const idt = dt > 0 ? 1 / dt : 0;
    for (const e of this.tracked) {
      const vx = (e.p.x - e.px) * idt, vz = (e.p.z - e.pz) * idt;
      e.px = e.p.x; e.pz = e.p.z;
      if (e.on && !e.on()) continue;
      if (vx * vx + vz * vz > 900) continue; // a teleport / respawn, not a stride
      this.push(e.p.x, e.p.z, e.r, e.s, vx, vz);
    }
    this.frame();
    // decay at 10 Hz
    this.tick += dt;
    if (this.tick < 0.1) return;
    const step = this.tick / RECOVER;
    this.tick = 0;
    if (!this.anyFlat && !this.dirty) return;
    let any = false;
    const a = this.amount, g = this.angle, out = this.texels(), list = this.active, listed = this.listed, full = this.full;
    if (full) { list.length = 0; listed.fill(0); this.full = false; }
    const count = full ? SIZE * SIZE : list.length;
    let kept = 0, changed = false;
    for (let n = 0; n < count; n++) {
      const i = full ? n : list[n] ?? 0;
      const v = a[i] ?? 0;
      if (v <= 0) { if (out !== null) { changed ||= out[i * 2] !== 128 || out[i * 2 + 1] !== 128; out[i * 2] = 128; out[i * 2 + 1] = 128; } if (!full) listed[i] = 0; continue; }
      const nv = v - step;
      if (nv <= 0) { a[i] = 0; if (out !== null) { changed ||= out[i * 2] !== 128 || out[i * 2 + 1] !== 128; out[i * 2] = 128; out[i * 2 + 1] = 128; } if (!full) listed[i] = 0; continue; }
      a[i] = nv; any = true;
      if (full) { listed[i] = 1; list.push(i); } else list[kept++] = i;
      if (out === null) continue;
      const ang = g[i] ?? 0;
      const r = Math.round(127.5 + 127 * Math.cos(ang) * nv), b = Math.round(127.5 + 127 * Math.sin(ang) * nv);
      changed ||= out[i * 2] !== r || out[i * 2 + 1] !== b;
      out[i * 2] = r;
      out[i * 2 + 1] = b;
    }
    if (!full) list.length = kept;
    this.anyFlat = any;
    this.dirty = false;
    // Float recovery can leave the quantized RG8 image identical. Keep the
    // native field/clock advancing without submitting those same bytes again.
    if (changed) this.uploaded();
  }

  /** The map's continuation (TrampleState). A tracked mover is a callback, not state: a field tracking one refuses. */
  snapshot(): TrampleState {
    if (this.tracked.length > 0) throw new Error('A trample map with tracked movers has no snapshot');
    const cells: number[] = [];
    for (let i = 0; i < SIZE * SIZE; i++) { const v = this.amount[i] ?? 0; if (v > 0) cells.push(i, v, this.angle[i] ?? 0); }
    return { cells, origin: this.ox === 0x7fffffff ? null : [this.ox, this.oz], centre: [this.cx, this.cz], anyFlat: this.anyFlat, dirty: this.dirty, tick: this.tick };
  }

  /** Continue exactly from a snapshot: refuses a state no map could hold (a texel out of range, out of order or not in
   *  (0, 1], a non-finite number) before changing anything. */
  restore(state: TrampleState): void {
    const { cells, origin, centre } = state, finite = (n: number): boolean => Number.isFinite(n);
    let last = -1;
    for (let k = 0; k < cells.length; k += 3) {
      const i = cells[k] ?? -1, v = cells[k + 1] ?? 0, g = cells[k + 2] ?? Number.NaN;
      if (!Number.isInteger(i) || i <= last || i >= SIZE * SIZE || !(v > 0 && v <= 1) || !finite(g)) throw new RangeError('Invalid trample cell');
      last = i;
    }
    if (cells.length % 3 !== 0 || !centre.every(finite) || !finite(state.tick) || state.tick < 0 || (origin !== null && !origin.every(n => Number.isInteger(n)))) throw new RangeError('Invalid trample state');
    if (this.tracked.length > 0) throw new Error('A trample map with tracked movers cannot restore');
    this.amount.fill(0); this.angle.fill(0);
    for (let k = 0; k < cells.length; k += 3) { const i = cells[k] ?? 0; this.amount[i] = cells[k + 1] ?? 0; this.angle[i] = cells[k + 2] ?? 0; }
    [this.ox, this.oz] = origin ?? [0x7fffffff, 0x7fffffff];
    [this.cx, this.cz] = centre;
    this.anyFlat = state.anyFlat; this.dirty = state.dirty; this.tick = state.tick; this.full = true;
  }

  /** after this frame's pushes, before the recovery: the page hands its live movers to the shader */
  protected frame(): void { /* a renderer-free field draws nothing */ }
  /** the RG8 texels the recovery rewrites (the page's texture data), or null */
  protected texels(): Uint8Array | null { return null; }
  /** the recovery changed at least one encoded texel */
  protected uploaded(): void { /* nothing to upload */ }

  private idx(ix: number, iz: number): number {
    return (((iz % SIZE) + SIZE) % SIZE) * SIZE + (((ix % SIZE) + SIZE) % SIZE);
  }

  private stamp(x: number, z: number, r: number, s: number, vx: number, vz: number): void {
    if (Math.abs(x - this.cx) > SPAN / 2 - r - 1 || Math.abs(z - this.cz) > SPAN / 2 - r - 1) return;
    const moving = vx * vx + vz * vz > 0.25;
    const heading = Math.atan2(vz, vx);
    const i0 = Math.floor((x - r) / TEXEL), i1 = Math.floor((x + r) / TEXEL);
    const j0 = Math.floor((z - r) / TEXEL), j1 = Math.floor((z + r) / TEXEL);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = (i + 0.5) * TEXEL - x, pz = (j + 0.5) * TEXEL - z;
      const d = Math.hypot(px, pz);
      if (d > r) continue;
      const w = s * (1 - (d / r) ** 2) * (moving ? 1 : 0.35); // standing still presses a little, walking flattens
      const k = this.idx(i, j);
      const cur = this.amount[k] ?? 0;
      if (w <= cur * 0.9) continue;
      this.amount[k] = Math.max(cur, Math.min(1, w));
      const ang = moving ? heading + (px * vz - pz * vx > 0 ? -0.35 : 0.35) : Math.atan2(pz, px);
      this.angle[k] = ang;
      if (this.listed[k] === 0) { this.listed[k] = 1; this.active.push(k); }
      this.dirty = true; this.anyFlat = true;
    }
  }

  /** move the window with the player; clear rows / columns that enter it (they held the far side's stamps) */
  private scroll(px: number, pz: number): void {
    const nx = Math.floor(px / TEXEL) - SIZE / 2, nz = Math.floor(pz / TEXEL) - SIZE / 2;
    if (nx === this.ox && nz === this.oz) return;
    const first = this.ox === 0x7fffffff;
    const dx = nx - this.ox, dz = nz - this.oz;
    if (first || Math.abs(dx) >= SIZE || Math.abs(dz) >= SIZE) {
      this.amount.fill(0);
      this.dirty = true; this.full = true;
    } else {
      // columns entering: [ox+SIZE, nx+SIZE) when moving +x, [nx, ox) when moving −x
      const clearCol = (i: number) => { for (let j = 0; j < SIZE; j++) this.amount[this.idx(i, j)] = 0; };
      const clearRow = (j: number) => { for (let i = 0; i < SIZE; i++) this.amount[this.idx(i, j)] = 0; };
      if (dx > 0) for (let i = this.ox + SIZE; i < nx + SIZE; i++) clearCol(i);
      else for (let i = nx; i < this.ox; i++) clearCol(i);
      if (dz > 0) for (let j = this.oz + SIZE; j < nz + SIZE; j++) clearRow(j);
      else for (let j = nz; j < this.oz; j++) clearRow(j);
      if (dx !== 0 || dz !== 0) this.dirty = true;
    }
    this.ox = nx; this.oz = nz;
  }
}
