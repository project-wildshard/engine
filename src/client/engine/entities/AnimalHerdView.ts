import * as THREE from 'three';
import { app } from '../app/runtime';
import type { TickRate } from '../../../shared/engine/app/scheduler';
import { TIER, TIER_CONFIG } from '../core/tier';
import { worldTime } from '../../../shared/engine/core/time';
import { practiceRoom } from '../core/practiceRoom';
import { ParticlePool } from '../fx/ParticlePool';
import type { LevelFrameBinding } from '../level/frame';
import { activeLevel } from '../../../shared/engine/level/selection';
import type { CreatureRenderSpec } from '../../../shared/engine/level/spec';
import type { Physics } from '../../../shared/engine/physics/Physics';
import { castRay, floorBelow } from '../../../shared/engine/physics/query';
import { heightAt, normalAt } from '../../../shared/engine/world/Heightfield';
import type { SkyRig as Sky } from '../world/skyRig';
import { AnimalFactory, type AnimalKind, type AnimalModel, type AnimalStyle } from './AnimalFactory';
import type { RowBodiesDraw } from './RowBodies';
import { Animal } from './AnimalView';
import { AnimalGroup } from './animalMatrices';
import { attachShadowCaster } from './animalShadow';
import { publishShellLevels } from './animalShells';
import { FarHerd, type FarMember } from './farHerd';
import { speciesDef } from '../../../shared/engine/entities/species/registry';

/** the live WORLD physics, read in one place (blood decals) */
const worldPhysics = (): typeof app.physics => app.physics;

/** one draw of the page's cosmetic stream: blood never touches a gameplay roll */
const cosmetic = (): number => app.rng.stream('cosmetic').next();

const SHELL_DIST = 18, SHELL_MAX = 4;   // fur shells: nearest SHELL_MAX animals within SHELL_DIST m

const _c = new THREE.Vector3(), _d = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();

// ─────────────────────────────────────────────────────────────────────────────────────────
// Blood: a pooled particle burst + pooled ground decals
// ─────────────────────────────────────────────────────────────────────────────────────────

function makeDropTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d');
  if (g === null) throw new Error('BloodFX: could not get a 2d canvas context');
  const grad = g.createRadialGradient(16, 16, 2, 16, 16, 15);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.7, 'rgba(255,255,255,0.9)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

const MAX_P = 384, MAX_DECALS = 24;
/** blood lands on the first world surface within this far under the burst (m) */
const BLOOD_DROP = 4;
const DOWN = { x: 0, y: -1, z: 0 } as const;

class BloodFX {
  group = new THREE.Group();
  private readonly pool: ParticlePool;
  /** where each droplet lands (PHYSICS P7: one ray down per burst) */
  private floor = new Float32Array(MAX_P);
  private decals: THREE.Mesh[] = [];
  private decalNext = 0;
  private active = 0;

  private readonly physics: Physics | undefined;
  constructor(sky: Sky, physics?: Physics) {
    this.physics = physics;
    const mat = new THREE.PointsMaterial({ color: new THREE.Color(0.09, 0.004, 0.003), size: 0.035, sizeAttenuation: true, transparent: true, opacity: 0.95, depthWrite: false, map: makeDropTexture(), alphaTest: 0.3 });
    this.pool = new ParticlePool({ capacity: MAX_P, material: mat, renderOrder: 5, attributes: {}, parkY: -1000 }); // PointsMaterial draws every slot: the free ones wait far below
    this.group.add(this.pool.points);
    const dmat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.035, 0.002, 0.002), roughness: 0.35, metalness: 0, transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    sky.setupMaterial(dmat);
    const dgeo = new THREE.CircleGeometry(1, 18);
    // irregular splat outline
    const pa = dgeo.attributes['position'] as THREE.BufferAttribute;
    for (let i = 1; i < pa.count; i++) { const k = 0.6 + 0.4 * Math.abs(Math.sin(i * 7.3) * Math.cos(i * 3.1)); pa.setXY(i, pa.getX(i) * k, pa.getY(i) * k); }
    for (let i = 0; i < MAX_DECALS; i++) {
      const m = new THREE.Mesh(dgeo, dmat);
      m.visible = false; m.receiveShadow = true; m.renderOrder = 2;
      this.decals.push(m); this.group.add(m);
    }
  }

  burst(at: THREE.Vector3, dir: THREE.Vector3, strength = 1): void {
    const n = Math.round(22 * strength);
    const physics = this.physics ?? worldPhysics();
    const fl = (physics ? floorBelow(physics, at.x, at.z, at.y + 0.3, BLOOD_DROP) : undefined) ?? heightAt(at.x, at.z);
    const { vel, life } = this.pool;
    for (let i = 0; i < n; i++) {
      const k = this.pool.claim();
      this.floor[k] = fl;
      this.pool.place(k, at);
      // spray mostly along the shot direction (exit) with a wide cone
      const s = 1.5 + cosmetic() * 3.5;
      vel[k * 3] = (dir.x * 0.6 + (cosmetic() - 0.5) * 1.2) * s;
      vel[k * 3 + 1] = (dir.y * 0.6 + (cosmetic() - 0.2) * 1.2) * s;
      vel[k * 3 + 2] = (dir.z * 0.6 + (cosmetic() - 0.5) * 1.2) * s;
      life[k] = 0.45 + cosmetic() * 0.45;
    }
    this.active = Math.min(MAX_P, this.active + n);
    // ground patch
    const d = this.decals[this.decalNext]; this.decalNext = (this.decalNext + 1) % MAX_DECALS;
    if (d === undefined) return;
    const gx = at.x + dir.x * 0.4, gz = at.z + dir.z * 0.4;
    // the patch lands on what is under it: a deck, a rock, the hold floor — not the terrain beneath them
    const hit = physics ? castRay(physics, _c.set(gx, at.y + 0.3, gz), DOWN, BLOOD_DROP) : null;
    if (hit) { d.position.set(gx, hit.point.y + 0.015, gz); _d.set(hit.normal.x, hit.normal.y, hit.normal.z); }
    else { const nrm = normalAt(gx, gz); d.position.set(gx, heightAt(gx, gz) + 0.015, gz); _d.set(nrm[0], nrm[1], nrm[2]); }
    d.quaternion.setFromUnitVectors(_c.set(0, 0, 1), _d);
    d.rotateZ(cosmetic() * Math.PI * 2);
    const r = 0.14 + cosmetic() * 0.14 * strength;
    d.scale.set(r, r * (0.7 + cosmetic() * 0.5), 1);
    d.visible = true;
  }

  update(dt: number): void {
    if (this.active === 0) return;
    let alive = 0;
    const { life, pos, vel } = this.pool;
    for (let k = 0; k < MAX_P; k++) {
      const l0 = life[k] ?? 0;
      if (l0 <= 0) continue;
      life[k] = l0 - dt;
      if ((life[k] ?? 0) <= 0) { pos[k * 3 + 1] = -1000; continue; }
      alive++;
      const j = k * 3;
      vel[j + 1] = (vel[j + 1] ?? 0) - 9.8 * dt;
      pos[j] = (pos[j] ?? 0) + (vel[j] ?? 0) * dt; pos[j + 1] = (pos[j + 1] ?? 0) + (vel[j + 1] ?? 0) * dt; pos[j + 2] = (pos[j + 2] ?? 0) + (vel[j + 2] ?? 0) * dt;
      const fl = this.floor[k] ?? -1e9;
      if ((pos[j + 1] ?? 0) < fl) { pos[j + 1] = fl + 0.01; vel[j] = vel[j + 1] = vel[j + 2] = 0; } // landed: it soaks in where it fell
    }
    this.active = alive;
    this.pool.posAttr.needsUpdate = true;
  }
}

type AnimalFur = ReturnType<AnimalFactory['instantiate']>['materials'][number];

/** a rig as the far herd sees it (its model: the batch's material) */
interface FarRig extends FarMember {
  readonly model: AnimalModel;
  /** the rig's own layer mask while the far herd draws it (its layers are 0 then: the rig is not drawn, its children are) */
  mask: number | null;
}

/**
 * The page's half of the herds (P1-E4.3): rigs, the far and shadow batches, fur shells, draw distance, blood and the
 * debug capsules. AnimalManager.ts decides; this draws. It holds no decision and no gameplay random stream.
 */
export class AnimalHerdView implements RowBodiesDraw {
  /** the animals' own world-matrix pass: a still, far animal's bones are not recomputed (animalMatrices.ts) */
  readonly group: AnimalGroup = new AnimalGroup();
  readonly factory: AnimalFactory;
  debug = false;
  private blood!: BloodFX;
  private debugMeshes: THREE.Mesh[] = [];
  private shellDist = new Float64Array(SHELL_MAX);
  private shellIdx = new Int32Array(SHELL_MAX);
  /** each multi-group rig's one-draw shadow caster (animalShadow.ts); the per-frame shadow distance switches it */
  private readonly casters = new Map<Animal, THREE.SkinnedMesh>();
  /** what `rig` made each actor from, until `adopt` hands it to the far herd */
  private readonly rigs = new WeakMap<Animal, { model: AnimalModel; fur: AnimalFur | undefined }>();
  /** PH-P2: the far animals drawn per model (farHerd.ts), desktop past TIER_CONFIG.animalFarBatchDist; each rig's entry.
   *  PF7b: a hull's coat variants whose coats are one layer array draw as one batch (AnimalFactory.farKey) */
  private readonly farHerd = new FarHerd<FarRig>((m) => this.factory.farMaterial(m.model), { keyOf: (m) => this.factory.farKey(m.model),
    pageSlots: () => TIER_CONFIG.animalFarPageSlots });
  private readonly farRigs = new Map<Animal, FarRig>();
  /** the rigs holding a far-herd slot now (holdFarSlot) */
  private readonly farHeld = new Set<Animal>();
  /** PH-P2: the casting animals' shadows per model (farHerd.ts { shadow }), within animalShadowDist */
  private readonly shadowHerd = new FarHerd<FarRig>((m) => m.model.fur, { shadow: true });
  /**
   * A level's override of TIER_CONFIG.animalShadowBatch (null: the tier's): false casts each animal from its own visible
   * rig (its one-draw caster) instead of the shadow herd's skinned copies — one shadow draw per animal per cascade, and
   * none of the batch's geometry (G180 B5, Pine Hollow's memory trim: ~−7.9 MB of GL, −12.8 MB of JS arrays)
   */
  shadowBatch: boolean | null = null;
  private readonly pbr: boolean;
  private herdShadows = false;
  private readonly scene: THREE.Scene;
  private readonly sky: Sky;
  private readonly physics: Physics | undefined;

  /** `opts.style` forces the render style (dev harness); production reads `ShardManifest.style` ('pbr' | 'lowpoly') */
  constructor(scene: THREE.Scene, sky: Sky, opts: { style?: AnimalStyle | undefined; render?: CreatureRenderSpec | undefined; physics?: Physics | undefined } = {}) {
    this.scene = scene;
    this.sky = sky;
    this.physics = opts.physics;
    const style = opts.style ?? activeLevel().creatureStyle ?? 'pbr';
    this.factory = new AnimalFactory(sky, { style, render: opts.render ?? activeLevel().creatures });
    this.pbr = this.factory.render.furRim;
    this.group.name = 'animals';
  }

  tierTicks(level: LevelFrameBinding['terrain']['level'] | undefined = app.render?.level): Readonly<Record<string, TickRate>> | undefined {
    return level?.tiers?.[TIER]?.ticks;
  }

  start(): void {
    this.blood = new BloodFX(this.sky, this.physics);
    this.group.add(this.blood.group);
  }

  finish(): void {
    this.group.add(this.farHerd.group, this.shadowHerd.group);
    if (this.group.parent !== this.scene) this.scene.add(this.group);
  }

  /** the hidden group joins the region before its herds spawn (RowBodiesView.build) */
  park(): void { this.group.visible = false; this.scene.add(this.group); }
  show(): void { this.group.visible = true; }
  inFrame<T>(frame: LevelFrameBinding, run: () => T): T { return frame.run(app, run); }

  rig(kind: AnimalKind, variant: string, rigSeed: number, seed: number, scale: number, id: string): ReturnType<RowBodiesDraw['rig']> {
    const model = this.factory.model(kind, variant);
    const rig = this.factory.instantiate(model, rigSeed);
    const actor = new Animal(rig, model, seed, scale, id);
    if (model.shells.length > 0) actor.makeShells = () => this.factory.createShells(rig, model);   // none in 'lowpoly'
    actor.prepareMaterial = (m) => this.sky.setupMaterial(m);
    this.rigs.set(actor, { model, fur: rig.materials[0] });
    return { actor, flight: model.species.flight };
  }

  adopt(a: Animal, player: THREE.Vector3, asleep: (a: Animal) => boolean): void {
    // one shadow draw per animal instead of one per material group (animalShadow.ts; PINE-HOLLOW PH-P1 / P2)
    const caster = attachShadowCaster(a.mesh);
    if (caster !== null) this.casters.set(a, caster);
    const made = this.rigs.get(a), fur = made?.fur;
    if (made !== undefined && fur !== undefined) {
      const { model } = made, slotData = this.factory.farSlotData(model);
      const far: FarRig = { mesh: a.mesh, tint: fur.color, model, mask: null, ...(slotData === undefined ? {} : { slotData }) };
      this.farRigs.set(a, far);
      // its far-herd page, opened now so the entry warm-up uploads it (farHerd.ts reserve), when it can draw from here
      if (TIER_CONFIG.animalFarBatchDist > 0) this.holdFarSlot(a, this.inFarReach(a, player, asleep));
    }
    this.group.add(a.mesh); this.group.own(a);
  }

  hide(a: Animal): void { a.mesh.visible = false; }

  remove(a: Animal): void {
    this.holdFarSlot(a, false); this.farRigs.delete(a); this.casters.delete(a);
    a.mesh.removeFromParent();
  }

  /** E322 F-L4: every moving animal within 70 m of the player parts the grass and flattens a track (Nalati's trample map) */
  trample(animals: readonly Animal[], p: THREE.Vector3): void {
    if (app.world.trample === null || practiceRoom.open) return;
    for (const a of animals) {
      if (!a.alive || a.hidden || Math.abs(a.speed) < 0.4) continue;
      const dx = a.position.x - p.x, dz = a.position.z - p.z;
      if (dx * dx + dz * dz > 70 * 70) continue;
      const r = speciesDef(a.kind).trampleRadius ?? 0.4;
      app.world.trample?.push(a.position.x, a.position.z, r, Math.min(1, 0.35 + Math.abs(a.speed) / 5), Math.sin(a.yaw) * a.speed, Math.cos(a.yaw) * a.speed);
    }
  }

  /** whether `a` can be drawn from `from`: shown, awake and within animalHideDist */
  private inFarReach(a: Animal, from: THREE.Vector3, asleep: (a: Animal) => boolean): boolean {
    const hide = TIER_CONFIG.animalHideDist;
    return !a.hidden && !asleep(a) && a.position.distanceToSquared(from) < hide * hide;
  }

  /**
   * PF7b: a rig holds a far-herd slot (farHerd.ts reserve) only while it can be drawn. Its page stays open for the next,
   * so the herd's geometry follows the most rigs ever in reach at once, not every rig spawned (Pine's phone: ~200 spawned
   * rigs reserved ~91 MB of pages).
   */
  private holdFarSlot(a: Animal, hold: boolean): void {
    const far = this.farRigs.get(a);
    if (far === undefined || hold === this.farHeld.has(a)) return;
    if (hold) { this.farHerd.reserve(far); this.farHeld.add(a); } else { this.farHerd.unreserve(far); this.farHeld.delete(a); }
  }

  beginDraw(camera: THREE.PerspectiveCamera | null): void {
    // fur shells: pick the SHELL_MAX nearest animals inside SHELL_DIST (tiny insertion sort, no allocs)
    this.shellDist.fill(Infinity); this.shellIdx.fill(-1);
    if (TIER_CONFIG.animalFarBatchDist > 0) this.farHerd.begin(camera);
    this.herdShadows = (this.shadowBatch ?? TIER_CONFIG.animalShadowBatch) && this.pbr;
    if (this.herdShadows) this.shadowHerd.begin(null);
  }

  reach(a: Animal, from: THREE.Vector3, asleep: (a: Animal) => boolean): void {
    if (TIER_CONFIG.animalFarBatchDist > 0) this.holdFarSlot(a, this.inFarReach(a, from, asleep));
  }

  sleep(a: Animal): void { a.mesh.visible = false; (this.casters.get(a) ?? a.mesh).castShadow = false; }

  draw(a: Animal, i: number, d2: number): void {
    const sd = this.shellDist, si = this.shellIdx, herdShadows = this.herdShadows;
    const farD = TIER_CONFIG.animalFarBatchDist, far2 = farD > 0 ? farD * farD : Infinity;
    // draw / shadow distance by tier: a deer at 150 m is a few pixels on a phone, and only near animals shadow
    // … shrinking away over the last 15 % of the draw distance rather than blinking out at it (E117: no pop)
    const hide = TIER_CONFIG.animalHideDist;
    // … except a pinned body (a boss row's): a 19 m boss must not vanish mid-fight past the phone's 150 m
    const fade = a.drawPinned || d2 < (hide * 0.85) ** 2 ? 1 : Math.max(0, Math.min(1, (hide - Math.sqrt(d2)) / (hide * 0.15)));
    a.mesh.visible = fade > 0;
    const sc = a.scale * fade * fade * (3 - 2 * fade);
    if (a.mesh.scale.x !== sc) a.mesh.scale.setScalar(sc);
    const fr = this.farRigs.get(a);
    // the rig's cull sphere: the model's bind-pose sphere + 0.6 m, as AnimalFactory.instantiate pads it
    const radius = fr === undefined ? 0 : ((fr.model.geometry.boundingSphere?.radius ?? 3) + 0.6) * a.scale;
    // the far herd draws it (or leaves it out of view): the rig's layers go to 0 — it is not drawn, what hangs on its
    // bones still is (the King's kit, a stuck bolt)
    // a generated hull (one group, no shells, no draw LOD) is the same pixels in the batch at any distance (desktop:
    // animalHullBatch); a procedural rig only once it is one draw (past animalOneDrawDist ≤ animalFarBatchDist)
    const from2 = fr?.model.hull !== undefined && TIER_CONFIG.animalHullBatch && herdShadows ? 0 : far2; // its shadow: the shadow herd
    const batched = fr !== undefined && farD > 0 && a.mesh.visible && d2 >= from2 && !a.fading && this.farHerd.take(fr, a.position, radius);
    if (fr !== undefined) {
      if (batched && fr.mask === null) { fr.mask = a.mesh.layers.mask; a.mesh.layers.mask = 0; }
      else if (!batched && fr.mask !== null) { a.mesh.layers.mask = fr.mask; fr.mask = null; }
    }
    // shadows within animalShadowDist: one draw per model per cascade (the shadow herd), else the rig's own caster
    let cast = d2 < TIER_CONFIG.animalShadowDist * TIER_CONFIG.animalShadowDist;
    if (cast && herdShadows && fr !== undefined && a.mesh.visible && !a.fading && this.shadowHerd.take(fr, a.position, radius)) cast = false;
    (this.casters.get(a) ?? a.mesh).castShadow = cast;
    a.setDrawLod(d2 < TIER_CONFIG.animalEyeDist * TIER_CONFIG.animalEyeDist ? 0 : d2 < TIER_CONFIG.animalOneDrawDist * TIER_CONFIG.animalOneDrawDist ? 1 : 2);
    if (TIER_CONFIG.furShells && d2 < SHELL_DIST * SHELL_DIST) {
      for (let k = 0; k < SHELL_MAX; k++) if (d2 < (sd[k] ?? Infinity)) {
        for (let m = SHELL_MAX - 1; m > k; m--) { sd[m] = sd[m - 1] ?? Infinity; si[m] = si[m - 1] ?? -1; }
        sd[k] = d2; si[k] = i; break;
      }
    }
  }

  endDraw(animals: readonly Animal[], count: number, dt: number): void {
    if (TIER_CONFIG.animalFarBatchDist > 0) this.farHerd.end();
    if (this.herdShadows) this.shadowHerd.end();
    publishShellLevels(animals, this.shellIdx, this.shellDist, count);
    this.blood.update(worldTime.realDt || dt); // blood keeps flying through a hit-stop (worldTime, Game.hitStop)
    if (this.debug) this.updateDebug(animals);
  }

  bloodBurst(at: THREE.Vector3, dir: THREE.Vector3, strength: number): void { this.blood.burst(at, dir, strength); }

  private updateDebug(animals: readonly Animal[]): void {
    if (this.debugMeshes.length === 0) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x8fe3ff, wireframe: true });
      for (const a of animals) {
        const h = new THREE.Mesh(new THREE.SphereGeometry(a.dims.headRadius * a.scale, 10, 8), mat);
        const b = new THREE.Mesh(new THREE.CapsuleGeometry(a.dims.bodyRadius * a.scale, a.dims.bodyHalfLen * 2 * a.scale, 4, 10), mat);
        this.debugMeshes.push(h, b); this.group.add(h, b);
      }
    }
    animals.forEach((a, i) => {
      const h = this.debugMeshes[i * 2], b = this.debugMeshes[i * 2 + 1];
      if (h === undefined || b === undefined) return;
      a.headWorld(h.position);
      a.bodyCapsule(_a, _b);
      b.position.lerpVectors(_a, _b, 0.5);
      _d.subVectors(_b, _a).normalize();
      b.quaternion.setFromUnitVectors(_c.set(0, 1, 0), _d);
    });
  }
}
