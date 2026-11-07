/**
 * An arena room's ground, renderer-free (CI12: the Nalati chapter tape observes the Golden King's kurgan natively): where
 * the chamber, the dromos and the room's volume are, the walkable floor (the drifted sand over the chamber floor, the coffin
 * plinth, the pedestal's step and the fallen beams' round tops) and the sand drifts themselves, piled, drained and cleared
 * by the fight, with the 15 Hz clock that publishes them. `BossArenaRoom` (arenaRoomView.ts) keeps the drawn grid and the
 * walkable patch and writes them when `pace` says a write is due; every number is the room's as before.
 *
 *   const ground = new ArenaRoomGround(rows);   ground.addSand(1, 2, 1.5, .3);   ground.floorAt(x, z);   ground.snapshot();
 */
import type { ArenaRoomRows } from './arenaRoomRows';

type GroundRows = Pick<ArenaRoomRows, 'origin' | 'halfWidth' | 'corridorHalfWidth' | 'corridorEnd' | 'cover' | 'pedestal' | 'beams' | 'sandCells'>;
interface Point { readonly x: number; readonly y: number; readonly z: number }
/** the ground's continuation as data: every sand cell, whether a write is pending, and the publishing clock */
export interface ArenaGroundSnapshot { readonly sand: readonly number[]; readonly dirty: boolean; readonly clock: number }

/** The state rows a room's drifts go by. */
export const sandWireName = (room: string): string => `sand.${room}`;
/** One strip of drifts on the wire. */
export interface SandRow { readonly name: string; readonly value: number }
/** A state row is an f32, whose whole numbers are exact to 24 bits. */
const SAND_ROW_CELLS = 3;
const sandByte = (height: number): number => Math.round(Math.min(1, Math.max(0, height)) * 255);

export class ArenaRoomGround {
  /** the sand drifts: a heightfield over the chamber floor (sandCells × sandCells cells, row j = z, column i = x) */
  readonly sand: Float32Array;
  private dirty = false;
  private clock = 0;
  constructor(private readonly rows: GroundRows) { this.sand = new Float32Array(rows.sandCells * rows.sandCells); }

  // Local frames.
  inChamber(p: Point): boolean { const x = p.x - this.rows.origin.x, z = p.z - this.rows.origin.z, y = p.y - this.rows.origin.y; return Math.abs(x) < this.rows.halfWidth && Math.abs(z) < this.rows.halfWidth && y > -3 && y < 8; }
  inDromos(p: Point): boolean { const x = p.x - this.rows.origin.x, z = p.z - this.rows.origin.z, y = p.y - this.rows.origin.y; return Math.abs(x) < this.rows.corridorHalfWidth + 0.5 && z >= this.rows.halfWidth && z < this.rows.corridorEnd + 1 && y > -3 && y < 8; }
  inVolume(p: Point): boolean { return this.inChamber(p) || this.inDromos(p); }

  // Walkable heights.
  floorAt(x: number, z: number): number | undefined {
    const lx = x - this.rows.origin.x, lz = z - this.rows.origin.z;
    const inCh = Math.abs(lx) <= this.rows.halfWidth + 1.4 && Math.abs(lz) <= this.rows.halfWidth, inDr = Math.abs(lx) <= this.rows.corridorHalfWidth + 0.2 && lz >= this.rows.halfWidth - 0.1 && lz <= this.rows.corridorEnd + 0.6;
    if (!inCh && !inDr) return undefined;
    let y = 0;
    if (inCh) {
      y = this.sandAt(lx, lz);
      // the coffin plinth
      if (Math.abs(lx - this.rows.cover.x) < this.rows.cover.wid / 2 + 0.65 && Math.abs(lz - this.rows.cover.z) < this.rows.cover.len / 2 + 0.6) y = Math.max(y, this.rows.cover.plinthH);
      // the pedestal's step
      if (Math.abs(lx - this.rows.pedestal.x) < 0.8 && Math.abs(lz - this.rows.pedestal.z) < 0.7) y = Math.max(y, 0.18);
      // the fallen beams (their round tops)
      for (const f of this.rows.beams) {
        const ax = f.a.x, az = f.a.z, bx = f.b.x, bz = f.b.z;
        const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
        const u = Math.max(0, Math.min(1, ((lx - ax) * dx + (lz - az) * dz) / L2));
        const d = Math.hypot(lx - (ax + dx * u), lz - (az + dz * u));
        if (d < f.r) y = Math.max(y, f.r + Math.sqrt(f.r * f.r - d * d) - 0.02);
      }
    }
    return this.rows.origin.y + y;
  }

  sandAt(lx: number, lz: number): number {
    const fx = (lx + this.rows.halfWidth) / (this.rows.halfWidth * 2) * this.rows.sandCells - 0.5, fz = (lz + this.rows.halfWidth) / (this.rows.halfWidth * 2) * this.rows.sandCells - 0.5;
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
    const h = (i: number, j: number) => (i < 0 || j < 0 || i >= this.rows.sandCells || j >= this.rows.sandCells ? 0 : this.sand[j * this.rows.sandCells + i] ?? 0);
    return (h(ix, iz) * (1 - tx) + h(ix + 1, iz) * tx) * (1 - tz) + (h(ix, iz + 1) * (1 - tx) + h(ix + 1, iz + 1) * tx) * tz;
  }
  addSand(lx: number, lz: number, r: number, dh: number, max = 1.0): void {
    const cell = (this.rows.halfWidth * 2) / this.rows.sandCells;
    const i0 = Math.max(0, Math.floor((lx - r + this.rows.halfWidth) / cell)), i1 = Math.min(this.rows.sandCells - 1, Math.ceil((lx + r + this.rows.halfWidth) / cell));
    const j0 = Math.max(0, Math.floor((lz - r + this.rows.halfWidth) / cell)), j1 = Math.min(this.rows.sandCells - 1, Math.ceil((lz + r + this.rows.halfWidth) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const cx = -this.rows.halfWidth + (i + 0.5) * cell, cz = -this.rows.halfWidth + (j + 0.5) * cell, d = Math.hypot(cx - lx, cz - lz) / r;
      if (d >= 1) continue;
      const k = j * this.rows.sandCells + i;
      this.sand[k] = Math.min(max, (this.sand[k] ?? 0) + dh * (1 - d * d) * (1 - d * d));
    }
    this.dirty = true;
  }
  clearSand(): void { this.sand.fill(0); this.dirty = true; }
  drainSand(dt: number, rate = 0.25): void {
    let any = false;
    for (let k = 0; k < this.sand.length; k++) { const h = this.sand[k] ?? 0; if (h > 0) { this.sand[k] = Math.max(0, h - rate * dt); any = true; } }
    if (any) this.dirty = true;
  }
  /** The publishing clock: true when a changed ground is due to be written (at most 15 times a second). */
  pace(dt: number): boolean {
    this.clock += dt;
    if (this.dirty && this.clock > 1 / 15) { this.clock = 0; this.dirty = false; return true; }
    return false;
  }

  /** The drifts as wire rows: three cells to a row, a byte each, over a metre. Calm strips send nothing. */
  sandRows(prefix: string): SandRow[] {
    const rows: SandRow[] = [], { sand } = this;
    for (let strip = 0; strip * SAND_ROW_CELLS < sand.length; strip++) {
      let value = 0;
      for (let cell = 0; cell < SAND_ROW_CELLS; cell++) value = value * 256 + sandByte(sand[strip * SAND_ROW_CELLS + cell] ?? 0);
      if (value !== 0) rows.push({ name: `${prefix}.${String(strip)}`, value });
    }
    return rows;
  }
  /** A page's drifts, as the server's rows say: `row` reads a strip, undefined where it is calm. */
  mirrorSand(row: (strip: number) => number | undefined): void {
    const { sand } = this;
    for (let strip = 0; strip * SAND_ROW_CELLS < sand.length; strip++) {
      let value = row(strip) ?? 0;
      for (let cell = SAND_ROW_CELLS - 1; cell >= 0; cell--) {
        const at = strip * SAND_ROW_CELLS + cell;
        if (at < sand.length) { const height = (value % 256) / 255; if (sand[at] !== height) { sand[at] = height; this.dirty = true; } }
        value = Math.floor(value / 256);
      }
    }
  }
  /** The highest drift, in metres. */
  get sandPeak(): number { return Math.max(...this.sand); }
  snapshot(): ArenaGroundSnapshot { return { sand: Array.from(this.sand), dirty: this.dirty, clock: this.clock }; }
  restore(saved: ArenaGroundSnapshot): void {
    if (saved.sand.length !== this.sand.length || saved.sand.some(h => !Number.isFinite(h)) || !Number.isFinite(saved.clock)) throw new Error('Invalid arena ground snapshot');
    this.sand.set(saved.sand); this.dirty = saved.dirty; this.clock = saved.clock;
  }
}
