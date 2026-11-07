// CI12 Nalati chapter: an arena room's ground split out of BossArenaRoom (ArenaRoomGround, renderer-free) answers exactly as
// the room's inline code did (volumes, floor, sand, piles, drains, clears and the 15 Hz publishing clock), and the ground and
// the portal law continue exactly from their checkpoints.
import { expect, test } from 'vitest';
import { Vector3 } from 'three';
import { ArenaRoomGround } from '../src/shared/game/boss/arenaGround';
import { ArenaPortalLaw, type ArenaPortalFrame } from '../src/shared/game/boss/arenaPortal';
import { ReturnProgram } from '../src/shared/game/population/returnProgram';
import { titanPrograms as titan } from './fixtures/titanInlineWitness';
import marsh from './fixtures/boss-owner/marsh-room.json' with { type: 'json' };

// the marsh room's ground rows, with two fallen beams across the chamber
const rows = { origin: marsh.origin, halfWidth: marsh.halfWidth, corridorHalfWidth: marsh.corridorHalfWidth, corridorEnd: marsh.corridorEnd,
  cover: marsh.cover, pedestal: marsh.pedestal, sandCells: marsh.sandCells,
  beams: [{ a: { x: -4, z: -3 }, b: { x: 3, z: 2 }, r: .35 }, { a: { x: 2, z: -5 }, b: { x: 4.5, z: 4 }, r: .25 }] };

/** BossArenaRoom's ground before the split (arenaRoom.ts, before CI12) */
class Inline {
  readonly sandH = new Float32Array(rows.sandCells * rows.sandCells); sandDirty = false; sandAcc = 0;
  inChamber(p: Vector3): boolean { const x = p.x - rows.origin.x, z = p.z - rows.origin.z, y = p.y - rows.origin.y; return Math.abs(x) < rows.halfWidth && Math.abs(z) < rows.halfWidth && y > -3 && y < 8; }
  inDromos(p: Vector3): boolean { const x = p.x - rows.origin.x, z = p.z - rows.origin.z, y = p.y - rows.origin.y; return Math.abs(x) < rows.corridorHalfWidth + 0.5 && z >= rows.halfWidth && z < rows.corridorEnd + 1 && y > -3 && y < 8; }
  inVolume(p: Vector3): boolean { return this.inChamber(p) || this.inDromos(p); }
  floorAt(x: number, z: number): number | undefined {
    const lx = x - rows.origin.x, lz = z - rows.origin.z;
    const inCh = Math.abs(lx) <= rows.halfWidth + 1.4 && Math.abs(lz) <= rows.halfWidth, inDr = Math.abs(lx) <= rows.corridorHalfWidth + 0.2 && lz >= rows.halfWidth - 0.1 && lz <= rows.corridorEnd + 0.6;
    if (!inCh && !inDr) return undefined;
    let y = 0;
    if (inCh) {
      y = this.sandAt(lx, lz);
      if (Math.abs(lx - rows.cover.x) < rows.cover.wid / 2 + 0.65 && Math.abs(lz - rows.cover.z) < rows.cover.len / 2 + 0.6) y = Math.max(y, rows.cover.plinthH);
      if (Math.abs(lx - rows.pedestal.x) < 0.8 && Math.abs(lz - rows.pedestal.z) < 0.7) y = Math.max(y, 0.18);
      for (const f of rows.beams) {
        const ax = f.a.x, az = f.a.z, bx = f.b.x, bz = f.b.z, dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
        const u = Math.max(0, Math.min(1, ((lx - ax) * dx + (lz - az) * dz) / L2)), d = Math.hypot(lx - (ax + dx * u), lz - (az + dz * u));
        if (d < f.r) y = Math.max(y, f.r + Math.sqrt(f.r * f.r - d * d) - 0.02);
      }
    }
    return rows.origin.y + y;
  }
  sandAt(lx: number, lz: number): number {
    const fx = (lx + rows.halfWidth) / (rows.halfWidth * 2) * rows.sandCells - 0.5, fz = (lz + rows.halfWidth) / (rows.halfWidth * 2) * rows.sandCells - 0.5;
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
    const h = (i: number, j: number) => (i < 0 || j < 0 || i >= rows.sandCells || j >= rows.sandCells ? 0 : this.sandH[j * rows.sandCells + i] ?? 0);
    return (h(ix, iz) * (1 - tx) + h(ix + 1, iz) * tx) * (1 - tz) + (h(ix, iz + 1) * (1 - tx) + h(ix + 1, iz + 1) * tx) * tz;
  }
  addSand(lx: number, lz: number, r: number, dh: number, max = 1.0): void {
    const cell = (rows.halfWidth * 2) / rows.sandCells;
    const i0 = Math.max(0, Math.floor((lx - r + rows.halfWidth) / cell)), i1 = Math.min(rows.sandCells - 1, Math.ceil((lx + r + rows.halfWidth) / cell));
    const j0 = Math.max(0, Math.floor((lz - r + rows.halfWidth) / cell)), j1 = Math.min(rows.sandCells - 1, Math.ceil((lz + r + rows.halfWidth) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const cx = -rows.halfWidth + (i + 0.5) * cell, cz = -rows.halfWidth + (j + 0.5) * cell, d = Math.hypot(cx - lx, cz - lz) / r;
      if (d >= 1) continue;
      const k = j * rows.sandCells + i; this.sandH[k] = Math.min(max, (this.sandH[k] ?? 0) + dh * (1 - d * d) * (1 - d * d));
    }
    this.sandDirty = true;
  }
  clearSand(): void { this.sandH.fill(0); this.sandDirty = true; }
  drainSand(dt: number, rate = 0.25): void { let any = false; for (let k = 0; k < this.sandH.length; k++) { const h = this.sandH[k] ?? 0; if (h > 0) { this.sandH[k] = Math.max(0, h - rate * dt); any = true; } } if (any) this.sandDirty = true; }
  pace(dt: number): boolean { this.sandAcc += dt; if (this.sandDirty && this.sandAcc > 1 / 15) { this.sandAcc = 0; this.sandDirty = false; return true; } return false; }
}

test('the ground answers as the room did, and continues from its checkpoint', () => {
  const old = new Inline(), ground = new ArenaRoomGround(rows);
  let copy: ArenaRoomGround | null = null, writes = 0;
  const probe = (g: ArenaRoomGround | Inline): number[] => {
    const out: number[] = [];
    for (let x = -8; x <= 8; x += .7) for (let z = -7; z <= 20; z += .9) {
      const p = new Vector3(rows.origin.x + x, rows.origin.y + (x + z) % 4 - 1, rows.origin.z + z);
      out.push(g.floorAt(p.x, p.z) ?? -999, g.sandAt(x, z), Number(g.inChamber(p)), Number(g.inDromos(p)), Number(g.inVolume(p)));
    }
    return out;
  };
  for (let f = 0; f < 400; f++) {
    const dt = f % 17 === 0 ? .09 : 1 / 30;
    for (const g of copy === null ? [old, ground] : [old, ground, copy]) {
      if (f % 7 === 0) g.addSand(Math.sin(f) * 5, Math.cos(f * .7) * 5, 1 + (f % 3), .12 + (f % 5) * .05, .9);
      if (f % 11 === 0) g.drainSand(dt, .3);
      if (f === 250) g.clearSand();
    }
    const w = old.pace(dt); expect(ground.pace(dt)).toBe(w); if (w) writes++;
    if (copy !== null) expect(copy.pace(dt)).toBe(w);
    if (f % 25 === 0) { const want = probe(old); expect(probe(ground)).toEqual(want); if (copy !== null) expect(probe(copy)).toEqual(want); }
    expect(Array.from(ground.sand)).toEqual(Array.from(old.sandH));
    if (f === 133) { copy = new ArenaRoomGround(rows); copy.restore(ground.snapshot()); }
  }
  expect(writes).toBeGreaterThan(20); expect(Array.from(old.sandH).some(h => h > .1)).toBe(true);
});

test('the portal law continues from its checkpoint exactly, through a fade', () => {
  const entrance = { x: 200, y: 2, z: 200, facing: 0 }, rowsPortal = { signal: 'kingDoor', end: 12 };
  const a = new ArenaPortalLaw(ReturnProgram.page(titan.rules), rowsPortal, entrance);
  let b: ArenaPortalLaw | null = null; const steps: string[][] = [[], []];
  const act = (law: ArenaPortalLaw, log: string[], dt: number, frame: ArenaPortalFrame): void => {
    const step = law.step(dt, () => frame); log.push(JSON.stringify(step));
    if (step.kind === 'decided') { if (!law.inside && step.enter) law.begin('enter', .2); else if (law.inside && step.exit === 2) law.begin('exit', .2); else if (law.inside && step.exit !== 0) law.inside = false; }
    else if (step.kind === 'faded') law.inside = step.pending === 'enter';
  };
  for (let f = 0; f < 900; f++) {
    const dt = f % 29 === 0 ? .13 : 1 / 30, phase = Math.floor(f / 150), along = (f % 150) / 150;
    const pz = [212 - along * 12, 200 + along * 14, 40 + along * 12, 49, 52 - along * 20, 212][phase] ?? 212;
    const frame: ArenaPortalFrame = { px: phase < 2 ? 200 : 30, py: phase < 2 ? 2 : 20, pz, floor: phase >= 2 && phase < 5 ? 20 : undefined, volume: phase === 1 || (phase >= 2 && phase < 5),
      engaged: phase === 3, sand: 0, originY: 20, originZ: 40 };
    act(a, steps[0] ?? [], dt, frame);
    if (b !== null) { act(b, steps[1] ?? [], dt, frame); expect(b.snapshot()).toEqual(a.snapshot()); }
    if (b === null && a.snapshot().fade >= 0) { b = new ArenaPortalLaw(ReturnProgram.page(titan.rules), rowsPortal, entrance); b.restore(a.snapshot()); }
  }
  expect(b).not.toBeNull();
  const tail = steps[0]?.slice(-(steps[1]?.length ?? 0));
  expect(steps[1]).toEqual(tail); expect(steps[1]?.some(s => s.includes('faded'))).toBe(true);
});
