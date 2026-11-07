import { smoothstep as sstep } from '../../../../shared/engine/core/noise';
import { app, gameplayRandom } from '../../app/runtime';
import type { EquipContext, EquipmentRow } from '../../../../shared/engine/combat/Equipment';
import type { Targets, TargetHit } from '../types';
import { DropArc } from './DropArc';
import { Projectiles, type WindField } from './projectile';
import { fovForAspect, FOV_HIP, isMesh } from './ranged';
import { Weapon, quiverState, type OwnHit } from '../../../../shared/engine/combat/Weapon';
import { FIXED_STEP } from '../../../../shared/engine/core/fixedStep';
import type { Game } from '../../core/Game';
import { weaponActionGate } from '../../input/weaponActions';
import { placeArm } from '../../player/firstPersonArms';
import type { Player } from '../../player/Player';
import { getSetting } from '../../ui/Settings';
import type { Forest } from '../../world/forest/Forest';
import type { SkyRig as Sky } from '../../world/skyRig';


import * as THREE from 'three';









import { BowDraw, RENOCK_TIME, type DrawEvent } from '../../../../shared/engine/combat/bowDraw';
import { shotRandom, shotSpread } from '../../../../shared/engine/combat/shotSpread';
import { bowAimOn, bowBlocked, bowLaunchSpeed, bowLooseSpreadDegrees, bowMount, bowMuzzle } from '../../../../shared/engine/combat/bowLaw';

import type { BowProfile, BowView } from './bowProfile';

/** View strategy ports supplied by the host world. */
export interface BowWorld { game: Game; sky: Sky; player: Player; forest: Forest }
/** Authored row, profile and unlock policy for the trusted bow family. */
export interface BowOptions<Style extends string = string> { row: EquipmentRow; profile: BowProfile<Style>; allowUnlocked?: boolean; inputContext: string; initialStyle: Style }
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const _v1 = V(0,0,0), _v2 = V(0,0,0), _v3 = V(0,0,0), _fwd = V(0,0,0), _dir = V(0,0,0), _rDir = V(0,0,0);
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const NEG_Z = V(0,0,-1), POS_Z = V(0,0,1), Y_AXIS = V(0,1,0);
const HOOK_BELOW_NOCK = 0.006;
const R_ARM_DIR = V(0.6, -0.42, 0.68).normalize(), R_ARM_DIR_PORT = V(0.42, -0.62, 0.66).normalize();
const RN_FOLLOW = 0.18, RN_DROP = 0.52, FOLLOW_OFF = V(0.035, 0.012, 0.075), QUIVER_OFF = V(0.3, -0.55, 0.12);
const L_ELBOW = V(-0.42, -0.52, -0.3), L_ELBOW_PORT = V(-0.2, -0.75, -0.32);
/** Shared drawn-projectile family; supplied profile owns every model, pose and arrow recipe. */
export class Bow<Style extends string = string> extends Weapon {
  /** the HUD strip (Weapons.ts BaseLike overrides): ARROWS n / 24 */
  readonly magazine: number;
  readonly profile: BowProfile<Style>;
  readonly state: ReturnType<typeof quiverState>;
  enabled = true;
  allowUnlocked = false;
  /** the AIM toggle (Weapons.adsHeld — the touch AIM disc; `?ads=1` forces it): the zoom down the arrow, never a draw */
  adsHeld = false;
  /** the draw, held (Weapons.altHeld — the touch FIRE disc): hold = draw, release at full = loose, early = let-down */

  /** 0..1 weapon-swap blend driven by Weapons.ts (1 = dropped out of the frame) */
  holster = 0;
  aimInfo: { kind: string; distance: number } | null = null;
  /** dev: > 0 = the viewmodel held up close and turned for inspection (`inspectYaw` rad, `inspectPitch`) — `?inspect=1` in the harness */
  inspect = 0; inspectYaw = 0; inspectPitch = 0;

  // ── the saddle's knobs (B7) — see the header ──
  drawSpeedScale = 1;
  extraSpreadDeg = 0;
  readonly carrierVelocity: THREE.Vector3 = new THREE.Vector3();
  arcAllowed = true;
  damageMultiplier: ((hit: TargetHit) => number) | undefined;

  /** bow-only: the string starts coming back / a draw was let down / a stuck arrow was picked up (survived or broke) */
  onDrawStart?: (() => void) | undefined;
  onLetDown?: (() => void) | undefined;
  /** bow-only: the draw reached full (the FIRE ring closes) */
  onFullDraw?: (() => void) | undefined;
  onRecover?: ((survived: boolean) => void) | undefined;
  /** the loose with its power (always 1 since N18: every loose is a full draw) — audio can scale the twang */
  onLoose?: ((power: number) => void) | undefined;

  readonly model: THREE.Group = new THREE.Group();
  readonly arrows: Projectiles;
  private readonly game: Game; private readonly sky: Sky; private readonly player: Player;
  private readonly targets: Targets | undefined;
  private readonly bowPivot = new THREE.Group();
  private readonly bowMesh: BowView<Style>['mesh'];
  private readonly nocked: THREE.Mesh;
  private readonly rHand: THREE.Mesh;
  private readonly lSleeve: THREE.Mesh; private readonly rSleeve: THREE.Mesh;
  private readonly lWrist: THREE.Vector3; private readonly rWrist: THREE.Vector3; private readonly rHook: THREE.Vector3; private readonly rWristDir: THREE.Vector3;
  /** the hand's nock point (rig space) at the last loose — the follow-through starts there */
  private readonly releasePos = new THREE.Vector3(); private readonly handPos = new THREE.Vector3();
  private readonly arc: DropArc;
  private readonly mat: THREE.Material;
  private readonly roll: THREE.Quaternion;
  freezeDraw: number | null = null;

  // draw state (bowDraw.ts)
  private readonly draw: BowDraw;
  /** The hold the frame's commands went out with, on a link: `update` runs after they are gone. */
  private carried = false;
  private p = 0;              // the draw, 0..1
  private vis = 0; private visVel = 0; // the string's visual draw (a spring: the release overshoots)
  private mouseDraw = false; private mouseAds = false;
  private mouseCancel = false; // LMB came up while input was off (the pointer lock lost): that release lets down
  private aimBlend = 0;       // 0 hip … 1 zoomed down the arrow (AIM)
  private ready = 0;          // 0 lowered … 1 raised
  private recoil = 0;
  private swayYaw = 0; private swayPitch = 0; // applied aim sway (removed again as it changes)
  private fov = FOV_HIP;
  private lastYaw = 0; private lastPitch = 0; private lagYaw = 0; private lagPitch = 0; private lagYawV = 0; private lagPitchV = 0;
  private aimFrame = 0; private readonly aimCache = { kind: '', distance: 0 };
  private readonly spawnPos = new THREE.Vector3(); private readonly launchVel = new THREE.Vector3();
  private readonly gripPos = new THREE.Vector3(); private readonly gripQuat = new THREE.Quaternion();

  constructor(world: BowWorld, targets: Targets | undefined, opts: BowOptions<Style>) {
    super(opts.row);
    this.row = { ...this.row, ui: { ...this.row.ui, inputContext: opts.inputContext } };
    this.style = opts.initialStyle;
    this.profile = opts.profile; this.draw = new BowDraw(this.profile.draw);
    this.magazine = this.profile.quiver;
    this.state = quiverState({ bolts: this.profile.quiver, loaded: true, reloading: false, reloadProgress: 1, ads: false }, this.profile.quiver);
    this.game = world.game; this.sky = world.sky; this.player = world.player;
    this.setAimSource(() => this.player.sampleAimCommand());
    this.targets = targets;
    this.allowUnlocked = opts.allowUnlocked ?? false;
    this.lastYaw = this.player.yaw; this.lastPitch = this.player.pitch;

    const view = this.profile.build(this.sky);
    this.mat = view.mat; this.bowMesh = view.mesh; this.roll = view.roll;
    this.lWrist = view.lWrist; this.rWrist = view.rWrist; this.rHook = view.rHook; this.rWristDir = view.rWristDir;
    this.nocked = view.nocked; this.rHand = view.rHand; this.lSleeve = view.lSleeve; this.rSleeve = view.rSleeve;
    this.bowPivot.add(new THREE.Mesh(this.bowMesh.geometry, this.mat));
    this.model.add(this.bowPivot, this.nocked, this.rHand, this.lSleeve, this.rSleeve);
    this.model.traverse((m) => {
      if (!isMesh(m)) return;
      m.frustumCulled = false; m.castShadow = false; m.receiveShadow = true;
      m.renderOrder = 1000;
      if (this.profile.transparentParts) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) { mat.transparent = true; mat.depthWrite = true; }
    });
    this.model.scale.setScalar(this.profile.vmScale);
    this.game.viewmodel.add(this.model);

    this.arrows = new Projectiles(world, targets, { ...this.profile.arrow(this.sky), ...this.profile.projectile });
    this.arrows.onTargetHit = (hit) => this.onArrowHit(hit);
    this.arrows.onHit = (kind, headshot, killed) => this.onHit?.(kind, headshot, killed);
    this.arrows.onImpact = (s, pt) => this.onImpact?.(s, pt);
    this.arrows.wind = this.profile.wind; // the one wind (grass, clouds, arrows); `bow.wind = null` for a still-air test
    this.arrows.canRecover = () => this.state.bolts < this.profile.quiver;
    this.arrows.onRecover = (ok) => { if (ok) this.state.bolts = Math.min(this.profile.quiver, this.state.bolts + 1); this.chargeEvent('recover', ok ? 1 : 0); this.onRecover?.(ok); };
    this.arc = new DropArc(this.game.scene, this.profile.arcColour);

  }

  /** the wind the arrows (and the arc) drift in */
  get wind(): WindField | null { return this.arrows.wind; }
  set wind(w: WindField | null) { this.arrows.wind = w; }
  /** the draw, 0..1 — the touch FIRE disc's ring (Weapons' `charge`) */
  override get charge(): number { return this.p; }
  get drawing(): boolean { return this.p > 0.01; }
  /** the draw is at full: a release now looses (the FIRE ring's `.ready`) */
  get fullDraw(): boolean { return this.draw.full; }
  /** 0..1 zoomed down the arrow (AIM) — for a HUD that wants to dim / tighten with it */
  get aimed(): number { return this.aimBlend; }
  /** AIM is on (RMB / the AIM disc toggle) */
  aimOn = false;

  // ── input ──
  override install(ctx: EquipContext): void {
    super.install(ctx);
    this.bindInput(ctx);
    ctx.scope.onDispose(() => { this.model.removeFromParent(); });
  }
  private bindInput(ctx: EquipContext): void {
    const allowed = weaponActionGate(this, this.player);
    app.input.bind('attack', () => { if (this.state.bolts <= 0) this.onDry?.(); else { this.mouseDraw = true; this.mouseCancel = false; } }, ctx.scope, allowed);
    app.input.bind('aim', () => { this.mouseAds = !this.mouseAds; }, ctx.scope, allowed);
    app.input.bindRelease('attack', () => { if (!this.mouseDraw) return; this.mouseDraw = false; if (!allowed()) this.mouseCancel = true; }, ctx.scope);
    app.input.onReset(() => { if (this.mouseDraw) this.mouseCancel = true; this.mouseDraw = false; this.mouseAds = false; }, ctx.scope);
  }

  /**
   * The draw's clock. On a link it takes one step for each command the frame sent, on the hold those commands carried, so it
   * keeps the server's count and lets go on the very command the server does (P1-E5.3-E1).
   */
  private stepDraw(dt: number, held: boolean, blocked: boolean): { ev: DrawEvent | null; shot: number } {
    const rate = this.drawSpeedScale * this.mountDraw, { wire } = this;
    if (wire === null) return { ev: this.draw.step(dt, held, blocked, rate), shot: 0 };
    const carried = this.carried, steps = wire.steps(), first = (wire.nextSeq() - steps) & 0xffff;
    this.carried = held; wire.hold(held);
    let ev: DrawEvent | null = null, shot = 0;
    for (let at = 0; at < steps; at++) {
      const event = this.draw.step(FIXED_STEP, carried, blocked, rate);
      if (event === 'loose') { shot = (first + at) & 0xffff; wire.shot(shot); }
      ev = event ?? ev;
    }
    return { ev, shot };
  }

  /** the FIRE disc's touch-down (Weapons.tryFire): the draw itself is the hold (`altHeld`), so this only clicks dry on an
   *  empty quiver — there is no quick-fire (N18) */
  tryFire(): void {
    if (this.enabled && this.state.bolts <= 0) this.onDry?.();
  }

  override serverHit(hit: OwnHit): void { super.serverHit(hit); this.arrows.endShot(hit.seq); }

  /** the loose — only ever from a full draw (bowDraw's 'loose'); `shot`: the command that let go, on a link */
  private loose(shot = 0): void {
    const p = 1;
    this.aimRay(_v1, _fwd);
    const spreadDeg = bowLooseSpreadDegrees(this.profile, this.aimBlend, this.player.speedFactor, this.extraSpreadDeg, this.mountSpread);
    const spread = THREE.MathUtils.degToRad(spreadDeg);
    _dir.copy(_fwd);
    shotSpread(_dir, spread, shot === 0 ? gameplayRandom : shotRandom(shot), this.profile.loose ?? { radius: 'sqrt', axisScale: 1 }, _v2);
    this.launchFrom(_dir, p, this.spawnPos, this.launchVel);
    this.arrows.launch(this.spawnPos, this.launchVel, { damageScale: this.profile.damageScale, onHitScale: this.damageMultiplier, ...(shot === 0 ? {} : { shot }) });
    this.state.bolts--;
    this.p = 0;
    this.releasePos.copy(this.handPos);
    this.recoil = 1;
    this.onFire?.(); this.chargeEvent('loose', p); this.onLoose?.(p); this.onArrowLoose(p, this.spawnPos, this.launchVel);
  }

  /** the arrow's start (on the aim line, just in front of the eye, where the nocked arrow's tip is) and velocity */
  private launchFrom(dir: THREE.Vector3, p: number, pos: THREE.Vector3, vel: THREE.Vector3): void {
    this.aimRay(pos, _fwd);
    pos.addScaledVector(dir, bowMuzzle(this.profile));
    vel.copy(dir).multiplyScalar(bowLaunchSpeed(this.profile, p)).add(this.carrierVelocity);
  }

  /** the aim is the CAMERA forward — the rider's head, not the horse / body */
  override aimRay(origin: THREE.Vector3, dir: THREE.Vector3): THREE.Vector3 { return super.aimRay(origin, dir); }

  /** Apply authored mounting data (draw, spread, rear shots and arc) without changing an unmounted profile.
   * Carrier velocity belongs to the saddle; external source and draw multipliers keep their own share. */
  setMount(m: { speed: number; yaw: number } | null): void {
    // the saddle's numbers: combat/bowLaw.ts (the Node simulation reads the same)
    const s = bowMount(this.profile, this.player.yaw, m);
    if (s === null) return;
    this.mountDraw = s.draw; this.mountSpread = s.spread; this.carrierVelocity.set(s.carrier.x, s.carrier.y, s.carrier.z);
    this.mountArc = s.arc; this.parthian = s.parthian; this.mounted = s.mounted;
  }
  carryMountState(previous: Bow<Style>): void {
    this.mountDraw = previous.mountDraw; this.mountSpread = previous.mountSpread;
    this.mountArc = previous.mountArc; this.parthian = previous.parthian; this.mounted = previous.mounted;
    this.carrierVelocity.copy(previous.carrierVelocity); this.extraSpreadDeg = previous.extraSpreadDeg;
    this.arcAllowed = previous.arcAllowed; this.wind = previous.wind;
  }
  /** the saddle's share (setMount) — kept apart from `drawSpeedScale` / `extraSpreadDeg` / `arcAllowed`, which other
   *  systems (the Golden Bow) set: the two multiply / add / AND */
  private mountDraw = 1; private mountSpread = 0; private mountArc = true;
  /** in the saddle: the horse's gallop sets `player.sprinting` (Mount.ts), which must not stop the draw — only running on foot does */
  private mounted = false;

  /** the bow's look: 'recurve' (horn and birch) or 'golden' (the Golden King's reward) — repaints the limbs + string */
  /** Stable native target identity, retained across held-variant replacement. */
  get targetSource():Targets|undefined{return this.targets;}
  setStyle(style: Style): void { this.style = style; this.bowMesh.repaint?.(style); }
  style: Style;
  /** the view is > 110° off the horse's heading (the HUD's REAR SHOT chip; a hit on a pursuer staggers — B7's `damageMultiplier`) */
  parthian = false;

  override addBolts(n: number): void { this.state.bolts = Math.min(this.profile.quiver, this.state.bolts + n); }
  override mirrorArrows(count: number): void { this.state.bolts = count; }
  override reload(): void { /* the draw is the reload */ }

  // ── per frame ──
  update(dt: number, t: number): void {
    const pl = this.player, cam = this.game.camera;
    // the camera's own matrices, not the viewmodel under it (the nock's world position below walks its own parents)
    cam.updateWorldMatrix(true, false);
    if (!this.enabled) { this.mouseDraw = false; this.mouseAds = false; }

    // ── the draw (bowDraw.ts): hold = draw, release at full = loose, early = let-down. The next draw may start while the
    //    hand is still coming up from the quiver (RN_EARLY of the re-nock left): the string comes back to meet the hand
    //    halfway, instead of the hand reaching all the way out to the braced string ──
    const held = this.mouseDraw || this.altHeld;
    // sprinting on foot lowers the bow; a gallop does not (horse archery): combat/bowLaw.ts
    const { running, blocked } = bowBlocked({ enabled: this.enabled, cancel: this.mouseCancel, bolts: this.state.bolts, sprinting: pl.sprinting, mounted: this.mounted, swimming: pl.swimming });
    if (!held) this.mouseCancel = false;
    const { ev, shot } = this.stepDraw(dt, held, blocked);
    if (ev === 'start') { this.chargeEvent('draw'); this.onDrawStart?.(); }
    else if (ev === 'full') { this.chargeEvent('draw', 1); this.onFullDraw?.(); }
    else if (ev === 'letdown' || ev === 'tired') { this.chargeEvent('letdown'); this.onLetDown?.(); }
    this.p = this.freezeDraw ?? this.draw.p;
    if (ev === 'loose') this.loose(shot);
    this.state.loaded = this.state.bolts > 0;
    this.state.reloading = false;
    this.state.reloadProgress = 1 - this.draw.renockT / RENOCK_TIME;

    // ── AIM (RMB / the AIM disc): the zoom down the arrow — a toggle, it never draws ──
    if (running || !this.enabled) this.mouseAds = false;
    // `state.ads` stays false: the HUD hides the crosshair on `ads` (the crossbow's iron sights replace it) — the bow has no
    // sight, the crosshair over the arrow IS the aim, so it stays up (and `aimed` / `aimOn` say AIM is on)
    this.aimOn = bowAimOn({ asked: this.mouseAds || this.adsHeld, enabled: this.enabled, running, swimming: pl.swimming });
    this.aimBlend += ((this.aimOn && this.model.visible ? 1 : 0) - this.aimBlend) * Math.min(1, dt * this.profile.aimIn);
    if (Math.abs(this.aimBlend - (this.aimOn ? 1 : 0)) < 0.002) this.aimBlend = this.aimOn ? 1 : 0;
    const aimK = sstep(0, 1, this.aimBlend);
    // the zoom now (1 … this.profile.aimZoom), in tan space: tan(half-FOV) ÷ zoom. The held weapon owns the FOV (Hor+ on portrait,
    // + the dodge kick); the cascades refit only on a base change
    const zoom = 1 + (this.profile.aimZoom - 1) * aimK;
    const baseFov = fovForAspect(THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(FOV_HIP) / 2) / zoom)), cam.aspect);
    const prevFov = this.fov;
    this.fov += (baseFov - this.fov) * Math.min(1, dt * 12);
    if (Math.abs(baseFov - this.fov) < 0.02) this.fov = baseFov;
    const fovNow = this.fov + pl.fovKick;
    if (this.model.visible && Math.abs(fovNow - cam.fov) > 0.01) { cam.fov = fovNow; cam.updateProjectionMatrix(); if (Math.abs(prevFov - this.fov) > 0.001 || Math.abs(fovNow - this.fov) < 0.01) this.sky.csm.updateFrustums(); }
    // the viewmodel keeps (nearly) its hip size while the world magnifies: stretching it along the view axis by the zoom
    // projects every vertex where the hip FOV put it (x / (z·k · tan/k)); this.profile.aimVmZoom < 1 lets it grow a touch (leaning in)
    this.model.scale.set(this.profile.vmScale, this.profile.vmScale, this.profile.vmScale * zoom ** this.profile.aimVmZoom);
    // the look slows with the zoom (mouse and touch read `lookMult`), so a zoomed turn crosses the screen at the hip rate
    if (this.profile.zoomLook) pl.zoomLook = this.model.visible ? 1 / zoom : 1;

    // ── aim sway on a long hold (applied to the view and taken back as it changes) ──
    let sy = 0, sp = 0;
    if (this.p > 0.3 && this.freezeDraw === null) {
      const over = this.draw.sway;
      const amp = (THREE.MathUtils.degToRad(0.06) + this.profile.swayMax * over * over) * (1 - (1 - this.profile.aimSway) * aimK) * this.p;
      sy = Math.sin(t * 1.3) * amp + Math.sin(t * 2.9 + 1) * amp * 0.35;
      sp = Math.sin(t * 1.7 + 0.5) * amp * 0.8 + Math.sin(t * 3.7) * amp * 0.25;
    }
    pl.yaw += sy - this.swayYaw; pl.pitch += sp - this.swayPitch; this.swayYaw = sy; this.swayPitch = sp;

    // ── the viewmodel ── PF6: a stowed bow (its model hidden) holds its springs, as a stowed held weapon holds its views,
    // and resumes from them when drawn; only the look it lags behind keeps up, so a turn made while stowed is no kick
    if (this.model.visible) this.poseViewmodel(dt, t);
    else { this.lastYaw = pl.yaw; this.lastPitch = pl.pitch; }

    // ── the drop arc ──
    const arcOn = this.arcAllowed && this.mountArc && (this.profile.arcMode === 'aim' ? this.aimOn : getSetting('huntersEye')) && this.p > this.profile.arcFrom && this.model.visible && this.holster < 0.01;
    if (arcOn) {
      this.aimRay(_v1, _fwd);
      this.launchFrom(_fwd, 1, _v2, _v3); // every loose is a full draw: the arc shows that path, fading in with the draw
      this.nocked.getWorldPosition(_dir);
      this.arc.show(this.arrows, _v2, _v3, _dir, sstep(this.profile.arcFrom, 0.85, this.p), _v1, this.game.renderer.getPixelRatio());
    } else this.arc.hide();

    // ── aim readout ──
    if (this.targets && (++this.aimFrame & 3) === 0) {
      this.aimRay(_v1, _fwd);
      const hit = this.targets.raycast(_v1, _fwd, 150);
      if (hit?.animal.alive) { this.aimCache.kind = hit.animal.kind; this.aimCache.distance = hit.distance; this.aimInfo = this.aimCache; }
      else this.aimInfo = null;
    }

    this.arrows.update(dt);
  }

  private poseViewmodel(dt: number, t: number): void {
    const pl = this.player, cam = this.game.camera;
    const port = cam.aspect < 1 ? Math.min(1, (1 - cam.aspect) * 1.6) : 0;
    // raised while drawing (and a beat after the loose so the follow-through reads)
    const raise = this.p > 0.01 || this.mouseDraw || this.altHeld || this.aimBlend > 0.01 || this.draw.renockT > 0;
    this.ready += ((raise ? 1 : 0) - this.ready) * Math.min(1, dt * (raise ? 9 : 4));
    const r = sstep(0, 1, this.ready);
    // the string: a spring onto the draw (under-damped: the release snaps past the brace and back)
    for (let rem = dt; rem > 0; rem -= 1 / 240) {
      const h = Math.min(rem, 1 / 240);
      this.visVel += (-(this.vis - this.p) * 1600 - this.visVel * 26) * h; this.vis += this.visVel * h;
    }
    if (this.freezeDraw !== null) { this.vis = this.freezeDraw; this.visVel = 0; }
    this.limbPose(this.vis);

    // the grip pose: rest ↔ drawn (portrait has its own pair)
    const R = this.profile.poses.rest, D = this.profile.poses.drawn, RP = this.profile.poses.restPort, DP = this.profile.poses.drawnPort;
    const g = this.gripPos, aim = _v1;
    g.lerpVectors(R.pos, RP.pos, port).lerp(_v2.lerpVectors(D.pos, DP.pos, port), r);
    aim.lerpVectors(R.aim, RP.aim, port).lerp(_v2.lerpVectors(D.aim, DP.aim, port), r);
    let cant = THREE.MathUtils.lerp(THREE.MathUtils.lerp(R.cant, RP.cant, port), THREE.MathUtils.lerp(D.cant, DP.cant, port), r);
    const pitch = THREE.MathUtils.lerp(THREE.MathUtils.lerp(R.pitch, RP.pitch, port), 0, r);
    // AIM: the raised pose comes to the eye — down the arrow (the zoom itself is update's)
    const ak = sstep(0, 1, this.aimBlend) * r;
    if (ak > 0) {
      const A = this.profile.poses.aim, AP = this.profile.poses.aimPort;
      g.lerp(_v2.lerpVectors(A.pos, AP.pos, port), ak);
      aim.lerp(_v2.lerpVectors(A.aim, AP.aim, port), ak);
      cant = THREE.MathUtils.lerp(cant, THREE.MathUtils.lerp(A.cant, AP.cant, port), ak);
    }
    // motion: breathing, walk bob (heavier at rest, little when aimed), look lag, the loose's follow-through
    const sf = pl.speedFactor * (1 - 0.6 * r) * (1 - 0.6 * ak);
    let dYaw = pl.yaw - this.lastYaw, dPitch = pl.pitch - this.lastPitch;
    this.lastYaw = pl.yaw; this.lastPitch = pl.pitch;
    if (Math.abs(dYaw) > 1) dYaw = 0; if (Math.abs(dPitch) > 1) dPitch = 0;
    this.lagYaw = THREE.MathUtils.clamp(this.lagYaw - dYaw * 0.5, -0.12, 0.12);
    this.lagPitch = THREE.MathUtils.clamp(this.lagPitch - dPitch * 0.5, -0.1, 0.1);
    for (let rem = dt; rem > 0; rem -= 1 / 120) {
      const h = Math.min(rem, 1 / 120);
      this.lagYawV += (-this.lagYaw * 200 - this.lagYawV * 20) * h; this.lagYaw += this.lagYawV * h;
      this.lagPitchV += (-this.lagPitch * 200 - this.lagPitchV * 20) * h; this.lagPitch += this.lagPitchV * h;
    }
    this.recoil *= Math.exp(-dt * 7);
    const lagK = (1 - 0.6 * r) * (1 - 0.7 * ak);
    g.x += Math.sin(t * 0.8) * 0.004 + Math.cos(pl.bobTime) * 0.02 * sf + this.lagYaw * 0.3 * lagK;
    g.y += Math.sin(t * 1.2) * 0.003 - Math.abs(Math.sin(pl.bobTime)) * 0.018 * sf + this.lagPitch * 0.25 * lagK;
    g.z -= this.recoil * 0.05; g.y -= this.recoil * 0.012;
    cant += Math.cos(pl.bobTime) * 0.03 * sf + this.recoil * 0.1;
    if (this.holster > 0) { const h = sstep(0, 1, this.holster); g.y -= h * 0.5; g.z += h * 0.1; cant -= h * 0.4; }
    // orientation: the bow's −Z at the aim point, rolled by the cant, pitched forward at rest
    _dir.subVectors(aim, g).normalize();
    this.gripQuat.setFromUnitVectors(NEG_Z, _dir)
      .multiply(_q1.setFromAxisAngle(POS_Z, cant))
      .multiply(_q2.setFromAxisAngle(_v3.set(1, 0, 0), pitch - this.recoil * 0.08 + this.lagPitch * 0.4 * lagK))
      .multiply(_q3.setFromAxisAngle(Y_AXIS, this.lagYaw * 0.5 * lagK));
    if (this.inspect > 0) { // dev: the grip up close, turned
      g.set(0.02, -0.02, this.profile.inspectZ);
      this.gripQuat.setFromAxisAngle(Y_AXIS, this.inspectYaw).multiply(_q1.setFromAxisAngle(_v3.set(1, 0, 0), this.inspectPitch));
    }
    this.bowPivot.position.copy(g); this.bowPivot.quaternion.copy(this.gripQuat);

    // ── the right hand: on the string while drawing; after a loose it follows through, drops to the quiver and comes
    //    back up with the next arrow, which it lays on the string (the draw only starts once it is there) ──
    const nock = _v2.copy(this.bowMesh.nock).applyQuaternion(this.gripQuat).add(g);
    const H = this.handPos;
    let arrowInHand = this.state.bolts > 0;
    if (this.draw.renockT > 0) {
      const u = 1 - this.draw.renockT / RENOCK_TIME;
      const follow = _v3.copy(this.releasePos).add(FOLLOW_OFF);
      if (u < RN_FOLLOW) H.lerpVectors(this.releasePos, follow, sstep(0, 1, u / RN_FOLLOW));
      else if (u < RN_DROP) { const k = (u - RN_FOLLOW) / (RN_DROP - RN_FOLLOW); H.copy(follow).lerp(_v1.copy(this.releasePos).add(QUIVER_OFF), k * k); }
      else { const k = (u - RN_DROP) / (1 - RN_DROP); H.copy(this.releasePos).add(QUIVER_OFF).lerp(nock, 1 - (1 - k) ** 3); }
      arrowInHand &&= u >= RN_DROP;
    } else H.copy(nock);
    const raised = r > 0.25 && (!this.profile.inspectHidesArms || this.inspect === 0);
    this.rHand.visible = raised; this.rSleeve.visible = raised;
    this.rHand.quaternion.copy(this.gripQuat).multiply(this.roll);
    this.rHand.position.copy(this.rHook).applyQuaternion(this.rHand.quaternion).negate().add(H);
    this.rHand.position.addScaledVector(_v3.set(0, 1, 0).applyQuaternion(this.gripQuat), -HOOK_BELOW_NOCK);
    if (!this.profile.inspectHidesArms && this.inspect === 2) { // dev: the drawing hand alone, up close, turned
      this.bowPivot.position.y = -5;
      this.rHand.quaternion.setFromAxisAngle(Y_AXIS, this.inspectYaw).multiply(_q1.setFromAxisAngle(_v3.set(1, 0, 0), this.inspectPitch)).multiply(this.roll);
      this.rHand.position.set(0, -0.06, -0.38);
    }
    // the arrow: from the hand's nock point to the rest on the left thumb (it swings in as the hand comes up)
    this.nocked.visible = raised && arrowInHand;
    const rest = _v1.set(this.profile.arrowX, this.profile.arrowY, 0).applyQuaternion(this.gripQuat).add(g);
    _dir.subVectors(rest, H).normalize();
    this.nocked.quaternion.setFromUnitVectors(NEG_Z, _dir);
    this.nocked.position.copy(H).addScaledVector(_dir, this.profile.arrowLength);
    // ── the forearms: each sleeve from its glove's wrist; the left heads for a fixed elbow (the bow arm is straight),
    //    the right keeps its heading (the elbow travels with the hand) ──
    const lw = _v1.copy(this.lWrist).applyQuaternion(this.gripQuat).add(g);
    const ld = _v3.lerpVectors(L_ELBOW, L_ELBOW_PORT, port).sub(lw).normalize();
    placeArm(this.lSleeve, lw.addScaledVector(ld, -0.02), ld);
    if (this.profile.inspectHidesArms) this.lSleeve.visible = this.inspect === 0;
    const rw = _v1.copy(this.rWrist).applyQuaternion(this.rHand.quaternion).add(this.rHand.position);
    // the sleeve continues the glove's own forearm line, pulled toward down-right so it leaves the frame at the corner
    _rDir.copy(this.rWristDir).applyQuaternion(this.rHand.quaternion);
    const rd = _v3.lerpVectors(R_ARM_DIR, R_ARM_DIR_PORT, port).lerp(_rDir, 0.5).normalize();
    placeArm(this.rSleeve, rw.addScaledVector(rd, -0.02), rd);
  }

  protected onArrowLoose(_power: number, _origin: THREE.Vector3, _vel: THREE.Vector3): void { /* custom bow hook */ }
  protected onArrowHit(_hit: TargetHit): void { /* custom bow hook */ }
  protected limbPose(draw: number): void { this.bowMesh.shape(Math.max(0, draw), draw); }
  displayModel(): THREE.Group {
    const g = new THREE.Group(), m = new THREE.Mesh(this.bowMesh.geometry.clone(), this.mat);
    m.castShadow = true; m.receiveShadow = true; g.add(m); return g;
  }
  /** dev: arrows stuck in the world */
  get stuckCount(): number { return this.arrows.stuckCount; }
}
