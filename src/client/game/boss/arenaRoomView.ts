/** The arena room's view half (P1-E4.2): the drawn room, its portal's scene and fades, the fight's looks and what the page
 *  lends the encounter's server half (`ArenaRoomPage`). The fight itself is arenaRoomFight.ts; this half reads its state. */
import * as THREE from 'three';
import * as v from 'valibot';
import { app } from '@wildshard/engine/app/runtime';
import { installEnteredRuntimeService } from '../shard/retainedHooks';
import { wirePage } from '../shardfile/wirePage';
import { arenaSealCollider } from '../../../shared/game/boss/arenaCollision';
import type { Animal } from '@wildshard/engine/entities/AnimalView';
import { diagnosticNow } from '@wildshard/engine/core/clock';
import { fxMaterial, type FxMaterial } from '@wildshard/engine/fx/groundFx';
import { LightPool } from '@wildshard/engine/fx/LightPool';
import type { BoxSpec as Collider } from '@wildshard/engine/physics/box';
import { HeightPatch } from '@wildshard/engine/physics/heightPatch';
import type { WorldRegistry } from '@wildshard/engine/world/registry';
import { readColliderRows } from '@wildshard/engine/models/colliders';
import { createClientScene } from '../plugin/scene';
import type { BossViewBinding } from '../../../server/game/plugin/bossPhase';
import type { ShardContext } from '../plugin/context';
import type { FixedDraws } from '../models/fixedDraws';
import type { BossBar } from '@wildshard/engine/ui/BossBar';
import type { Game } from '@wildshard/engine/core/Game';
import type { Player } from '@wildshard/engine/player/Player';
import type { RowBodiesView } from '@wildshard/engine/entities/RowBodies';
import type { ReturnProgram } from '../../../shared/game/population/returnProgram';
import { modelContext, type ModelContext } from '@wildshard/engine/models/model';
import { parsePrivateScene } from '@wildshard/format/clientChannels';
import { Rng } from '@wildshard/engine/core/rng';
import { macrotask } from '@wildshard/engine/boot/plan';
import { buildYield } from '@wildshard/engine/core/workSlice';
import { gpuOnlyAttributes } from '@wildshard/engine/core/gpuOnly';
import { listenPage } from '@wildshard/engine/input/dom';
import type { ArenaScriptData } from '@wildshard/format/arenaScriptRows';
import { TIER } from '@wildshard/engine/core/tier';
import { terrainHeight as heightAt } from '@wildshard/engine/world/terrainHeight';
import type { StormReading } from '../../../shared/game/weather/feed';
import { ArenaFireView, ArenaWhirlsView, lendOpenArenaView } from './arenaFire';
import { ArenaPortalLaw } from '../../../shared/game/boss/arenaPortal';
import { ArenaRoomGround } from '../../../shared/game/boss/arenaGround';
import { ArenaRoomPortalSchema, ArenaRoomSchema, type ArenaRoomRows } from '../../../shared/game/boss/arenaRoomRows';
import type { ArenaRoomEncounter, ArenaRoomPage } from './arenaRoom';
import { ArenaSceneView, CloudBody } from './encounterView';
import {entryOwner, lateEntryOwner, presentEntryOwner} from '../../../shared/game/shardfile/entryOwners';
import { prepareLentLooks } from '../shardfile/lentLooks';
import type { Scope } from '@wildshard/engine/app/scope';
import { pageRidingMount, respawnPageMounted, installArenaBoundary } from '../riding/client';
/** Client-only arena attachments and deformable floor, driven by scene and encounter rows. */

/** Native owners borrowed by an arena portal, without author callbacks. */
export interface ArenaRoomPortalWorld {
  readonly game: Pick<Game, 'scene' | 'camera'>;
  readonly player: Pick<Player, 'position' | 'velocity' | 'yaw' | 'pitch' | 'moveScale'>;
  readonly animals: Pick<RowBodiesView, 'calm' | 'group'>;
}
/** Client-only entry/exit lifecycle of the existing arena host. AS observes
 * the actual room floor and entrance; the host owns fades, isolation, movement
 * and the single ordered boss/room update. Row data chooses all room policy. */
export class ArenaRoomPortal {
  /** the portal's decisions and fade (renderer-free, CI12) */
  private readonly law: ArenaPortalLaw;
  get inside(): boolean { return this.law.inside; }
  private readonly rows;
  private readonly keep: RegExp;
  private hidden: THREE.Object3D[] = [];
  private calmWas = false;
  private locked = false; private slow = false;
  private ui: BossBar | null = null;
  /** The encounter's own frame: its brain on a page, its row on the wire. */
  private drive: ((dt: number, t: number) => void) | null = null;
  constructor(private readonly world: ArenaRoomPortalWorld, private readonly room: BossArenaRoom, input: unknown,
    program: ReturnProgram, private readonly entrance: { readonly x: number; readonly y: number; readonly z: number; readonly facing: number } | null) {
    this.rows = v.parse(ArenaRoomPortalSchema, input); this.keep = new RegExp(this.rows.keep, 'i');
    this.law = new ArenaPortalLaw(program, this.rows, entrance);
  }
  bind(ui: BossBar, drive: (dt: number, t: number) => void): void { this.ui = ui; this.drive = drive; }
  setLocked(on: boolean): void { this.locked = on; this.move(); }
  private move(): void { this.world.player.moveScale = this.locked ? 0 : this.slow ? this.rows.slow : 1; }
  enter(immediate = false, atZ: number = this.rows.spawn.z): void {
    if (!immediate) { this.ui?.fade(true, this.rows.fade.out); this.law.begin('enter', this.rows.fade.hold); return; }
    const { player } = this.world;
    this.room.world(this.rows.spawn.x, 0, atZ, player.position);
    player.velocity.set(0,0,0); player.yaw = this.rows.spawn.yaw; player.pitch = 0;
    this.show();
  }
  /** The room stands in for the world around it. */
  private show(): void {
    const { game, animals } = this.world, origin = this.room.rows.origin;
    this.law.inside = true; this.room.setVisible(true); this.hidden = [];
    for (const object of game.scene.children) {
      if (!object.visible || object === this.room.group || object === animals.group || object === game.camera || object instanceof THREE.Light || this.keep.test(object.name) || object.type === 'Points'
        || object.position.distanceToSquared(new THREE.Vector3(origin.x,origin.y,origin.z)) < this.rows.near ** 2) continue;
      object.visible = false; this.hidden.push(object);
    }
    this.calmWas = animals.calm; animals.calm = true; // the page's brain never arms on the wire: the row is the fight
  }
  leave(teleport: boolean, immediate = false): void {
    if (teleport && !immediate) { this.ui?.fade(true, this.rows.fade.out); this.law.begin('exit', this.rows.fade.hold); return; }
    const { player } = this.world, e = this.entrance;
    if (teleport && e !== null) {
      player.position.set(e.x - Math.sin(e.facing) * this.rows.exitOffset, e.y, e.z - Math.cos(e.facing) * this.rows.exitOffset);
      player.yaw = e.facing; player.pitch = 0; player.velocity.set(0,0,0);
    }
    this.gone();
  }
  /** The world comes back. */
  private gone(): void {
    const { animals } = this.world;
    this.law.inside = false; this.room.setVisible(false);
    for (const object of this.hidden) object.visible = true;
    this.hidden = []; animals.calm = this.calmWas;
    this.slow = false; this.locked = false; this.move();
  }
  update(dt: number, t: number): void {
    const p = this.world.player.position;
    // the server walks a player in and out: the page follows where it put them, and the fight's frame runs on its row
      const inside = this.room.inVolume(p);
      if (inside !== this.law.inside) { if (inside) this.show(); else this.gone(); }
      this.drive?.(dt,t);
      if (inside) this.room.update(dt,t);
  }
}
interface Stream { mesh: THREE.Mesh; mat: FxMaterial; tell: THREE.Mesh; tellMat: FxMaterial; x: number; z: number }
interface Ring { mesh: THREE.Mesh; mat: FxMaterial }



export class BossArenaRoom {
  group: THREE.Object3D = new THREE.Group();
  readonly colliders: Collider[] = [];

  readonly floorHeightAt = (x: number, z: number): number | undefined => this.floorAt(x, z);

  readonly streams: Stream[] = [];
  readonly rings: Ring[] = [];
  declare beam: { mesh: THREE.Mesh; mat: FxMaterial; line: THREE.Mesh; lineMat: FxMaterial };
  declare dome: { mesh: THREE.Mesh; mat: FxMaterial };
  declare arc: { mesh: THREE.Mesh; mat: FxMaterial };
  private shafts: { mesh: THREE.Mesh; mat: FxMaterial; target: number }[] = [];
  declare private flames: FxMaterial;
  declare private curtain: { mesh: THREE.Mesh; mat: FxMaterial; k: number; target: number };
  private sealCollider: Collider;
  declare private lid: THREE.Mesh;
  private statues: THREE.Mesh[] = [];
  declare private heap: THREE.Mesh;
  private fx: FxMaterial[] = [];
  // the sand drifts: a heightfield over the chamber floor (this.rows.sandCells × this.rows.sandCells cells), drawn as one displaced grid
  /** the room's ground: its volumes, floor and sand drifts (renderer-free, CI12) */
  readonly ground: ArenaRoomGround;
  declare private sandMesh: THREE.Mesh;
  private sandLight: Float32Array;
  private readonly sandColor: THREE.Color;
  actor: Animal | null = null;
  private sandPatch: HeightPatch | null = null;
  private staticMaterial: THREE.MeshBasicMaterial | null = null;
  private staticBuilt = false;

  readonly rows: ArenaRoomRows;
  constructor(input: unknown, private readonly geometry: ReadonlyMap<string, THREE.BufferGeometry>) {
    const rows = v.parse(ArenaRoomSchema, input); this.rows = rows;
    this.ground = new ArenaRoomGround(rows);
    this.sandLight = new Float32Array((rows.sandCells + 1) ** 2 * 3);
    this.sandColor = new THREE.Color(rows.sandColor);
    this.sealCollider = { x: this.rows.origin.x, z: this.rows.origin.z + this.rows.halfWidth + 0.1, hw: this.rows.doorHalfWidth + 0.3, hd: 0.25, rot: 0, yTop: this.rows.origin.y - 50, yBottom: this.rows.origin.y - 51 };
  }


  // Local frames.
  world(lx: number, ly: number, lz: number, out: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 { return out.set(this.rows.origin.x + lx, this.rows.origin.y + ly, this.rows.origin.z + lz); }
  inChamber(p: THREE.Vector3): boolean { return this.ground.inChamber(p); }
  inDromos(p: THREE.Vector3): boolean { return this.ground.inDromos(p); }
  inVolume(p: THREE.Vector3): boolean { return this.ground.inVolume(p); }

  build(lazyStatic = false): this {
    const steps = this.buildSteps(lazyStatic);
    while (steps.next().done !== true) { /* every part now */ }
    return this;
  }

  async buildSliced(lazyStatic: boolean, yieldTask: () => Promise<void>): Promise<this> {
    const steps = this.buildSteps(lazyStatic);
    while (steps.next().done !== true) await yieldTask();
    return this;
  }

  private *buildSteps(lazyStatic: boolean): Generator<void, void> {
    const t0 = diagnosticNow();
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
    this.staticMaterial = mat;
    const materials = new Map<string, THREE.Material>([['fabric', mat]]);
    for (const row of this.rows.view.fx) {
      const mode = row.mode;
      if (mode !== 0 && mode !== 1 && mode !== 2 && mode !== 3 && mode !== 4 && mode !== 5 && mode !== 6 && mode !== 7) throw new Error('Invalid chamber effect');
      const material = fxMaterial(mode, new THREE.Color().fromArray(row.color), row.alpha, row.additive);
      material.depthTest = row.depthTest; material.uniforms.uP.value.fromArray(row.p);
      materials.set(row.id, material); this.fx.push(material);
    }
    const recipe = this.rows.view.scene;
    const scene = createClientScene(recipe, { geometry: this.geometry, materials });
    this.group = scene.root;
    const effect = (id: string): Ring => {
      const part: unknown = scene.parts.get(id), material = materials.get(id);
      if (!chamberMesh(part) || !(material instanceof THREE.ShaderMaterial) || !this.fx.includes(material as FxMaterial)) throw new Error('Missing chamber effect');
      return { mesh: part, mat: material as FxMaterial };
    };
    const mesh = (id: string): THREE.Mesh => { const part: unknown = scene.parts.get(id); if (!chamberMesh(part)) throw new Error('Missing chamber part'); return part; };
    this.lid = mesh(this.rows.lid); this.heap = mesh(this.rows.heap); this.sandMesh = mesh(this.rows.sand);
    this.statues = this.rows.markers.map(id => mesh(id));
    const sand = this.sandMesh.geometry;
    this.sandLight = Float32Array.from(sand.getAttribute('light').array); sand.deleteAttribute('light');
    const position = sand.getAttribute('position'); if (position instanceof THREE.BufferAttribute) position.setUsage(THREE.DynamicDrawUsage);
    this.shafts = this.rows.shafts.map(row => Object.assign(effect(row.id), { target: row.base }));
    this.flames = effect(this.rows.flames).mat;
    this.rings.push(...this.rows.rings.map(id => effect(id)));
    this.streams.push(...this.rows.streams.map(spot => { const stream = effect(spot.id), tell = effect(spot.tell); return Object.assign(stream, { tell: tell.mesh, tellMat: tell.mat, x: spot.x, z: spot.z }); }));
    const beam = effect(this.rows.beam), line = effect(this.rows.line); this.beam = { ...beam, line: line.mesh, lineMat: line.mat };
    this.dome = effect(this.rows.dome); this.arc = effect(this.rows.arc); this.curtain = { ...effect(this.rows.seal), k: 0, target: 0 };
    this.colliders.push(...structuredClone(this.rows.collision.boxes), this.sealCollider);
    if (!lazyStatic) this.buildStatic();
    this.tris = this.rows.triangles; this.buildMs = Math.round(diagnosticNow() - t0);
    yield;
  }

  private buildStatic(): void {
    if (this.staticBuilt) return;
    if (this.staticMaterial === null) throw new Error('The dungeon must build before entry');
    const scene = createClientScene(this.rows.view.static, { geometry: this.geometry, materials: new Map([['fabric', this.staticMaterial]]) });
    this.group.add(scene.root);
    this.group.children.pop(); this.group.children.unshift(scene.root);
    this.staticBuilt = true;
  }

  async buildStaticSliced(yieldTask: () => Promise<void>): Promise<void> { this.buildStatic(); await yieldTask(); }
  buildMs = 0; tris = 0;

  register(registry: WorldRegistry): void {
    const Y0 = this.rows.origin.y;
    // JSON has one zero; the original box conversion negates its zero yaw.
    const descs = readColliderRows(this.rows.collision.descs, { kinds: ['box', 'capsule'], surfaces: ['wood', 'stone', 'metal', 'sand'] });
    for (const desc of descs) if (desc.kind === 'box' && desc.yaw === 0) desc.yaw = -0;
    registry.add({ id: this.rows.id, name: this.rows.name, category: 'buildings', file: this.rows.file, surface: 'wood', colliders: descs, floor: this.floorHeightAt, solidFloor: true });
    // the seal: its box in the interior group's frame (the group stands at this.rows.origin, never moves)
    registry.add({
      id: this.rows.sealId, name: this.rows.sealName, category: 'buildings', file: this.rows.file, surface: 'sand', follows: this.group,
      colliders: [arenaSealCollider(this.rows)], active: () => this.sealed,
    });
    const ph = app.physics;
    if (ph) this.sandPatch = new HeightPatch(ph, { x: this.rows.origin.x, y: Y0, z: this.rows.origin.z, size: this.rows.halfWidth * 2, res: this.rows.sandCells + 1, material: 'sand', owner: this });
  }

  // Walkable heights.
  private floorAt(x: number, z: number): number | undefined { return this.ground.floorAt(x, z); }

  /** Whether this room's looks exist yet. */
  get built(): boolean { return this.staticBuilt; }
  sandAt(lx: number, lz: number): number { return this.ground.sandAt(lx, lz); }
  addSand(lx: number, lz: number, r: number, dh: number, max = 1.0): void { this.ground.addSand(lx, lz, r, dh, max); }
  clearSand(): void { this.ground.clearSand(); }
  drainSand(dt: number, rate = 0.25): void { this.ground.drainSand(dt, rate); }

  private writeSand(): void {
    const g = this.sandMesh.geometry, pos = g.getAttribute('position'), col = g.getAttribute('color');
    const N1 = this.rows.sandCells + 1;
    const grid = this.sandPatch ? new Float32Array(N1 * N1) : null;
    let any = false;
    for (let j = 0; j < N1; j++) for (let i = 0; i < N1; i++) {
      const vertex = j * N1 + i;
      // vertex height = the mean of the (up to) four cells round it
      let s = 0, c = 0;
      for (const [di, dj] of [[-1, -1], [0, -1], [-1, 0], [0, 0]] as const) { const ci = i + di, cj = j + dj; if (ci >= 0 && cj >= 0 && ci < this.rows.sandCells && cj < this.rows.sandCells) { s += this.ground.sand[cj * this.rows.sandCells + ci] ?? 0; c++; } }
      const h = c > 0 ? s / c : 0;
      if (h > 0.01) any = true;
      if (grid) grid[vertex] = h;
      pos.setY(vertex, h > 0.01 ? h : -0.05);
      const k = 0.85 + 0.25 * Math.min(1, h / 0.6);
      col.setXYZ(vertex, this.sandColor.r * k * (this.sandLight[vertex * 3] ?? 1), this.sandColor.g * k * (this.sandLight[vertex * 3 + 1] ?? 1), this.sandColor.b * k * (this.sandLight[vertex * 3 + 2] ?? 1));
    }
    pos.needsUpdate = true; col.needsUpdate = true;
    this.sandMesh.visible = any;
    if (grid) this.sandPatch?.set(grid);   // P1: the drifts are walkable as real geometry (row j = z, column i = x)
  }

  // State the fight drives.
  setSealed(on: boolean): void {
    this.curtain.target = on ? 1 : 0;
    this.sealCollider.yBottom = on ? this.rows.origin.y - 1 : this.rows.origin.y - 51;
    this.sealCollider.yTop = on ? this.rows.origin.y + this.rows.doorHeight + 1 : this.rows.origin.y - 50;
  }
  get sealed(): boolean { return this.curtain.target > 0.5; }
  setLid(open: number): void {
    const k = THREE.MathUtils.clamp(open, 0, 1);
    const slide = THREE.MathUtils.smoothstep(k, 0, 0.7), tip = THREE.MathUtils.smoothstep(k, 0.55, 1);
    const motion = this.rows.coverMotion;
    this.lid.position.set(motion.closed[0] + motion.slide[0] * slide + motion.tip[0] * tip, motion.closed[1] + motion.slide[1] * slide + motion.tip[1] * tip, motion.closed[2] + motion.slide[2] * slide + motion.tip[2] * tip);
    this.lid.rotation.set(motion.slideRotation[0] * slide + motion.tipRotation[0] * tip, motion.slideRotation[1] * slide + motion.tipRotation[1] * tip, motion.slideRotation[2] * slide + motion.tipRotation[2] * tip);
  }
  setNicheStatue(i: number, on: boolean): void { const s = this.statues[i]; if (s) s.visible = on; }
  setShaft(i: number, strength: number): void { const s = this.shafts[i]; if (s) s.target = strength; }
  showHeap(on: boolean, lx: number = this.rows.cover.x + 1.8, lz: number = this.rows.cover.z + 2.6): void { this.heap.visible = on; this.heap.position.set(lx, this.sandAt(lx, lz), lz); }
  setVisible(on: boolean): void {
    if (on && !this.staticBuilt) this.buildStatic();
    this.group.visible = on;
  }

  update(dt: number, t: number): void {
    if (!this.group.visible) return;
    for (const m of this.fx) m.uniforms.uTime.value = t;
    for (const s of this.shafts) {
      const a = s.mat.uniforms.uAlpha;
      a.value += (s.target - a.value) * Math.min(1, dt * 1.5);
      s.mesh.visible = a.value > 0.01;
    }
    const c = this.curtain;
    c.k += (c.target - c.k) * Math.min(1, dt * (c.target > c.k ? 3 : 1.2));
    c.mat.uniforms.uAlpha.value = c.k;
    c.mesh.visible = c.k > 0.02;
    this.flames.uniforms.uAlpha.value = 0.85 + 0.15 * Math.sin(t * 13) * Math.sin(t * 7.3);
    wirePage.sandInto(this.ground, this.rows.id);
    if (this.ground.pace(dt)) this.writeSand();
  }
}


const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _h = new THREE.Vector3();
function chamberMesh(value: unknown): value is THREE.Mesh { return value instanceof THREE.Mesh; }
const valueOrZero = (value: number | undefined): number => value ?? 0;


export function arenaRoomViews(d: BossArenaRoom, tuning: { readonly reach: number; readonly ringMax: number; readonly beamRadius: number }): BossViewBinding {
  d.dome.mesh.scale.setScalar(1.75);
  d.dome.mat.uniforms.uAlpha.value = 0.9;
  return {
    'arena.lid.open': (open) => { d.setLid(valueOrZero(open)); },
    'arena.shaft': (i, strength) => { d.setShaft(valueOrZero(i), valueOrZero(strength)); },
    'arena.fx.hide': () => {
      for (const r of d.rings) r.mesh.visible = false;
      for (const s of d.streams) { s.mesh.visible = false; s.tell.visible = false; }
      d.beam.mesh.visible = false; d.beam.line.visible = false; d.dome.mesh.visible = false; d.arc.mesh.visible = false;
    },
    'arena.shield': (on) => { d.dome.mesh.visible = on === 1; },
    'arena.shield.at': (x, y, z) => { d.dome.mesh.position.set(valueOrZero(x) - d.rows.origin.x, valueOrZero(y) - d.rows.origin.y, valueOrZero(z) - d.rows.origin.z); },
    'adds.spot': (i, on) => { d.setNicheStatue(valueOrZero(i), on === 1); },
    'boss.glow': (k) => {
      const body = d.actor;
      if (!body) return;
      const mats = Array.isArray(body.mesh.material) ? body.mesh.material : [body.mesh.material];
      for (const m of mats) if (m instanceof THREE.MeshLambertMaterial) { m.emissive.fromArray(d.rows.glowColor); m.emissiveIntensity = valueOrZero(k); }
    },
    'strike.arc': (x, floorY, z, yaw) => {
      const arc = d.arc;
      arc.mesh.visible = true;
      arc.mesh.position.set(valueOrZero(x) - d.rows.origin.x, valueOrZero(floorY) - d.rows.origin.y + 0.04, valueOrZero(z) - d.rows.origin.z);
      arc.mesh.rotation.y = valueOrZero(yaw) - Math.PI / 2;
      arc.mesh.scale.setScalar(tuning.reach * 1.15);
    },
    'strike.arc.off': () => { d.arc.mesh.visible = false; },
    'hazard.ring': (i, cx, cz, r) => {
      const vis = d.rings[valueOrZero(i)];
      if (!vis) return;
      vis.mesh.visible = true;
      vis.mesh.position.set(valueOrZero(cx) - d.rows.origin.x, 0.06, valueOrZero(cz) - d.rows.origin.z);
      vis.mesh.scale.setScalar(valueOrZero(r));
      vis.mat.uniforms.uAlpha.value = 1.4 * (1 - THREE.MathUtils.smoothstep(valueOrZero(r), tuning.ringMax * 0.7, tuning.ringMax));
    },
    'hazard.ring.off': (i) => { const vis = d.rings[valueOrZero(i)]; if (vis) vis.mesh.visible = false; },
    'hazard.ring.tell': (x, floorS, z, charge) => {
      const ring = d.rings[1];
      if (!ring) return;
      ring.mesh.visible = true;
      ring.mesh.position.set(valueOrZero(x) - d.rows.origin.x, valueOrZero(floorS) - d.rows.origin.y + 0.05, valueOrZero(z) - d.rows.origin.z);
      ring.mesh.scale.setScalar(2.4 - 1.6 * valueOrZero(charge));
      ring.mat.uniforms.uAlpha.value = 0.4 + 0.6 * valueOrZero(charge);
    },
    'hazard.pour.off': (i) => { const vis = d.streams[valueOrZero(i)]; if (vis) { vis.mesh.visible = false; vis.tell.visible = false; } },
    'hazard.pour.tell': (i, t) => {
      const vis = d.streams[valueOrZero(i)];
      if (!vis) return;
      vis.tell.visible = true; vis.tellMat.uniforms.uAlpha.value = Math.min(1, valueOrZero(t) * 2) * 0.9;
      vis.tell.position.y = d.sandAt(vis.x, vis.z) + 0.05;
    },
    'hazard.pour.fall': (i, k) => {
      const vis = d.streams[valueOrZero(i)];
      if (!vis) return;
      vis.tell.visible = false;
      vis.mesh.visible = true;
      vis.mat.uniforms.uAlpha.value = valueOrZero(k);
    },
    'hazard.sweep': (cx, cz, angle, dir, k) => {
      const b = d.beam, R = tuning.beamRadius, a = valueOrZero(angle);
      const top = _w.fromArray(d.rows.beamTop);
      _v.set(valueOrZero(cx), 0, valueOrZero(cz));
      const len = _v.distanceTo(top);
      b.mesh.visible = true;
      b.mesh.position.copy(_v);
      b.mesh.scale.set(1, len, 1);
      b.mesh.quaternion.setFromUnitVectors(_h.set(0, 1, 0), top.sub(_v).normalize());
      b.mat.uniforms.uAlpha.value = 0.7 * valueOrZero(k);
      b.line.visible = true;
      b.line.rotation.y = valueOrZero(dir) > 0 ? a - Math.PI / 2 : a - Math.PI / 2 - Math.PI * 0.6;
      b.line.scale.set(R / 6, 1, R * 0.85 / 6);
      b.line.position.set(0, 0.05, -0.5);
      b.lineMat.uniforms.uAlpha.value = 0.55 * valueOrZero(k);
    },
    'hazard.sweep.off': () => { d.beam.mesh.visible = false; d.beam.line.visible = false; },
    'victory.heap': (on, x, z) => {
      if (on !== 1) { d.showHeap(false); return; }
      d.showHeap(true, valueOrZero(x) - d.rows.origin.x, valueOrZero(z) - d.rows.origin.z);
    },
  };
}

/** Native cloud resources are identical for an entered fight and its specimen. */
function arenaScriptCloud(scene: THREE.Scene, state: Readonly<Record<string,number>>, data: ArenaScriptData): CloudBody {
  const g = data.geometry;
  return new CloudBody(scene,{ ...g.body,geometry: { ...g.body.geometry,eyes: g.eyes },poses: g.poses,
    puffs: { ...g.body.puffs,rows: g[TIER].puffs } },state,new Map([['place',{ ...data.arena.body,ground: heightAt(data.arena.ground.x,data.arena.ground.z) }]]));
}

/**
 * G808: the arena's spare light (the reward's slot, dark until the victory) is a LightPool light of the scene it lights.
 * A raw scene light counted in every lit program's key: two arenas in a grid region raised the page from 5 to 7 point
 * lights, so a crossing into Nalati linked 83 of its 142 programs a second time, once per light count. A region's pool
 * is mirrored onto the page's reserved lights (regionalWorld.ts), so the page count never moves; a solo page's pool is
 * fixed after its first render. Same colour, reach, decay and place; dark, so nothing it lights changes.
 */
function pooledSpare(scene:THREE.Scene,colour:THREE.ColorRepresentation,at:THREE.Vector3):THREE.PointLight{
  const light=LightPool.for(scene).acquire(colour,0,1,2);light.position.copy(at);return light;
}

/** What the page lends each encounter (`ArenaRoomPage`): the looks it draws with and the DOM it listens to. */
export const ARENA_ROOM_PAGE: ArenaRoomPage = {
  phone: TIER === 'phone', ai: () => app.rng.stream('ai'),
  roomLight: (colour, at) => { const light = new THREE.PointLight(colour, 0, 1, 2); light.position.copy(at); return light; },
  openLight: pooledSpare,
  openViews: (scene, rows) => ({ body: pose => arenaScriptCloud(scene, pose, rows), arena: () => new ArenaSceneView(scene, rows.geometry.arena),
    whirls: (arena, windLaw, author, scope) => new ArenaWhirlsView(rows.whirls, windLaw, [arena.mesh('funnel0'), arena.mesh('funnel1'), arena.mesh('funnel2')], arena.instances('debris'), author, scope),
    whirlsPreflight: (whirls, bindings) => { ArenaWhirlsView.preflight(whirls, bindings); },
    fire: () => new ArenaFireView(scene, rows.arenaFire, (TIER === 'phone' ? rows.geometry.phone : rows.geometry.desktop).flames) }),
  portal: (world, room, rows, program, entrance) => new ArenaRoomPortal(world, room, rows, program, entrance),
  views: arenaRoomViews,
  rewardObject: (model, sky) => {
    const object = model.build(modelContext(sky), model.defaults, new Rng(0));
    if (!(object instanceof THREE.Object3D)) throw new Error('Arena reward requires a native scene specimen');
    return object;
  },
  entered: installEnteredRuntimeService, mount: pageRidingMount, respawnMounted: respawnPageMounted, boundary: installArenaBoundary, lendOpenView: lendOpenArenaView,
  listenSkip: (scope, held) => {
    listenPage(scope, 'keydown', event => { if (event instanceof KeyboardEvent && event.code === 'Enter') held('key', true); });
    listenPage(scope, 'keyup', event => { if (event instanceof KeyboardEvent && event.code === 'Enter') held('key', false); });
    listenPage(scope, 'pointerdown', () => { held('touch', true); }); listenPage(scope, 'pointerup', () => { held('touch', false); }); listenPage(scope, 'pointercancel', () => { held('touch', false); });
  },
};

/** Immutable resource ids used by the native arena's admitted private scenes. */
function arenaRoomGeometryIds(input: unknown): readonly string[] {
  const room = v.parse(ArenaRoomSchema,input);
  return [...new Set([parsePrivateScene(room.view.scene),parsePrivateScene(room.view.static)].flatMap(scene => scene.nodes.flatMap(node => node.kind === 'mesh' ? [node.geometry] : [])))];
}
/** The native arena constructs its own resource map from the world's loaded fixed draws (every admitted geometry id is
 *  found before any copy is made) and owns build slicing. */
export function buildArenaRoomEncounter(Encounter:typeof ArenaRoomEncounter,input:{readonly kind:'open';readonly ports:Parameters<typeof buildOpenArenaEncounter>[1];readonly rows:Parameters<typeof buildOpenArenaEncounter>[2]}):Promise<ArenaRoomEncounter>;
export function buildArenaRoomEncounter(Encounter:typeof ArenaRoomEncounter,ctx: ShardContext, room: unknown, encounter: unknown,
  draws: Pick<FixedDraws, 'ready' | 'handle'>, entrance: { readonly x: number; readonly y: number; readonly z: number; readonly facing: number } | null):Promise<ArenaRoomEncounter>;
export function buildArenaRoomEncounter(Encounter:typeof ArenaRoomEncounter,ctx:ShardContext|{readonly kind:'open';readonly ports:Parameters<typeof buildOpenArenaEncounter>[1];readonly rows:Parameters<typeof buildOpenArenaEncounter>[2]},room?:unknown,encounter?:unknown,
  draws?:Pick<FixedDraws,'ready'|'handle'>,entrance:{readonly x:number;readonly y:number;readonly z:number;readonly facing:number}|null=null):Promise<ArenaRoomEncounter>{
  if('kind' in ctx)return buildOpenArenaEncounter(Encounter,ctx.ports,ctx.rows);
  const world = ctx.game.runtime?.world; if (world === undefined || world === null) throw new Error('Arena build requires its entered world');
  if (draws===undefined||!draws.ready) throw new Error('Arena build requires its loaded fixed draws');
  const handles = arenaRoomGeometryIds(room).map(id => [id, draws.handle(id)] as const);
  const geometry = new Map(handles.map(([id, handle]) => [id, handle.copy()]));
  const dungeon = new BossArenaRoom(room,geometry);
  const sand = parsePrivateScene(dungeon.rows.view.scene).nodes.find(node => node.id === dungeon.rows.sand);
  if (sand?.kind !== 'mesh') throw new Error('Missing chamber sand geometry');
  // These are private draw copies, never the rebuild templates. Sand rewrites
  // positions/colours; the other shapes only move or change material uniforms.
  for (const [id, shape] of geometry) if (id !== sand.geometry) gpuOnlyAttributes(shape, 'arena.room');
  return sliceArenaRoom(new Encounter(dungeon,encounter,entrance,ARENA_ROOM_PAGE),dungeon,{ scene: world.game.scene,registry: ctx.app.registry });
}

/** The room's parts each take a build slice; its spare light joins the scene's pool once the room is in that scene. */
export async function sliceArenaRoom(encounter:ArenaRoomEncounter,dungeon:BossArenaRoom,world:{readonly scene:THREE.Scene;readonly registry:WorldRegistry}):Promise<ArenaRoomEncounter>{
  await dungeon.buildSliced(true,macrotask);await macrotask();world.scene.add(dungeon.group);encounter.spareLight=pooledSpare(world.scene,encounter.spareLight.color,encounter.spareLight.position);dungeon.register(world.registry);
  return encounter;
}

async function buildOpenArenaEncounter(Encounter:typeof ArenaRoomEncounter,ports: {readonly scope:Scope;readonly weatherContext?:ShardContext;readonly context:Pick<ModelContext,'sky'>}, stage:{readonly id:string;readonly files:{readonly fight:string;readonly geometry:string};readonly weather:string;readonly anchor:string}):Promise<ArenaRoomEncounter> {
  const scope = ports.scope, ctx = ports.weatherContext, runtime = ctx?.game.runtime, world = runtime?.world;
  if (ctx === undefined || runtime === undefined || world === undefined || world === null || ctx.scope !== scope)
    throw new Error('World arena needs its original construction context');
  const product = ctx.product, game = world.game, player = world.player, sky = world.sky, root = game.scene, owner = game.levelScope;
  const read = product.json, answer = ctx.answer, point = entryOwner(scope, 'world-point', stage.anchor);
  const x = point?.x, y = point?.y, z = point?.z, weatherLoan = lateEntryOwner(scope, 'world-weather', stage.weather);
  let weather: { readonly rig: ReturnType<typeof weatherLoan>; readonly storm: StormReading } | undefined;
  const live = (): void => {
    if (scope.disposed || scope.disposing || owner.disposed || owner.disposing) throw new Error('World arena owner left');
    if (ports.weatherContext !== ctx || ctx.scope !== scope || ctx.product !== product || product.json !== read || ctx.answer !== answer
      || ctx.game.runtime !== runtime || runtime.world !== world || world.game !== game || world.player !== player || world.sky !== sky
      || game.scene !== root || game.levelScope !== owner || ports.context.sky !== sky
      || entryOwner(scope, 'world-point', stage.anchor) !== point
      || point?.x !== x || point?.y !== y || point?.z !== z) throw new Error('World arena owners changed');
  };
  const weatherOwner = (): NonNullable<typeof weather> => {
    live();
    const rig = weatherLoan(), storm = rig.storm;
    if (weather !== undefined && (weather.rig !== rig || weather.storm !== storm))
      throw new Error('World arena owners changed');
    if (storm === null) throw new Error('World arena needs its original storm');
    weather ??= { rig, storm };
    return weather;
  };
  const constructionLive = (): void => {
    live();
    if (weather !== undefined || presentEntryOwner(scope, 'world-weather', stage.weather) !== null) weatherOwner();
  };
  constructionLive();
  const data = await Encounter.readOpen(product, stage.files); constructionLive();
  for (const program of [data.programs.attack, data.programs.wind]) {
    if (Encounter.prepareProgram(program, owner)) { await buildYield(owner); constructionLive(); }
  }
  // G639: the fight's programmes admit in their own build slices, into the same level-scope cache the encounter's
  // constructor reads (one Nalati world-hook frame held the read, both admissions and the views: 136 ms at phone 4x)
  for (const program of [data.programs.attack, data.programs.wind]) { await buildYield(owner); constructionLive(); Encounter.admitProgram(program, owner); }
  await buildYield(owner); constructionLive();
  // its fire and cloud looks compile a build step each first: inside the constructor they shared one frame (~50 ms of a
  // 133 ms Nalati world-hook frame at phone 4x)
  await prepareLentLooks([data.arenaFire.flameLook, data.arenaFire.smokeLook, data.geometry.body.puffs.look]); constructionLive();
  const encounter = new Encounter({kind:'open',page:ARENA_ROOM_PAGE,world:{game,player,
    get weather() { return weatherOwner().storm; },tieSpot:point},rows:data}); constructionLive();
  ctx.answer('weather.storm-hold', held => Math.max(held, Number(encounter.engaged))); constructionLive();
  return encounter;
}
