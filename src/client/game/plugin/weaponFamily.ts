import { BladeMoves, type BladeBody, type BladePorts } from './bladeMoves';
import { createClientChannelView, type ClientGeometryKernels } from './clientChannelView';
import { admitHeldRecipe } from './heldRecipe';
import { createClientChannels, bindClientChannelInputs } from '../../../shared/game/plugin/channels';
import { readBorrowedOwner, type BorrowedOwnerPath } from '../../../shared/game/plugin/borrowed';
import { createClientScene, createHeldMeleeBinding, type ClientScene, type ClientScenePorts } from './scene';
import { Object3D, BufferGeometry, Group, Mesh, BoxGeometry, ConeGeometry, CylinderGeometry, TorusGeometry, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, PointLight, Vector2, Vector3, MathUtils, PlaneGeometry, AdditiveBlending, DoubleSide } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RangedAction, stepActionClock } from "@wildshard/engine/combat/Firearm";
import { leverProfile, type LeverProfile } from "../../../shared/game/shardfile/items";
import * as v from "valibot";
import { CatalogueIconSchema, type CatalogueIconName } from "@wildshard/format/items";
import { blocks } from "@wildshard/engine/blocks";
import type { WorldContactDispatcher } from "@wildshard/engine/combat/contactWeapon";
import { Weapon, type WeaponState, type AimInfo, type OwnHit } from "@wildshard/engine/combat/Weapon";
import { makeFlashTexture } from "@wildshard/engine/combat/view/firearmFx";
import { worldHit } from "@wildshard/engine/combat/view/ranged";
import { Gunfire } from "@wildshard/engine/fx/gunfire";
import { bodyOnRay, combatFloat } from "@wildshard/engine/ui/Combat";
import { Tool } from "@wildshard/engine/combat/Tool";
import type { EquipmentCues, EquipmentRow, EquipContext } from "@wildshard/engine/combat/Equipment";
import type { ItemFamily, ItemFamilyPorts } from "@wildshard/engine/combat/itemFamilies";
import type { ItemSpec } from "@wildshard/engine/combat/items";
import { buildSword } from "../systems/items/declaredSword";
import { REST } from "../../../shared/game/weapons/starterMoves";
import type { LevelContext } from "@wildshard/engine/level/context";

type App = LevelContext['app'];

// SF54: the private iron sword copy, deleted when these families graduate

/**
 * The share of a held item's flat colour that glows (E460). A declared shard's look need not light a camera-held item:
 * the template's neutral look has no environment and a dim sun, so a plain grey item's shade side rendered near black on
 * every renderer (its measure surfaces carry their own lift, families/measure.ts). At 0.5 the sunlit face reads as the
 * declared colour and the shade side a step darker.
 */
export const ITEM_VIEW_LIFT = 0.5;
/** SB43: the painted sword's lift; its own vertex colours carry the look, so the row's colour only lifts the shade side a little. */
const SWORD_VIEW_LIFT = 0.25;
/** A lit lantern shows a warm glowing core in its glass (a band round a GLB body), so the toggle shows by day (playtest round 3: LANTERN showed nothing). */
const LANTERN_LIT = 0xffc46a;
/** On a portrait screen a held item's view sits at most this share of the half-frame from the centre (its depth's). */
const IN_FRAME = 0.7;

/**
 * Keep a held item inside a portrait frame (playtest round 3, iPhone portrait: the lantern's view at x −0.3 sat off the left
 * edge and the whip's showed as a slab on the right one). Its declared x is pulled toward the centre until it lies within
 * IN_FRAME of the half-width the camera sees at its depth; landscape keeps the declared pose. The model's parent is the
 * camera's viewmodel root.
 */
function keepInFrame(model: Group, at: readonly [number, number, number], shift = 0): void {
  const camera = model.parent?.parent;
  let x = at[0];
  if (camera instanceof PerspectiveCamera && camera.aspect < 1) {
    const half = Math.abs(at[2]) * Math.tan(MathUtils.degToRad(camera.fov) / 2) * camera.aspect * IN_FRAME;
    x = Math.sign(x) * Math.min(Math.abs(x), half);
  }
  x += shift; // a swing's own travel, off the kept rest
  if (model.position.x !== x) model.position.x = x;
}

function isGroup(value: unknown): value is Group { return value instanceof Group; }
/** A declared item's held view from its row (`view`): an admitted asset, or a kit recipe's own build. Exported for its test. */
export function itemMesh(ports: Pick<ItemFamilyPorts, 'view' | 'model' | 'scope'>): Group {
  if (ports.view.asset !== undefined) {
    if (!isGroup(ports.model)) throw new Error('Admitted equipment asset needs its loaded model');
    const model = ports.model.clone(true);
    model.position.set(...ports.view.position); model.rotation.set(...ports.view.rotation);
    ports.scope.onDispose(() => { model.removeFromParent(); });
    return model;
  }
  const recipe = ports.view.recipe;
  if (recipe === 'kit.rifle') return rifleMesh(ports);
  if (recipe === 'kit.lantern') return lanternMesh(ports);
  if (!['kit.whip', 'kit.sword'].includes(recipe)) throw new Error(`Unresolved item view ${recipe}`);
  const model = new Group();
  const sword = recipe === 'kit.sword' ? buildSword('iron') : null;
  // SB43: the sword is painted per part (iron blade, dark guard, leather grip, the fists on it) and held in the starter sword's
  // REST, its tip leaning away from the eye; the row's rotation turns it from there. Built upright in one flat colour, it stood
  // as a grey slab over the right third of a phone's view. The row's colour still lifts its shade side (ITEM_VIEW_LIFT).
  const material = sword === null
    ? new MeshStandardMaterial({ color: ports.view.colour, flatShading: true, emissive: ports.view.colour, emissiveIntensity: ITEM_VIEW_LIFT })
    : new MeshStandardMaterial({ vertexColors: true, flatShading: true, emissive: ports.view.colour, emissiveIntensity: SWORD_VIEW_LIFT });
  const geometry = sword?.sword ?? new CylinderGeometry(0.025, 0.04, 0.8, 6);
  sword?.arms.dispose();
  const mesh = new Mesh(geometry, material); if (sword !== null) mesh.quaternion.copy(REST.q); model.add(mesh);
  model.position.set(...ports.view.position); model.rotation.set(...ports.view.rotation);
  ports.scope.onDispose(() => { model.removeFromParent(); geometry.dispose(); material.dispose(); });
  return model;
}
/** The lantern's glass, a warm pane that reads as glass unlit; the lit glow core covers it (DeclaredLantern). */
const LANTERN_GLASS = 0xf1dcaa;
/**
 * opus-greybox: a lantern's stand-in when its row names no GLB. It was a bare 12 × 18 × 12 cm box, which read as a grey
 * placeholder cube at the view's lower left in every first-person frame. Now a lantern: a base, four corner posts, a top
 * plate, a pyramid roof and a carry ring in the row's colour (one merged draw), round a glass core (one draw).
 */
function lanternMesh(ports: Pick<ItemFamilyPorts, 'view' | 'model' | 'scope'>): Group {
  const model = new Group();
  const part = (geometry: BufferGeometry, x: number, y: number, z: number): BufferGeometry => geometry.translate(x, y, z);
  const pieces = [part(new BoxGeometry(0.12, 0.022, 0.12), 0, -0.075, 0), part(new BoxGeometry(0.11, 0.02, 0.11), 0, 0.07, 0),
    part(new ConeGeometry(0.08, 0.045, 4).rotateY(Math.PI / 4), 0, 0.1025, 0), part(new TorusGeometry(0.035, 0.005, 4, 10, Math.PI), 0, 0.097, 0),
    ...[[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([sx = 0, sz = 0]) => part(new BoxGeometry(0.016, 0.13, 0.016), sx * 0.048, 0, sz * 0.048))];
  const frame = mergeGeometries(pieces, false); for (const piece of pieces) piece.dispose();
  const pane = new BoxGeometry(0.08, 0.12, 0.08);
  const metal = new MeshStandardMaterial({ color: ports.view.colour, flatShading: true, emissive: ports.view.colour, emissiveIntensity: ITEM_VIEW_LIFT });
  const glass = new MeshStandardMaterial({ color: LANTERN_GLASS, flatShading: true, emissive: LANTERN_GLASS, emissiveIntensity: ITEM_VIEW_LIFT, roughness: 0.2 });
  model.add(new Mesh(frame, metal), new Mesh(pane, glass));
  model.position.set(...ports.view.position); model.rotation.set(...ports.view.rotation);
  ports.scope.onDispose(() => { model.removeFromParent(); frame.dispose(); pane.dispose(); metal.dispose(); glass.dispose(); });
  return model;
}
/** TE-ENG2: a lever's stand-in when its row names no GLB: a barrel and a stock in the row's colour, the muzzle at the barrel's end. */
function rifleMesh(ports: Pick<ItemFamilyPorts, 'view' | 'model' | 'scope'>): Group {
  const model = new Group(), material = new MeshStandardMaterial({ color: ports.view.colour, flatShading: true, emissive: ports.view.colour, emissiveIntensity: ITEM_VIEW_LIFT });
  const barrel = new BoxGeometry(0.035, 0.045, 0.75), stock = new BoxGeometry(0.055, 0.11, 0.3);
  const front = new Mesh(barrel, material), back = new Mesh(stock, material);
  front.position.set(0, 0.02, -0.3); back.position.set(0, -0.02, 0.2); model.add(front, back);
  const muzzle = new Object3D(); muzzle.name = 'muzzle'; muzzle.position.set(0, 0.02, -0.68); model.add(muzzle);
  model.position.set(...ports.view.position); model.rotation.set(...ports.view.rotation);
  ports.scope.onDispose(() => { model.removeFromParent(); barrel.dispose(); stock.dispose(); material.dispose(); });
  return model;
}
/** Seconds the muzzle flash shows after a round leaves. */
const FLASH_SECONDS = 0.06;
/** Frames the page's count may differ from the server's at rest before the server's stands. */
const APART_FRAMES = 15;
interface LeverAimPlayer { zoomLook: number; readonly sprinting: boolean }
/** A lever the page holds, as the shardfile client reads and drives it (TE-ENG2). */
export interface DeclaredLeverHandle {
  /** Whether this player has taken it off its rack: the server's word on the wire, this page's own off it. */
  readonly taken: boolean;
  /** The rack's scene ran here with no wire: take it. */
  readonly take: () => void;
  /** The server's owned lines for this lever: rounds in the gun, the reserve, a reload under way, taken. */
  readonly mirror: (rounds: number, reserve: number, reloading: boolean, taken: boolean) => void;
  readonly bindAimView: (camera: PerspectiveCamera, player: LeverAimPlayer, refit: () => void) => void;
}
/** QA42: a held round's way from the eye (the aim ray), its end and the body the cosmetic ray met. */
const _origin = new Vector3(), _aim = new Vector3(), _end = new Vector3(), _muzzle = new Vector3(), _body = new Vector3();
/** Seconds a round the page saw meet a body waits for the server's hit before it reads as blocked (armour, a shut guard). */
/** The flash's roll and the kick's wander: a look only, so a local stream rather than the app's rng. */
let rollSeed = 4243;
const roll = (): number => { rollSeed = (rollSeed * 16807) % 2147483647; return (rollSeed - 1) / 2147483646; };
const BLOCKED_AFTER = 0.6;
/** A round in hand while reloading: where the hand goes for it (below the frame), in the model's metres from its grip. */
const POUCH = new Vector3(0.06, -0.24, 0.16);
const _handAt = new Vector3(), _gateAt = new Vector3(), _home = new Vector3();
/** The held flash: three additive cards under the muzzle (one facing the eye, two along the bore), turned at random per shot. */
function heldFlash(size: number): { readonly group: Group; readonly dispose: () => void } {
  // a canvas only on a page: a headless view (the tests, a bot) draws the cards untextured
  const group = new Group(), map = typeof document === 'undefined' ? null : makeFlashTexture(), material = new MeshBasicMaterial({ map, transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false, side: DoubleSide });
  const face = new PlaneGeometry(size, size), side = new PlaneGeometry(size * 0.7, size * 1.9).rotateX(-Math.PI / 2).translate(0, 0, -size * 0.75);
  const cross = side.clone().rotateZ(Math.PI / 2);
  group.add(new Mesh(face, material), new Mesh(side, material), new Mesh(cross, material));
  group.name = 'flash'; group.visible = false;
  for (const child of group.children) child.renderOrder = 20;
  return { group, dispose: () => { map?.dispose(); material.dispose(); face.dispose(); side.dispose(); cross.dispose(); } };
}
/**
 * A declared lever-action rifle (TE-ENG2, `kit.lever`): Pine's per-round cycle (`RangedAction.Cycle`) from the row's `firearm` profile,
 * with the shard's GLB in hand. On the wire the server fires every round (a hitscan at any body) and feeds every reload; this page
 * plays its own cycle for the feel and takes the server's count when they differ at rest. Its weapon state fills the HUD's ammo
 * strip: rounds in the gun over the tube, and the reserve. Until the player takes it from its rack it is hidden and refuses every press.
 *
 * QA42 (Jake, 2026-11-19 on Brasscap: "The reloading animation's trash ... there's no particle effects ... There's no bullets"):
 * - a shot kicks the gun up and back and the camera with it, shows a three-card flash at the `muzzle`, drops the `hammer`
 *   and throws the `lever` (GLB nodes, each optional), and sends a tracer from the muzzle to where the round stops: a body
 *   the aim ray passes (`bodyOnRay`), else the world, where a dust cloud rises (`Gunfire`);
 * - the server's hit throws sparks there; a round the page saw meet a body with no hit from the server in BLOCKED_AFTER is
 *   blocked (armour, a shut guard): sparks and a grey ARMOUR float;
 * - a reload turns the gun's loading gate (the `gate` node) up toward the eye; the right hand (`handRight`, with the
 *   `round` in its fingers) goes down for a round, brings it to the gate and thumbs it in as each round feeds, then
 *   takes the wrist again. A GLB without those nodes keeps the turn alone.
 */
/** QA 11-19 row 41 (Jake on Brasscap: "Shooting the gun makes no sound."): a declared lever whose row names no cues fires,
 *  reloads and clicks dry through the shared lever voices (`sharedCombatCues`); a row's own cues still win. */
export const DECLARED_LEVER_CUES: EquipmentCues = { fire: 'cue.lever.fire', reload: 'cue.lever.reload', dry: 'cue.lever.dry', impact: 'cue.projectile.hit' };
class DeclaredLever extends Weapon implements DeclaredLeverHandle {
  readonly model: Group;
  readonly state: WeaponState = { ammo: undefined, magazine: 0, reserve: 0, loaded: false, reloading: false, reloadProgress: 0, ads: false };
  holster = 0; enabled = true; adsHeld = false; aimInfo: AimInfo | null = null;
  taken = false;
  private readonly ports: ItemFamilyPorts;
  private readonly profile: LeverProfile;
  private readonly store: { reserve: number };
  private readonly act: InstanceType<typeof RangedAction.Cycle>;
  private readonly flash: Group;
  private readonly muzzle: Object3D;
  private readonly lever: Object3D | null;
  private readonly hammer: Object3D | null;
  private readonly hand: { readonly node: Object3D; readonly rest: Vector3; readonly gate: Vector3; readonly round: Object3D | null } | null;
  private readonly sight: Vector3;
  private aimView: { camera: PerspectiveCamera; player: LeverAimPlayer; refit: () => void } | undefined;
  private hip: { fov: number; look: number } | undefined;
  private sightBlend = 0;
  private flashT = 0; private kick = 0; private apart = 0; private reloadBlend = 0; private hammerFall = 0;
  /** A round the page saw meet a body: where, its way, and the seconds left for the server's hit. */
  private readonly blocked = { at: new Vector3(), way: new Vector3(), left: 0 };
  constructor(row: EquipmentRow, spec: Extract<ItemSpec, { kind: 'weapon' }>, ports: ItemFamilyPorts) {
    const profile: LeverProfile = leverProfile({ id: spec.id, profile: ports.profile });
    super({ ...row, cues: row.cues ?? DECLARED_LEVER_CUES, ui: { ...row.ui, touch: 'ranged', melee: false, lockOn: false, ammo: { label: 'Rounds', segments: profile.magazine, magazine: true } } });
    this.ports = ports; this.profile = profile; this.store = { reserve: profile.reserve };
    this.act = new RangedAction.Cycle(this.store, { magazine: profile.magazine, reload: profile.reload, ...profile.lever });
    this.model = itemMesh(ports); this.setAimSource(ports.aim);
    const muzzle = this.model.getObjectByName('muzzle') ?? this.model;
    const sight = this.model.getObjectByName('frontSight') ?? muzzle;
    this.muzzle = muzzle;
    this.sight = this.model.worldToLocal(sight.getWorldPosition(new Vector3())).applyEuler(this.model.rotation);
    // Align just above the bore when the mesh has no sight locator.
    if (sight === muzzle) this.sight.y += 0.03;
    // a wide bore (a scattergun's) flashes wider: the spread stands for it
    const flash = heldFlash(0.16 + Math.min(0.12, profile.spreadHip * 0.06));
    this.flash = flash.group; muzzle.add(this.flash);
    this.lever = this.model.getObjectByName('lever') ?? null;
    this.hammer = this.model.getObjectByName('hammer') ?? null;
    const hand = this.model.getObjectByName('handRight'), gate = this.model.getObjectByName('gate');
    this.hand = hand === undefined || gate === undefined ? null
      : { node: hand, rest: hand.position.clone(), gate: gate.position.clone(), round: hand.getObjectByName('round') ?? null };
    if (this.hand !== null && this.hand.round !== null) this.hand.round.visible = false;
    ports.scope.onDispose(flash.dispose);
    this.state.magazine = profile.magazine; this.sync();
  }
  override install(ctx: EquipContext): void {
    super.install(ctx); ctx.scope.onDispose(() => { this.ports.scope.dispose(); });
    ctx.scope.onDispose(() => { this.releaseAim(); });
    this.ports.input.bind('attack', () => { this.tryFire(); }, ctx.scope, () => this.enabled);
    this.ports.input.bind('reload', () => { this.reload(); }, ctx.scope, () => this.enabled);
  }
  bindAimView(camera: PerspectiveCamera, player: LeverAimPlayer, refit: () => void): void {
    this.aimView = { camera, player, refit };
  }
  override setActive(on: boolean): void {
    if (!on) this.releaseAim();
    super.setActive(on);
  }
  private releaseAim(): void {
    const view = this.aimView, hip = this.hip;
    if (view !== undefined && hip !== undefined) {
      view.camera.fov = hip.fov; view.camera.updateProjectionMatrix(); view.refit();
      view.player.zoomLook = hip.look;
    }
    this.hip = undefined; this.sightBlend = 0; this.state.ads = false;
  }
  private updateAim(dt: number): void {
    const view = this.aimView;
    const aimed = this.enabled && this.taken && !this.state.reloading && view?.player.sprinting !== true
      && (this.adsHeld || this.ports.input.held('aim'));
    this.state.ads = aimed;
    const target = Number(aimed);
    const blend = MathUtils.damp(this.sightBlend, target, 20, dt);
    this.sightBlend = Math.abs(blend - target) < 0.002 ? target : blend;
    if (this.sightBlend === 0) { this.releaseAim(); return; }
    if (view === undefined) return;
    const hip = this.hip ??= { fov: view.camera.fov, look: view.player.zoomLook };
    const zoom = 1 + 0.3 * this.sightBlend;
    const fov = MathUtils.radToDeg(2 * Math.atan(Math.tan(MathUtils.degToRad(hip.fov) / 2) / zoom));
    if (Math.abs(view.camera.fov - fov) > 0.01) {
      view.camera.fov = fov; view.camera.updateProjectionMatrix(); view.refit();
    }
    view.player.zoomLook = hip.look / zoom;
  }
  take(): void { this.taken = true; this.sync(); }
  tryFire(): void {
    if (!this.enabled || !this.taken) return;
    const { act } = this;
    // Pine's trigger: a pull mid-reload stops it after this round; an empty chamber throws the lever, or reloads a dry tube.
    if (act.phase === 'reload') { act.triggerWhileReloading(); this.wire?.press(false); return; }
    if (act.phase !== 'idle') return;
    if (!act.chambered) { this.onDry?.(); if (act.tube > 0) act.throwLever(); else this.reload(); this.wire?.press(false); return; }
    act.dropHammer(); this.kick = 1; this.flashT = FLASH_SECONDS; this.hammerFall = 1;
    this.flash.rotation.z = roll() * Math.PI * 2; this.flash.scale.setScalar(0.85 + roll() * 0.35);
    this.onFire?.();
    this.shotEffects();
    this.wire?.press(false); // the server fires the round along this look; off the wire no round lands here
  }
  /** QA42: the round's tracer, the camera's kick, and the dust where it lands or the body it meets (the server settles the hit). */
  private shotEffects(): void {
    const fire = Gunfire.current(); if (fire === null) return;
    this.aimRay(_origin, _aim); _aim.normalize();
    const wall = worldHit(_origin, _end.copy(_origin).addScaledVector(_aim, this.profile.range), 0);
    const reach = wall?.distance ?? this.profile.range, body = bodyOnRay(_origin, _aim, reach, _body);
    if (body !== null) _end.copy(body); else _end.copy(_origin).addScaledVector(_aim, reach);
    fire.shot(this.muzzle.getWorldPosition(_muzzle), _end, 'own');
    fire.kick(1.6 + roll() * 0.8, (roll() - 0.5) * 1.2);
    if (body !== null) { this.blocked.at.copy(body); this.blocked.way.copy(_aim); this.blocked.left = BLOCKED_AFTER; return; }
    if (wall === null) return;
    fire.impact(_end, _aim, 'dust');
    this.onImpact?.('ground', _end.clone());
  }
  /** QA42: the server's word on a round: sparks (a weak spot's hotter spray) where it struck; a hit of nothing reads as blocked. */
  override serverHit(hit: OwnHit): void {
    this.blocked.left = 0;
    if (hit.amount <= 0) { this.blockedAt(hit.at, this.blocked.way); return; }
    super.serverHit(hit);
    Gunfire.current()?.impact(hit.at, this.blocked.way, hit.head ? 'flesh' : 'sparks');
  }
  private blockedAt(at: Vector3, way: Vector3): void {
    Gunfire.current()?.impact(at, way, 'armour');
    combatFloat(at, 'ARMOUR', 'armour');
    this.onImpact?.('wood', at.clone());
  }
  override reload(): void {
    if (!this.enabled || !this.taken || !this.act.beginReload()) return;
    this.onReloadStart?.(); this.wire?.reload();
  }
  mirror(rounds: number, reserve: number, reloading: boolean, taken: boolean): void {
    if (taken && !this.taken) this.taken = true;
    // At rest both sides agree, or the server's count stands, rounds and reserve together; mid-cycle or mid-reload the page's own
    // count leads (a reserve taken early would end the page's reload a round short).
    const { act } = this;
    if (act.phase !== 'idle' || reloading || act.rounds === rounds && this.store.reserve === reserve) { this.apart = 0; return; }
    this.apart += 1;
    if (this.apart < APART_FRAMES) return;
    act.chambered = rounds > 0; act.tube = Math.min(act.tubeMax, Math.max(0, rounds - 1)); this.store.reserve = reserve; this.apart = 0;
  }
  update(dt: number, _t: number): void {
    // On the wire the cycle steps once per command sent, so it chambers on the tick the server's does (P1-E6).
    stepActionClock(dt, this.wire, seconds => { for (const event of this.act.events(seconds, false)) if (event === 'reloadEnd') this.onReloadEnd?.(); });
    this.sync();
    this.updateAim(dt);
    if (this.blocked.left > 0 && (this.blocked.left -= dt) <= 0) this.blockedAt(this.blocked.at, this.blocked.way);
    const [x, y, z] = this.ports.view.position, [rx, ry, rz] = this.ports.view.rotation;
    this.kick *= Math.exp(-dt * 12); this.flashT = Math.max(0, this.flashT - dt); this.hammerFall *= Math.exp(-dt * 3);
    const throwing = Math.sin(this.act.cycleU * Math.PI), reloading = this.act.phase === 'reload';
    this.reloadBlend = MathUtils.damp(this.reloadBlend, Number(reloading), 9, dt);
    const r = MathUtils.smoothstep(this.reloadBlend, 0, 1), kick = this.kick;
    this.model.visible = this.taken && (this.enabled || this.holster > 0);
    const sightX = MathUtils.lerp(x, -this.sight.x, this.sightBlend), sightY = MathUtils.lerp(y, -this.sight.y, this.sightBlend);
    // the reload: the gun comes in across the body toward the middle, its muzzle swung left, rolled onto its left side so the
    // loading gate on its right faces up at the eye and the right hand can thumb rounds into it
    this.model.position.set(sightX - r * 0.12, sightY - throwing * 0.03 + r * 0.05, z + kick * 0.09 + r * 0.14);
    this.model.rotation.set(rx + kick * 0.2 + r * 0.1, ry + r * 0.5, rz + (this.lever === null ? throwing * 0.25 : throwing * 0.06) + r * 1.5 + kick * 0.03);
    if (this.lever !== null) this.lever.rotation.x = throwing * 0.95;
    if (this.hammer !== null) this.hammer.rotation.x = this.act.hammerCocked ? 0 : -0.75 * Math.max(0.6, this.hammerFall);
    this.poseHand(throwing);
    this.flash.visible = this.flashT > 0;
    keepInFrame(this.model, [sightX, sightY, z]);
  }
  /** The right hand through a reload: down for a round, up to the gate, the thumb's push as it feeds; down with the lever as it throws. */
  private poseHand(throwing: number): void {
    const hand = this.hand; if (hand === null) return;
    const { reloadIn } = this.profile.lever, reload = this.profile.reload;
    let round = false;
    _gateAt.copy(hand.gate).sub(hand.rest);
    if (this.act.phase === 'reload') {
      const inT = this.act.phaseT - reloadIn;
      // before the first round: the hand drops from the wrist to the pouch; then one fetch-and-push cycle per round
      if (inT < 0) _handAt.lerpVectors(_home.set(0, 0, 0), POUCH, MathUtils.smoothstep(1 + inT / Math.max(0.05, reloadIn), 0, 1));
      else {
        // a cycle runs from one round's feed (u 0) to the next's (u 1): back down for it, up to the gate, the thumb's push
        const u = (inT % reload) / reload, first = inT < reload;
        if (u < 0.15) { if (first) _handAt.copy(POUCH); else _handAt.lerpVectors(_gateAt, POUCH, MathUtils.smoothstep(u, 0, 0.15)); }
        else if (u < 0.6) { _handAt.lerpVectors(POUCH, _gateAt, MathUtils.smoothstep(u, 0.15, 0.6)); _handAt.x += 0.03 * (1 - MathUtils.smoothstep(u, 0.4, 0.6)); round = true; }
        else { const push = MathUtils.smoothstep(u, 0.6, 0.95); _handAt.copy(_gateAt); _handAt.z -= 0.035 * push; round = push < 0.95; }
      }
      hand.node.position.copy(hand.rest).add(_handAt);
    } else {
      // home on the wrist, eased back from wherever the reload left it; down with the lever as it throws
      _home.copy(hand.rest); _home.y -= throwing * 0.04;
      hand.node.position.lerp(_home, hand.node.position.distanceTo(_home) < 0.002 ? 1 : 0.3);
    }
    if (hand.round !== null) hand.round.visible = round;
  }
  private sync(): void {
    const s = this.state, { act } = this;
    s.ammo = this.taken ? act.rounds : undefined; s.reserve = this.store.reserve; s.loaded = act.chambered;
    s.reloading = act.phase === 'reload'; s.reloadProgress = act.reloadProgress;
  }
}
/** The page's lever, if this weapon is one. */
export function declaredLever(weapon: unknown): (Weapon & DeclaredLeverHandle) | null { return weapon instanceof DeclaredLever ? weapon : null; }
/** A held melee swing's offset off the row's rest pose: x, y, z in metres, then turns about x, y, z in radians (TE-ENG4). */
type SwingPose = readonly [number, number, number, number, number, number];
/** A swing: its shortest length in seconds, and its poses at their share of it; the last is the rest. */
interface SwingArc { readonly seconds: number; readonly keys: readonly (readonly [number, SwingPose])[] }
const REST_POSE: SwingPose = [0, 0, 0, 0, 0, 0];
/** A light strike: a short cock to the right, the sweep across and down to the left (the strike lands as it starts), the recovery. */
const LIGHT_SWING: SwingArc = { seconds: 0.32, keys: [[0.18, [0.05, 0.05, 0.02, 0.25, 0, -0.85]], [0.5, [-0.24, -0.1, -0.12, -0.85, 0, 1.25]], [1, REST_POSE]] };
/** A heavy strike: the blade raised back over the shoulder, the chop forward and down, a slower recovery. */
const HEAVY_SWING: SwingArc = { seconds: 0.5, keys: [[0.3, [-0.02, 0.12, 0.08, 0.85, 0, -0.2]], [0.56, [-0.06, -0.16, -0.2, -1.6, 0, 0.15]], [1, REST_POSE]] };
/**
 * The pose `u` (0 to 1) through an arc that starts from `from` (the pose a strike caught the blade in, so a strike mid-swing never
 * pops), eased between keys. `side` -1 mirrors it (a backhand): x, and the turns about y and z, change sign.
 */
function swingPose(arc: SwingArc, u: number, from: readonly number[], side: number, out: number[]): void {
  let k0 = 0, a: readonly number[] = from;
  for (const [k1, key] of arc.keys) {
    if (u <= k1) {
      const s = k1 > k0 ? MathUtils.smoothstep(u, k0, k1) : 1;
      for (let i = 0; i < 6; i++) { const b = (key[i] ?? 0) * (i === 0 || i === 4 || i === 5 ? side : 1), was = a[i] ?? 0; out[i] = was + (b - was) * s; }
      return;
    }
    k0 = k1; a = key.map((value, i) => value * (i === 0 || i === 4 || i === 5 ? side : 1));
  }
  out.fill(0);
}
/**
 * A declared melee weapon (`kit.melee`): the row's light and heavy strikes through the item runtime, on the wire the server's.
 * TE-ENG4: its held model swings on each strike (a light sweep across, a heavy chop down; a light strike during a light swing
 * comes back as a backhand), started by the press on the wire, by a charged hold's release, or off it by the runtime's `fire`.
 * Only this player's view swings: another player's figure holds a stock blade, and no strike reaches it on the wire.
 */
class DeclaredMelee extends Weapon {
  readonly model: Group;
  readonly state: WeaponState = { ammo: undefined, magazine: 0, reserve: 0, loaded: true, reloading: false, reloadProgress: 0, ads: false };
  holster = 0; enabled = true; aimInfo: AimInfo | null = null;
  private readonly ports: ItemFamilyPorts;
  private readonly spec: Extract<ItemSpec, { kind: 'weapon' }>;
  private held = false;
  /** On the wire the server's runtime keeps the cooldown; this one only spares it presses it would refuse. */
  private cooling = 0;
  private readonly origin = new Vector3(); private readonly direction = new Vector3();
  /** TE-ENG4: seconds into the swing (-1: at rest), its arc, side and length, the pose it started from and this frame's. */
  private swingT = -1; private arc: SwingArc = LIGHT_SWING; private side = 1; private swingSeconds = LIGHT_SWING.seconds;
  private readonly from: number[] = [0, 0, 0, 0, 0, 0]; private readonly offset: number[] = [0, 0, 0, 0, 0, 0];
  /** Seconds the hold has been down. */
  private heldFor = 0;
  /** The heavy charge a hold has built, which fills the touch ATTACK disc's ring. */
  override get charge(): number { return this.held ? Math.min(1, this.heldFor / this.spec.charge) : 0; }
  get adsHeld(): boolean { return this.held; }
  set adsHeld(on: boolean) {
    // a release the player made: a swap or stow disables the weapon first, and the server drops that charge
    const held = this.enabled && on, charged = this.enabled && !on && this.held && this.heldFor >= this.spec.charge;
    if (held !== this.held) this.heldFor = 0;
    // SR11 (C8): on the wire the server holds the charge and strikes on its release; this page's runtime never steps.
    if (this.wire !== null) {
      this.held = held; this.wire.hold(held);
      if (charged && this.cooling <= 0) { this.cooling = this.spec.heavy.cooldown; this.swing(true); }
      return;
    }
    this.held = held; this.ports.runtime.hold(this.held, this.ports.aim(), this.enabled);
  }
  constructor(row: EquipmentRow, spec: Extract<ItemSpec, { kind: 'weapon' }>, ports: ItemFamilyPorts) {
    super(row); this.ports = ports; this.spec = spec; this.model = itemMesh(ports); this.setAimSource(ports.aim);
    ports.runtime.observe(ports.scope, (phase, contact, heavy) => {
      if (phase === 'fire') { this.swing(heavy === true); this.onFire?.(); }
      if (phase === 'hit' && contact !== undefined) this.onHit?.(contact.kind, contact.headshot, contact.killed);
    });
  }
  override install(ctx: EquipContext): void {
    super.install(ctx); ctx.scope.onDispose(() => { this.ports.scope.dispose(); });
    this.ports.input.bind('attack', () => { this.tryFire(); }, ctx.scope, () => this.enabled);
    this.ports.input.bind('heavy', () => { if (!this.pressWire(true)) this.ports.runtime.queue(2, this.ports.aim()); }, ctx.scope, () => this.enabled);
  }
  tryFire(): void {
    if (!this.enabled || this.pressWire(false)) return;
    this.aimRay(this.origin, this.direction); this.ports.runtime.queue(1, { origin: this.origin, direction: this.direction });
  }
  /** SR11 (C8): a press goes to the server, which strikes with this item's own runtime and aim. False: no wire, the page's runtime takes it. */
  private pressWire(heavy: boolean): boolean {
    if (this.wire === null) return false;
    if (this.cooling > 0) return true;
    this.cooling = (heavy ? this.spec.heavy : this.spec.light).cooldown;
    this.wire.press(false, heavy); this.swing(heavy); this.onFire?.();
    return true;
  }
  /** Start the held model's swing for a strike, from wherever the last one left it. */
  private swing(heavy: boolean): void {
    this.side = !heavy && this.swingT >= 0 && this.arc === LIGHT_SWING ? -this.side : 1;
    this.arc = heavy ? HEAVY_SWING : LIGHT_SWING;
    this.swingSeconds = Math.max(this.arc.seconds, (heavy ? this.spec.heavy : this.spec.light).cooldown);
    for (let i = 0; i < 6; i++) this.from[i] = this.offset[i] ?? 0;
    this.swingT = 0;
  }
  update(dt: number, _t: number): void {
    this.cooling = Math.max(0, this.cooling - dt);
    if (this.held) this.heldFor += dt;
    const o = this.offset;
    if (this.swingT >= 0) {
      this.swingT += dt;
      const u = Math.min(1, this.swingT / this.swingSeconds);
      if (u < 1) swingPose(this.arc, u, this.from, this.side, o); else { o.fill(0); this.swingT = -1; }
    }
    const [x, y, z] = this.ports.view.position, [rx, ry, rz] = this.ports.view.rotation;
    this.model.visible = this.enabled || this.holster > 0;
    this.model.position.set(x, y + (o[1] ?? 0), z + (o[2] ?? 0));
    this.model.rotation.set(rx + (o[3] ?? 0), ry + (o[4] ?? 0), rz + (o[5] ?? 0));
    keepInFrame(this.model, this.ports.view.position, o[0] ?? 0);
  }
}
class DeclaredLantern extends Tool {
  readonly id: `tool.${string}`;
  readonly slot = 'offhand'; readonly actions: readonly NonNullable<Extract<ItemSpec, { kind: 'tool' }>['action']>[];
  readonly model: Group; readonly light: PointLight;
  private readonly flame: Mesh;
  holster = 0; enabled = true;
  private readonly ports: ItemFamilyPorts;
  private readonly spec: Extract<ItemSpec, { kind: 'tool' }>;
  constructor(row: EquipmentRow, spec: Extract<ItemSpec, { kind: 'tool' }>, ports: ItemFamilyPorts) {
    super(row);
    if (!row.id.startsWith('tool.')) throw new Error('Tool id required');
    if (spec.action === null) throw new Error('Declared lantern requires its toggle action');
    this.id = `tool.${row.id.slice(5)}`; this.actions = [spec.action]; this.spec = spec; this.ports = ports;
    this.model = itemMesh(ports);
    // the lit core: its own unlit material over the glass, shown only while the lantern burns (the body's material is never
    // changed); a row's GLB lantern has no stand-in glass, so its core stays the old band round the body
    const band = ports.view.asset === undefined ? new BoxGeometry(0.085, 0.124, 0.085) : new BoxGeometry(0.13, 0.07, 0.13), glow = new MeshBasicMaterial({ color: LANTERN_LIT });
    this.flame = new Mesh(band, glow); this.flame.visible = false; this.model.add(this.flame);
    ports.scope.onDispose(() => { band.dispose(); glow.dispose(); });
    this.light = new PointLight(0xffe1aa, 0, 8); this.model.add(this.light);
    // SHARD-SOURCE SS-GF1a1b: hidden until the kit first steps it; a lantern still on its stand is locked, so never stepped
    this.model.visible = false;
    ports.scope.onDispose(() => { this.light.dispose(); });
    ports.runtime.observe(ports.scope, (phase) => { if (phase === 'light') this.equipEvents?.emit('tool.used', { id: row.id, phase: ports.runtime.lightOn ? 'on' : 'off' }); });
  }
  override install(ctx: EquipContext): void { super.install(ctx); ctx.scope.onDispose(() => { this.ports.scope.dispose(); }); }
  update(_dt: number, _t: number): void {
    const lit = this.ports.runtime.lightOn;
    this.model.visible = true;
    this.light.intensity = lit ? this.spec.intensity : 0;
    this.flame.visible = lit;
    keepInFrame(this.model, this.ports.view.position);
  }
}
/** The view spring a held contact weapon's model sways on (`blocks.viewmodel`). */
export type HeldContactSpring = Parameters<typeof blocks.viewmodel>[0];
/**
 * A held contact weapon (SHARD-PLATFORM SF85): the chassis a native family's held weapon shares over its move rows
 * (`BladeMoves`). Attack swings light, Heavy swings heavy, and a still hold (touch) fills the charge ring over
 * `chargeSeconds` and its release swings heavy at once; the model sways on the view spring; contacts go through the
 * shared melee block. A family gives its rows' runtime (`moves`), its `swing` and its view in `update` (after `stepHeld`).
 */
export abstract class HeldContactWeapon<T extends BladeBody = BladeBody> extends Weapon {
  override readonly state: WeaponState = { ammo: undefined, magazine: 0, reserve: 0, loaded: true, reloading: false, reloadProgress: 0, ads: false };
  override holster = 0; override enabled = true; override adsHeld = false; override aimInfo: AimInfo | null = null;
  /** told of every swing's start (heavy or light) */
  onSwing: ((heavy: boolean) => void) | null = null;
  protected readonly app: App;
  protected readonly vm: ReturnType<typeof blocks.viewmodel>;
  protected readonly contact: ReturnType<typeof blocks.melee>;
  protected readonly spring = { yaw: 0, pitch: 0, yawVelocity: 0, pitchVelocity: 0 };
  protected get hold(): BladeMoves<T>['hold'] { return this.moves.hold; }
  protected chargeSeconds: number;
  /** the family's move rows at work */
  protected abstract readonly moves: BladeMoves<T>;
  private readonly releaseHold = (): void => { this.moves.cooldown = 0; this.swing(true); };
  constructor(app: App, row: EquipmentRow, spring: HeldContactSpring, chargeSeconds: number) {
    super(row); this.app = app; this.chargeSeconds = chargeSeconds;
    this.vm = blocks.viewmodel({ ...spring }); this.contact = blocks.melee(app.combat);
    this.blocks.vm = this.vm; this.blocks.melee = this.contact;
  }
  override get charge(): number { return Math.min(1, this.hold.elapsed / this.chargeSeconds); }
  override install(ctx: EquipContext): void {
    super.install(ctx);
    this.app.input.bind('attack', () => { this.tryFire(); }, ctx.scope, () => this.enabled);
    this.app.input.bind('heavy', () => { const started = this.swing(true); this.wire?.press(started, true); }, ctx.scope, () => this.enabled);
    ctx.scope.onDispose(() => { this.hold.reset(); });
  }
  override tryFire(): void { const started = this.swing(false); this.wire?.press(started); }
  /** Starts a light or heavy swing when its cooldown and the weapon allow (false: refused). */
  abstract swing(heavy: boolean): boolean;
  /** This frame's aim from the eye (false: no equipment host). */
  protected aim(from: Vector3, dir: Vector3): boolean {
    const host = this.app.equipmentHost; if (host === null) return false;
    this.setAimSource(() => host.player.sampleAimCommand()); this.aimRay(from, dir); return true;
  }
  /** The cooldowns run down, the hold steps (its release swings heavy) and the view spring follows the turn. */
  protected stepHeld(dt: number): void {
    this.moves.cool(dt);
    const active = this.enabled && this.holster <= 0.001;
    this.hold.step(dt, active, this.adsHeld, this.releaseHold);
    this.wire?.hold(active && this.adsHeld); // the server keeps its own charge, and lets go when this does
    this.vm.step(this.spring, new Vector2(), dt);
  }
}

/** Register one native weapon family in the caller's session-local registry, without allocating a weapon or installing inputs.
 * The loader checks the shard namespace and every item before construction. Duplicate and reserved kit names refuse here. */
export function registerWeaponFamily(registry: Map<string, ItemFamily>, id: string, family: ItemFamily): void {
  if (typeof id !== 'string' || id.length > 128 || !/^[a-z][a-zA-Z0-9.-]*$/u.test(id) || !id.includes('.') || id.startsWith('kit.')) throw new Error('A native weapon family needs a bounded shard-local id');
  if (family.kind !== 'weapon') throw new Error('Weapon family registration requires a weapon constructor');
  if (registry.has(id)) throw new Error(`Duplicate weapon family ${id}`);
  registry.set(id, family);
}

/** A declared item row's icon (`ui.icon`): one of the format's catalogue icons, every one of which the page's catalogue
 *  draws (`icons.ts`); refused otherwise. FORMAT-PRUNE FP51: the names live in the format, not as engine literals. */
export function declaredItemIcon(name: string): CatalogueIconName {
  if (!v.is(CatalogueIconSchema, name)) throw new Error(`Unknown catalogue item icon ${name}`);
  return name;
}
/** Explicit built-in item family registry, injected into the full loader; importing does not install content. */
export function declaredKitItemFamilies(): ReadonlyMap<string, ItemFamily> {
  return new Map<string, ItemFamily>([
    ['kit.melee', { kind: 'weapon', create: (row, spec, ports) => new DeclaredMelee(row, spec, ports) }],
    ['kit.lantern', { kind: 'tool', create: (row, spec, ports) => new DeclaredLantern(row, spec, ports) }],
    ['kit.lever', { kind: 'weapon', create: (row, spec, ports) => new DeclaredLever(row, spec, ports), profiles: ['firearm'], locked: true }],
  ]);
}

/** One presentation clock and the admitted numeric views of privately owned held-model parts.
 * The owner cannot write simulation state, issue contacts or choose a gameplay action. */
export class HeldPlayback {
  readonly model: ClientScene | null;
  private readonly attachments: ClientScene[] = [];
  private elapsed = 0;
  private delta = 0;
  /** the held model's own node (its private scene's root, else its first part): a hidden ancestor means nothing of it draws */
  private readonly anchor: Object3D | null;
  private readonly inputs = new Map<string, ReadonlyMap<string, () => number>>();
  private readonly groups = new Map<string, { lane: ReturnType<typeof createClientChannelView>; copied: number[]; readers: ((() => number) | undefined)[]; outputs?: ReturnType<ReturnType<typeof createClientChannelView>['bindNumeric']> }[]>();
  constructor(rows: Readonly<Record<string, readonly unknown[]>>, parts: ReadonlyMap<string, unknown>, kernels?: ClientGeometryKernels | ((parts: ReadonlyMap<string, unknown>, model: ClientScene | null) => ClientGeometryKernels), source?: { readonly row: unknown; readonly ports: ClientScenePorts }) {
    const groups = Object.entries(rows);
    if (groups.length === 0 || groups.length > 16) throw new RangeError('Held playback groups exceed admission');
    for (const [id, programs] of groups) if (!/^[a-z][a-zA-Z0-9.-]*$/u.test(id) || id.length > 128 || !Array.isArray(programs) || programs.length === 0 || programs.length > 8) throw new Error('Invalid held playback group');
    this.model = source === undefined ? null : createClientScene(source.row, source.ports);
    let anchor: Object3D | null = this.model?.root ?? null;
    if (anchor === null) for (const part of parts.values()) if (part instanceof Object3D) { anchor = part; break; }
    this.anchor = anchor;
    try {
    const targets = new Map(parts);
    for (const [id, object] of this.model?.parts ?? []) {
      if (targets.has(id)) { this.model?.dispose(); throw new Error('Private scene target repeated'); }
      targets.set(id, object);
    }
    const binding = typeof kernels === 'function' ? kernels(targets, this.model) : kernels;
    for (const [id, programs] of groups) {
      this.groups.set(id, programs.map(program => {
        const visual = typeof program === 'object' && program !== null && ('bindings' in program || 'geometry' in program || 'connectors' in program);
        const lane = visual ? createClientChannelView(program, targets, binding) : createClientChannels(program);
        return { lane, copied: Array.from({ length: lane.reads.length }, () => 0), readers: [] };
      }));
    }    } catch (error) { this.model?.dispose(); throw error; }
  }

  /** Required scene handles for declared held weapons and their catalogue views. */
  get root(): Group {
    const root = this.model?.group('root');
    if (root === null || root === undefined) throw new Error('Held scene root unavailable');
    return root;
  }
  part(id: string): Object3D {
    const part = this.model?.parts.get(id);
    if (part === undefined) throw new Error('Held scene part unavailable');
    return part;
  }
  material(id: string): MeshStandardMaterial {
    const material = this.model?.standardMaterial(id);
    if (material === null || material === undefined) throw new Error('Held scene material unavailable');
    return material;
  }

  /** Construct another owned private part, optionally appended at an existing admitted node. No world-scene access. */
  createPart(source: {readonly row:unknown;readonly ports:ClientScenePorts}, parent?: string): ClientScene {
    const target = parent === undefined ? null : this.model?.parts.get(parent);
    if (target === undefined) throw new Error('Missing owned attachment parent');
    const part = createClientScene(source.row,source.ports); target?.add(part.root); this.attachments.push(part); return part;
  }
  /** Dispose only resources this owner constructed, including detached parts. Borrowed ports remain caller-owned. */
  dispose(): void { for (const part of this.attachments) part.dispose(); this.model?.dispose(); this.attachments.length = 0; }
  /** Refuse a schedule naming an unbound group before inputs or contact clocks advance. */
  requireGroups(ids: readonly string[]): void { for (const id of ids) if (!this.groups.has(id)) throw new Error('Missing held playback group'); }
  /** Presentation time only; callers retain their original contact/hold phase ordering. */
  beginFrame(dt: number): void {
    if (!Number.isFinite(dt) || dt < 0 || dt > 1e12 || this.elapsed + dt > 1e12) throw new RangeError('Invalid held playback frame');
    this.delta = dt; this.elapsed += dt;
  }
  get time(): number { return this.elapsed; }
  /** Bind admitted numeric owner paths once; frame-local values remain supplied at their original phase. */
  bindInputs(group: string, rows: unknown, owners: ReadonlyMap<string, unknown>): void {
    const views = this.groups.get(group); if (views === undefined) throw new Error('Missing held playback group');
    if (this.inputs.has(group)) throw new Error('Held numeric inputs already bound');
    const inputs = bindClientChannelInputs(rows, owners, new Set(views.flatMap(view => view.lane.reads)));
    this.inputs.set(group, inputs);
    // Reader identities are admitted once. Their closures still resolve and
    // validate the current borrowed value on every evaluation.
    for (const view of views) for (let i = 0; i < view.lane.reads.length; i++) view.readers[i] = inputs.get(view.lane.reads[i] ?? '');
  }
  /** Bind one numeric programme's existing output channels to explicitly borrowed private visual fields. */
  bindOutputs(group: string, rows: readonly { readonly property: string; readonly target: string; readonly path: readonly string[] }[], owners: ReadonlyMap<string, unknown>): void {
    const views = this.groups.get(group), view = views?.[0];
    if (views?.length !== 1 || view === undefined || view.outputs !== undefined || rows.length === 0 || rows.length > 32) throw new Error('Invalid held numeric output group');
    const property = (key: string): key is keyof typeof view.lane.frame => Object.hasOwn(view.lane.frame, key);
    const bindings = rows.map(row => { if (!property(row.property)) throw new Error('Missing held output channel'); return { ...row, property: row.property }; });
    view.outputs = view.lane.bindNumeric(bindings, owners);
  }
  /** whether a node above the held model (the model itself, its holster, the viewmodel) is hidden */
  private hidden(): boolean {
    for (let node = this.anchor; node !== null; node = node.parent) if (!node.visible) return true;
    return false;
  }
  /** Copy a bounded observation into one selected view group; never lends authoritative objects. */
  apply(group: string, values: Readonly<Record<string, number>>): void {
    const views = this.groups.get(group); if (views === undefined) throw new Error('Missing held playback group');
    // T10: a holstered weapon's model is hidden, yet every equipped weapon is updated each frame (its clocks, its shots in
    // flight). PF6 (reverses T10's exactness for stateful views): every view of an undrawn model is skipped, those with
    // private locals too: a spring or counter holds its state while the weapon is stowed and resumes from it when drawn
    // (the holstered firearm's presentation was 0.1 ms of Pine's frame at 4x). A stateless view's next evaluation writes
    // exactly what it would have; a view that sets visibility still runs (it may be what shows the model)
    const hidden = this.hidden();
    for (const { lane, copied, readers, outputs } of views) {
      if (hidden && lane.toggles !== true) continue;
      for (let i = 0; i < lane.reads.length; i++) {
        const key = lane.reads[i]; if (key === undefined) throw new Error('Missing held playback read');
        const value = values[key] ?? readers[i]?.(); if (value === undefined) throw new Error(`Missing held playback observation ${key}`);
        copied[i] = value;
      }
      lane.evaluate({ time: this.elapsed, delta: this.delta, values: copied }); outputs?.apply(lane.frame);
    }
  }
}


/** Owned presentation parts and the native contact factory; the factory retains the original source/reaction laws. */
export interface HeldMeleePorts<T extends BladeBody, P> {
  readonly model: Group; readonly parts: P; readonly presentation: HeldPlayback;
  readonly nodes: ReadonlyMap<string, unknown>;
  readonly contacts: (ports: Omit<BladePorts<T>, 'react' | 'body'>) => BladeMoves<T>;
  readonly restingVisible?: boolean; readonly tip?: Vector3; readonly caughtPart?: () => Mesh;
}
/**
 * One page held-melee phase owner. Immediate contacts claim before sampling aim; delayed contacts sample at their
 * original landing times. Rows select the phase/channel, and the server stays authoritative.
 */
export class HeldMeleeWeapon<T extends BladeBody, P> extends HeldContactWeapon<T> {
  override readonly model: Group;
  readonly parts: P; readonly presentation: HeldPlayback;
  protected readonly moves: BladeMoves<T>;
  private readonly binding: ReturnType<typeof createHeldMeleeBinding>;
  private readonly ports: HeldMeleePorts<T, P>;
  private readonly observed = { phase: 1, charge: 0, spring: 0, holster: 0, stowed: 0,
    ext: 0, slack: 0, tipX: 0, tipY: 0, tipZ: 0, gripX: 0, gripY: 0, gripZ: 0, modelX: 0, modelY: 0,
    reach: 0, taut: 0, caughtX: 0, caughtY: 0, caughtZ: 0 };
  private readonly end = new Vector3();
  private caughtAt: Vector3 | null = null; private caughtT = 0; private caughtMesh: Mesh | null = null;
  private secondary: ((family: BladeMoves<T>) => number | null) | null = null;
  onGust: ((from: Vector3, dir: Vector3) => void) | null = null;
  stowed: () => boolean = () => false;
  motion: string; motionK = 1;
  constructor(app: App, row: EquipmentRow, phases: unknown, ports: HeldMeleePorts<T, P>) {
    const binding = createHeldMeleeBinding(phases, ports.nodes), data = binding.row;
    super(app, row, data.spring, data.charge);
    if (data.mode === 'delayed' && (ports.tip === undefined || ports.caughtPart === undefined)) throw new Error('Delayed phase requires owned deformation/catch ports');
    this.binding = binding; this.ports = ports; this.model = ports.model; this.parts = ports.parts; this.presentation = ports.presentation;
    this.motion = data.phases[0].id;
    this.moves = ports.contacts({ settles: () => this.wire === null, hit: request => this.contact.hit(request), aim: (from, dir) => this.aim(from, dir),
      fired: () => { this.onFire?.(); }, struck: (id, killed) => { this.onHit?.(id, false, killed); },
      caught: caught => { if (this.moves.move === data.phases[1].move) this.catchAt(caught.at); } });
    for (let i = 0; i < data.phases.length; i++) { const phase = data.phases[i]; if (phase === undefined) throw new Error('Missing admitted primary'); const move = this.moves.row(phase.move); if (move.lane !== 'primary' || move.heavy !== (i === 1) || (data.mode === 'immediate' ? move.lands.length > 0 : move.lands.length === 0)) throw new Error('Phase crossed its contact mode or lane'); }
    if (data.mode === 'immediate') { const move = this.moves.row(data.secondary.phase.move); if (move.lane !== 'secondary' || move.lands.length > 0) throw new Error('Phase crossed its contact mode or lane'); }
    this.presentation.requireGroups(data.mode === 'immediate' ? [...data.phases.map(phase => phase.channel), data.secondary.phase.channel] : Object.values(data.channels));
    this.model.position.set(...data.position);
    if (data.rotation !== undefined) this.model.rotation.set(...data.rotation);
    if (data.scale !== undefined) this.model.scale.setScalar(data.scale);
  }
  bindSecondary(start: (family: BladeMoves<T>) => number | null, charge: number): void { this.secondary = start; this.chargeSeconds = charge; }
  /** Platform contact policy attaches to the existing immediate/delayed landing owner. */
  bindWorldTargets(owner: WorldContactDispatcher | null): void { this.moves.bindWorldTargets(owner); }
  override install(ctx: EquipContext): void {
    super.install(ctx);
    const row = this.binding.row;
    if (row.mode === 'immediate') this.app.input.bind(row.secondary.action, () => { this.gust(); }, ctx.scope, () => this.enabled);
    else ctx.scope.onDispose(() => {
      this.moves.cancel();
      if (this.caughtMesh !== null) { this.caughtMesh.removeFromParent(); this.caughtMesh.geometry.dispose(); this.caughtMesh = null; }
    });
  }
  private aimed(): { from: Vector3; dir: Vector3 } | null {
    const from = new Vector3(), dir = new Vector3(); return this.aim(from, dir) ? { from, dir } : null;
  }
  swing(heavy: boolean): boolean {
    const row = this.binding.row, phase = row.phases[heavy ? 1 : 0];
    if (row.mode === 'delayed') {
      if (!this.enabled || !this.moves.swing(phase.move)) return false;
      this.onSwing?.(heavy); return true;
    }
    if (this.moves.cooldown > 0 || !this.enabled || this.stowed()) return false;
    this.moves.claim(phase.move); this.play(phase.id); this.onSwing?.(heavy);
    const aim = this.aimed(); if (aim !== null) this.slash(aim.from, aim.dir, heavy);
    return true;
  }
  slash(from: Vector3, dir: Vector3, heavy: boolean): number {
    const struck = this.moves.land(this.binding.row.phases[heavy ? 1 : 0].move, 0, from, dir);
    if (struck > 0) this.onFire?.(); return struck;
  }
  gust(): void {
    const row = this.binding.row;
    if (row.mode !== 'immediate' || this.moves.secondaryCooldown > 0 || !this.enabled || this.stowed()) return;
    if (this.secondary?.(this.moves) !== row.secondary.phase.move) return;
    this.play(row.secondary.phase.id); this.wire?.secondary?.();
    const aim = this.aimed(); if (aim === null) return;
    this.onGust?.(aim.from, aim.dir); this.blow(aim.from, aim.dir);
  }
  blow(from: Vector3, dir: Vector3): number {
    const row = this.binding.row; if (row.mode !== 'immediate') throw new Error('No admitted immediate secondary');
    return this.moves.land(row.secondary.phase.move, 0, from, dir);
  }
  private play(id: string): void { this.motion = id; this.motionK = 0; }
  private catchAt(at: Vector3): void {
    const row = this.binding.row;
    if (row.mode !== 'delayed') return;
    const scene = this.app.equipmentHost?.game.scene; if (scene === undefined) return;
    if (this.caughtMesh === null) { const part = this.ports.caughtPart?.(); if (part === undefined) throw new Error('Missing owned catch part'); this.caughtMesh = part; part.frustumCulled = false; scene.add(part); }
    this.caughtMesh.position.copy(at); this.caughtMesh.visible = true; this.caughtAt = at.clone(); this.caughtT = row.caughtSeconds;
  }
  override update(dt: number): void {
    const row = this.binding.row, observed = this.observed;
    if (row.mode === 'immediate') {
      this.stepHeld(dt);
      const phase = this.binding.phases.get(this.motion);
      if (phase === undefined) throw new Error('Unadmitted held phase');
      this.motionK = Math.min(1, this.motionK + dt / phase.seconds);
      this.presentation.beginFrame(dt);
      observed.phase = this.motionK; observed.charge = this.charge; observed.spring = this.spring.yaw; observed.holster = this.holster; observed.stowed = Number(this.stowed());
      this.presentation.apply(phase.channel, observed); return;
    }
    this.presentation.beginFrame(dt); this.stepHeld(dt);
    observed.holster = this.holster; observed.spring = this.spring.yaw; this.presentation.apply(row.channels.root, observed);
    const { moving, resting, deformation } = this.binding, tip = this.ports.tip;
    if (moving === null || resting === null || deformation === null || tip === undefined) throw new Error('Missing owned delayed bindings');
    if (this.caughtT > 0) { this.caughtT -= dt; if (this.caughtT <= 0 && this.caughtMesh !== null) this.caughtMesh.visible = false; }
    if (this.moves.t < 0) { deformation.visible = false; resting.visible = this.ports.restingVisible ?? true; this.presentation.apply(row.channels.rest, observed); return; }
    const t = this.moves.advance(dt), double = this.moves.move === row.phases[1].move;
    if (t < 0) return;
    const local = double && t > row.second - row.overlap ? t - (row.second - row.unroll) : t;
    observed.ext = Math.min(1, local / row.unroll); observed.slack = Math.max(0, (local - row.unroll) / (row.show - row.unroll));
    this.presentation.apply(row.channels.active, observed); resting.visible = false; deformation.visible = true;
    observed.tipX = tip.x; observed.tipY = tip.y; observed.tipZ = tip.z;
    observed.gripX = moving.position.x; observed.gripY = moving.position.y; observed.gripZ = moving.position.z;
    observed.modelX = this.model.position.x; observed.modelY = this.model.position.y; observed.reach = row.reach[double ? 1 : 0];
    if (this.caughtT > 0 && this.caughtAt !== null) { this.model.updateWorldMatrix(true, false); this.end.copy(this.caughtAt); this.model.worldToLocal(this.end); }
    observed.taut = Number(this.caughtT > 0); observed.caughtX = this.end.x; observed.caughtY = this.end.y; observed.caughtZ = this.end.z;
    this.presentation.apply(row.channels.deformation, observed);
  }
}

type PageMeleeTarget = ReturnType<App['combat']['targets']>[number];
/** Borrowed query and owned scene ports for an admitted held melee item. */
export interface HeldMeleeScenePorts {
  readonly presentation: HeldPlayback; readonly contacts: unknown;
  readonly raycast?: (from: Vector3, dir: Vector3, reach: number) => { readonly animal: Parameters<App['combat']['target']>[0]; readonly point: Vector3 } | null;
  readonly tip?: readonly [number, number, number]; readonly restingGroup?: string;
  readonly caught?: { readonly scene: Parameters<HeldPlayback['createPart']>[0]; readonly part: string };
}
/** Construct the existing held owner directly from its rows and scene; no private subclass/controller. */
export function createHeldMelee(app: App, row: EquipmentRow, phases: unknown, ports: HeldMeleeScenePorts): HeldMeleeWeapon<PageMeleeTarget, HeldPlayback> {
  const model = ports.presentation, caught = ports.caught;
  if (!row.id.startsWith('weapon.')) throw new Error('Held melee requires a weapon row');
  return new HeldMeleeWeapon(app, row, phases, { model: model.root, parts: model, presentation: model, nodes: model.model?.parts ?? new Map(),
    ...(ports.tip === undefined ? {} : { tip: new Vector3(...ports.tip) }),
    ...(ports.restingGroup === undefined ? {} : { restingVisible: model.model?.group(ports.restingGroup) === null }),
    ...(caught === undefined ? {} : { caughtPart: () => { const mesh = model.createPart(caught.scene).mesh(caught.part); if (mesh === null) throw new Error('Declared caught part unavailable'); return mesh; } }),
    contacts: bound => new BladeMoves(row.id, ports.contacts, { ...bound,
      ...(ports.raycast === undefined ? {} : { body: (from: Vector3, dir: Vector3, reach: number) => {
        const hit = ports.raycast?.(from, dir, reach) ?? null, target = hit === null ? null : app.combat.target(hit.animal);
        return hit === null || target === null ? null : { port: target, point: hit.point };
      } }),
      react: target => ({ actor: target.actor, ...(target.impulse === undefined ? {} : { impulse: target.impulse }),
        stagger: (dir: Vector3, strength: number) => { target.target.stagger?.(dir, strength); } }),
    }),
  });
}


/** Named resource bindings reuse the same bounded owner/path capability as quest presentation. */
export interface HeldResourceBinding {
  readonly id:string; readonly from:BorrowedOwnerPath; readonly args?:readonly unknown[];
  readonly result?:readonly (string|number)[]; readonly requires?:string; readonly bytes?:number;
  readonly copyGeometry?:boolean; readonly indexArray?:boolean; readonly emptyGeometry?:boolean;
}
export interface HeldResourceRows {
  readonly reads?:readonly (HeldResourceBinding&{readonly discardGeometry?:boolean})[];
  readonly geometry:readonly HeldResourceBinding[]; readonly objects?:readonly HeldResourceBinding[];
  readonly textures?:readonly HeldResourceBinding[]; readonly repeats?:readonly {readonly id:string;readonly value:readonly [number,number]}[];
  readonly decorators?:readonly HeldResourceBinding[];
}
/** Authored scene/playback/item rows; no builder, shader or contact authority in a recipe. */
export interface HeldMeleeRecipe {
  readonly equipment: EquipmentRow; readonly phases: Readonly<Record<string,unknown>>;
  readonly playback: Readonly<Record<string,readonly unknown[]>>; readonly scene:unknown; readonly resources?:HeldResourceRows;
  readonly attachments?:readonly {readonly id:string;readonly row:unknown;readonly parent:string;readonly requires?:string;readonly resources?:HeldResourceRows}[];
  readonly tip?:readonly [number,number,number]; readonly restingGroup?:string;
  readonly caught?:{readonly row:unknown;readonly part:string};
}
/** Sealed resource owners or original explicit ports; no authoritative actor/world ports are exposed here. */
export interface HeldPresentationPorts {
  readonly scene?:ClientScenePorts; readonly attachments?:ReadonlyMap<string,ClientScenePorts|null>; readonly owners?:ReadonlyMap<string,unknown>;
}
const heldMethod=(value:unknown):value is(...args:unknown[])=>unknown=>typeof value==='function';
function heldJson(value:unknown,depth=0):boolean {
  if(depth>8)return false;
  if(value===null||typeof value==='boolean')return true;
  if(typeof value==='string')return value.length<=4096;
  if(typeof value==='number')return Number.isFinite(value);
  if(Array.isArray(value))return value.length<=1024&&value.every((entry:unknown)=>heldJson(entry,depth+1));
  return typeof value==='object'&&Object.keys(value).length<=128&&Object.entries(value).every(([key,entry])=>!['constructor','prototype','__proto__'].includes(key)&&heldJson(entry,depth+1));
}
function heldResources(rows:HeldResourceRows,owners:ReadonlyMap<string,unknown>,locals:Record<string,unknown>):ClientScenePorts {
  const sources=new Map(owners);sources.set('locals',locals);
  const check=(bindings:readonly HeldResourceBinding[]):void=>{
    if(bindings.length>64||new Set(bindings.map(row=>row.id)).size!==bindings.length||bindings.some(row=>!/^[a-zA-Z][a-zA-Z0-9.-]{0,127}$/u.test(row.id)
      ||row.args!==undefined&&(row.args.length>16||!heldJson(row.args))||row.result!==undefined&&(row.result.length===0||row.result.length>16)))throw new Error('Invalid held resource bindings');
  };
  const roster=[rows.reads??[],rows.geometry,rows.objects??[],rows.textures??[],rows.decorators??[]];for(const entries of roster)check(entries);
  const resolve=(row:HeldResourceBinding):unknown=>{
    if(row.requires!==undefined&&(locals[row.requires]===null||locals[row.requires]===undefined))return null;
    const borrowed=readBorrowedOwner(sources,row.from);if(borrowed===null)return null;
    let value=borrowed.value;
    if(row.args!==undefined){if(!heldMethod(value))throw new Error('Held resource requires its borrowed method');value=value.apply(borrowed.receiver,[...row.args]);}
    if(row.result!==undefined&&value!==null&&value!==undefined)value=readBorrowedOwner(new Map([['value',value]]),{owner:'value',path:row.result})?.value;
    if(row.bytes!==undefined&&(!(value instanceof Uint8Array)||value.byteLength!==row.bytes))return null;
    return value??null;
  };
  for(const row of rows.reads??[]){
    const value=resolve(row);locals[row.id]=value;
    if(row.discardGeometry===true&&value!==null){const geometry=readBorrowedOwner(new Map([['value',value]]),{owner:'value',path:['geometry']})?.value;if(!(geometry instanceof BufferGeometry))throw new Error('Held resource requires its owned geometry copy');geometry.dispose();}
  }
  const geometryRows=new Map(rows.geometry.map(row=>[row.id,row])),objects=new Map((rows.objects??[]).map(row=>[row.id,resolve(row)])),textures=new Map((rows.textures??[]).map(row=>[row.id,resolve(row)]));
  const decorators=new Map<string,(material:MeshStandardMaterial)=>void>();
  for(const row of rows.decorators??[]){const borrowed=readBorrowedOwner(sources,row.from),method=borrowed?.value;if(borrowed===null||!heldMethod(method))throw new Error('Held decorator requires its owned method');decorators.set(row.id,material=>{method.apply(borrowed.receiver,[material,...row.args??[]]);});}
  const repeats=rows.repeats??[];
  if(repeats.length>32||new Set(repeats.map(row=>row.id)).size!==repeats.length||repeats.some(row=>row.value.some(value=>!Number.isFinite(value)||Math.abs(value)>1e5)))throw new Error('Invalid held texture repeat rows');
  return {objects,textures,decorators,textureRepeat:new Map(repeats.map(row=>[row.id,row.value])),geometry:id=>{
    const row=geometryRows.get(id);if(row===undefined)throw new Error(`Undeclared held geometry ${id}`);
    const value=resolve(row);if(value===null)return row.emptyGeometry===true?new BufferGeometry():null;
    if(!(value instanceof BufferGeometry))throw new Error('Held geometry requires its owned buffer');
    const geometry=row.copyGeometry===true?value.clone():value,index=geometry.getIndex();if(row.indexArray===true&&index!==null)geometry.setIndex(Array.from(index.array));return geometry;
  }};
}
function heldPresentation(recipe:HeldMeleeRecipe,ports:HeldPresentationPorts):{readonly model:HeldPlayback;readonly scene:ClientScenePorts} {
  admitHeldRecipe(recipe);
  const rows=recipe.attachments??[],locals:Record<string,unknown>={};
  if(rows.length>16||new Set(rows.map(row=>row.id)).size!==rows.length||rows.some(row=>!/^[a-z][a-zA-Z0-9.-]{0,127}$/u.test(row.id)))throw new Error('Invalid held attachment roster');
  if(recipe.resources!==undefined&&ports.owners===undefined)throw new Error('Held recipe needs its sealed resource owners');
  const scene=recipe.resources===undefined?ports.scene:heldResources(recipe.resources,ports.owners??new Map(),locals);
  if(scene===undefined)throw new Error('Held recipe requires its private scene ports');
  const model=new HeldPlayback(recipe.playback,new Map(),undefined,{row:recipe.scene,ports:scene});
  try {
    for(const row of rows){
      if(row.requires!==undefined&&(locals[row.requires]===null||locals[row.requires]===undefined))continue;
      const borrowed=row.resources===undefined?ports.attachments?.get(row.id):heldResources(row.resources,ports.owners??new Map(),locals);
      if(borrowed!==undefined&&borrowed!==null)model.createPart({row:row.row,ports:borrowed},row.parent);
    }
    return {model,scene};
  } catch(error){model.dispose();throw error;}
}
/** Construct one shared held hierarchy for page and Explorer, including declared optional attachments. */
export function createHeldPresentation(recipe:HeldMeleeRecipe,ports:HeldPresentationPorts):HeldPlayback {return heldPresentation(recipe,ports).model;}
/** Query/phase ports stay owned; presentation assembly is declared once for both melee families. */
export interface DeclaredHeldMeleePorts extends Omit<HeldMeleeScenePorts,'presentation'|'tip'|'restingGroup'|'caught'> {
  readonly model:HeldPresentationPorts; readonly charge?:number;
}
/** Bind the recipe to the existing held controller; never installs a second actor or phase owner. */
export function createDeclaredHeldMelee(app:App,recipe:HeldMeleeRecipe,ports:DeclaredHeldMeleePorts):ReturnType<typeof createHeldMelee> {
  const {model,scene}=heldPresentation(recipe,ports.model);
  try {
    return createHeldMelee(app,recipe.equipment,ports.charge===undefined?recipe.phases:{...recipe.phases,charge:ports.charge},{
      presentation:model,contacts:ports.contacts,
      ...(ports.raycast===undefined?{}:{raycast:ports.raycast}),
      ...(recipe.tip===undefined?{}:{tip:recipe.tip}),...(recipe.restingGroup===undefined?{}:{restingGroup:recipe.restingGroup}),
      ...(recipe.caught===undefined?{}:{caught:{scene:{row:recipe.caught.row,ports:{geometry:scene.geometry}},part:recipe.caught.part}}),
    });
  } catch(error){model.dispose();throw error;}
}
