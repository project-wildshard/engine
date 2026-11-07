import {readModuleGroups} from '../boot/download';

import { uiScope, mountUi } from '../ui/ownership';
import { engineString } from '../../../shared/engine/strings';
import { app } from '../app/runtime';
import { resourceScope } from '../../../shared/engine/app/resources';
import type { Scope } from '../../../shared/engine/app/scope';
import { ownSceneTree } from '../app/sceneOwnership';
import { tap } from '../../../shared/engine/core/harnessTap';
/** Shared HUD + Weapon Explorer: a 100 × 100 m enclosed grid room and three hit-reactive humanoid dummies. */
import * as THREE from 'three';
import type { Game } from '../core/Game';
import { practiceFps } from '../core/tier';
import type { Physics } from '../../../shared/engine/physics/Physics';
import { addTrainingTarget, trainingTargetRaycast, type TrainingTargetBodies } from '../../../shared/engine/physics/trainingTargets';
import type { Player } from '../player/Player';
import type { TargetAnimal, TargetHit } from '../combat/types';
import type { EquipmentService } from '../combat/EquipmentService';
import { practiceActor } from './targets';
import type { WorldRegistry, ColliderDesc } from '../world/registry';
import { DummyMotion, DummyPose } from './DummyMotion';
import type { DummyClips } from './DummyClips';
import { applyDummyStudio } from './DummyStudio';
import { DUMMY_JOINTS, type DummyVariant, type TrainingDummyModel } from './TrainingDummy';
import { DUMMY_VARIANTS } from './dummyMetadata';
import { ARENA_LINEUP } from './lineup';
import { enterPracticeLoan, exitPracticeLoan, practiceViewDistance } from './practiceLoan';
import { paramsOf } from '../models/model';
import { trainingDummy } from '../models/trainingDummy';
import { dummyFigure, dummyStandIn } from '../models/trainingDummyFigure';
import './arena.css';
import type { Renderer } from '../render/renderer';

const HALF_WIDTH = 50, HALF_DEPTH = 50, WALL_HEIGHT = 9;
const Y = 900; // an isolated room high over each shard; existing world geometry and AI never enter it
const CYAN = 0x75d9ff;

/** the lineup (./lineup.ts: placements of the shared dummy model, room-local) */
const LINEUP = ARENA_LINEUP;
const LABEL_Y = 2.05;
/** the figure's weight against a blow: straw is light, steel heavy */
const MASS: Record<DummyVariant, number> = { 'straw-cloth': 0.8, wood: 1, 'wood-steel': 1.3 };
const HEAD_BOTTOM = 1.36; // trainingTargets.ts: the head volume spans 1.36 – 1.78 m

interface FloatingText { el: HTMLElement; point: THREE.Vector3; time: number }

const _label = new THREE.Vector3(), _float = new THREE.Vector3(), _toward = new THREE.Vector3();

export class TrainingTarget implements TargetAnimal {
  readonly kind = 'training-dummy';
  readonly lockable = true;
  harnessHold = false;
  readonly alive = true; // practice targets never die or stop accepting combos
  readonly position: THREE.Vector3;
  readonly dims = { bodyY: 0.94, bodyRadius: 0.4, bodyHalfLen: 0.4 };
  model: TrainingDummyModel;
  ready = false;
  readonly variant: DummyVariant;
  readonly label: HTMLElement;
  /** its Rapier colliders (src/shared/engine/physics/trainingTargets.ts), on only while the room is open */
  bodies: TrainingTargetBodies | null = null;
  /** the springs (hit-driven motion) and the bones they drive; the pose waits for the model */
  readonly motion: DummyMotion;
  private pose: DummyPose | null = null;
  private clips: DummyClips | null = null;
  private materials: THREE.MeshStandardMaterial[] = [];
  /** The current figure owns its generated studio materials, including the drawn loading stand-in. */
  private figureScope: Scope | null = null;
  private readonly owner: Scope;
  private readonly studio: typeof applyDummyStudio;
  private flash = 0;
  private flashShown = 0;
  /** the tag's width in px, measured once it is laid out (reading it every frame would force a layout per frame) */
  labelWidth = 0;
  /** the last blow, so the melee stagger that follows it in the same frame adds to that blow */
  private lastHit = { px: 0, py: 0, pz: 0, frame: -1 };
  private frame = 0;
  /** who is swinging: the push falls back to "away from the player" when a hit carries no direction */
  attacker: THREE.Vector3 | null = null;
  onDamage: (amount: number, point: THREE.Vector3) => void = () => undefined;

  constructor(variant: DummyVariant, x: number, y: number, z: number, localX: number, localZ: number, layer: HTMLElement, seed: number, owner: Scope = resourceScope(), studio: typeof applyDummyStudio = applyDummyStudio) {
    this.owner = owner; this.studio = studio;
    this.variant = variant;
    this.position = new THREE.Vector3(x, y, z);
    this.model = { root: new THREE.Group(), joints: {}, rig: 'placeholder' };
    this.model.root.position.set(localX, 0, localZ);
    this.motion = new DummyMotion(seed);
    const label = document.createElement('div'); label.className = 'ws-practice-label';
    label.textContent = DUMMY_VARIANTS.find((v) => v.id === variant)?.label ?? variant;
    layer.append(label); this.label = label;
  }

  install(model: TrainingDummyModel, renderer: Renderer): void {
    if (this.owner.disposed) throw new Error('Practice figure owner has retired');
    const previous = this.model.root;
    model.root.position.copy(previous.position);
    const parent = previous.parent;
    this.figureScope?.dispose();
    this.figureScope = this.owner.child('practice-figure');
    ownSceneTree(model.root, this.figureScope, app.assets);
    if (parent) { parent.remove(previous); parent.add(model.root); }
    this.materials = this.studio(model.root, renderer);
    // the springs rotate bones from their rest pose; measure it before anything moves them
    this.pose = new DummyPose(model.root, model.joints);
    this.motion.leftSign = DummyPose.leftSign(model.root, model.joints);
    this.model = model;
    this.clips = null;
    if (model.rig === 'humanoid') {
      void this.installClips(model);
    }
    this.ready = true;
  }

  private async installClips(model: TrainingDummyModel): Promise<void> {
    try {
      const { DummyClips, loadDummyClips } = await import('./DummyClips');
      const clips = await loadDummyClips(this.variant);
      if (this.model === model) this.clips = new DummyClips(model.root, clips, this.variant);
    } catch (error: unknown) { console.warn('Training dummy motion unavailable', error); }
  }

  damageFor(headshot: boolean, distance: number): number {
    const base = this.variant === 'straw-cloth' ? 39 : this.variant === 'wood' ? 30 : 22;
    return Math.round(base * (headshot ? 2.2 : 1) * Math.max(0.7, 1 - distance / 160));
  }

  headWorld(out: THREE.Vector3): THREE.Vector3 { out.copy(this.position); out.y += 1.58; return out; }

  /** the push along `dir` (world), flattened; away from the attacker when it has no horizontal part */
  private push(dir: THREE.Vector3 | undefined, point: THREE.Vector3): { dx: number; dz: number } {
    let dx = dir?.x ?? 0, dz = dir?.z ?? 0;
    let len = Math.hypot(dx, dz);
    if (len < 0.2) {
      _toward.copy(this.position).sub(this.attacker ?? point.clone().setZ(point.z + 1));
      dx = _toward.x; dz = _toward.z; len = Math.hypot(dx, dz);
    }
    return len > 1e-4 ? { dx: dx / len, dz: dz / len } : { dx: 0, dz: -1 };
  }

  applyDamage(amount: number, point: THREE.Vector3, dir?: THREE.Vector3): boolean {
    const armor = this.variant === 'wood-steel' ? 0.62 : this.variant === 'wood' ? 0.82 : 1;
    const dealt = Math.max(1, Math.round(amount * armor));
    const px = point.x - this.position.x, py = point.y - this.position.y, pz = point.z - this.position.z;
    const { dx, dz } = this.push(dir, point);
    // the punch of any hit; a melee blow's stagger (Sword/Sabre call it right after) adds the knock-back
    tap.hit?.('training-dummy', amount);
    this.motion.hit({ px, py, pz, dx, dz, weight: Math.min(3, Math.max(0.3, amount / 25)) / MASS[this.variant], headshot: py > HEAD_BOTTOM });
    const reaction = py > HEAD_BOTTOM ? 'head-hit' : Math.abs(px) > 0.18
      ? (px * this.motion.leftSign > 0 ? 'hit-left' : 'hit-right') : amount >= 45 ? 'heavy-hit' : 'body-hit';
    this.clips?.hit(reaction, amount / 25, MASS[this.variant]);
    this.lastHit.py = py; this.lastHit.frame = this.frame;
    this.flash = Math.min(1, this.flash + 0.35 + dealt / 120);
    this.onDamage(dealt, point);
    return false;
  }

  /** a melee knock-back: the blow's rock grows with the move's stagger (light 0 … charged 1) */
  stagger(dir: THREE.Vector3, strength: number): void {
    const h = this.lastHit;
    const { dx, dz } = this.push(dir, this.position);
    this.motion.shove(h.frame === this.frame ? h.py : 1.1, dx, dz, Math.max(0, strength), MASS[this.variant]);
    if (strength >= 0.7) this.clips?.hit('heavy-hit', 1 + strength, MASS[this.variant]);
  }

  /**
   * The bone a bolt or arrow stuck at `point` rides (E289: Crossbow / Projectiles attach to it, so it rocks with the
   * figure): the joint whose segment (the joint to its child joint) passes nearest the point.
   */
  stuckFrame(point: THREE.Vector3): THREE.Object3D | null {
    let best: THREE.Object3D | null = null, bestD = Infinity;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), ab = new THREE.Vector3(), ap = new THREE.Vector3();
    this.model.root.updateMatrixWorld(true);
    for (const joint of DUMMY_JOINTS) {
      const bone = this.model.joints[joint];
      if (!bone) continue;
      bone.getWorldPosition(a);
      const child = bone.children.find((c) => c instanceof THREE.Bone || Object.values(this.model.joints).includes(c));
      if (child) child.getWorldPosition(b); else b.copy(a);
      ab.subVectors(b, a); ap.subVectors(point, a);
      const len2 = ab.lengthSq();
      const t = len2 > 1e-8 ? Math.min(1, Math.max(0, ap.dot(ab) / len2)) : 0;
      const d = ap.addScaledVector(ab, -t).lengthSq();
      if (d < bestD) { bestD = d; best = bone; }
    }
    return best ?? this.model.root;
  }

  /** Sword.ts's white hit flash (C5): the figure's emissive for a beat */
  hitFlash(strength: number): void { this.flash = Math.min(1, Math.max(this.flash, strength)); }

  update(dt: number): void {
    this.frame++;
    this.motion.update(dt);
    this.clips?.update(dt);
    // The generated base carries follow-through; a smaller immediate impulse avoids doubling joint travel (E336).
    this.pose?.apply(this.motion, this.clips !== null, this.clips !== null ? 0.20 : 1);
    if (this.flash > 0 || this.flashShown > 0) {
      this.flash = Math.max(0, this.flash - dt * 7);
      const e = this.flash * this.flash * 0.08;
      for (const m of this.materials) m.emissive.setRGB(e, e * 0.97, e * 0.92);
      this.flashShown = e;
    }
  }
}

/** a plane with a vertex-colour gradient: `shade(u, v)` (0 … 1 across, 0 … 1 up) gives each vertex's colour */
function shadedPlane(w: number, h: number, sw: number, sh: number, shade: (u: number, v: number, out: THREE.Color) => void): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h, sw, sh);
  const uv = g.getAttribute('uv');
  const colors = new Float32Array(uv.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < uv.count; i++) { shade(uv.getX(i), uv.getY(i), c); colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

function makeRoom(cx: number, cz: number): { root: THREE.Group; colliders: ColliderDesc[] } {
  const root = new THREE.Group(); root.name = 'HUD + Weapon Explorer · grid arena';
  root.position.set(cx, Y, cz);
  const shaded = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false });
  const low = new THREE.Color(0x12304a), high = new THREE.Color(0x1d3f5e), deep = new THREE.Color(0x0a1624);
  // the floor: a pool of light under the lineup, fading to the room's navy toward the walls
  const floor = new THREE.Mesh(shadedPlane(HALF_WIDTH * 2, HALF_DEPTH * 2, 40, 40, (u, v, out) => {
    const x = (u - 0.5) * HALF_WIDTH * 2, z = (0.5 - v) * HALF_DEPTH * 2; // rotateX(−90°) maps the plane's +v to −z
    const d = Math.hypot(x / 9, (z + 5) / 11);
    out.set(0x0b1726).lerp(low, Math.max(0, 1 - d) ** 1.5 * 0.85);
  }).rotateX(-Math.PI / 2), shaded);
  floor.position.y = -0.03; root.add(floor);
  // the ceiling: lit over the lineup, so the portrait frame's top half reads as a room
  const ceiling = new THREE.Mesh(shadedPlane(HALF_WIDTH * 2, HALF_DEPTH * 2, 40, 40, (u, v, out) => {
    const x = (u - 0.5) * HALF_WIDTH * 2, z = (0.5 - v) * HALF_DEPTH * 2; // rotateX(+90°) maps +v to +z
    const d = Math.hypot(x / 18, (-z - 8) / 22);
    out.copy(deep).lerp(high, Math.max(0, 1 - d) ** 0.9);
  }).rotateX(Math.PI / 2), shaded);
  ceiling.position.y = WALL_HEIGHT; root.add(ceiling);
  // walls: brighter where they meet the floor (the grid's glow), dark toward the ceiling
  const wallShade = (_u: number, v: number, out: THREE.Color): void => { out.copy(low).lerp(deep, Math.min(1, v * 1.4) ** 0.8); };
  const back = new THREE.Mesh(shadedPlane(HALF_WIDTH * 2, WALL_HEIGHT, 1, 6, wallShade), shaded);
  back.position.set(0, WALL_HEIGHT / 2, -HALF_DEPTH); root.add(back);
  const front = back.clone(); front.position.z = HALF_DEPTH; root.add(front);
  const side = new THREE.Mesh(shadedPlane(HALF_DEPTH * 2, WALL_HEIGHT, 1, 6, wallShade), shaded);
  side.rotation.y = Math.PI / 2; side.position.set(-HALF_WIDTH, WALL_HEIGHT / 2, 0); root.add(side);
  const other = side.clone(); other.position.x = HALF_WIDTH; root.add(other);

  // All grid strokes are one line-segment draw call; stronger corner strokes give the box a VR-stage silhouette.
  const lines: number[] = [];
  const push = (a: readonly number[], b: readonly number[]): void => { lines.push(a[0] ?? 0, a[1] ?? 0, a[2] ?? 0, b[0] ?? 0, b[1] ?? 0, b[2] ?? 0); };
  for (let x = -HALF_WIDTH; x <= HALF_WIDTH; x += 2) push([x, 0.015, -HALF_DEPTH], [x, 0.015, HALF_DEPTH]);
  for (let z = -HALF_DEPTH; z <= HALF_DEPTH; z += 2) push([-HALF_WIDTH, 0.015, z], [HALF_WIDTH, 0.015, z]);
  // the ceiling grid, every 4 m: perspective lines converging over the lineup instead of a black lid (E285)
  for (let x = -HALF_WIDTH; x <= HALF_WIDTH; x += 4) push([x, WALL_HEIGHT - 0.02, -HALF_DEPTH], [x, WALL_HEIGHT - 0.02, HALF_DEPTH]);
  for (let z = -HALF_DEPTH; z <= HALF_DEPTH; z += 4) push([-HALF_WIDTH, WALL_HEIGHT - 0.02, z], [HALF_WIDTH, WALL_HEIGHT - 0.02, z]);
  for (let x = -HALF_WIDTH; x <= HALF_WIDTH; x += 2) {
    push([x, 0.02, -HALF_DEPTH + 0.01], [x, WALL_HEIGHT, -HALF_DEPTH + 0.01]);
    push([x, 0.02, HALF_DEPTH - 0.01], [x, WALL_HEIGHT, HALF_DEPTH - 0.01]);
  }
  for (let z = -HALF_DEPTH; z <= HALF_DEPTH; z += 2) {
    push([-HALF_WIDTH + 0.01, 0.02, z], [-HALF_WIDTH + 0.01, WALL_HEIGHT, z]);
    push([HALF_WIDTH - 0.01, 0.02, z], [HALF_WIDTH - 0.01, WALL_HEIGHT, z]);
  }
  for (let h = 2; h <= WALL_HEIGHT; h += 2) {
    push([-HALF_WIDTH, h, -HALF_DEPTH + 0.01], [HALF_WIDTH, h, -HALF_DEPTH + 0.01]);
    push([-HALF_WIDTH, h, HALF_DEPTH - 0.01], [HALF_WIDTH, h, HALF_DEPTH - 0.01]);
    push([-HALF_WIDTH + 0.01, h, -HALF_DEPTH], [-HALF_WIDTH + 0.01, h, HALF_DEPTH]);
    push([HALF_WIDTH - 0.01, h, -HALF_DEPTH], [HALF_WIDTH - 0.01, h, HALF_DEPTH]);
  }
  const grid = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(lines, 3)), new THREE.LineBasicMaterial({ color: CYAN, transparent: true, opacity: 0.29, depthWrite: false, fog: false, toneMapped: false }));
  root.add(grid);
  const corners: number[] = [];
  for (const x of [-HALF_WIDTH, HALF_WIDTH]) for (const z of [-HALF_DEPTH, HALF_DEPTH]) corners.push(x, 0, z, x, WALL_HEIGHT, z);
  root.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(corners, 3)), new THREE.LineBasicMaterial({ color: CYAN, transparent: true, opacity: 0.9, fog: false, toneMapped: false })));
  root.visible = false;
  const colliders: ColliderDesc[] = [
    { kind: 'box', x: cx, y: Y - 2, z: cz, hx: HALF_WIDTH, hy: 2, hz: HALF_DEPTH }, // a 4 m slab: a 0.28 m one sank faster (E285)
    { kind: 'box', x: cx, y: Y + WALL_HEIGHT / 2, z: cz - HALF_DEPTH, hx: HALF_WIDTH, hy: WALL_HEIGHT / 2, hz: 0.22 },
    { kind: 'box', x: cx, y: Y + WALL_HEIGHT / 2, z: cz + HALF_DEPTH, hx: HALF_WIDTH, hy: WALL_HEIGHT / 2, hz: 0.22 },
    { kind: 'box', x: cx - HALF_WIDTH, y: Y + WALL_HEIGHT / 2, z: cz, hx: 0.22, hy: WALL_HEIGHT / 2, hz: HALF_DEPTH },
    { kind: 'box', x: cx + HALF_WIDTH, y: Y + WALL_HEIGHT / 2, z: cz, hx: 0.22, hy: WALL_HEIGHT / 2, hz: HALF_DEPTH },
  ];
  return { root, colliders };
}

export class TrainingArena {
  readonly scope: ReturnType<typeof uiScope> = uiScope('trainingArena');
  /** E357 F2 read-only practice state for the pause/resume snapshot. */
  get isActive(): boolean { return this.active; }
  readonly targets: TrainingTarget[];
  private readonly root: THREE.Group;
  private readonly overlay: HTMLElement;
  private readonly floats: FloatingText[] = [];
  private active = false;
  private modelsReady = false;
  private loadPromise: Promise<void> | null = null;
  private readonly preparation: HTMLElement;
  /** the room's centre (world x, z); the lineup and the spawn are laid out from it */
  readonly center: { x: number; z: number };
  private player: Player | null = null;
  private weapons: EquipmentService | null = null;

  private readonly game: Game;
  private readonly physics: Physics;
  constructor(game: Game, registry: WorldRegistry, physics: Physics, center: { x: number; z: number }) {
    this.game = game;
    this.physics = physics;
    app.encounters.register({ id: 'training-dummy', displayName: 'Training dummy', showHeadBar: false }, game.levelScope);
    this.center = center;
    const { root, colliders } = makeRoom(center.x, center.z);
    this.root = root;
    // E285: on Nine Dragon the capsule sank through the floor slab a few mm a step at some spots (Rapier lost the contact),
    // until the ground read as a slope and every dodge was refused. The floor is also a P2-bridge floor function, which
    // puts sunk feet back on top. It answers only while the room is open: the room hangs over the shard's spawn.
    const floor = (x: number, z: number): number | undefined =>
      this.active && Math.abs(x - center.x) < HALF_WIDTH && Math.abs(z - center.z) < HALF_DEPTH ? Y : undefined;
    registry.add({ id: 'practice-arena', name: 'HUD + Weapon Explorer arena', category: 'ground', file: 'src/client/engine/practice/TrainingArena.ts', object: root, colliders, surface: 'metal', floor, solidFloor: false });
    const overlay = document.createElement('div'); overlay.className = 'ws-practice';
    mountUi(overlay, this.scope); this.overlay = overlay;
    const preparation = document.createElement('div'); preparation.className = 'ws-practice-preparing'; preparation.textContent = engineString('s_392e9e34e810');
    overlay.append(preparation); this.preparation = preparation;
    // E348: each copy of the shared dummy model its lineup places, its armour the placement's variant
    this.targets = LINEUP.map((spot, i) => {
      const x = center.x + spot.x, z = center.z + spot.z;
      const target = new TrainingTarget(paramsOf(trainingDummy, spot.variant, spot.params).variant, x, Y, z, spot.x, spot.z, overlay, i + 1, game.levelScope);
      target.bodies = addTrainingTarget(physics, target, x, Y, z);
      target.bodies.setEnabled(false); // E300: shot at only while the room is open (enter / exit)
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.69, 0.012, 6, 48).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: CYAN, fog: false, toneMapped: false }));
      ring.position.set(spot.x, 0.01, spot.z); root.add(ring);
      target.onDamage = (amount, point) => { this.float(String(amount), point, 'hit'); };
      return target;
    });
    const combatTargets = this.targets.map((target, index) =>
      app.combat.targetPort(practiceActor(target, `practice.${String(index)}`), target, undefined,
        () => !game.levelScope.disposed && app.levelScope === game.levelScope && this.active && target.ready));
    app.combat.registerTargets(game.levelScope, () => combatTargets, () => app.levelScope === game.levelScope && this.active);
    // Dummies are children of the room for visibility; their static solid bodies and separate hitboxes live in Rapier.
    for (const target of this.targets) root.add(target.model.root);
    game.onUpdate((dt) => { if (this.active) this.update(dt); }, 'training-arena');
  }

  get entered(): boolean { return this.active; }

  /**
   * Fetch, decode and upload the three figures before the room opens, so it is full on its first frame (E291: it opened
   * empty for a second or more). A boot that lands in the room calls it, and enter() does; once only. Nothing preloads
   * them ahead of the room (G187 / SF47: they are not resident while the player is out in the world).
   */
  preload(): Promise<void> {
    if (this.loadPromise === null) {
      readModuleGroups(['practice.models']);
      this.loadPromise = this.prepareModels();
    }
    return this.loadPromise;
  }

  private async prepareModels(): Promise<void> {
    const renderer = this.game.renderer;
    await Promise.all(this.targets.map(async (target) => {
      const model = await dummyFigure(target.variant, 'arena'); // the model's builder (src/client/engine/models/trainingDummy.ts)
      if (this.game.levelScope.disposed) return;
      target.install(model, renderer);
      await this.upload(model.root);
    }));
    this.modelsReady = true;
    this.preparation.hidden = true;
  }

  /** textures to the GPU and the studio program compiled now, off screen, not on the room's first frame */
  private async upload(root: THREE.Object3D): Promise<void> {
    const renderer = this.game.renderer;
    root.traverse((part) => {
      if (!(part instanceof THREE.Mesh) || !(part.material instanceof THREE.MeshStandardMaterial)) return;
      for (const t of [part.material.map, part.material.metalnessMap, part.material.roughnessMap, part.material.normalMap]) if (t !== null) renderer.initTexture(t);
    });
    try { await renderer.compileAsync(root, this.game.camera, this.game.scene); }
    catch (error) { console.warn('[practice] precompile skipped', error); }
  }

  /**
   * How far back from the centre dummy the player stands so the whole lineup, arms included, is inside the frame:
   * nearer on a wide frame (Driftwood's portrait, any landscape), further on Nalati's narrow one. The labels clamp
   * inside the frame on their own (update).
   */
  private viewDistance(): number { return practiceViewDistance(this.game.camera.fov, this.game.camera.aspect, innerWidth); }

  enter(player: Player, weapons: EquipmentService): void {
    this.active = true; this.root.visible = true; this.overlay.classList.add('show');
    app.setState('practice');
    practiceFps.on = true; // mobile targets 60 in here (E290, tier.ts frameCapFps)
    this.player = player;
    for (const t of this.targets) { t.attacker = player.position; t.bodies?.setEnabled(true); }
    document.dispatchEvent(new CustomEvent('ws:practice-active', { detail: true }));
    app.events.emit('practice.active', true);
    this.overlay.parentElement?.classList.add('practice-active');
    // still loading: the procedural figures stand in at once, never an empty room; the meshes replace them on arrival
    if (!this.modelsReady) for (const t of this.targets) if (!t.ready) t.install(dummyStandIn(t.variant), this.game.renderer);
    this.preparation.hidden = true;
    void this.preload();
    // the weapon explorer (every weapon this shard has, only while in here) and the spawn facing the lineup (practiceLoan.ts)
    this.weapons = weapons;
    const centre = LINEUP[1] ?? { x: 0, z: -7 };
    enterPracticeLoan({ weapons, player }, { x: this.center.x, z: this.center.z + centre.z + this.viewDistance(), y: Y });
  }

  exit(): void {
    this.active = false; this.root.visible = false; this.overlay.classList.remove('show');
    app.setState('play');
    for (const t of this.targets) t.bodies?.setEnabled(false); // E300: no dummy volume left for the world's rays over the shard
    practiceFps.on = false;
    exitPracticeLoan(this.weapons); this.weapons = null; // the world's own unlocks again
    this.player = null;
    document.dispatchEvent(new CustomEvent('ws:practice-active', { detail: false }));
    app.events.emit('practice.active', false);
    this.overlay.parentElement?.classList.remove('practice-active');
    for (const f of this.floats) f.el.remove();
    this.floats.length = 0;
  }

  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): TargetHit | null {
    if (!this.active || !this.targets.every((t) => t.ready)) return null;
    const hit = trainingTargetRaycast(this.physics, origin, dir, maxDist);
    const target = this.targets.find((t) => t === hit?.target);
    return hit && target ? { animal: target, point: new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z), distance: hit.distance, headshot: hit.headshot } : null;
  }

  miss(point: THREE.Vector3): void { if (this.active) this.float('MISS', point, 'miss'); }

  private float(value: string, point: THREE.Vector3, tone: 'hit' | 'miss'): void {
    const el = document.createElement('div'); el.className = `ws-practice-float ${tone}`; el.textContent = value;
    this.overlay.append(el); this.floats.push({ el, point: point.clone(), time: 0 });
  }

  private update(dt: number): void {
    // the hoverboard has no place in the room: it kills the dodge (E285); the H key would otherwise bring it back
    if (this.player?.hover === true) this.player.setHover(false);
    const W = innerWidth, H = innerHeight;
    for (const target of this.targets) {
      target.update(dt);
      const p = _label.copy(target.position);
      p.y += LABEL_Y;
      p.project(this.game.camera);
      const shown = target.ready && p.z < 1;
      target.label.style.display = shown ? '' : 'none';
      if (!shown) continue;
      // keep the tag inside the frame (a side dummy on a narrow portrait frame), its arrow still over the figure
      const x = (p.x * 0.5 + 0.5) * W, y = (-p.y * 0.5 + 0.5) * H;
      if (target.labelWidth === 0) { target.labelWidth = target.label.offsetWidth; }
      const half = target.labelWidth / 2 + 6;
      const cx = Math.min(W - half, Math.max(half, x));
      target.label.style.transform = `translate(${Math.round(cx)}px, ${Math.round(y)}px) translate(-50%, -50%)`;
      target.label.style.setProperty('--ws-practice-arrow', `${Math.round(x - cx)}px`);
    }
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i]; if (!f) continue;
      f.time += dt;
      if (f.time > 0.85) { f.el.remove(); this.floats.splice(i, 1); continue; }
      const p = _float.copy(f.point);
      p.y += 0.25 + f.time * 0.6;
      p.project(this.game.camera);
      f.el.style.opacity = String(1 - f.time / 0.85);
      f.el.style.transform = `translate(${Math.round((p.x * 0.5 + 0.5) * W)}px, ${Math.round((-p.y * 0.5 + 0.5) * H)}px) translate(-50%, -50%)`;
    }
  }
}
