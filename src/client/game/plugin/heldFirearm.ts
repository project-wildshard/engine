import * as THREE from 'three';
import { app } from '@wildshard/engine/app/runtime';
import type { EquipContext } from '@wildshard/engine/combat/Equipment';
import { Firearm, RangedAction, RangedReload, stepActionClock, type RangedCycleEvent } from '@wildshard/engine/combat/Firearm';
import type { Targets } from '@wildshard/engine/combat/types';
import type { BrassEjectionRow } from '@wildshard/engine/combat/view/brass';
import type { HitscanProfile } from '@wildshard/engine/combat/view/hitscan';
import { FOV_ADS, FOV_HIP, makeBoltAtlas, makeCord, prepareWeaponView, viewmodelRowMaterial, viewmodelTexSet, weaponDisplay, whiteColors,
  type RangedOptions, type RangedWorld, type ViewmodelMaterialRow, type ViewmodelSet } from '@wildshard/engine/combat/view/ranged';
import type { AimInfo, WeaponState } from '@wildshard/engine/combat/Weapon';
import { HeldHandParts } from '@wildshard/engine/player/heldHandParts';
import { HitscanPresentation, RangedFrame, type RangedFlashShape, type RangedFrameRow, type RangedTraceRow } from '@wildshard/engine/render/viewmodelFeel';
import type { SkyRig as Sky } from '@wildshard/engine/world/skyRig';
import { mergePrimitives, type PrimitiveRow } from './geometry';
import { HeldPlayback } from './weaponFamily';

/**
 * The held-firearm host (H3, SHARD-PLATFORM C6 view, G454 data only): a first-person hitscan firearm whose parts, materials,
 * pose, part motion, hands and effects are rows. The shard passes data and borrowed geometry, never a callback:
 *
 * - `model.geometry`: geometry by id (the GLB's node names, or `rows.primitives`: primitive rows merged per id);
 *   `rows.materials`: the viewmodels' shared lit program per id (`look`) or a basic glow (`basic`), over `model.textures`
 *   and `rows.textures` (procedural sets with a repeat).
 * - `rows.parts`: the meshes, each `{ id, geometry, material, at?, rot?, sighted?, hidden?, display? }`; `at` names an
 *   anchor or is a point, `sighted: false` hides the part once the sights are up, `display` adds it to the world copy.
 * - The action follows the profile: a `lever` row makes a per-round cycling action (`RangedAction.Cycle`), else a
 *   magazine with a timed reload (`RangedReload`). Its phase events drive the brass, the sounds and the equipment events.
 * - `rows.playback`: HeldPlayback programmes by group, their input bindings and their outputs onto the host's records
 *   (`frame`, `sight`, `values`, `grip`); `schedule` names the groups run each frame (action groups, grip groups, frame,
 *   sight, pose). `hands`: two baked fists (HeldHandParts), the right posed by the `grip` groups.
 *
 * Owner paths the rows read on `weapon` (a data contract: move the JSON paths with any rename): `time`, `player`, `feel`,
 * `holster`, `hip`, `view`, `profile`, `act` (the cycling action), `partValues`, `poseFrame`, `adsPose`, `grips` (`rest`,
 * `gate`, `out`), `handFrame`, `gate`, `anchors.<id>`, `round`, `inspect`, `inspectYaw`, `game`.
 *
 *   const gun = new HeldFirearm(world, targets, { row, profile, view, rows, model: { geometry, textures } });
 */

type Triple = readonly [number, number, number];
/** The numbers the host reads from the weapon profile; a `lever` row selects the cycling action. */
export interface HeldFirearmProfile extends HitscanProfile {
  readonly magazine: number; readonly reserve: number; readonly interval: number; readonly reload: number; readonly autoReload: number;
  readonly bloomShot: number; readonly bloomMax: number; readonly ads: { readonly blend: number };
  readonly lever?: { readonly cycleDelay: number; readonly cycleTime: number; readonly ejectAt: number; readonly cockAt: number; readonly reloadIn: number };
}
/** The view numbers the host reads itself (rows may read more under `view`). */
export interface HeldFirearmView {
  readonly kick: number;
  readonly flash: { readonly frames: number; readonly lightTime: number; readonly light: number; readonly size?: number };
  readonly brass: { readonly count: number; readonly life: number };
  readonly tracer: { readonly count: number; readonly time: number };
  readonly sight: { readonly muzzleZ: number };
  readonly port: Triple;
  readonly timing: { readonly autoReloadDelay: number; readonly autoReloadClose?: number };
  readonly hip: { readonly px: number; readonly py: number; readonly pz: number; readonly rx: number; readonly ry: number; readonly rz: number; readonly scale: number };
}
/** One mesh of the held model. */
export interface HeldPartRow {
  readonly id: string; readonly geometry: string; readonly material: string;
  readonly at?: string | Triple; readonly rot?: Triple; readonly sighted?: boolean; readonly hidden?: boolean;
  readonly display?: boolean | { readonly rot: Triple };
}
/** A material: the viewmodels' shared lit program from a look row, or an unlit glow. */
export type HeldMaterialRow = { readonly name: string; readonly look: ViewmodelMaterialRow }
  | { readonly name: string; readonly basic: { readonly color: number; readonly opacity: number } };
interface OutputRow { readonly property: string; readonly target: string; readonly path: readonly string[] }
/** The host's records a programme's outputs may write. */
export type HeldOutputTarget = 'frame' | 'sight' | 'values' | 'grip';
/** The model's rows: what a world card needs too. */
export interface HeldModelRows {
  readonly materials: Readonly<Record<string, HeldMaterialRow>>;
  /** procedural texture sets by id: the set's name and its repeat (`cord` and `bolt` keep their own: a cord tiled 1 × 14, a clamped atlas) */
  readonly textures?: Readonly<Record<string, { readonly set: HeldTextureSet; readonly repeat?: readonly [number, number] }>>;
  /** geometry by id built from primitive rows (merged in order) */
  readonly primitives?: Readonly<Record<string, readonly PrimitiveRow[]>>;
  readonly parts: readonly HeldPartRow[];
  readonly anchors: Readonly<Record<string, Triple>>;
}
/** The held firearm's rows (see the module comment). */
export interface HeldFirearmRows extends HeldModelRows {
  /** `ownPass`: its own depth clear (a pass per model); `shared`: the viewmodels' one depth clear */
  readonly mount: 'ownPass' | 'shared';
  /** the loading point the hands and the round aim at (an anchor), the round in hand (a hidden part) */
  readonly gate?: string; readonly round?: string;
  /** the ejected case */
  readonly brass: { readonly geometry: string; readonly material: string };
  /** a sight glow: shown sighted, its opacity × the sights' blend */
  readonly glow?: { readonly part: string; readonly opacity: number };
  /** the model scaled by the frame's `scale` (when the pose rows don't scale it) */
  readonly scaleRoot?: boolean;
  /** part x rotations the action groups read: `partValues.<key>` = that part's rotation.x */
  readonly rotationReads?: Readonly<Record<string, string>>;
  readonly playback: {
    readonly groups: Readonly<Record<string, readonly unknown[]>>;
    readonly inputs: readonly { readonly group: string; readonly rows: unknown }[];
    readonly outputs: readonly { readonly group: string; readonly rows: readonly OutputRow[]; readonly target: HeldOutputTarget }[];
    readonly schedule: { readonly frame: string; readonly sight: string; readonly pose: string; readonly action: readonly string[]; readonly grip: readonly string[] };
  };
  readonly presentation: {
    readonly frame: RangedFrameRow;
    readonly flash: { readonly shape: RangedFlashShape; readonly colour: number };
    readonly ejection: BrassEjectionRow; readonly tracer: RangedTraceRow; readonly hitMuzzle: Triple;
  };
}
/** The engine's procedural viewmodel sets a texture row may name. */
export type HeldTextureSet = 'gunmetal' | 'anodised' | 'polymer' | 'walnut' | 'brushed-steel' | 'leather' | 'cord' | 'bolt';

/** Borrowed model data: geometry by id (a GLB's parts) and texture sets by id (a GLB's atlases). */
export interface HeldFirearmModel {
  readonly geometry?: ReadonlyMap<string, THREE.BufferGeometry>;
  readonly textures?: Readonly<Record<string, ViewmodelSet>>;
}
/** A fist's grip: where it closes, its axis and its palm normal (model space). */
export interface HeldGrip { readonly at: THREE.Vector3; readonly axis: THREE.Vector3; readonly palm: THREE.Vector3 }
export interface GripRow { readonly at: Triple; readonly axis: Triple; readonly palm: Triple }
/** One baked fist (borrowed geometry, its sleeve and wrist) and where it grips. */
export interface HeldHandRow extends GripRow {
  readonly geometry: THREE.BufferGeometry; readonly sleeve: THREE.BufferGeometry | null;
  readonly wrist: THREE.Vector3; readonly dir: THREE.Vector3; readonly elbow?: Triple; readonly coat?: boolean;
}
/** The two hands: the left fixed, the right posed by the grip groups between `right` (rest) and `gate`. */
export interface HeldFirearmHands {
  readonly material: THREE.Material; readonly coatMaterial?: THREE.Material;
  readonly left: HeldHandRow; readonly right: HeldHandRow; readonly gate: GripRow;
}
export interface HeldFirearmOptions<P extends HeldFirearmProfile> extends RangedOptions {
  profile: P; view: HeldFirearmView; rows: HeldFirearmRows; model: HeldFirearmModel; hands?: HeldFirearmHands;
  /** take the muzzle flash's light from the scene's LightPool at boot (default) */
  muzzleLight?: boolean;
}

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _v2 = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
const need = <T>(value: T | undefined, what: string): T => { if (value === undefined) throw new Error(`Held firearm: missing ${what}`); return value; };
/** A grip row as vectors (the directions normalised). */
export const heldGrip = (row: GripRow): HeldGrip => ({ at: new THREE.Vector3(...row.at), axis: new THREE.Vector3(...row.axis).normalize(), palm: new THREE.Vector3(...row.palm).normalize() });
/** Grip space (+Y the grip axis, the back of a right hand +X) → model space. */
export function placeHeldFist(fist: THREE.Object3D, p: HeldGrip, mirror: boolean): void {
  _y.copy(p.axis).normalize(); _x.copy(p.palm).multiplyScalar(mirror ? 1 : -1);
  _x.addScaledVector(_y, -_x.dot(_y)).normalize(); _z.crossVectors(_x, _y);
  fist.position.copy(p.at); fist.quaternion.copy(_q.setFromRotationMatrix(_m.makeBasis(_x, _y, _z)));
}

/** The rows' materials and geometry, built once per call (the viewmodel and each world card own theirs). */
export function heldFirearmParts(sky: Sky, rows: HeldModelRows, model: HeldFirearmModel): { geometry: ReadonlyMap<string, THREE.BufferGeometry>; materials: ReadonlyMap<string, THREE.Material> } {
  const sets: Record<string, ViewmodelSet> = { ...model.textures };
  for (const [id, row] of Object.entries(rows.textures ?? {})) {
    const set: ViewmodelSet = row.set === 'cord' ? makeCord() : row.set === 'bolt' ? makeBoltAtlas() : viewmodelTexSet(row.set), repeat = row.repeat;
    if (repeat !== undefined) for (const texture of [set.map, set.normalMap, set.armMap]) texture?.repeat.set(...repeat);
    sets[id] = set;
  }
  const materials = new Map<string, THREE.Material>(Object.entries(rows.materials).map(([id, row]) => [id, 'look' in row
    ? viewmodelRowMaterial(sky, row.name, row.look, sets)
    : new THREE.MeshBasicMaterial({ name: row.name, color: row.basic.color, opacity: row.basic.opacity, toneMapped: false, fog: false })]));
  const geometry = new Map(model.geometry);
  for (const [id, primitives] of Object.entries(rows.primitives ?? {})) geometry.set(id, mergePrimitives(primitives));
  return { geometry, materials };
}
interface DisplayPart { geo: THREE.BufferGeometry; mat: THREE.Material; pos?: THREE.Vector3; rot?: THREE.Euler }
function displayParts(rows: HeldModelRows, geometry: ReadonlyMap<string, THREE.BufferGeometry>, materials: ReadonlyMap<string, THREE.Material>): DisplayPart[] {
  const anchors = rows.anchors;
  return rows.parts.filter(part => part.display !== undefined && part.display !== false).map(part => {
    const at = part.at === undefined ? undefined : new THREE.Vector3(...typeof part.at === 'string' ? need(anchors[part.at], `anchor ${part.at}`) : part.at);
    const rot = typeof part.display === 'object' ? new THREE.Euler(...part.display.rot) : undefined;
    const out: DisplayPart = { geo: need(geometry.get(part.geometry), `geometry ${part.geometry}`), mat: need(materials.get(part.material), `material ${part.material}`) };
    if (at !== undefined) out.pos = at;
    if (rot !== undefined) out.rot = rot;
    return out;
  });
}
/** The Model Explorer's card: the displayed parts on their own materials and copies of the geometry. */
export function heldFirearmDisplay(sky: Sky, rows: HeldModelRows, model: HeldFirearmModel): THREE.Group {
  const { geometry, materials } = heldFirearmParts(sky, rows, model);
  return weaponDisplay(displayParts(rows, geometry, materials), { mode: 'parts', copyGeometry: true, whiteColors: true });
}

/** A held hitscan firearm on rows: the platform's trigger, hitscan, action, brass, flash, pose and hands. */
export class HeldFirearm<P extends HeldFirearmProfile = HeldFirearmProfile> extends Firearm {
  readonly profile: P; readonly view: HeldFirearmView;
  readonly state: WeaponState & { ammo: number };
  enabled = true; allowUnlocked = false; adsHeld = false; holster = 0;
  aimInfo: AimInfo | null = null;
  readonly model: THREE.Group = new THREE.Group();
  /** the cycle is thrown (a lever's 'leverCycle' sound) / a round went through the gate */
  onCycle?: () => void; onRoundIn?: () => void;
  /** dev (the evidence strip): hold the cycle at u (0..1); null = live */
  freezeCycle: number | null = null;
  /** dev: > 0 keeps the sighted-hidden parts shown, turned `inspectYaw` */
  inspect = 0; inspectYaw: number = Math.PI / 2;
  readonly parts: Record<string, THREE.Mesh> = {};
  readonly anchors: Readonly<Record<string, THREE.Vector3>>;
  readonly gate: THREE.Vector3;
  readonly hip: HeldFirearmView['hip'];
  readonly adsPose = { px: 0, py: 0, pz: 0, scale: 0, rearDepth: 0, frontDepth: 0, muzzleDepth: 0 };
  tracerLife: number;
  /** the cycling action (a lever), null for a magazine */
  readonly act: InstanceType<typeof RangedAction.Cycle> | null;
  private readonly rows: HeldFirearmRows; private readonly display: DisplayPart[];
  private readonly game: RangedWorld['game']; private readonly sky: Sky; private readonly player: RangedWorld['player'];
  private readonly targets: Targets | undefined;
  private active = true; private time = 0; private cooldown = 0; private bloom = 0;
  private readonly reloadClock = new RangedReload({ mode: 'magazine' });
  private readonly round: THREE.Mesh | null;
  private readonly glow: THREE.Mesh | null;
  private readonly rotationReads: readonly (readonly [string, THREE.Mesh])[];
  private readonly sightedHidden: THREE.Mesh[] = [];
  private readonly effects: HitscanPresentation;
  private hands: HeldHandParts | null = null;
  private readonly grips: { rest: HeldGrip; gate: HeldGrip; out: HeldGrip };
  private readonly handFrame = { roundVisible: 0 };
  private readonly feel: RangedFrame;
  private readonly frameInputs = { enabled: false, active: false, held: false, reloading: false, adsDuration: 1, kick: 0 };
  private readonly posePlayback: HeldPlayback;
  private readonly poseFrame = { portrait: 0, ads: 0, scale: 0, cycle: 0, sprinting: 0, reloading: 0, reloadProgress: 0, sprint: 0, loadBlend: 0, reloadTilt: 0 };
  readonly partValues: Record<string, number> = { open: 0, cycling: 0, cycleU: 0, hammerAngle: 0, cocked: 0, reloading: 0, reloadProgress: 0 };

  constructor(world: RangedWorld, targets: Targets | undefined, opts: HeldFirearmOptions<P>) {
    super(opts.row);
    const { rows, view, profile } = opts;
    this.profile = profile; this.view = view; this.rows = rows;
    this.state = { ammo: profile.magazine, magazine: profile.magazine, reserve: profile.reserve, loaded: true, reloading: false, reloadProgress: 0, ads: false };
    this.act = profile.lever === undefined ? null : new RangedAction.Cycle(this.state, { magazine: profile.magazine, reload: profile.reload, ...profile.lever });
    this.tracerLife = view.tracer.time; this.hip = { ...view.hip };
    this.row = { ...this.row, ui: { ...this.row.ui, inputContext: 'weapon.ranged' } };
    this.game = world.game; this.sky = world.sky; this.player = world.player; this.targets = targets;
    this.setAimSource(() => this.player.sampleAimCommand());
    this.allowUnlocked = opts.allowUnlocked ?? false;
    const p = rows.presentation;
    this.feel = new RangedFrame(p.frame, this.player, FOV_HIP, FOV_ADS);
    this.effects = new HitscanPresentation(this.feel, this.game.scene, this.model, this.game.camera, {
      flash: { profile: view.flash, shape: p.flash.shape, colour: p.flash.colour }, muzzle: view.sight,
      brass: { profile: view.brass, port: view.port, ejection: p.ejection },
      tracer: { count: view.tracer.count, row: p.tracer }, hitMuzzle: p.hitMuzzle,
    }, opts.muzzleLight);

    const { geometry, materials } = heldFirearmParts(this.sky, rows, opts.model);
    this.display = displayParts(rows, geometry, materials);
    this.anchors = Object.fromEntries(Object.entries(rows.anchors).map(([id, at]) => [id, new THREE.Vector3(...at)]));
    this.gate = rows.gate === undefined ? new THREE.Vector3() : need(this.anchors[rows.gate], `anchor ${rows.gate}`);
    for (const part of rows.parts) {
      const mesh = new THREE.Mesh(need(geometry.get(part.geometry), `geometry ${part.geometry}`), need(materials.get(part.material), `material ${part.material}`));
      if (part.at !== undefined) mesh.position.copy(typeof part.at === 'string' ? need(this.anchors[part.at], `anchor ${part.at}`) : new THREE.Vector3(...part.at));
      if (part.rot !== undefined) mesh.rotation.set(...part.rot);
      if (part.hidden === true) mesh.visible = false;
      if (part.sighted === false) this.sightedHidden.push(mesh);
      this.parts[part.id] = mesh; this.model.add(mesh);
    }
    this.round = rows.round === undefined ? null : need(this.parts[rows.round], `part ${rows.round}`);
    this.glow = rows.glow === undefined ? null : need(this.parts[rows.glow.part], `part ${rows.glow.part}`);
    this.rotationReads = Object.entries(rows.rotationReads ?? {}).map(([key, id]) => [key, need(this.parts[id], `part ${id}`)]);
    const flashMat = this.effects.flash.build(this.model);
    const cam = this.game.camera;
    if (rows.mount === 'ownPass') {
      // depth clear + render after the world
      const clearer = new THREE.Mesh(new THREE.BoxGeometry(0.001, 0.001, 0.001), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true, fog: false }));
      clearer.renderOrder = 999; clearer.frustumCulled = false;
      clearer.onBeforeRender = (renderer) => { renderer.clearDepth(); };
      this.model.add(clearer);
      prepareWeaponView(this.model, { clearer, flash: { meshes: this.effects.flash.quads, material: flashMat } });
    } else prepareWeaponView(this.model, { flash: { meshes: this.effects.flash.quads, material: flashMat } });
    const caseGeo = need(geometry.get(rows.brass.geometry), `geometry ${rows.brass.geometry}`);
    whiteColors(caseGeo);
    this.effects.prepare(caseGeo, need(materials.get(rows.brass.material), `material ${rows.brass.material}`));
    if (rows.mount === 'ownPass') { this.game.viewmodel.mountOwnPass(this.model, cam); if (!cam.parent) this.game.scene.add(cam); } // staged while its cell prepares (op-hitch41)
    else this.game.viewmodel.add(this.model);
    this.effects.mount();
    this.syncState();
    const hands = opts.hands;
    this.grips = { rest: heldGrip(hands?.right ?? { at: [0, 0, 0], axis: [0, 1, 0], palm: [1, 0, 0] }), gate: heldGrip(hands?.gate ?? { at: [0, 0, 0], axis: [0, 1, 0], palm: [1, 0, 0] }), out: heldGrip({ at: [0, 0, 0], axis: [0, 1, 0], palm: [1, 0, 0] }) };
    if (hands !== undefined) {
      const fist = (row: HeldHandRow, name: string) => ({ name, geometry: row.geometry, sleeve: row.sleeve, wrist: row.wrist, dir: row.dir, elbow: row.elbow,
        material: hands.material, sleeveMaterial: row.coat === true ? hands.coatMaterial ?? hands.material : hands.material });
      this.hands = new HeldHandParts(this.model, [fist(hands.left, 'hand-left'), fist(hands.right, 'hand-right')],
        { name: 'weapon-hands', viewmodelOnly: true, transparentMaterials: [hands.material, hands.coatMaterial ?? hands.material] });
      placeHeldFist(this.hands.fist(0), heldGrip(hands.left), true); placeHeldFist(this.hands.fist(1), this.grips.rest, false);
    }

    const play = rows.playback;
    this.posePlayback = new HeldPlayback(play.groups, new Map<string, unknown>([['root', this.model], ...Object.entries(this.parts)]));
    const owners = new Map([['weapon', this]]);
    for (const input of play.inputs) this.posePlayback.bindInputs(input.group, input.rows, owners);
    const records: Record<HeldOutputTarget, object> = { frame: this.poseFrame, sight: this.adsPose, values: this.partValues, grip: this.grips.out };
    for (const output of play.outputs) this.posePlayback.bindOutputs(output.group, output.rows, new Map(output.rows.map(row => [row.target, records[output.target]])));
  }

  /** dev / the cost readout: what the hands add (null without) */
  get handsCost(): { draws: number; tris: number; verts: number; bytes: number } | null { return this.hands?.cost ?? null; }

  override install(ctx: EquipContext): void {
    super.install(ctx);
    this.feel.bindInputs(app.input, ctx.scope, this, this.player);
    ctx.scope.onDispose(() => { this.posePlayback.dispose(); this.model.removeFromParent(); });
  }
  override setActive(on: boolean): void {
    this.active = on; this.model.visible = on;
    if (!on) { this.enabled = false; this.feel.mouseAds = false; }
  }
  private syncState(): void {
    const act = this.act; if (act === null) return;
    const s = this.state; s.ammo = act.rounds; s.loaded = act.chambered; s.reloading = act.phase === 'reload';
  }
  /** 0..1 through the cycle (0 at rest) */
  get cycleU(): number { return this.freezeCycle ?? this.act?.cycleU ?? 0; }

  protected override reloadingAction(): boolean { return this.act === null ? this.state.reloading : this.act.phase === 'reload'; }
  protected override actionReady(): boolean { return this.act === null ? this.cooldown <= 0 : this.act.phase === 'idle'; }
  protected override roundReady(): boolean { return this.act === null ? this.state.ammo > 0 : this.act.chambered; }
  protected override onTriggerWhileReloading(): void { this.act?.triggerWhileReloading(); }
  protected override onEmptyTrigger(): void {
    if (this.act !== null && this.act.tube > 0) { this.act.throwLever(); this.event('cycle'); } else if (this.state.reserve > 0) this.reload();
  }
  override reload(): void {
    if (this.act === null) this.reloadClock.begin(this, this.profile.magazine);
    else if (this.act.beginReload()) { this.event('reloadStart'); this.wire?.reload(); }
  }
  addRounds(n: number): void { this.state.reserve += n; }
  override addBolts(n: number): void { this.addRounds(n); }

  private readonly stepCycle = (seconds: number): void => {
    this.sinceEmpty += seconds;
    if (this.act !== null) for (const event of this.act.events(seconds, this.autoReloadDue())) this.event(event);
  };
  /** One phase event of the action, at its original boundary. */
  private event(event: RangedCycleEvent): void {
    switch (event) {
      case 'cycle': this.equipEvents?.emit('weapon.action', { id: this.row.id, phase: 'cycle' }); this.onCycle?.(); break;
      case 'eject': this.effects.eject(); break;
      case 'chambered': this.syncState(); break;
      case 'reloadStart': this.state.reloadProgress = 0; this.syncState(); this.onReloadStart?.(); break;
      case 'round': this.equipEvents?.emit('weapon.reload', { id: this.row.id, phase: 'round' }); this.onRoundIn?.(); break;
      case 'reloadEnd': this.state.reloadProgress = 0; this.syncState(); this.onReloadEnd?.(); break;
      default: break;
    }
  }

  protected override fire(): void {
    const s = this.state;
    if (this.act === null) { s.ammo--; s.loaded = s.ammo > 0; this.cooldown = this.profile.interval; } else this.act.dropHammer();
    this.feel.shot(this.view.kick);
    this.effects.flash.fire(this.model, app.rng.stream('cosmetic'));
    this.syncState();
    this.onFire?.(); // before the hit resolves: Combat registers the aimed shot, the damage float then closes it
    this.effects.hit(this, this.targets, this.profile, this.bloom, this.player.speedFactor, this.time);
    if (this.act === null) { this.effects.eject(); this.bloom = Math.min(this.profile.bloomMax, this.bloom + this.profile.bloomShot); this.onShot(); }
  }

  /** A world-space copy for a pickup or a skin drop: the display parts on their own materials, in one program. */
  displayModel(): THREE.Group { return weaponDisplay(this.display, { mode: 'merged', sky: this.sky }); }

  update(dt: number, t: number): void {
    this.time = t; this.posePlayback.beginFrame(dt);
    const p = this.player, cam = this.game.camera, act = this.act, s = this.state, sc = this.rows.playback.schedule, values = this.partValues;
    if (act === null || this.freezeCycle !== null) this.sinceEmpty += dt;
    if (act === null) {
      this.cooldown = Math.max(0, this.cooldown - dt); this.bloom = Math.max(0, this.bloom - dt * 2.4);
      if (this.autoReloadDue()) this.reload();
      if (s.reloading && this.reloadClock.progress(this, dt, this.profile.reload) >= 1) this.reloadClock.finish(this, this.profile.magazine);
      values['reloading'] = Number(s.reloading); values['reloadProgress'] = s.reloadProgress;
    } else {
      if (this.freezeCycle === null) { stepActionClock(dt, this.wire, this.stepCycle); s.reloadProgress = act.reloadProgress; this.syncState(); }
      values['cycleU'] = this.cycleU; values['cycling'] = Number(this.freezeCycle !== null || act.phase === 'cycle');
      values['cocked'] = Number(this.freezeCycle !== null ? this.cycleU >= 0.2 : act.hammerCocked); values['reloading'] = Number(act.phase === 'reload');
    }
    // the parts: the action's groups, then the right hand
    for (const [key, mesh] of this.rotationReads) values[key] = mesh.rotation.x;
    for (const group of sc.action) this.posePlayback.apply(group, values);
    const hands = this.hands;
    if (hands?.group.visible === true) {
      this.handFrame.roundVisible = Number(this.round?.visible ?? false);
      for (const group of sc.grip) this.posePlayback.apply(group, this.handFrame);
      const right = hands.fist(1); placeHeldFist(right, this.grips.out, false); right.visible = this.sightedHidden.every(mesh => mesh.visible);
    }
    this.effects.flash.advance(dt, this.model);
    const frame = this.frameInputs;
    frame.enabled = this.enabled; frame.active = this.active; frame.held = this.adsHeld;
    frame.reloading = this.reloadingAction(); frame.adsDuration = this.profile.ads.blend; frame.kick = this.view.kick;
    s.ads = this.feel.sampleFrame(dt, p, frame, cam, this.sky.csm);
    // pose: hip ↔ sighted ↔ sprint ↔ reload ↔ the cycle's rock ↔ holster
    const f = this.poseFrame;
    f.sprinting = Number(p.sprinting); f.reloading = Number(this.reloadingAction()); f.reloadProgress = s.reloadProgress;
    this.posePlayback.apply(sc.frame, f);
    const { ads: a, scale } = f; if (a > 0 && (this.adsPose.scale !== scale || this.adsPose.rearDepth <= 0)) this.posePlayback.apply(sc.sight, f);
    for (const mesh of this.sightedHidden) mesh.visible = a < 0.85 || this.inspect > 0;
    const glow = this.glow, glowRow = this.rows.glow;
    if (glow !== null && glowRow !== undefined && glow.material instanceof THREE.MeshBasicMaterial) { glow.visible = a > 0.001; glow.material.opacity = a * glowRow.opacity; }
    if (this.rows.scaleRoot === true) this.model.scale.setScalar(scale);
    f.cycle = values['open'] ?? 0; this.posePlayback.apply(sc.pose, f);
    this.feel.scanAim(this, this.targets, this.active, _o, _d, _v2, this.model);
    this.effects.publish(dt, t, this.game.renderer, this.tracerLife);
  }
  protected override autoReloadDue(): boolean {
    if (this.act === null) return !this.state.reloading && this.state.ammo <= 0 && this.state.reserve > 0 && this.sinceEmpty > this.profile.autoReload && this.active && this.enabled;
    return this.act.wantsAutoReload && this.sinceEmpty > this.view.timing.autoReloadDelay && this.sinceEmpty < (this.view.timing.autoReloadClose ?? 5) && this.active && this.enabled;
  }
}
