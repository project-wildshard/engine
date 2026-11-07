import { engineString } from '../../../../shared/engine/strings';
/**
 * Interactables — the runtime of the interactables kit (A2): builds every row of an `InteractTable` (types.ts) into TWO
 * BatchedMeshes for the whole shard (lit parts on the shared `lowPolyLookMaterial`, glowing parts unlit — 2 draw calls,
 * per-instance frustum culling), wires one E-prompt per row into the game's interactable list, adds colliders, and
 * runs the behaviour: lids and doors swing, levers throw, plates sink under you or a barrel (an overlap query of the
 * PLAYER / ITEM groups), the barrel is a dynamic body your capsule pushes (PHYSICS P7-L1: it tips, rolls, stops at
 * walls; `BarrelWatch` sends it home when it is lost or wedged), pickups bob and are taken, the beacon burns. All state
 * lives in `Flags` (flags.ts), so a quest, a save and a validator see the same thing.
 *
 *   const kit = new Interactables({ scene, sky, player, flags, place, floorAt, prompts: interactables }).build(table);
 *   kit.onEvent = (e) => { … toast / audio / inventory … };          // see InteractEvent
 *   game.onUpdate((dt, t) => kit.update(dt, t));
 *   kit.moveTo('hold-key', x, z)                                      // a key dropped where the sailor fell
 *   kit.live('hold-grate')?.position                                  // world position of a row
 *
 * No point lights (plan row 0.3: lights are never added / removed mid-play); glow is emissive-looking unlit colour that
 * blooms, pulsed through the per-instance colour.
 *
 * E306 / E315 M1 (second pass): each row's thing is a model (src/client/engine/models/interact.ts: sea chest, key, pickups, door, lever,
 * pressure plate, puzzle barrel, beacon, bench, shard altar), placed `drawnInto` the batch that draws it — one placement
 * per row, so each card counts its copies and VIEW IN WORLD lands on one. The batches stay the kit's (two draws, posed
 * every frame); so does the collision (moving boxes, the barrel's body).
 */
import * as THREE from 'three';
import { ChangedBatchedMesh } from '../../render/changedTextureUploads';
import { app } from '../../app/runtime';
import { lowPolyLookMaterial } from '../lowpolyKit';
import type { SkyRig as Sky } from '../skyRig';
import type { BoxSpec as Collider } from '../../../../shared/engine/physics/box';
import { boxInFrame } from '../../physics/boxFrame';
import { boxDesc, type Piece } from '../registry';
import type { Physics } from '../../../../shared/engine/physics/Physics';
import type { GroupName } from '../../../../shared/engine/physics/groups';
import type { Body } from '../../../../shared/engine/physics/bodies';
import { BARREL_BODY, BARREL_HALF, BARREL_R, BarrelWatch, barrelAtPlate, plateOverlap, type BarrelEnv } from '../../../../shared/engine/world/interact/barrel';
import { waterLevel } from '../../../../shared/engine/world/Heightfield';
import { test, bindInteractionState, type Flags } from '../../../../shared/engine/world/interact/flags';
import { bindInteractPlacements, autoFlag, interactProps, pickupLook, type Interactable, type InteractDef, type InteractTable, type Place } from '../../../../shared/engine/world/interact/types';
import { modelContext, type ModelDef, type Placement } from '../../models/model';
import { place, type Placed } from '../../models/place';
import { InstancedBatch } from '../../models/instancedBatch';
import { walkInPickup } from '../../../../shared/engine/world/interact/pickup';
import { pickPrompt, promptVisible, setPromptSight, PROMPT_SIGHT_SLACK } from '../../../../shared/engine/world/interact/prompts';

export interface InteractEvent {
  type: 'open' | 'locked' | 'take' | 'lever' | 'door' | 'press' | 'release' | 'light' | 'sit' | 'use' | 'found' | 'barrel-reset';
  def: InteractDef;
  /** a human line for the toast */
  text?: string;
  /** an inventory item handed out (a chest's contents / a pickup) */
  item?: string;
  n?: number;
  /** a flag handed out from a chest (its `{ flag }`) */
  flag?: string;
  /** world position of the row */
  at: THREE.Vector3;
}

export interface InteractHost {
  scene: THREE.Scene;
  sky: Sky;
  player: { position: THREE.Vector3; velocity: THREE.Vector3 };
  flags: Flags;
  /** a placement → world point (y = the floor there unless pinned) + world yaw */
  place: (p: Place) => { x: number; y: number; z: number; yaw: number };
  /** walkable floor height at (x, z): the highest platform, else the terrain */
  floorAt: (x: number, z: number) => number;
  /** the game's interactable list (main.ts scans it for the nearest "[E] …" prompt) */
  prompts: Interactable[];
}

type BatchId = 'lit' | 'glow';
interface Part {
  batch: BatchId; inst: number;
  /** local pose in the row frame (called when the row is dirty) */
  pose: (lv: Live, t: number, out: THREE.Matrix4) => void;
  /** only drawn while this holds (default: while the row is shown) */
  when?: (lv: Live) => boolean;
  /** glow parts: brightness (per-instance colour) */
  glow?: (lv: Live, t: number) => number;
  animated: boolean;
}

export class Live {
  readonly position: THREE.Vector3 = new THREE.Vector3();
  yaw = 0;
  shown = true;
  /** 0 closed / off / up … 1 open / on / pressed — eased toward `target` */
  anim = 0;
  target = 0;
  parts: Part[] = [];
  collider: Collider | null = null;
  readonly object: THREE.Object3D = new THREE.Object3D();
  piece: Piece | null = null;
  prompt: Interactable | null = null;
  dirty = true;
  /** barrel: its start (the leash is measured from here) */
  home: THREE.Vector3 = new THREE.Vector3();
  /** barrel: its full turn (PHYSICS P7-L1: it tips and rolls), `position` being its base centre under that turn */
  readonly rot: THREE.Quaternion = new THREE.Quaternion();
  /** barrel: its dynamic body (PHYSICS P7); null without a physics world (node tests) */
  body: Body | null = null;
  /** barrel: when it has to go home (lost, wedged, past its leash) */
  watch: BarrelWatch | null = null;
  /** glow tint (pickups' `color`) */
  tint: THREE.Color = new THREE.Color(1, 1, 1);
  readonly rules:ReturnType<typeof bindInteractionState>;
  readonly def: InteractDef;
  constructor(def: InteractDef,flags:Flags) {
    this.def = def;this.rules=bindInteractionState(def,flags);
  }
}

const PLAYER_R = 0.35;
const _m = new THREE.Matrix4(), _local = new THREE.Matrix4(), _c = new THREE.Color(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _v = new THREE.Vector3(), _e = new THREE.Euler();
const OFF: Collider = { x: 0, z: 0, hw: 0, hd: 0, rot: 0, yTop: -1e6, yBottom: -1e6 + 1 };
const _bp = { x: 0, y: 0, z: 0 }, _bq = { x: 0, y: 0, z: 0, w: 1 };
const PARKED = { yTop: -1e6, yBottom: -1e6 - 1 };
const parked = (c: Collider): boolean => c.yTop < -1e5;

// ── line of sight (PHYSICS P5): a prompt is offered only when the eye can SEE it ─────────────────────────────────────

/**
 * How the LOS pick sees one prompt. `slack`: a world hit this many metres short of the prompt point still counts as
 * seen (the thing's own body — its half-size + 0.2). `body`: the registry piece that IS the thing (its Rapier collider
 * is tagged with it as owner), so a ray that meets it first has met the target, not a wall.
 */
export interface Sight { slack: number; body?: object | null }
/** the slack of a prompt nobody described (a pickup orb, an NPC's head, a zipline platform) */
export const SIGHT_SLACK: 0.5 = PROMPT_SIGHT_SLACK;
export function setSight(it: Interactable, s: Sight): void { setPromptSight(it, s); }

/** Does `eye` see the prompt? — no world surface between them but its own body. No physics world (boot, node) → yes. */
export function canSee(physics: Physics | null, eye: { x: number; y: number; z: number }, it: Interactable): boolean {
  return promptVisible(physics, eye, it);
}

/** The nearest prompt within its own radius of `eye` that `eye` can see (main.ts's "[E] …" pick, and so the E key). */
export function pickInteractable<T extends Interactable>(list: readonly T[], eye: THREE.Vector3, physics: Physics | null): T | undefined {
  return pickPrompt(list, eye, physics);
}

const T = (x: number, y: number, z: number, out: THREE.Matrix4, rx = 0, ry = 0, rz = 0, s = 1): void => {
  out.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.setScalar(s));
};


export class Interactables {
  onEvent?: (e: InteractEvent) => void;
  /** a bench was sat on: its world position and facing (the host turns the player to the view) */
  onSit?: (at: THREE.Vector3, yaw: number) => void;
  readonly lives: Live[] = [];
  /** its rows' models as placed (the named places' sets read them) */
  readonly placed: Placed[] = [];
  private byId = new Map<string, Live>();
  private batches!: Record<BatchId, THREE.BatchedMesh | InstancedBatch>;
  private geoIds = new Map<string, { batch: BatchId; id: number }>();
  private pending: { key: string; batch: BatchId; geo: THREE.BufferGeometry }[] = [];
  private instCount: Record<BatchId, number> = { lit: 0, glow: 0 };
  private seed = 0x1a7e;
  private unsub: (() => void) | null = null;

  private host: InteractHost;
  constructor(host: InteractHost) {
    this.host = host;
  }

  live(id: string): Live | undefined { return this.byId.get(id); }

  build(table: InteractTable, placements?: unknown): this {
    const placedTable = placements === undefined ? table : bindInteractPlacements(table, placements);
    return this.addRows(placedTable.rows).finish();
  }

  /** `build`'s first pass over some of a placed table's rows, in table order: each row's live state and the geometries
   *  of its parts (made once per shape). A caller that must not make every shape in one task adds the rows a few at a
   *  time, then calls `finish` once; the result is `build`'s. */
  addRows(rows: readonly InteractDef[]): this {
    for (const def of rows) {
      const lv = new Live(def,this.host.flags);
      this.lives.push(lv); this.byId.set(def.id, lv);
      this.parts(lv);
    }
    return this;
  }

  /** `build`'s second pass over every added row: the two batches sized to fit, then instances, colliders and models. */
  finish(): this {
    const size = (b: BatchId) => this.pending.filter((p) => p.batch === b).reduce((a, p) => a + p.geo.getAttribute('position').count, 0);
    const litMat = lowPolyLookMaterial(this.host.sky);
    const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true, toneMapped: true });
    glowMat.name = 'interact-glow';
    // A lent graph look never draws on a multi-draw batch (E271 / E272; on the grid its shader did not compile): instanced
    const batch = (b: BatchId, material: THREE.Material): THREE.BatchedMesh | InstancedBatch => {
      if (Reflect.get(material, 'isGraphShaderMaterial') === true) return new InstancedBatch(material, { name: `interact-${b}`, castShadow: b === 'lit', receiveShadow: b === 'lit', ownsGeometry: true });
      const bm = new ChangedBatchedMesh(Math.max(1, this.instCount[b]), Math.max(3, size(b)), Math.max(3, size(b)), material);
      bm.name = `interact-${b}`; bm.sortObjects = false; bm.perObjectFrustumCulled = true; bm.frustumCulled = false; // the batch's own sphere is stale (instances move); three culls each instance instead
      bm.castShadow = b === 'lit'; bm.receiveShadow = b === 'lit';
      return bm;
    };
    this.batches = { lit: batch('lit', litMat), glow: batch('glow', glowMat) };
    for (const p of this.pending) this.geoIds.set(p.key, { batch: p.batch, id: this.batches[p.batch].addGeometry(p.geo) });
    // a BatchedMesh copies its shapes; an instanced batch draws (and frees) them itself
    for (const p of this.pending) if (this.batches[p.batch] instanceof THREE.BatchedMesh) p.geo.dispose();
    this.pending = [];
    for (const lv of this.lives) for (const part of lv.parts) {
      const key = (part as Part & { geoKey: string }).geoKey;
      const g = this.geoIds.get(key);
      if (!g) throw new Error(`interact: no geometry ${key}`);
      part.inst = this.batches[g.batch].addInstance(g.id);
      this.batches[g.batch].setColorAt(part.inst, _c.setRGB(1, 1, 1));
    }
    this.host.scene.add(this.batches.lit, this.batches.glow);
    for (const lv of this.lives) this.placeLive(lv);
    this.unsub = this.host.flags.onChange(() => this.refresh());
    this.refresh(true);
    this.placeModels();
    // FC16: an instanced batch draws its still copies as one mesh; the bobbing / opening parts keep their own
    for (const b of ['lit', 'glow'] as const) {
      const drawn = this.batches[b];
      if (!(drawn instanceof InstancedBatch)) continue;
      const animated = new Set<number>();
      for (const lv of this.lives) for (const part of lv.parts) if (part.batch === b && (part.animated || part.glow !== undefined)) animated.add(part.inst);
      drawn.mergeStill(animated);
    }
    return this;
  }

  /** E315: the rows' models, drawn into the batches (a card per model, a placement per row, no colliders: the kit's) */
  private placeModels(): void {
    const ctx = modelContext(this.host.sky), batches = this.batches, placed = this.placed;
    /** one model's rows: a placement each, and its world box (the thing's size round where it stands) */
    class Rows<P extends object> {
      private readonly pls: Placement<P>[] = [];
      private readonly boxes: number[] = [];
      readonly def: ModelDef<P>;
      readonly batch: BatchId;
      constructor(def: ModelDef<P>, batch: BatchId) {
        this.def = def;
        this.batch = batch;
      }
      add(lv: Live, params: P, half: readonly [number, number, number], lift = 0, variant?: string): void {
        const p = lv.home, [hx, hy, hz] = half, cy = p.y + lift + hy;
        this.pls.push({ x: p.x, y: p.y, z: p.z, yaw: lv.yaw, params, ...(variant === undefined ? {} : { variant }) });
        this.boxes.push(p.x - hx, cy - hy, p.z - hz, p.x + hx, cy + hy, p.z + hz);
      }
      place(): void {
        if (this.pls.length === 0) return;
        placed.push(place(this.def, this.pls, { ctx, draw: 'batched', drawnInto: { object: batches[this.batch], boxes: Float32Array.from(this.boxes) }, piece: { id: `interact:${this.def.id}` } }));
      }
    }
    const chest = new Rows(interactProps().models.seaChest, 'lit'), key = new Rows(interactProps().models.holdKey, 'glow'), door = new Rows(interactProps().models.door, 'lit');
    const lever = new Rows(interactProps().models.lever, 'lit'), plate = new Rows(interactProps().models.pressurePlate, 'lit'), barrel = new Rows(interactProps().models.puzzleBarrel, 'lit');
    const beacon = new Rows(interactProps().models.beacon, 'lit'), bench = new Rows(interactProps().models.bench, 'lit'), altar = new Rows(interactProps().models.shardAltar, 'lit');
    const pickups = new Map<string, Rows<Record<string, never>>>();   // per registered look (registerPickupLook)
    const small = [0.25, 0.25, 0.25] as const;
    for (const lv of this.lives) {
      const d = lv.def;
      switch (d.kind) {
        case 'chest': { const look = d.look ?? 'chest', D = interactProps().CHEST_DIMS[look]; chest.add(lv, { look, locked: d.lock !== undefined }, [D.w / 2, (D.h + D.lidH) / 2, D.w / 2], 0, look); break; }
        case 'key': key.add(lv, {}, [0.2, 0.2, 0.2], 0.9); break;
        case 'pickup': {
          const look = pickupLook(d.look);
          if (look === undefined) break;   // an unregistered look draws nothing far away (validate reports it)
          let rows = pickups.get(d.look);
          if (rows === undefined) { rows = new Rows(look.model, look.batch); pickups.set(d.look, rows); }
          rows.add(lv, {}, small, look.lift); break;
        }
        case 'door': door.add(lv, { look: d.look, w: d.w, h: d.h }, [d.w / 2 + 0.1, d.h / 2, d.w / 2 + 0.1], 0, d.look); break;
        case 'lever': lever.add(lv, {}, [0.25, 0.4, 0.25]); break;
        case 'plate': plate.add(lv, { size: d.size }, [d.size / 2, 0.08, d.size / 2]); break;
        case 'barrel': barrel.add(lv, {}, [0.4, 0.48, 0.4]); break;
        case 'beacon': beacon.add(lv, {}, [0.6, 0.7, 0.6]); break;
        case 'bench': bench.add(lv, {}, [0.9, 0.3, 0.9]); break;
        case 'altar': altar.add(lv, { sockets: d.fills.length }, [0.8, 0.65, 0.8]); break;
        default: break;
      }
    }
    for (const r of [chest, key, ...pickups.values(), door, lever, plate, barrel, beacon, bench, altar]) r.place();
  }

  /** The level scene owner may already own the batch GPU resources. */
  dispose(opts: { batches?: boolean } = {}): void {
    this.unsub?.();
    for (const bm of Object.values(this.batches)) { this.host.scene.remove(bm); if (opts.batches !== false) bm.dispose(); }
    for (const lv of this.lives) { if (lv.prompt) { const i = this.host.prompts.indexOf(lv.prompt); if (i !== -1) this.host.prompts.splice(i, 1); } if (lv.collider) Object.assign(lv.collider, OFF); if (lv.body) { app.bodies?.remove(lv.body); lv.body = null; } }
  }

  /** move a row to world (x, z) on the floor there (a key dropped by an enemy) */
  moveTo(id: string, x: number, z: number, y?: number): void {
    const lv = this.byId.get(id); if (!lv) return;
    lv.position.set(x, y ?? this.host.floorAt(x, z), z);
    lv.home.copy(lv.position);
    if (lv.body) this.sendHome(lv, lv.body); // its watch reads `home` live
    this.updateCollider(lv); lv.dirty = true;
  }

  // ── build ──────────────────────────────────────────────────────────────────────────────────────

  private geo(key: string, batch: BatchId, make: () => THREE.BufferGeometry): string {
    if (!this.pending.some((p) => p.key === key) && !this.geoIds.has(key)) this.pending.push({ key, batch, geo: make() });
    return key;
  }
  private part(lv: Live, key: string, batch: BatchId, pose: Part['pose'], opts: { when?: Part['when']; glow?: Part['glow']; animated?: boolean } = {}): void {
    const p: Part & { geoKey: string } = { batch, inst: -1, pose, animated: opts.animated ?? false, geoKey: key };
    if (opts.when) p.when = opts.when;
    if (opts.glow) p.glow = opts.glow;
    lv.parts.push(p);
    this.instCount[batch]++;
  }
  private s(): number { return this.seed++; }

  private parts(lv: Live): void {
    const d = lv.def, still = (_: Live, __: number, out: THREE.Matrix4) => { out.identity(); };
    switch (d.kind) {
      case 'chest': {
        const look = d.look ?? 'chest', D = interactProps().CHEST_DIMS[look];
        this.part(lv, this.geo(`chest:${look}`, 'lit', () => interactProps().chestBase(look, this.s())), 'lit', still);
        this.part(lv, this.geo(`lid:${look}`, 'lit', () => interactProps().chestLid(look, this.s())), 'lit', (l, _t, out) => T(0, D.h, -D.d / 2, out, -1.95 * ease(l.anim)), { animated: true });
        this.part(lv, this.geo(`glint:${look}`, 'glow', () => interactProps().chestGlint(look, this.s())), 'glow', still, { when: (l) => l.anim > 0.3, glow: (_l, t) => 1.4 + 0.3 * Math.sin(t * 5) });
        if (d.lock !== undefined) this.part(lv, this.geo('padlock', 'lit', () => interactProps().padlock(this.s())), 'lit', (_l, _t, out) => T(0, D.h - 0.12, D.d / 2 + 0.05, out), { when: (l) => l.anim === 0 && !this.host.flags.has(`open:${l.def.id}`) });
        break;
      }
      case 'key':
        this.part(lv, this.geo('key', 'glow', () => interactProps().keyModel(this.s())), 'glow', bob(0.9, 0.08, 1.6), { animated: true, glow: pulse(1.5) });
        break;
      case 'pickup': {
        for (const part of pickupLook(d.look)?.parts ?? []) {
          const geo = this.geo(part.key, part.batch, () => part.geometry(this.s()));
          if (part.bob === undefined) this.part(lv, geo, part.batch, still);
          else this.part(lv, geo, part.batch, bob(...part.bob), { animated: true, ...(part.pulse === undefined ? {} : { glow: pulse(part.pulse) }) });
        }
        break;
      }
      case 'door': {
        const { w, h, look } = d;
        this.part(lv, this.geo(`frame:${look}:${w}:${h}`, 'lit', () => interactProps().doorFrame(look, w, h, this.s())), 'lit', still);
        const pk = this.geo(`panel:${look}:${w}:${h}`, 'lit', () => interactProps().doorPanel(look, w, h, this.s()));
        if (look === 'plank') this.part(lv, pk, 'lit', (l, _t, out) => T(-w / 2, 0, 0, out, 0, -1.75 * ease(l.anim)), { animated: true });
        else this.part(lv, pk, 'lit', (l, _t, out) => T(0, (h + 0.05) * ease(l.anim), 0, out), { animated: true });
        break;
      }
      case 'lever':
        this.part(lv, this.geo('lever-base', 'lit', () => interactProps().leverBase(this.s())), 'lit', still);
        this.part(lv, this.geo('lever-handle', 'lit', () => interactProps().leverHandle(this.s())), 'lit', (l, _t, out) => T(0, 0.34, 0, out, 0.7 - 1.4 * ease(l.anim)), { animated: true });
        break;
      case 'plate': {
        const sz = d.size;
        this.part(lv, this.geo(`plate-rim:${sz}`, 'lit', () => interactProps().plateRim(sz, this.s())), 'lit', still);
        this.part(lv, this.geo(`plate:${sz}`, 'lit', () => interactProps().plateSlab(sz, this.s())), 'lit', (l, _t, out) => T(0, -0.06 * l.anim, 0, out), { animated: true });
        break;
      }
      case 'barrel':
        this.part(lv, this.geo('barrel', 'lit', () => interactProps().barrel(this.s())), 'lit', still);
        break;
      case 'beacon':
        this.part(lv, this.geo('brazier', 'lit', () => interactProps().brazier(this.s())), 'lit', still);
        this.part(lv, this.geo('flame', 'glow', () => interactProps().flame(this.s())), 'glow', (l, t, out) => {
          const f = ease(l.anim), fl = 1 + 0.12 * Math.sin(t * 13) + 0.07 * Math.sin(t * 29 + 1);
          out.compose(_v.set(0, 0.95, 0), _q.setFromEuler(_e.set(0, t * 0.7, 0)), _s.set(f * (1 + 0.05 * Math.sin(t * 17)), f * fl, f));
        }, { when: (l) => l.anim > 0.01, glow: (_l, t) => 2.2 + 0.4 * Math.sin(t * 11), animated: true });
        break;
      case 'bench':
        this.part(lv, this.geo('bench', 'lit', () => interactProps().bench(this.s())), 'lit', still);
        break;
      case 'altar': {
        const n = d.fills.length;
        this.part(lv, this.geo(`altar:${n}`, 'lit', () => interactProps().altar(n, this.s())), 'lit', still);
        const socket = pickupLook(d.socketLook)?.parts[0];   // what fills a socket: a registered pickup look's first part
        if (socket !== undefined) d.fills.forEach((f, i) => {
          const s = interactProps().altarSocket(i, n);
          this.part(lv, this.geo(socket.key, socket.batch, () => socket.geometry(this.s())), socket.batch, (_l, t, out) => T(s.x, s.y + Math.sin(t * 1.3 + i) * 0.04, s.z, out, 0, t * 0.8 + i, 0, 0.8),
            { animated: true, when: (l) => this.host.flags.has(`used:${l.def.id}`) && this.host.flags.has(f), glow: pulse(2.4) });
        });
        break;
      }
      default: break;
    }
  }

  private placeLive(lv: Live): void {
    const d = lv.def, p = this.host.place(d.at);
    lv.position.set(p.x, p.y, p.z); lv.yaw = p.yaw; lv.home.copy(lv.position);
    if (d.kind === 'pickup' && d.color !== undefined) lv.tint.set(d.color);
    // colliders
    const box = (hw: number, hd: number, h: number): Collider => ({ x: p.x, z: p.z, hw, hd, rot: -p.yaw, yTop: p.y + h, yBottom: p.y - 0.5 });
    switch (d.kind) {
      case 'chest': { const D = interactProps().CHEST_DIMS[d.look ?? 'chest']; lv.collider = box(D.w / 2, D.d / 2, D.h + D.lidH); break; }
      case 'door': lv.collider = box(d.w / 2 + 0.05, 0.16, d.h); break;
      case 'barrel': {
        // a free dynamic cylinder the player's capsule tips and rolls (PHYSICS P7-L1); a static box where there is no world (tests)
        const bodies = app.bodies;
        lv.rot.setFromAxisAngle(_v.set(0, 1, 0), p.yaw);
        if (bodies) {
          lv.body = bodies.spawn({ ...BARREL_BODY, owner: lv }, { x: p.x, y: p.y + BARREL_HALF + 0.01, z: p.z }, undefined, lv.rot);
          lv.watch = new BarrelWatch(lv.home, d.leash);
        } else lv.collider = box(BARREL_R, BARREL_R, 1.0);
        break;
      }
      case 'beacon': lv.collider = box(0.5, 0.5, 1.2); break;
      case 'altar': lv.collider = box(0.7, 0.7, 1.2); break;
      case 'lever': lv.collider = box(0.22, 0.18, 0.4); break;
      case 'key': case 'pickup': case 'plate': case 'bench': break;
      default: break;
    }
    if (lv.collider) {
      lv.object.position.copy(lv.position); lv.object.rotation.y = lv.yaw;
      const moving = d.kind === 'barrel';
      lv.piece = app.registry.add({ id: `interact-${d.id}`, name: d.id, category: 'props', file: 'src/client/engine/world/interact/Interactables.ts',
        colliders: [moving ? boxInFrame(lv.collider, lv.object) : boxDesc(lv.collider, 'wood')], surface: 'wood',
        ...(moving ? { follows: lv.object } : {}), active: () => lv.shown && lv.collider !== null && !parked(lv.collider) });
    }
    // the prompt
    if (d.kind !== 'plate' && d.kind !== 'barrel' && !(d.kind === 'pickup' && d.touch === true)) {
      const pos = new THREE.Vector3(p.x, p.y + (d.kind === 'door' ? 1.1 : d.kind === 'key' ? 1.0 : 0.6), p.z);
      const radius = () => this.promptRadius(lv), label = () => this.label(lv);
      const prompt: Interactable = {
        position: pos,
        get radius() { return radius(); },
        get label() { return label(); },
        wireId: d.id,
        onInteract: () => { this.interact(lv); },
      };
      lv.prompt = prompt;
      setSight(prompt, { slack: this.sightSlack(lv), body: lv.piece });
      this.host.prompts.push(prompt);
    }
    // the initial state from the flags (a reload keeps an opened chest open)
    lv.anim = lv.target = this.stateTarget(lv);
  }

  /** the row's own half-size + 0.2: a hit that close to the prompt point is the thing itself */
  private sightSlack(lv: Live): number {
    const d = lv.def;
    switch (d.kind) {
      case 'chest': { const D = interactProps().CHEST_DIMS[d.look ?? 'chest']; return Math.max(D.w, D.d) / 2 + 0.2; }
      case 'door': return d.w / 2 + 0.25;
      case 'beacon': return 0.7;
      case 'altar': return 0.9;
      case 'bench': return 0.8;
      case 'lever': return 0.45;
      case 'key': case 'pickup': return 0.3;
      case 'plate': case 'barrel': return SIGHT_SLACK;   // no prompt
      default: return SIGHT_SLACK;
    }
  }

  private updateCollider(lv: Live): void {
    if (lv.prompt) lv.prompt.position.set(lv.position.x, lv.position.y + (lv.def.kind === 'door' ? 1.1 : lv.def.kind === 'key' ? 1.0 : 0.6), lv.position.z);
    if (!lv.collider) return;
    lv.collider.x = lv.position.x; lv.collider.z = lv.position.z;
  }

  // ── state ──────────────────────────────────────────────────────────────────────────────────────

  private has(f: string): boolean { return this.host.flags.has(f); }

  private stateTarget(lv: Live): number {
    const d = lv.def, a = autoFlag(d);
    switch (d.kind) {
      case 'door': return this.has(`open:${d.id}`) || (d.opensWhen !== undefined && test(this.host.flags, d.opensWhen)) ? 1 : 0;
      case 'plate': return this.has(`plate:${d.id}`) ? 1 : 0;
      case 'key': case 'pickup': return 0;
      case 'chest': case 'lever': case 'beacon': case 'bench': case 'altar': case 'barrel': return a !== null && this.has(a) ? 1 : 0;
      default: return 0;
    }
  }

  private refresh(first = false): void {
    for (const lv of this.lives) {
      const d = lv.def;
      const shown=lv.rules.shown();
      if (shown !== lv.shown || first) {
        lv.shown = shown; lv.dirty = true;
        lv.body?.setEnabled(shown);
        if (d.kind === 'door') this.syncDoor(lv);
        else if (lv.collider) { if (shown) this.updateColliderOn(lv); else Object.assign(lv.collider, PARKED); }
      }
      const tg = this.stateTarget(lv);
      if (tg !== lv.target) { lv.target = tg; lv.dirty = true; }
      // a latching door whose condition came true stays open
      if (d.kind === 'door' && d.latch === true && d.opensWhen !== undefined && !this.has(`open:${d.id}`) && test(this.host.flags, d.opensWhen)) {
        this.host.flags.set(`open:${d.id}`);
        this.emit({ type: 'door', def: d, text: d.toast ?? engineString('s_83d237706c2b'), at: lv.position });
      }
    }
  }
  /**
   * A door is solid only when it is shut (PHYSICS.md: "solid when shut, never stuck on the player"): its box is parked
   * while it swings (0 < anim < 1) and while it stands open, and comes back once anim is 0 — and the player is not
   * standing in it, so a door that closes on you waits until you step out.
   */
  private syncDoor(lv: Live): void {
    const c = lv.collider; if (!c) return;
    const solid = lv.shown && lv.anim === 0 && !this.playerIn(lv, c);
    if (solid && parked(c)) this.updateColliderOn(lv);
    else if (!solid && !parked(c)) Object.assign(c, PARKED);
  }
  /** is the player's body (feet + 1.8 m, radius PLAYER_R) inside the door's box where it stands when on? */
  private playerIn(lv: Live, c: Collider): boolean {
    const pl = this.host.player.position, y = lv.position.y, h = lv.def.kind === 'door' ? lv.def.h : 1.2;
    if (pl.y > y + h || pl.y + 1.8 < y - 0.5) return false;
    const cos = Math.cos(-c.rot), sin = Math.sin(-c.rot), dx = pl.x - c.x, dz = pl.z - c.z;
    return Math.abs(dx * cos - dz * sin) < c.hw + PLAYER_R && Math.abs(dx * sin + dz * cos) < c.hd + PLAYER_R;
  }
  private updateColliderOn(lv: Live): void {
    const c = lv.collider; if (!c) return;
    const d = lv.def, y = lv.position.y;
    const h = d.kind === 'door' ? d.h : d.kind === 'chest' ? 0.7 : d.kind === 'barrel' ? 1 : 1.2;
    c.x = lv.position.x; c.z = lv.position.z; c.yTop = y + h; c.yBottom = y - 0.5;
    if (lv.piece) {
      const desc = lv.def.kind === 'barrel' ? boxInFrame(c, lv.object) : boxDesc(c, 'wood');
      const previous = lv.piece.colliders?.[0];
      if (previous?.kind !== 'box' || previous.x !== desc.x || previous.y !== desc.y || previous.z !== desc.z ||
        previous.hx !== desc.hx || previous.hy !== desc.hy || previous.hz !== desc.hz) lv.piece.colliders = [desc];
    }
  }

  private promptRadius(lv:Live):number {return lv.rules.promptRadius(lv.anim,lv.shown);}
  private locked(lv:Live):string|null {return lv.rules.locked();}

  private label(lv: Live): string {
    const d = lv.def, lock = this.locked(lv);
    if (lock !== null) return lock;
    switch (d.kind) {
      case 'chest': return d.lock !== undefined ? `Unlock the ${d.look === 'strongbox' ? 'strongbox' : 'chest'}` : `Open the ${d.look === 'strongbox' ? 'strongbox' : d.look === 'treasure' ? 'treasure chest' : 'chest'}`;
      case 'key': return `Take ${d.label}`;
      case 'pickup': return `Take ${d.label}`;
      case 'door': return d.lock !== undefined && !this.has(`open:${d.id}`) ? 'Unlock' : lv.target > 0 ? 'Close' : 'Open';
      case 'lever': return d.label ?? (this.has(`lever:${d.id}`) ? 'Push the lever back' : 'Pull the lever');
      case 'beacon': return d.label;
      case 'bench': return d.label;
      case 'altar': return d.label;
      case 'plate': case 'barrel': return '';
      default: return '';
    }
  }

  private emit(e: InteractEvent): void { this.onEvent?.(e); }

  private interact(lv: Live): void {
    const d = lv.def, F = this.host.flags, at = lv.position;
    if (!lv.shown) return;
    const lock = this.locked(lv);
    if (lock !== null) { this.emit({ type: 'locked', def: d, text: lock, at }); return; }
    const raise = () => { const a = autoFlag(d); if (a !== null) F.set(a); for (const s of d.sets ?? []) F.set(s); };
    switch (d.kind) {
      case 'chest': {
        raise();
        this.emit({ type: 'open', def: d, text: d.toast ?? '', at });
        for (const l of d.contents) {
          if ('item' in l) this.emit({ type: 'found', def: d, item: l.item, n: l.n ?? 1, at });
          else if ('key' in l) { F.set(`key:${l.key}`); this.emit({ type: 'found', def: d, text: engineString('s_f2abdaceed9a', [l.label]), at }); }
          else { F.set(l.flag); this.emit({ type: 'found', def: d, text: engineString('s_f2abdaceed9a', [l.label]), flag: l.flag, at }); }
        }
        break;
      }
      case 'key': F.set(`key:${d.key}`); raise(); this.emit({ type: 'take', def: d, text: d.toast ?? engineString('s_126d87005647', [d.label]), at }); break;
      case 'pickup': this.take(lv); break;
      case 'door': {
        if (d.look === 'plank' && F.has(`open:${d.id}`)) { F.clear(`open:${d.id}`); this.emit({ type: 'door', def: d, text: '', at }); break; }
        raise(); this.emit({ type: 'door', def: d, text: d.toast ?? '', at });
        break;
      }
      case 'lever': {
        if (d.latch === true && F.has(`lever:${d.id}`)) break;
        const on = F.toggle(`lever:${d.id}`);
        for (const s of d.sets ?? []) F.set(s, on);
        this.emit({ type: 'lever', def: d, text: d.toast ?? '', at });
        break;
      }
      case 'beacon': raise(); this.emit({ type: 'light', def: d, text: d.toast ?? engineString('s_73269da1371d'), at }); break;
      case 'bench': raise(); this.emit({ type: 'sit', def: d, text: d.toast ?? '', at }); this.onSit?.(lv.position, lv.yaw); break;
      case 'altar': raise(); this.emit({ type: 'use', def: d, text: d.toast ?? '', at }); break;
      case 'plate': case 'barrel': break;
      default: break;
    }
  }

  private take(lv: Live): void {
    const d = lv.def; if (d.kind !== 'pickup') return;
    const F = this.host.flags;
    F.set(`taken:${d.id}`); for (const s of d.sets ?? []) F.set(s);
    this.emit({ type: 'take', def: d, text: d.toast ?? d.label, ...(d.item !== undefined ? { item: d.item, n: 1 } : {}), at: lv.position });
  }

  // ── per frame ──────────────────────────────────────────────────────────────────────────────────

  update(dt: number, t: number): void {
    const pl = this.host.player.position, F = this.host.flags, physics = app.physics;
    // barrels first: their pose from the body (plates feel the body itself)
    for (const lv of this.lives) if (lv.def.kind === 'barrel' && lv.shown) this.syncBarrel(lv, dt);
    for (const lv of this.lives) {
      const d = lv.def;
      if (!lv.shown) { if (lv.dirty) this.pose(lv, t); continue; }
      if (d.kind === 'plate') {
        const down = physics !== null && plateDown(physics, lv, d.size, d.by);
        if (down !== F.has(`plate:${d.id}`)) { F.set(`plate:${d.id}`, down); for (const s of d.sets ?? []) F.set(s, down); this.emit({ type: down ? 'press' : 'release', def: d, at: lv.position }); }
      } else if (d.kind === 'pickup' && d.touch === true && walkInPickup(physics, pl, lv.position)) this.take(lv);
      if (lv.anim !== lv.target) {
        const speed = d.kind === 'door' && d.look !== 'plank' ? 0.7 : d.kind === 'plate' ? 6 : d.kind === 'beacon' ? 1.2 : 2.4;
        lv.anim = lv.target > lv.anim ? Math.min(lv.target, lv.anim + dt * speed) : Math.max(lv.target, lv.anim - dt * speed);
        lv.dirty = true;
      }
      if (d.kind === 'door') this.syncDoor(lv);
      // bobbing / flickering parts: only near the camera (a sea-glass piece 200 m off is culled anyway)
      if (!lv.dirty && lv.parts.some((p) => p.animated && p.glow !== undefined) && lv.position.distanceToSquared(pl) < 90 * 90) lv.dirty = true;
      if (lv.dirty) this.pose(lv, t);
    }
  }

  private pose(lv: Live, t: number): void {
    lv.dirty = false;
    lv.object.position.copy(lv.position); lv.object.quaternion.copy(lv.def.kind === 'barrel' ? lv.rot : _q.setFromAxisAngle(_v.set(0, 1, 0), lv.yaw));
    _m.compose(lv.position, lv.def.kind === 'barrel' ? lv.rot : _q.setFromAxisAngle(_v.set(0, 1, 0), lv.yaw), _s.set(1, 1, 1));
    for (const p of lv.parts) {
      const bm = this.batches[p.batch];
      const vis = lv.shown && (p.when ? p.when(lv) : true);
      bm.setVisibleAt(p.inst, vis);
      if (!vis) continue;
      p.pose(lv, t, _local);
      bm.setMatrixAt(p.inst, _local.premultiply(_m));
      if (p.glow) bm.setColorAt(p.inst, _c.copy(lv.tint).multiplyScalar(p.glow(lv, t)));
    }
  }

  /**
   * The barrel's pose from its body — its full turn, interpolated between fixed steps — and the never-jam rule
   * (`BarrelWatch`): past its leash, lost in the sea or under the world, or wedged, it goes home upright.
   */
  private syncBarrel(lv: Live, dt: number): void {
    const b = lv.body, bodies = app.bodies;
    if (b === null || bodies === null) return;
    b.pose(bodies.alpha, _bp, _bq);
    _q.set(_bq.x, _bq.y, _bq.z, _bq.w);
    _v.set(0, -BARREL_HALF, 0).applyQuaternion(_q).add(_bp); // the base centre (the model's origin)
    if (lv.position.distanceToSquared(_v) + lv.rot.angleTo(_q) > 1e-10) {
      lv.position.copy(_v); lv.rot.copy(_q); lv.dirty = true;
    }
    if (lv.watch?.check(b.curr, dt, this.barrelEnv) === true) this.sendHome(lv, b, true);
  }

  /** what `BarrelWatch` reads of the world: the player, the floor, the sea, the plates */
  private envCache: BarrelEnv | null = null;
  private get barrelEnv(): BarrelEnv {
    this.envCache ??= this.makeEnv();
    return this.envCache;
  }
  private makeEnv(): BarrelEnv {
    return {
      player: this.host.player,
      floorAt: (x, z) => this.host.floorAt(x, z),
      water: () => waterLevel(),
      onPlate: (c) => this.lives.some((p) => p.def.kind === 'plate' && p.shown
        && barrelAtPlate(c, p.position, p.def.size)),
    };
  }

  /** the barrel back at its start, upright, at rest ("The barrel rolls back to where it was") */
  private sendHome(lv: Live, b: Body, announce = false): void {
    const d = lv.def; if (d.kind !== 'barrel') return;
    lv.rot.setFromAxisAngle(_v.set(0, 1, 0), lv.yaw);
    b.teleport({ x: lv.home.x, y: lv.home.y + BARREL_HALF + 0.01, z: lv.home.z }, lv.rot);
    lv.position.copy(lv.home); lv.dirty = true;
    lv.watch?.clear();
    if (announce) this.emit({ type: 'barrel-reset', def: d, text: d.toast ?? engineString('s_fa58d2eb0c57'), at: lv.position });
  }
}

const SEES_PLAYER: readonly GroupName[] = ['PLAYER'], SEES_ITEM: readonly GroupName[] = ['ITEM'], SEES_ANY: readonly GroupName[] = ['PLAYER', 'ITEM'];
const isBarrel = (owner: unknown): boolean => owner instanceof Live && owner.def.kind === 'barrel';
const anyOwner = (): boolean => true;

/**
 * Is something on the plate? (PHYSICS P5-L3 → P7) An overlap query of a thin slab just over the plate, a little inside
 * its rim, against the player's capsule (`by: 'player'`), a barrel's body (`'barrel'`) or either / any item (`'any'`).
 */
export function plateDown(physics: Physics, lv: { position: { x: number; y: number; z: number }; yaw: number }, size: number, by: 'player' | 'barrel' | 'any'): boolean {
  return plateOverlap(physics, lv.position, lv.yaw, size, { sees: by === 'player' ? SEES_PLAYER : by === 'barrel' ? SEES_ITEM : SEES_ANY,
    accepts: by === 'barrel' ? isBarrel : anyOwner });
}

function ease(x: number): number { return x * x * (3 - 2 * x); }
function bob(h: number, amp: number, spin: number): Part['pose'] {
  return (lv, t, out) => T(0, h + Math.sin(t * 1.8 + lv.home.x) * amp, 0, out, 0, t * spin, 0);
}
function pulse(base: number): Part['glow'] {
  return (lv, t) => base + 0.35 * Math.sin(t * 2.6 + lv.home.z);
}
