// Frozen original fire and whirl views used only by the native lifecycle oracle.
/** Client-only instanced arena flames, smoke, scorch and whirlwinds. No fight decisions or hazard ownership. */
import * as THREE from 'three';
import { app } from '@wildshard/engine/app/runtime';
import { TIER } from '@wildshard/engine/core/tier';
import { terrainHeight as heightAt, terrainNormal as normalAt } from '@wildshard/engine/world/terrainHeight';
import { lentLook, setLentParam } from '../../src/client/game/shardfile/lentLooks';
import { ProjectedState, type ReturnProgram } from '../../src/shared/game/population/returnProgram';
import type { CellField } from '../../src/shared/game/systems/cellField';
import type { ArenaWhirlsRows,ArenaFireRows } from '@wildshard/format/encounterRows';

interface SmokeP { x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number; life: number; r0: number; r1: number; glow: number; seed: number; on: boolean }

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _y = new THREE.Vector3(0, 1, 0);

/** the phase-3 fire's flames and smoke; the fight feeds it the burning cells each frame */
export class ArenaFireView {
  readonly flames: THREE.InstancedMesh;
  readonly smoke: THREE.InstancedMesh;
  private readonly flameData: THREE.InstancedBufferAttribute;
  private readonly smokeData: THREE.InstancedBufferAttribute;
  private readonly wind = new THREE.Vector2();
  private readonly pool: SmokeP[] = [];
  private n = 0;
  private next = 0;
  private scorched = 0;
  private scorch: THREE.InstancedMesh | null = null;

  readonly rows: ArenaFireRows;
  constructor(scene: THREE.Scene, input: ArenaFireRows, flames: unknown) {
    const rows = input;
    if (rows.life[0] <= 0 || rows.life[1] < 0) throw new Error('Invalid smoke lifetime');
    this.rows = rows;
    // per instance (aInst): the flames' heat 0..1, front (1 = the downwind edge) and seed; the smoke's age, fire glow and seed
    const flameGeo = new THREE.BufferGeometryLoader().parse(flames);
    this.flameData = new THREE.InstancedBufferAttribute(new Float32Array(rows.flameCount * 3), 3);
    flameGeo.setAttribute('aInst', this.flameData);
    this.flames = new THREE.InstancedMesh(flameGeo, lentLook(rows.flameLook), rows.flameCount);
    this.flames.frustumCulled = false; this.flames.count = 0; this.flames.renderOrder = 14; this.flames.name = rows.flameLook;
    scene.add(this.flames);
    const nSmoke = TIER === 'phone' ? rows.smokeCount[0] : rows.smokeCount[1];
    const smokeGeo = new THREE.IcosahedronGeometry(1, TIER === 'phone' ? rows.smokeDetail[0] : rows.smokeDetail[1]);
    this.smokeData = new THREE.InstancedBufferAttribute(new Float32Array(nSmoke * 3), 3);
    smokeGeo.setAttribute('aInst', this.smokeData);
    this.smoke = new THREE.InstancedMesh(smokeGeo, lentLook(rows.smokeLook), nSmoke);
    this.smoke.frustumCulled = false; this.smoke.count = 0; this.smoke.name = rows.smokeLook;
    scene.add(this.smoke);
    for (let i = 0; i < nSmoke; i++) this.pool.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 1, r0: 1, r1: 1, glow: 0, seed: 0, on: false });
  }

  /** The instanced decal a burnt-out cell leaves (the caller's scene owns it). */
  attachScorch(mesh: THREE.InstancedMesh): void { this.scorch = mesh; mesh.count = 0; }

  /** Draw `field`'s burning cells this frame: each rises, roars and sinks to embers, the downwind front tallest, smoke
   *  rolling off. */
  drawField(field: CellField, dt: number, windX: number, windZ: number): void {
    const rows = this.rows.cells; if (rows === undefined) throw new Error('Arena fire has no cell rows');
    const smoke = TIER === 'phone' ? rows.smoke[0] : rows.smoke[1], step = field.rows.cell;
    this.begin();
    for (let c = 0; c < field.length; c++) {
      if (field.state(c) !== field.rows.states.active) continue;
      const left = field.remaining(c), x = field.x(c), z = field.z(c), y = heightAt(x, z) - rows.sink;
      const heat = Math.min(1, (rows.burn - left) / 0.9) * Math.min(1, left / 2.2), next = field.cellAt(x + windX * step, z + windZ * step);
      this.flame(x + Math.sin(c * 3.1) * rows.scatter, y, z + Math.cos(c * 2.3) * rows.scatter, c, heat, next >= 0 && field.state(next) === field.rows.states.idle ? 1 : 0, rows.size);
      if (app.rng.stream('cosmetic').next() < dt * smoke * (0.4 + heat)) this.puff(x, y, z, heat);
    }
    this.end();
  }

  /** A burnt-out cell's scorch, lying on the slope and turned at random. */
  scorchCell(field: CellField, cell: number): void {
    const rows = this.rows.cells, mesh = this.scorch;
    if (rows === undefined || mesh === null || this.scorched >= mesh.instanceMatrix.count) return;
    const random = (): number => app.rng.stream('cosmetic').next(), { jitter, lift, scale } = rows.scorch;
    const x = field.x(cell) + (random() - 0.5) * jitter, z = field.z(cell) + (random() - 0.5) * jitter, n = normalAt(x, z);
    _q.setFromUnitVectors(_y, _p.set(n[0], n[1], n[2]).normalize()).multiply(_q2.setFromAxisAngle(_y, random() * 6.28));
    _m.compose(_p.set(x, heightAt(x, z) + lift, z), _q, _s.set(scale[0] + random() * scale[1], 1, scale[0] + random() * scale[1]));
    mesh.setMatrixAt(this.scorched++, _m); mesh.count = this.scorched; mesh.instanceMatrix.needsUpdate = true;
  }

  /** start a frame's flames */
  begin(): void { this.n = 0; }

  /** one burning cell's flame cluster: `heat` 0..1 (it rises, roars, dies to embers), `front` 1 on the downwind edge */
  flame(x: number, y: number, z: number, cell: number, heat: number, front: number, size: number): void {
    if (this.n >= this.flames.instanceMatrix.count) return;
    const k = size * (this.rows.front[0] + this.rows.front[1] * front) * (this.rows.heat[0] + this.rows.heat[1] * heat);
    _q.setFromAxisAngle(_y, cell * 0.7);
    _m.compose(_p.set(x, y, z), _q, _s.set(k * this.rows.flameWidth, k, k * this.rows.flameWidth));
    this.flames.setMatrixAt(this.n, _m);
    this.flameData.setXYZ(this.n, heat, front, (cell * 0.618) % 1);
    this.n++;
  }

  end(): void {
    this.flames.count = this.n;
    this.flames.instanceMatrix.needsUpdate = true;
    this.flameData.needsUpdate = true;
  }

  /** a smoke puff leaves a burning cell */
  puff(x: number, y: number, z: number, strength: number): void {
    const p = this.pool[this.next];
    this.next = (this.next + 1) % this.pool.length;
    if (!p) return;
    p.on = true; p.x = x + (app.rng.stream('cosmetic').next() - 0.5) * 2; p.y = y + 1.2; p.z = z + (app.rng.stream('cosmetic').next() - 0.5) * 2;
    p.vx = (app.rng.stream('cosmetic').next() - 0.5) * 0.6; p.vz = (app.rng.stream('cosmetic').next() - 0.5) * 0.6; p.vy = this.rows.rise[0] + app.rng.stream('cosmetic').next() * this.rows.rise[1];
    p.age = 0; p.life = this.rows.life[0] + app.rng.stream('cosmetic').next() * this.rows.life[1]; p.r0 = this.rows.radius[0] + app.rng.stream('cosmetic').next() * this.rows.radius[1]; p.r1 = (this.rows.expansion[0] + app.rng.stream('cosmetic').next() * this.rows.expansion[1]) * (0.7 + 0.4 * strength);
    p.glow = strength; p.seed = app.rng.stream('cosmetic').next();
  }

  update(dt: number, t: number, windX: number, windZ: number, windSpeed: number, fog: THREE.Color, flash: number): void {
    this.wind.set(windX, windZ).multiplyScalar(Math.min(0.5, 0.12 + 0.025 * windSpeed));
    const c = fog;
    setLentParam(this.rows.flameLook, 't', t); setLentParam(this.rows.flameLook, 'wind', [this.wind.x, this.wind.y]);
    setLentParam(this.rows.smokeLook, 't', t); setLentParam(this.rows.smokeLook, 'fogC', [c.r, c.g, c.b]); setLentParam(this.rows.smokeLook, 'flash', flash);
    let n = 0;
    for (const p of this.pool) {
      if (!p.on) continue;
      p.age += dt / p.life;
      if (p.age >= 1) { p.on = false; continue; }
      // it rises, slows, and the wind takes it (rolling downwind as a column)
      p.vy *= 1 - dt * 0.25;
      p.x += (p.vx + windX * windSpeed * 0.55 * p.age) * dt; p.z += (p.vz + windZ * windSpeed * 0.55 * p.age) * dt; p.y += p.vy * dt;
      const r = p.r0 + (p.r1 - p.r0) * Math.sqrt(p.age);
      _q.setFromAxisAngle(_y, p.seed * 6.28 + t * 0.2);
      _m.compose(_p.set(p.x, p.y, p.z), _q, _s.set(r, r * 0.85, r));
      this.smoke.setMatrixAt(n, _m);
      this.smokeData.setXYZ(n, p.age, p.glow, p.seed);
      n++;
    }
    this.smoke.count = n;
    this.smoke.instanceMatrix.needsUpdate = true;
    this.smokeData.needsUpdate = true;
  }

  /** the fire is out (the smoke already aloft keeps rising and thins) */
  out(): void { this.n = 0; this.flames.count = 0; }
  /** a reset: nothing burning, no smoke, no scorch */
  clear(): void { this.out(); for (const p of this.pool) p.on = false; this.smoke.count = 0; this.scorched = 0; if (this.scorch !== null) this.scorch.count = 0; }
}

/** Whirlwinds: one admitted wander law each (`laws`, sharing the first's cooldown `cd`), a funnel that eases in at `ease`/s,
 *  spins at `spin` rad/s and breathes `breathe` [share, rate], `sink` m into the ground, and its debris climbing a spiral
 *  (`count` pieces, `climb` turns a second, `turn` rad/s, `step` rad apart, `radius` [base, growth to the top], `height` m,
 *  rolling `roll` rad/s about `axis`, sized `scale` [base, step, steps]). */
const _axis = new THREE.Vector3();
/** The whirlwinds' funnels (the caller's meshes, one per law) and debris (its instanced mesh), moved by their laws. */
export class ArenaWhirlsView {
  private readonly rows: ArenaWhirlsRows;
  private readonly whirls: { readonly law: ProjectedState; readonly funnel: THREE.Object3D; on: boolean; k: number }[];
  private readonly hits: THREE.Vector3[] = [];
  constructor(input: ArenaWhirlsRows, program: ReturnProgram, funnels: readonly THREE.Object3D[], private readonly debris: THREE.InstancedMesh) {
    this.rows = input;
    if (funnels.length !== this.rows.laws.length || debris.instanceMatrix.count < this.rows.laws.length * this.rows.debris.count) throw new Error('Whirlwinds need a funnel each and room for their debris');
    this.whirls = this.rows.laws.map((row, i) => {
      const funnel = funnels[i]; if (funnel === undefined) throw new Error('Missing whirlwind funnel');
      return { law: new ProjectedState(row, program), funnel, on: false, k: 0 };
    });
  }
  /** Which whirlwinds blow (bit i: whirlwind i). */
  arm(mask: number): void { this.whirls.forEach((w, i) => { w.on = (mask & (1 << i)) !== 0; }); }
  reset(): void { for (const w of this.whirls) { w.on = false; w.funnel.visible = false; } this.debris.count = 0; }
  /** Ease, move and draw them; on a decision tick (`thinkDt` > 0) each law steps with `frame` (wx, wz, px, pz). The
   *  whirlwinds that touch the player this tick, where they stand. */
  update(dt: number, t: number, live: boolean, thinkDt: number, frame: { readonly wx: number; readonly wz: number; readonly px: number; readonly pz: number }): readonly THREE.Vector3[] {
    const rows = this.rows, d = rows.debris, shared = this.whirls[0]?.law;
    _axis.fromArray(d.axis).normalize();
    let n = 0, hit = 0;
    for (let i = 0; i < this.whirls.length; i++) {
      const w = this.whirls[i]; if (w === undefined) continue;
      w.k += ((live && w.on ? 1 : 0) - w.k) * Math.min(1, dt * rows.ease);
      w.funnel.visible = w.k > 0.02;
      if (!w.funnel.visible) continue;
      let hurt = false;
      if (thinkDt > 0) {
        const result = w.law.project({ dt: thinkDt, t, index: i, wx: frame.wx, wz: frame.wz, cd: shared?.value('cd') ?? 0, hit: Number(i === 0), px: frame.px, pz: frame.pz, open: Number(live) });
        if (result['broke'] === 1) shared?.set({ cd: result['cd'] ?? 0 });
        hurt = result['hurt'] === 1;
      }
      const x = w.law.value('x'), z = w.law.value('z'), y = heightAt(x, z);
      w.funnel.position.set(x, y - rows.sink, z); w.funnel.rotation.y += dt * rows.spin;
      w.funnel.scale.set(w.k, w.k * (1 + rows.breathe[0] * Math.sin(t * rows.breathe[1] + i)), w.k);
      for (let k = 0; k < d.count; k++) {
        const u = ((k / d.count) + t * d.climb + i * 0.13) % 1, a = t * d.turn + k * d.step, r = d.radius[0] + u * d.radius[1];
        _m.compose(_p.set(x + Math.cos(a) * r, y + u * d.height, z + Math.sin(a) * r), _q.setFromAxisAngle(_axis, t * d.roll + k), _s.setScalar(w.k * (d.scale[0] + (k % d.scale[2]) * d.scale[1])));
        this.debris.setMatrixAt(n++, _m);
      }
      if (hurt) { const at = this.hits[hit] ?? new THREE.Vector3(); this.hits[hit++] = at.set(x, y, z); }
    }
    this.debris.count = n; this.debris.instanceMatrix.needsUpdate = true;
    this.hits.length = hit;
    return this.hits;
  }
}
