import { AnimalPoseLaw } from '../../../shared/engine/entities/animalPose';
import { QuadrupedRigPose, applyAnimalRoot } from '../../../shared/engine/entities/animalRig';
import { diagnosticNow } from '../../../shared/engine/core/clock';
import * as THREE from 'three';
import type { CharacterMotor } from '../../../shared/engine/physics/CharacterMotor';
import { ragdollsFor, type Ragdoll } from '../physics/ragdoll';
import { TIER } from '../core/tier';
import { frameCost } from '../../../shared/engine/core/frameCost';
import { heightAt } from '../../../shared/engine/world/Heightfield';
import type { AnimalMaterial, AnimalModel, AnimalRig } from './AnimalFactory';
import { variantMods, type RigAnimCtx } from '../../../shared/engine/entities/species/registry';
import { app, gameplayRandom } from '../app/runtime';
import type { DamageRequest } from '../../../shared/engine/combat/pipeline';
import { AnimalSim, damageFor as simDamageFor, type AnimalPoseSample, type AnimalVolumePort } from '../../../shared/engine/entities/AnimalSim';
import { floorBelow } from '../../../shared/engine/physics/query';

/**
 * Animal — one animal instance (any registered species): procedural skeletal animation + health.
 *
 * Animation is a weighted blend of gait/idle pose generators (idle, graze, walk, trot, gallop)
 * written into a flat Float32Array of joint angles, plus additive layers (alert look-at,
 * hit flinch, death collapse) and terrain adaptation (body tilt to the slope, per-foot
 * knee flex so hooves plant). The result is applied to the rig's bones every frame.
 *
 * DEATH (PHYSICS P8): the killing hit hands the body to a ragdoll (src/client/engine/physics/ragdoll.ts) — built at the pose it died
 * in, thrown by the hit's `dir` / damage, posed from the physics every frame, frozen to a static corpse once it rests.
 * A quadruped's bones are all physics; a custom rig (crab: one tumbling body; monkey / sailor: one upright body that
 * falls) keeps its species' keyframed death on the limbs. Past the tier's live-ragdoll cap (phone 2, desktop 6), or with
 * no physics world (dev scenes), the death is the keyframed collapse below.
 *
 * Public surface used by other systems:
 *   animal.kind: 'deer' | 'boar' | …  animal.alive      animal.position (feet, world)
 *   animal.variant / rarity / label   the rolled VariantDef ('white-stag', 'uncommon', "White stag"); mods = its gameplay multipliers
 *   animal.aggressive                 true for species that charge (boar, bear) — the minimap paints these red
 *   animal.hp / maxHp                 animal.state       animal.yaw (heading, radians)
 *   animal.lastHitT                   diagnosticNow() ms of the last applyDamage (health bars fade from it)
 *   animal.damageFor(headshot, distance)   → the DAMAGE model's number for a bolt (the crossbow asks before applyDamage)
 *   animal.applyDamage(amount, hitPoint, dir) → true if it died
 *   animal.stagger(dir, strength)     a melee blow: pushed STAGGER_PUSH m along `dir` over 0.25 s, AI frozen (`stunned`)
 *                                     for 0.4–0.8 s in a braced flinch; strength 0 = light (0.6 m / 0.4 s), 1 = heavy (1.5 m / 0.8 s)
 *   animal.headWorld(out) / bodyCapsule(a, b)  — hit volumes (world space)
 *   animal.hitFlash(strength)         a melee blow's white flash (Sword.ts): the body's per-animal material glows white and
 *                                     fades over FLASH_T s (world time — it holds through a hit-stop)
 *   animal.attackTurnCap              rad/s the heading may turn while an attack runs (Infinity = free; the Driftwood manager
 *                                     sets ATTACK_TURN so a committed swing can be strafed out of — "strafe is the dodge")
 *   A stagger CANCELS a running attack (a hit interrupts a wind-up: the species' think sees attackPhase < 0 and recovers).
 *   Custom rigs lean away from the blow (the root tilts by the directional flinch); quadrupeds with an attack running (the
 *   manager's charge wind-up) drop the head, lower the front and paw the ground (poseWindup).
 *
 * The AnimalManager owns AI state and calls animal.setMotion(desiredYaw, desiredSpeed).
 *
 * CUSTOM RIGS (`SpeciesDef.rig === 'custom'`: the Driftwood crab / monkey / sailor): the skeleton is whatever the
 * species built (`body` root + `head` are the only required bones); every frame Animal.ts fills a RigAnimCtx
 * (speed, strafe, gait phase, deathT, flinch, brace, attack, mem) and calls `species.animate(ctx)` instead of the
 * quadruped pose generators. Everything else — applyDamage, stagger, hit volumes, fadeOut, the manager's raycast —
 * is unchanged. Extra motion knobs for those species' AI: `setStrafe(mps)` (lateral speed, + = left),
 * `yOffset` (metres above the ground: a monkey in a crown, a sailor below the deck), `startAttack(seconds)` /
 * `attackPhase` (0..1 wind-up → strike, drives the telegraph pose), `mem` (per-animal numbers).
 */

/** Seeded legacy bolt formula shared with the headless simulation. */
export function damageFor(headshot: boolean, dist: number): number { return simDamageFor(headshot, dist, gameplayRandom); }

const P_COUNT = 27;

const smooth01 = (t: number) => t * t * (3 - 2 * t);

const _cc = new THREE.Vector3(), _ca = new THREE.Vector3(), _cb = new THREE.Vector3();

/** a hit capsule on a bone (E350 F-X2, AnimalDims.bodyAt / fore): centre `at` (bone local, model units), the axis the bone's
 *  x or z tilted `pitch` rad toward its y, `halfLen` model units each way. The matrix's columns carry the mesh scale, so
 *  the segment comes out in world metres */
function capsuleOn(m: THREE.Matrix4, at: readonly [number, number, number], axis: 'x' | 'z', pitch: number, halfLen: number, a: THREE.Vector3, b: THREE.Vector3): void {
  _cc.set(at[0], at[1], at[2]).applyMatrix4(m);
  const e = m.elements;
  if (axis === 'x') _ca.set(e[0], e[1], e[2]); else _ca.set(e[8], e[9], e[10]);
  _ca.multiplyScalar(Math.cos(pitch)).addScaledVector(_cb.set(e[4], e[5], e[6]), Math.sin(pitch));
  a.copy(_cc).addScaledVector(_ca, -halfLen); b.copy(_cc).addScaledVector(_ca, halfLen);
}

/** stagger (a sword blow, Sword.ts): push distance / hold time at strength 0 (light) and 1 (heavy), the push's duration */

/** the melee hit flash: seconds to fade, emissive intensity at strength 1 */
const FLASH_T = 0.14, FLASH_I = 0.9;

/** Client creature view over headless state: rigs, animation, material LOD and corpse presentation. */
export class Animal extends AnimalSim {
  mesh: THREE.SkinnedMesh;
  readonly custom: boolean;
  private flashMat: AnimalMaterial | null = null;
  private flashBase = new THREE.Color();
  private flashBaseI = 1;
  /** TE-ENG10: the rig's part materials, each flashed with the body and returned to its own base (an unlit glow by colour) */
  private flashParts: { readonly colour: THREE.Color; readonly base: THREE.Color; readonly intensity: { emissiveIntensity: number } | null; readonly baseI: number }[] = [];
  /** the rig's own part materials (TE-ENG10), kept whole through a fade: a clone would drop their family shader patch */
  private parts: ReadonlySet<THREE.Material> = new Set();
  private flash = 0;
  private bones: Record<string, THREE.Bone>;
  private readonly bBody: THREE.Bone;
  private readonly bHead: THREE.Bone;
  private readonly bFore: THREE.Bone | null;
  private model: AnimalModel;
  private readonly poseLaw: AnimalPoseLaw;
  private get pose(): Float32Array { return this.poseLaw.pose; }
  private get phase(): number { return this.poseLaw.phase; }
  get gaitPhase(): number { return this.phase; }
  private get lookAmt(): number { return this.poseLaw.lookAmt; }
  onStaggered?: (animal: Animal, strength: number, running: boolean) => void;
  private get tiltPitch(): number { return this.poseLaw.tiltPitch; }
  private get tiltRoll(): number { return this.poseLaw.tiltRoll; }
  onFootfall?: (animal: Animal, strength: number) => void;
  debugGait?: { gait: string; phase: number };
  onDamaged?: (animal: Animal, amount: number, hitPoint: THREE.Vector3, dir: THREE.Vector3, died: boolean) => void;
  shells: THREE.SkinnedMesh[] = [];
  makeShells?: (animal: Animal) => THREE.SkinnedMesh[];
  prepareMaterial?: (m: THREE.Material) => void;
  shellLevel = 0;
  hidden = false;
  /** Drawn at any distance: the tier's draw distance never shrinks or hides it (a boss row's body, set by its view). */
  drawPinned = false;
  private fadeT = -1;
  private fadeMats: THREE.Material[] = [];
  private drawLod = 0;
  private lodBase: { geometry: THREE.BufferGeometry; materials: THREE.Material[] } | null = null;
  private legAbd = new Float32Array(4);
  private ragdoll: Ragdoll | null = null;
  private externalSimulation: AnimalSim | null = null;
  private observedHit = -Infinity;
  private observedAlive = true;
  private readonly simPose: AnimalPoseSample = { attackT: -1, attackDur: 1, groundY: 0, tiltRollT: 0,
    stunT: 0, flinch: 0, flinchRoll: 0, flinchPitch: 0, brace: 0, deathSide: 1 };

  /** True when the authoritative host, rather than the legacy manager, owns decisions and physics. */
  get simulationBound(): boolean { return this.externalSimulation !== null || this.rowDriven; }
  /** A wire row stands this body (`showRow`): no decision or step of its own, only its pose. */
  rowDriven = false;
  /** The rows' lowest flinch since the last blow. A blow is a rise in the wire's own flinch: the local copy decays every
   *  frame (the pose law, a custom rig's ragdoll) while a dead body's row keeps its last flinch, so comparing against the
   *  local copy re-armed the white flash every frame on a corpse (TE-ENG9). The rise counts from the low point, not the
   *  last row: an interpolated rise at a high frame rate moves less than the threshold per frame. */
  private rowFlinchLow = 0;
  /** The last row's hp, null before the first: a body that comes into view already hurt took no blow this page saw. */
  private rowHp: number | null = null;
  override showRow(row: Parameters<AnimalSim['showRow']>[0], dt: number): void {
    const hit = row.flinch > this.rowFlinchLow + 0.05, died = this.alive && !row.alive;
    // REMOTE-PLAYERS RP1: a fall in the row's hp is a blow, whoever landed it, so every page in range shows the bar draining
    // (Combat.ts reads `lastHitT`). Only this page's own hits reach the pipeline that sets it offline.
    const struck = this.rowHp !== null && row.hp < this.rowHp;
    this.rowFlinchLow = hit ? row.flinch : Math.min(this.rowFlinchLow, row.flinch);
    this.rowHp = row.hp;
    super.showRow(row, dt);
    if (struck) this.lastHitT = this.hitTime();
    if (hit) this.hitFlash();
    if (died) { this.deathT = 0; this.deathSide = 1; }
  }
  /** A rig's queries retain its render-published bones; bind posed volumes on the authoritative native actor. */
  override bindVolumes(_port: AnimalVolumePort): void { throw new Error('Bind creature volumes on the native actor'); }
  /** Bind a fresh rig to the host creature. Rendering never advances or disposes its simulation body. */
  bindSimulation(sim: AnimalSim): this {
    if (this.externalSimulation !== null || this.motor !== null || this.ragdoll !== null
      || sim === this || sim.entityId !== this.entityId || sim.kind !== this.kind) throw new Error('Incompatible creature view binding');
    this.externalSimulation = sim;
    const share = (key: keyof AnimalSim): void => {
      Object.defineProperty(this, key, { configurable: false, enumerable: true,
        get: () => sim[key], set: (value: unknown) => { Reflect.set(sim, key, value); } });
    };
    for (const key of ['kind', 'variant', 'rarity', 'label', 'aggressive', 'mods', 'alive', 'hp', 'maxHp',
      'position', 'yaw', 'speed', 'state', 'herd', 'desiredYaw', 'desiredSpeed', 'turnRate', 'lastHitT',
      'lookTarget', 'lookWeight', 'seed', 'scale', 'strafe', 'desiredStrafe', 'yOffset', 'driven', 'levelGround',
      'groundHeight', 'mem', 'attackTurnCap', 'scripted', 'harnessHold'] as const) share(key);
    Object.defineProperties(this, {
      combatActor: { value: sim.combatActor.bind(sim) }, applyDamage: { value: sim.applyDamage.bind(sim) },
      applyFinalDamage: { value: sim.applyFinalDamage.bind(sim) }, stagger: { value: sim.stagger.bind(sim) },
      setMotion: { value: sim.setMotion.bind(sim) }, setStrafe: { value: sim.setStrafe.bind(sim) },
      impulse: { value: sim.impulse.bind(sim) }, fly: { value: sim.fly.bind(sim) },
      startAttack: { value: sim.startAttack.bind(sim) }, cancelAttack: { value: sim.cancelAttack.bind(sim) },
      damageFor: { value: sim.damageFor.bind(sim) }, step: { value: sim.step.bind(sim) },
      snapshot: { value: sim.snapshot.bind(sim) }, restore: { value: sim.restore.bind(sim) },
      attackPhase: { get: () => sim.attackPhase }, stunned: { get: () => sim.stunned },
      flying: { get: () => sim.flying }, lockable: { get: () => sim.lockable },
      lockRange: { get: () => sim.lockRange }, hasImpulse: { get: () => sim.hasImpulse },
      place: { value: (x: number, z: number, yaw: number, y?: number): void => {
        sim.place(x, z, yaw, y); this.mesh.position.copy(sim.position); this.mesh.rotation.y = sim.yaw;
      } },
    });
    this.rigCtx.position = sim.position; this.rigCtx.lookTarget = sim.lookTarget; this.rigCtx.mem = sim.mem;
    this.observedHit = sim.lastHitT; this.observedAlive = sim.alive;
    return this;
  }

  private readSimulationPose(): void {
    const sim = this.externalSimulation;
    if (sim === null) return;
    const motion = this.simPose; sim.samplePose(motion);
    this.attackT = motion.attackT; this.attackDur = motion.attackDur; this.groundY = motion.groundY;
    this.tiltRollT = motion.tiltRollT; this.stunT = motion.stunT;
    if (sim.lastHitT !== this.observedHit) {
      this.observedHit = sim.lastHitT; this.flinch = motion.flinch;
      this.flinchRoll = motion.flinchRoll; this.flinchPitch = motion.flinchPitch; this.brace = motion.brace;
      this.hitFlash();
    }
    if (sim.alive !== this.observedAlive) {
      this.observedAlive = sim.alive; this.deathT = sim.alive ? -1 : 0; this.deathSide = motion.deathSide;
    }
    this.rigCtx.mem = sim.mem;
  }

constructor(rig: AnimalRig, model: AnimalModel, seed: number, scale = 1, entityId = `creature.${model.kind}.${String(seed)}`) {
    const v = model.variantDef;
    super({ kind: model.kind, label: v.label || model.species.label, variant: v.id, rarity: v.rarity,
      hp: v.hp ?? model.species.tuning?.hp ?? (model.species.aggressive === true ? 100 : 60),
      aggressive: model.species.aggressive ?? false, dims: model.dims, mods: variantMods(model.species, v),
      ...(model.species.flight === undefined ? {} : { flight: model.species.flight }),
      ...(model.species.lockable === undefined ? {} : { lockable: model.species.lockable }) }, seed, scale, entityId, {
      heightAt: (x, z) => heightAt(x, z), random: gameplayRandom, now: () => diagnosticNow(),
      floorBelow: (x, z, fromY, maxDrop) => app.physics === null ? heightAt(x, z) : floorBelow(app.physics, x, z, fromY, maxDrop),
    });
    this.mesh = rig.mesh; this.bones = rig.bones; this.model = model;
    this.mesh.scale.setScalar(scale);
    this.mesh.rotation.order = 'YXZ';
    this.custom = model.species.rig === 'custom';
    this.poseLaw = new AnimalPoseLaw({ dims: model.dims, custom: this.custom, ...(model.species.gait === undefined ? {} : { gait: model.species.gait }), ...(model.species.pose === undefined ? {} : { pose: model.species.pose }) });
    this.poseLaw.onFootfall = strength => { this.onFootfall?.(this, strength); };
    const bone = (name: string): THREE.Bone => {
      const bn = rig.bones[name];
      if (bn === undefined) throw new Error(`animal '${model.kind}': rig has no bone '${name}'`);
      return bn;
    };
    this.bBody = bone('body'); this.bHead = bone('head');
    const fore = model.dims.fore;
    this.bFore = fore === undefined ? null : bone(fore.bone);
    this.jointPose=this.custom?null:new QuadrupedRigPose(rig.bones);
    const fur = rig.materials[0];
    if (fur !== undefined && fur !== model.hard) { this.flashMat = fur; this.flashBase.copy(fur.emissive); this.flashBaseI = fur.emissiveIntensity; }
    this.parts = new Set(rig.parts);
    for (const part of rig.parts ?? []) {
      const emissive: unknown = Reflect.get(part, 'emissive'), colour: unknown = Reflect.get(part, 'color'), lit = emissive instanceof THREE.Color;
      const flashed = lit ? emissive : colour instanceof THREE.Color ? colour : null; if (flashed === null) continue;
      const intensity = lit && typeof Reflect.get(part, 'emissiveIntensity') === 'number' ? part as unknown as { emissiveIntensity: number } : null;
      this.flashParts.push({ colour: flashed, base: flashed.clone(), intensity, baseI: intensity?.emissiveIntensity ?? 1 });
    }
    this.rigCtx = {
      bones: this.bones, dims: model.dims, dt: 0, t: 0, seed, scale, speed: 0, strafe: 0, phase: 0, state: 'idle', alive: true,
      deathT: -1, flinch: 0, brace: 0, attack: -1, lookTarget: this.lookTarget, lookWeight: 0, position: this.position, yaw: 0, mem: this.mem, animal: this,
    };
  }
  private rigCtx: RigAnimCtx;
  /** A restored snapshot replaces `mem` (AnimalSim.restore copies it), so the rig poses from the restored memory, not the
   *  object it was built with (G254: a restored grid region's Drowned Sailor posed from its pre-restore memory, its deck
   *  offset lost, 0.6 m under the hold's floor). An externally simulated body reads its simulation's memory instead. */
  override restore(saved: ReturnType<AnimalSim['snapshot']>): void {
    super.restore(saved);
    this.rigCtx.mem = this.mem;
  }

  /** The flight body opts into 3-D lock acquisition and camera tracking, independent of species kind. */

  /** Authored species eligibility; flight bodies retain their default opt-in. */

  /** fading out (fadeOut): its own transparent materials, so the far herd leaves it alone */
  get fading(): boolean { return this.fadeT >= 0; }

  /** Place on analytic ground (plus flight altitude), or at an exact world feet `y`, facing `yaw`. */
  override place(x: number, z: number, yaw: number, y?: number): void {
    super.place(x, z, yaw, y);
    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = yaw;
  }

  /** Add world velocity (m/s), decaying at 3.5/s. WORLD ground bodies retain Y for a fall; flyers use XYZ. */

  /** Public flight command; the species must declare its flight body. */

  /** lateral desired speed, m/s, + = the animal's left (the crab sidesteps around you) */

  /** begin an attack lasting `dur` s: `attackPhase` runs 0 → 1 (the species' animate poses the wind-up and the strike from it) */

  /** set by the manager: an attack (a wind-up) just started — the telegraph's sound cue */
  onAttack?: ((animal: Animal, dur: number) => void) | undefined;
  /** 0..1 through the current attack, -1 when none (held at 1 until the next startAttack / cancelAttack) */

  /** a melee blow's white flash (0..1): the body glows white and fades over FLASH_T s (see the header) */
  hitFlash(strength = 1): void {
    if (this.flashMat === null) return;
    this.flash = Math.max(this.flash, THREE.MathUtils.clamp(strength, 0, 1));
    this.applyFlash();
  }
  private applyFlash(): void {
    const m = this.flashMat;
    if (m === null) return;
    const k = this.flash;
    if (k <= 0) {
      m.emissive.copy(this.flashBase); m.emissiveIntensity = this.flashBaseI;
      for (const part of this.flashParts) { part.colour.copy(part.base); if (part.intensity !== null) part.intensity.emissiveIntensity = part.baseI; }
      return;
    }
    m.emissive.setRGB(1, 1, 1).lerp(this.flashBase, 1 - k); m.emissiveIntensity = THREE.MathUtils.lerp(this.flashBaseI, FLASH_I, k);
    for (const part of this.flashParts) {
      part.colour.setRGB(1, 1, 1).lerp(part.base, 1 - k);
      if (part.intensity !== null) part.intensity.emissiveIntensity = THREE.MathUtils.lerp(part.baseI, Math.max(part.baseI, FLASH_I), k);
    }
  }

  // ── combat ─────────────────────────────────────────────────────────────────────────────

  /** damage a bolt does to this animal: body 32–40 with distance falloff, ×2.5 to the head (see DAMAGE) */

  /** world-space head hit sphere centre (the head joint, or dims.headAt on the head bone) */
  override headWorld(out: THREE.Vector3): THREE.Vector3 {
    const at = this.model.dims.headAt;
    if (at !== undefined) return out.set(at[0], at[1], at[2]).applyMatrix4(this.bHead.matrixWorld);
    const m = this.bHead.matrixWorld.elements;
    return out.set(m[12], m[13], m[14]);
  }
  /** world-space body capsule segment (a = rump, b = chest; or bottom → top for an upright rig, dims.capsuleAxis 'y') */
  override bodyCapsule(a: THREE.Vector3, b: THREE.Vector3): void {
    const d = this.model.dims;
    if (d.capsuleAxis !== 'y' && (d.bodyAt !== undefined || d.bodyPitch !== undefined)) {
      capsuleOn(this.bBody.matrixWorld, d.bodyAt ?? [0, 0, 0], 'z', d.bodyPitch ?? 0, d.bodyHalfLen, a, b);
      return;
    }
    const m = this.bBody.matrixWorld.elements;
    // body bone world matrix: columns are the body axes in world space
    const cx = m[12], cy = m[13], cz = m[14];
    const o = d.capsuleAxis === 'y' ? 4 : 8;
    const fx = m[o] * d.bodyHalfLen, fy = (m[o + 1] ?? 0) * d.bodyHalfLen, fz = (m[o + 2] ?? 0) * d.bodyHalfLen;
    a.set(cx - fx, cy - fy, cz - fz); b.set(cx + fx, cy + fy, cz + fz);
  }
  /** world-space segment of the second body capsule (dims.fore); false when the species has none */
  override foreCapsule(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const f = this.model.dims.fore, bone = this.bFore;
    if (f === undefined || bone === null) return false;
    capsuleOn(bone.matrixWorld, f.at, 'x', 0, f.halfLen, a, b);
    return true;
  }

  /**
   * Apply damage (`amount` is final: AnimalManager.raycast() hands back `hit.damage` from the DAMAGE model —
   * body 32–40 with distance falloff, head ×2.5 — and AnimalManager.hit(hit, dir) applies it). `hitPoint`/`dir`
   * (world) drive the flinch and the collapse side. Returns true if this shot killed it. Blood, sounds, AI reaction and manager.onKill
   * happen through `onDamaged`, so calling this directly is enough. A variant's `mods.damageTaken` scales BODY hits
   * (Old Ironhide shrugs off 40 %); a headshot always lands in full — `onDamaged` gets the amount actually dealt.
   */
  override applyDamage(amount: number, hitPoint: THREE.Vector3, dir: THREE.Vector3): boolean {
    if (!this.alive) return false;
    return app.combat.hit({ source: 'env', sourceTags: ['dmg.legacy', 'cover.checked'], target: this.combatActor(), amount, point: hitPoint, dir })?.killed ?? false;
  }

  override get dims(): AnimalModel['dims'] { return this.model.dims; }
  protected override hitTime(): number { return diagnosticNow(); }

  /** Stable bridge for weapons until the creature runtime supplies its own Actor. */

  /** Pipeline output only: variant and species modifiers have already run once, in order. */

  /**
   * The death's ragdoll (see the header): the build from the rig, the animal's own motion plus the hit's throw. Null
   * past the tier cap or with no physics world — then the keyframed collapse runs as before.
   */
  private startRagdoll(damage: number, hitPoint: THREE.Vector3, dir: THREE.Vector3): void {
    const physics = app.physics;
    if (physics === null) return;
    const d = this.model.dims;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    this.mesh.updateMatrixWorld(true);
    this.ragdoll = ragdollsFor(physics).spawn({
      build: !this.custom ? 'quadruped' : d.capsuleAxis === 'y' ? 'upright' : 'rigid',
      root: this.mesh, bones: this.bones, dims: d, scale: this.scale, lite: TIER === 'phone',
      // forward along the heading, strafe to the animal's left (world (cos yaw, -sin yaw))
      velocity: { x: sin * this.speed + cos * this.strafe, y: 0, z: cos * this.speed - sin * this.strafe },
      hitPoint, dir, damage,
    });
  }

  /** A ragdolled death's frame: the physics poses the mesh (and a quadruped's bones), a custom rig's limbs keep their keyframes. */
  private updateRagdoll(r: Ragdoll, dt: number, t: number, near: boolean): void {
    this.speed = 0; this.strafe = 0;
    if (this.custom && near) {
      if (this.flinch > 0.001) this.flinch *= Math.exp(-dt * 5.5);
      if (this.deathT >= 0) this.deathT = Math.min(1, this.deathT + dt / 0.8);
      const c = this.rigCtx;
      c.dt = dt; c.t = t; c.speed = 0; c.strafe = 0; c.phase = this.phase; c.state = this.state; c.alive = false;
      c.deathT = this.deathT; c.flinch = this.flinch; c.brace = 0; c.attack = -1; c.lookWeight = 0; c.yaw = this.yaw;
      this.model.species.animate?.(c);
    }
    r.pose(dt);
    // the corpse's place (loot, harvest): under the torso, or the custom rig's root
    r.rootPosition(this.position);
    if (!this.custom) this.position.y -= this.model.dims.halfWidth * this.scale;
    this.updateFade(dt);
    if (this.hidden) r.dispose();
  }

  /** the physics body while near the player (src/shared/engine/physics/creatures.ts hands it out and takes it back) */
  override motor: CharacterMotor | null = null;
  /** Explicit retirement releases a corpse's ragdoll even when it receives no later update. */
  retireBody(): void {
    this.ragdoll?.dispose(); this.ragdoll = null;
    if (this.externalSimulation === null) { this.motor?.dispose(); this.motor = null; }
  }
  /** the last update left the skeleton's pose as it was (the far LOD): the animals' group may keep its bones' world
   *  matrices while the root stands still too (src/client/engine/entities/animalMatrices.ts) */
  poseFrozen = false;
  /** counts the updates that may pose the bones (only `update` poses them): the animals' group compares a pose only when it
   *  moved on since the group last saw it */
  poseVersion = 0;
  /** FC11: pose the bones on every Nth update (the manager sets it from the camera distance); the root moves every update */
  poseEvery = 1;
  private poseTick = -1;
  /** the time since the bones were last posed, handed to the next pose (springs and the gait read the whole step) */
  private poseDt = 0;

  /** true while a stagger holds it: the manager skips its think, it neither steers nor walks */

  /**
   * A melee blow (Sword.ts calls it right after applyDamage): the animal stops dead, is shoved along `dir` (world,
   * flattened) over STAGGER_PUSH_T s and holds a braced flinch for the stun — 0.6 m / 0.4 s at strength 0 (a light
   * swing) up to 1.5 m / 0.8 s at 1 (the heavy). Big animals (scale > 1) are shoved proportionally less. Bolts never
   * call this, so Pine Hollow's crossbow hunting is unchanged. `onStaggered` lets the manager break a running charge.
   */

  protected override moveBody(want: { x: number; y: number; z: number }): void {
    const t0 = frameCost.on ? diagnosticNow() : 0;
    super.moveBody(want);
    if (frameCost.on) frameCost.sub('motor', t0);
  }
  protected override attackStarted(dur: number): void { this.onAttack?.(this, dur); }
  protected override hasDamageMultiplier(): boolean { return this.model.species.damageMul !== undefined; }
  protected override damageMultiplier(req: DamageRequest): number { return this.model.species.damageMul?.(this, req.point, req.dir, req) ?? 1; }
  protected override died(dealt: number, point: THREE.Vector3, dir: THREE.Vector3): void {
    for (let l = 0; l < 4; l++) this.legAbd[l] = ((l % 2 === 0) === (this.deathSide < 0)) ? 0.35 : 0.25;
    this.startRagdoll(dealt, point, dir);
  }
  /** A settled wire death runs the existing collapse presentation without applying damage. */
  presentDeath(dealt: number, point: THREE.Vector3, dir: THREE.Vector3): void { this.died(dealt, point, dir); }
  protected override damaged(dealt: number, point: THREE.Vector3, dir: THREE.Vector3, died: boolean): void { this.onDamaged?.(this, dealt, point, dir, died); }
  protected override staggered(strength: number, running: boolean): void { this.onStaggered?.(this, strength, running); }

  // ── per-frame ──────────────────────────────────────────────────────────────────────────

  /** Integrate motion and animate. `t` = global seconds; `near` = within animation LOD range. */
  update(dt: number, t: number, near: boolean): void {
    this.poseFrozen = false; this.poseVersion++;
    if (this.flash > 0) { this.flash = Math.max(0, this.flash - dt / FLASH_T); this.applyFlash(); }
    if (this.ragdoll !== null) { this.updateRagdoll(this.ragdoll, dt, t, near); return; }
    if (this.rowDriven) { /* posed from its row */ } else if (this.externalSimulation === null) this.stepMotion(dt); else this.readSimulationPose();

    this.advancePose(this.poseLaw, dt, t, near, this.externalSimulation === null && !this.rowDriven, this.debugGait);
    if (!near) { this.applyRoot(); this.poseFrozen = true; return; }
    // FC11: a mid / far animal keeps its last bone pose between pose frames (staggered by its seed); the root still moves
    this.poseDt += dt;
    if (this.poseTick < 0) this.poseTick = Math.floor(this.seed * 8);
    this.poseTick = (this.poseTick + 1) % 8;
    if (this.poseEvery > 1 && this.poseTick % this.poseEvery !== 0) { this.applyRoot(); this.updateFade(dt); this.poseFrozen = true; return; }
    const poseDt = this.poseDt;
    this.poseDt = 0;
    if (this.custom) {
      const c = this.rigCtx;
      c.dt = poseDt; c.t = t; c.speed = this.speed; c.strafe = this.strafe; c.phase = this.phase; c.state = this.state; c.alive = this.alive;
      c.deathT = this.deathT; c.flinch = this.flinch; c.brace = smooth01(this.brace); c.attack = this.attackPhase; c.lookWeight = this.lookAmt; c.yaw = this.yaw;
      this.model.species.animate?.(c);
      this.applyRoot();
      this.updateFade(dt);
      return;
    }

    this.applyPose(poseDt);
    const post = this.model.species.postPose;
    if (post !== undefined) {
      // species-only motion on top of the standard pose (a horse's mane and rearing, a wolf's jaw) — SpeciesDef.postPose
      const c = this.rigCtx;
      c.dt = poseDt; c.t = t; c.speed = this.speed; c.strafe = this.strafe; c.phase = this.phase; c.state = this.state; c.alive = this.alive;
      c.deathT = this.deathT; c.flinch = this.flinch; c.brace = smooth01(this.brace); c.attack = this.attackPhase; c.lookWeight = this.lookAmt; c.yaw = this.yaw;
      post(c);
    }
    this.applyRoot();
    this.updateFade(dt);
  }

  /** Show `n` of the fur-shell layers (0 = none; spread across the 8 layers so 4 still spans the coat depth). */
  setShellLevel(n: number): void {
    if (n === this.shellLevel) return;
    if (n > 0 && this.shells.length === 0 && this.makeShells !== undefined) this.shells = this.makeShells(this);
    this.shellLevel = n;
    const N = this.shells.length;
    for (const sh of this.shells) sh.visible = false;
    if (this.hidden) return;
    // pick n layers evenly spaced, always including the outermost
    for (let j = 0; j < Math.min(n, N); j++) { const sh = this.shells[Math.round(((j + 1) * N) / Math.min(n, N)) - 1]; if (sh !== undefined) sh.visible = true; }
  }

  /**
   * Draw LOD, set by the manager from the camera distance (tier.ts animalEyeDist / animalOneDrawDist):
   * 0 = fur / hard / eye, three draws; 1 = the eyes drawn in the hard material (two draws — an eye is under a pixel
   * there); 2 = the whole body in the fur material (one draw — hooves / antlers are a pixel or two). Rigs whose
   * geometry is not the fur / hard / eye split (custom and low-poly models) stay at 0.
   */
  setDrawLod(level: number): void {
    if (level === this.drawLod || this.fadeT >= 0) return;
    const mesh = this.mesh;
    if (this.lodBase === null) {
      // a rig with part materials (TE-ENG10) keeps every group: a glowing part never folds into the body
      if (!Array.isArray(mesh.material) || mesh.material.length !== 3 || this.flashParts.length > 0 || eyesInHard(mesh.geometry) === null) return;
      this.lodBase = { geometry: mesh.geometry, materials: mesh.material };
    }
    const { geometry, materials } = this.lodBase;
    const merged = level === 1 ? eyesInHard(geometry) : null;
    const fur = materials[0];
    if (level === 1 && merged !== null) { mesh.geometry = merged; mesh.material = materials; this.drawLod = 1; }
    else if (level === 2 && fur !== undefined) { mesh.geometry = geometry; mesh.material = fur; this.drawLod = 2; }
    else { mesh.geometry = geometry; mesh.material = materials; this.drawLod = 0; }
  }

  /** Fade the (dead) animal out over 1.5 s, then hide it. Used when a carcass has been harvested. */
  fadeOut(): void {
    if (this.fadeT >= 0 || this.hidden) return;
    this.setDrawLod(0);
    this.fadeT = 0;
    this.setShellLevel(0);
    // give this mesh its own transparent materials (hard + eye are shared per model); the body from this animal's own
    // material, which a `sharedBody` look keeps as its port while the rig draws the model's one body
    const mats = this.mesh.material as THREE.Material[];
    // a part material is this rig's own (TE-ENG10): it fades as itself, keeping its family patch (an emissive's intensity)
    this.fadeMats = mats.map((m, i) => {
      if (this.parts.has(m)) { if (!m.transparent) { m.transparent = true; m.needsUpdate = true; } return m; }
      const c = (i === 0 && this.flashMat !== null ? this.flashMat : m).clone(); c.transparent = true; c.depthWrite = true; this.prepareMaterial?.(c); return c;
    });
    // the fur clone loses its rim patch; a plain transparent fade is fine for 1.5 s
    this.mesh.material = this.fadeMats;
  }

  private updateFade(dt: number): void {
    if (this.fadeT < 0) return;
    this.fadeT += dt / 1.5;
    const k = Math.min(1, this.fadeT);
    for (const m of this.fadeMats) m.opacity = 1 - k;
    this.mesh.position.y -= 0.12 * k;                 // sinks into the ground as it goes
    if (k >= 1) { this.hidden = true; this.mesh.visible = false; this.fadeT = -1; }
  }

  /** Sample at the existing manager cadence; motion and target clocks retain their actor owner. */
  sampleTerrain(): void { this.samplePoseTerrain(this.poseLaw); }

  // ── apply to bones ──────────────────────────────────────────────────────────────────────

  private readonly jointPose: QuadrupedRigPose | null;
  private readonly jointClock = { bodyY: 0, alive: true, deathT: -1, deathSide: 1, speed: 0, legAbd: this.legAbd };
  private applyPose(dt: number): void {
    const c=this.jointClock;
    c.bodyY=this.model.dims.bodyY;c.alive=this.alive;c.deathT=this.deathT;c.deathSide=this.deathSide;c.speed=this.speed;
    this.jointPose?.apply(this.pose,dt,c);
  }
  private applyRoot(): void {
    applyAnimalRoot(this.mesh,this.position,this.yaw,this.tiltPitch,this.tiltRoll,this.custom,this.alive,this.flinch,this.flinchPitch,this.flinchRoll);
  }

}

export { P_COUNT };

/**
 * The fur / hard / eye rig geometry with the eye range folded into the hard group (same buffers, one group fewer),
 * cached per geometry; null when the groups are not that contiguous three-way split.
 */
const eyesMerged = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry | null>();
function eyesInHard(g: THREE.BufferGeometry): THREE.BufferGeometry | null {
  const hit = eyesMerged.get(g);
  if (hit !== undefined) return hit;
  const [fur, hard, eye] = g.groups;
  let out: THREE.BufferGeometry | null = null;
  const split = g.groups.length === 3 && fur?.materialIndex === 0 && hard?.materialIndex === 1 && eye?.materialIndex === 2;
  if (split && eye.start === hard.start + hard.count) {
    out = new THREE.BufferGeometry();
    out.setIndex(g.index);
    for (const [name, attr] of Object.entries(g.attributes)) out.setAttribute(name, attr);
    out.morphAttributes = g.morphAttributes; out.morphTargetsRelative = g.morphTargetsRelative;
    out.boundingSphere = g.boundingSphere; out.boundingBox = g.boundingBox;
    out.addGroup(fur.start, fur.count, 0);
    out.addGroup(hard.start, hard.count + eye.count, 1);
  }
  eyesMerged.set(g, out);
  return out;
}
