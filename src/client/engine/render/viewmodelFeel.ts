import { Vector2, Vector3, DynamicDrawUsage, InstancedInterleavedBuffer, InterleavedBufferAttribute, Color, Group, Mesh, MeshBasicMaterial, PlaneGeometry, AdditiveBlending, DoubleSide, Quaternion, PointLight, type BufferGeometry, type Material, type Object3D, type Scene, type WebGLRenderer, type PerspectiveCamera } from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { worldHit, Puffs } from '../combat/view/ranged';
import { LightPool } from '../fx/LightPool';
import { brassRoster, ejectBrass, stepBrass, type BrassCase, type BrassEjectionRow } from '../combat/view/brass';
import { ads } from '../../../shared/engine/combat/blocks/ads';
import { fovForAspect } from '../../../shared/engine/combat/blocks/melee';
import { worldTime } from '../../../shared/engine/core/time';
import { makeFlashTexture } from '../combat/view/firearmFx';
import { weaponActionGate } from '../input/weaponActions';
import type { InputService } from '../input/InputService';
import type { Scope } from '../../../shared/engine/app/scope';
import type { Weapon } from '../../../shared/engine/combat/Weapon';
import { hitscan, type HitscanProfile } from '../combat/view/hitscan';
import { getSetting } from '../ui/Settings';
import type { Targets } from '../combat/types';
import { SlashTrail, type FollowPointTrail, type FollowTrailProfile } from '../combat/view/slashTrail';

/** Drawing-buffer port used by viewmodel effects without exposing a renderer backend. */
export type DrawingBuffer = Pick<WebGLRenderer, 'getDrawingBufferSize' | 'domElement' | 'getPixelRatio'>;
export interface LookSpring { yaw: number; pitch: number; yawVelocity: number; pitchVelocity: number }
export interface LookLag { gain: number; clampYaw: number; clampPitch: number; k: number; c: number }
export function viewmodel(lag: LookLag): { step: (state: LookSpring, delta: Vector2, dt: number, timeScale?: number) => void; dispose: () => void } {
  return { step: (state, delta, dt, timeScale = worldTime.scale) => {
    state.yaw = Math.max(-lag.clampYaw, Math.min(lag.clampYaw, state.yaw - delta.x * lag.gain));
    state.pitch = Math.max(-lag.clampPitch, Math.min(lag.clampPitch, state.pitch - delta.y * lag.gain));
    let remaining = dt * timeScale;
    for (let substep = 0; substep < 4096; substep++) {
      if (!(remaining > 0)) break;
      const h = Math.min(remaining, 1 / 120);
      state.yawVelocity += (-state.yaw * lag.k - state.yawVelocity * lag.c) * h; state.yaw += state.yawVelocity * h;
      state.pitchVelocity += (-state.pitch * lag.k - state.pitchVelocity * lag.c) * h; state.pitch += state.pitchVelocity * h;
      remaining -= 1 / 120;
    }
    if (remaining > 0) throw new RangeError('View spring step exceeds its bounded clock');
  }, dispose: () => undefined };
}

/** A declared straight shot or sampled flight trail; marker geometry belongs to the caller. */
export interface RangedTraceRow {
  readonly mode: 'segment' | 'trail'; readonly points: number; readonly width: number;
  readonly color: readonly [number, number, number]; readonly order: number;
  readonly lifetime: number; readonly fade: number; readonly markerScale: number;
  /** Optional data-selected point profile; screen-space drawing is unchanged. */
  readonly follow?: Omit<FollowTrailProfile, 'points'>;
}
export interface RangedTraceMarker { readonly group: Group; readonly ring: Mesh; readonly material: MeshBasicMaterial }
/** Owns the existing line buffers and expiry clock, borrowing optional impact-marker ports.
 * No pool or world is retained; callers keep their original roster and source time.
 */
export class RangedTrace {
  readonly line: LineSegments2; readonly mat: LineMaterial;
  private readonly geo: LineSegmentsGeometry;
  private readonly buf: Float32Array;
  private readonly ibuf: InstancedInterleavedBuffer | null;
  private readonly follow: FollowPointTrail | null;
  private readonly row: RangedTraceRow;
  private readonly mark: RangedTraceMarker | undefined;
  n = 0; active = false; endTime = -1; t0 = -1;
  /** Allocate only the declared roster, under the same bounded runtime cap. */
  static roster(scene: Scene, row: RangedTraceRow, count: number, marker?: () => RangedTraceMarker): RangedTrace[] {
    if (!Number.isInteger(count) || count < 1 || count > 128) throw new RangeError('Invalid ranged trace roster');
    const result: RangedTrace[] = [];
    for (let i = 0; i < 128; i++) {
      if (i >= count) break;
      result.push(new RangedTrace(scene, row, marker?.()));
    }
    return result;
  }
  constructor(scene: Scene, row: RangedTraceRow, marker?: RangedTraceMarker) {
    if (!Number.isInteger(row.points) || row.points < 2 || row.points > 2048
      || ![row.width, row.order, row.lifetime, row.fade, row.markerScale, ...row.color].every(Number.isFinite)
      || row.width <= 0 || row.lifetime <= 0 || row.fade <= 0
      || (row.mode === 'segment' && row.points !== 2)
      || (row.mode === 'trail' && marker === undefined)) throw new RangeError('Invalid ranged trace row');
    this.row = row; this.mark = marker;
    this.buf = new Float32Array((row.points - 1) * 6);
    this.geo = new LineSegmentsGeometry(); this.geo.setPositions(this.buf);
    if (row.mode === 'trail' && (row.follow === undefined || row.follow.every !== null)) throw new RangeError('Projected trails require an append profile');
    this.follow = row.follow === undefined ? null : SlashTrail.follow({ ...row.follow, points: row.points });
    if (row.mode === 'trail') {
      const attribute = this.geo.getAttribute('instanceStart');
      if (!(attribute instanceof InterleavedBufferAttribute) || !(attribute.data instanceof InstancedInterleavedBuffer)) throw new Error('Trace geometry has no segment buffer');
      this.ibuf = attribute.data; this.ibuf.setUsage(DynamicDrawUsage); this.geo.instanceCount = 0;
    } else this.ibuf = null;
    this.mat = new LineMaterial({ linewidth: row.width, transparent: true, opacity: 1, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
    this.mat.color = new Color(...row.color);
    this.line = new LineSegments2(this.geo, this.mat);
    this.line.frustumCulled = false; this.line.renderOrder = row.order; this.line.visible = false;
    scene.add(this.line);
    if (marker) { marker.group.visible = false; scene.add(marker.group); }
  }
  /** A fresh flight uses the existing allocation; impact ends it on the caller's source clock. */
  begin(point: Vector3): void {
    this.n = 0; this.geo.instanceCount = 0; this.active = true; this.endTime = -1;
    this.follow?.reset();
    this.mat.opacity = 1; if (this.mark) { this.mark.material.opacity = 1; this.mark.group.visible = false; }
    this.line.visible = false; this.addPoint(point);
  }
  addPoint(point: Vector3): void {
    const follow = this.follow, buffer = this.ibuf;
    if (follow === null || buffer === null || !follow.follow(point, true, 0)) return;
    if (this.n > 0) {
      const last = follow.previous;
      const offset = (this.n - 1) * 6, b = this.buf;
      b[offset] = last.x; b[offset + 1] = last.y; b[offset + 2] = last.z;
      b[offset + 3] = point.x; b[offset + 4] = point.y; b[offset + 5] = point.z;
      buffer.addUpdateRange(offset, 6); buffer.needsUpdate = true;
      this.geo.instanceCount = this.n; this.line.visible = true;
    }
    this.n = follow.count;
  }
  finish(point: Vector3, time: number): void {
    this.addPoint(point);
    if (this.mark) { this.mark.group.position.copy(point); this.mark.group.visible = true; }
    this.endTime = time + this.row.lifetime;
  }
  /** The straight-shot path preserves its original positions upload and immediate opacity reset. */
  show(from: Vector3, to: Vector3, time: number): void {
    this.buf[0] = from.x; this.buf[1] = from.y; this.buf[2] = from.z;
    this.buf[3] = to.x; this.buf[4] = to.y; this.buf[5] = to.z;
    this.geo.setPositions(this.buf); this.mat.opacity = 1; this.line.visible = true; this.t0 = time;
  }
  /** Published at the old after-pose phase; segment users may retain their existing live life knob. */
  publish(time: number, camera: PerspectiveCamera, resolution: Vector2, life: number = this.row.lifetime): void {
    if (this.row.mode === 'segment') {
      if (this.t0 < 0) return;
      this.mat.resolution.copy(resolution);
      const alpha = 1 - (time - this.t0) / life;
      if (alpha <= 0) { this.t0 = -1; this.line.visible = false; return; }
      this.mat.opacity = alpha; return;
    }
    if (!this.active) return;
    this.mat.resolution.copy(resolution);
    if (this.endTime < 0) return;
    const remaining = this.endTime - time;
    if (remaining <= 0) { this.active = false; this.line.visible = false; if (this.mark) this.mark.group.visible = false; return; }
    const alpha = Math.min(1, remaining / this.row.fade); this.mat.opacity = alpha;
    if (this.mark) {
      this.mark.material.opacity = alpha; this.mark.ring.quaternion.copy(camera.quaternion);
      this.mark.group.scale.setScalar(Math.max(1, this.row.markerScale * this.mark.group.position.distanceTo(camera.position)));
    }
  }
}


/** Coefficients for a camera-held ranged view; the action/reload/contact owner stays with the weapon. */
export interface RangedFrameRow {
  readonly clock: 'frame' | 'world';
  readonly fovWhen: 'always' | 'active';
  readonly recoil: { readonly decay: number; readonly attack: number; readonly recovery: number };
  readonly lag: LookLag;
  readonly clampAfter: boolean;
  readonly readout: { readonly range: number; readonly mask: number; readonly held: boolean; readonly posed: boolean };
}
interface RangedHeading { readonly yaw: number; pitch: number; readonly sprinting: boolean }
interface RangedControls {
  readonly enabled: boolean; readonly active: boolean; readonly held: boolean; readonly reloading: boolean;
  readonly adsDuration: number; readonly kick: number;
}
interface RangedCamera { readonly aspect: number; fov: number; updateProjectionMatrix: () => void }
/** One owner for ADS, camera recoil recovery and heading lag. It never advances reloads or contacts.
 * Coefficients and clock are explicit; camera/player ports are borrowed, without retaining a world or renderer.
 */
export class RangedFrame {
  mouseAds = false;
  adsBlend = 0;
  recoil = 0;
  readonly lag: LookSpring = { yaw: 0, pitch: 0, yawVelocity: 0, pitchVelocity: 0 };
  private readonly vm: ReturnType<typeof viewmodel>;
  private readonly delta = new Vector2();
  private readonly resolution = new Vector2();
  private lastYaw: number;
  private lastPitch: number;
  private kickPending = 0;
  private kickApplied = 0;
  private fov: number;
  private readonly row: RangedFrameRow;
  private readonly hipFov: number;
  private readonly adsFov: number;
  private aimFrame = 0;
  private readonly aimCache = { kind: '', distance: 0 };
  constructor(row: RangedFrameRow, heading: RangedHeading, hipFov: number, adsFov: number) {
    const coefficients = [row.recoil.decay, row.recoil.attack, row.recoil.recovery,
      row.lag.gain, row.lag.clampYaw, row.lag.clampPitch, row.lag.k, row.lag.c, hipFov, adsFov];
    if (!['frame', 'world'].includes(row.clock) || !['always', 'active'].includes(row.fovWhen)
      || coefficients.some(value => !Number.isFinite(value) || value < 0 || value > 10000)) throw new RangeError('Invalid ranged frame coefficients');
    this.row = row; this.hipFov = hipFov; this.adsFov = adsFov;
    this.vm = viewmodel(row.lag); this.lastYaw = heading.yaw; this.lastPitch = heading.pitch; this.fov = hipFov;
  }
  /** The original recoil impulse is claimed at the weapon's shot phase. */
  shot(kick: number): void { this.recoil = 1; this.kickPending = kick; }
  /** Original scope/context/lock refusal and input order; reset only drops the mouse ADS latch. */
  bindInputs(input: InputService, scope: Scope, weapon: Weapon & { allowUnlocked: boolean }, player: { locked: boolean }): void {
    const allowed = weaponActionGate(weapon, player);
    input.bind('attack', () => { weapon.tryFire(); }, scope, allowed);
    input.bind('aim', () => { this.mouseAds = !this.mouseAds; }, scope, allowed);
    input.bind('reload', () => { weapon.reload(); }, scope, allowed);
    input.onReset(() => { this.mouseAds = false; }, scope);
  }
  /** Cadence-limited animal readout, capped by the first world surface, using borrowed scratch vectors. */
  scanAim(weapon: Weapon, targets: Targets | undefined, active: boolean, origin: Vector3, direction: Vector3, end: Vector3, model: Object3D): void {
    const row = this.row.readout;
    if ((row.held && !active) || !targets || (++this.aimFrame & row.mask) !== 0) return;
    if (row.posed) model.updateMatrixWorld();
    weapon.aimRay(origin, direction);
    const wall = worldHit(origin, end.copy(origin).addScaledVector(direction, row.range), 0);
    const hit = targets.raycast(origin, direction, wall?.distance ?? row.range);
    if (hit?.animal.alive) { this.aimCache.kind = hit.animal.kind; this.aimCache.distance = hit.distance; weapon.aimInfo = this.aimCache; }
    else weapon.aimInfo = null;
  }
  /** Resolve the existing hit law, then publish callbacks and borrowed effects in shot order. */
  publishHitscan(weapon: Weapon, targets: Targets | undefined, profile: HitscanProfile, bloom: number, speedFactor: number,
    model: Object3D, muzzle: readonly [number, number, number], time: number, tracers: readonly RangedTrace[], puffs: Puffs,
    directionScratch: Vector3, pointScratch: Vector3): void {
    if (tracers.length === 0 || tracers.length > 128) throw new RangeError('Invalid hitscan trace roster');
    // off the wire the blow is the server's to settle: this shot draws only its trace, to the wall
    const {point, direction, surface, hit, killed} = hitscan((origin, dir) => weapon.aimRay(origin, dir), weapon.wire === null ? targets : undefined, profile, this.adsBlend, bloom, speedFactor, world => weapon.shotDraws(world));
    weapon.wire?.press(true);
    if (hit) weapon.onHit?.(hit.animal.kind, hit.headshot, killed);
    directionScratch.copy(direction);
    if (getSetting('tracers')) {
      const first = tracers[0]; if (first === undefined) throw new Error('Missing hitscan trace');
      const trace = tracers.reduce((oldest, next) => next.t0 < oldest.t0 ? next : oldest, first);
      model.updateMatrixWorld(); model.localToWorld(pointScratch.set(...muzzle)); trace.show(pointScratch, point, time);
    }
    if (surface) { puffs.emit(point, directionScratch, surface); weapon.onImpact?.(surface, point); }
  }
  /** Returns the published ADS state, after the action/flash phases and before the held pose. */
  sampleFrame(dt: number, heading: RangedHeading, controls: RangedControls, camera: RangedCamera,
    frustums: { updateFrustums: () => void }): boolean {
    const h = dt * (this.row.clock === 'world' ? worldTime.scale : 1), row = this.row;
    if (heading.sprinting || !controls.enabled) this.mouseAds = false;
    const aimed = (this.mouseAds || controls.held) && controls.enabled && !controls.reloading && !heading.sprinting;
    this.adsBlend = ads(this.adsBlend, aimed, h, controls.adsDuration);
    const a = this.adsBlend * this.adsBlend * (3 - 2 * this.adsBlend);
    const targetFov = fovForAspect(this.hipFov + (this.adsFov - this.hipFov) * a, camera.aspect);
    if ((row.fovWhen === 'always' || controls.active) && Math.abs(targetFov - this.fov) > .01) {
      this.fov = targetFov; camera.fov = this.fov; camera.updateProjectionMatrix(); frustums.updateFrustums();
    }
    this.recoil *= Math.exp(-h * row.recoil.decay);
    if (this.kickPending > 0) {
      const kick = Math.min(this.kickPending, controls.kick * h * row.recoil.attack);
      heading.pitch += kick; this.kickApplied += kick; this.kickPending -= kick;
    } else if (this.kickApplied > 0) {
      const recovery = this.kickApplied * Math.min(1, h * row.recoil.recovery);
      heading.pitch -= recovery; this.kickApplied -= recovery;
    }
    let yaw = heading.yaw - this.lastYaw, pitch = heading.pitch - this.lastPitch;
    this.lastYaw = heading.yaw; this.lastPitch = heading.pitch;
    if (Math.abs(yaw) > 1) yaw = 0; if (Math.abs(pitch) > 1) pitch = 0;
    this.vm.step(this.lag, this.delta.set(yaw, pitch), h, 1);
    if (row.clampAfter) {
      this.lag.yaw = Math.max(-row.lag.clampYaw, Math.min(row.lag.clampYaw, this.lag.yaw));
      this.lag.pitch = Math.max(-row.lag.clampPitch, Math.min(row.lag.clampPitch, this.lag.pitch));
    }
    return aimed;
  }
  /** Effects publish after the pose/contact phases. Paint ports keep their own tracer style and clocks. */
  presentEffects<T>(dt: number, time: number, renderer: Parameters<Puffs['update']>[1], camera: PerspectiveCamera,
    puffs: Puffs, tracers: readonly T[], paint: (tracer: T, time: number, camera: PerspectiveCamera, resolution: Vector2) => void): void {
    if (tracers.length > 128) throw new RangeError('Ranged tracer roster exceeds its bound');
    puffs.update(dt, renderer, camera); renderer.getDrawingBufferSize(this.resolution);
    for (let i = 0; i < 128; i++) {
      const tracer = tracers[i]; if (tracer === undefined) break;
      paint(tracer, time, camera, this.resolution);
    }
  }

}

/** Authored flash transforms, borrowing the existing muzzle, light and live flash profile. */
export interface RangedFlashShape {
  readonly size?: number; readonly y: number; readonly z: number; readonly secondaryZ: number;
  readonly secondaryScale: readonly [number, number, number]; readonly lightY: number; readonly lightZ: number;
}
interface RangedFlashProfile { readonly frames: number; readonly lightTime: number; readonly light: number; readonly size?: number }
/** One build/fire/fade owner for the original two quads and borrowed pooled light. */
export class RangedFlash {
  readonly group: Group = new Group(); readonly quads: Mesh[] = [];
  private frames = 0; private lightTime = 0;
  private readonly profile: RangedFlashProfile; private readonly shape: RangedFlashShape;
  private readonly muzzle: { readonly muzzleZ: number }; readonly light: PointLight;
  constructor(profile: RangedFlashProfile, shape: RangedFlashShape, muzzle: { readonly muzzleZ: number }, light: PointLight) {
    this.profile = profile; this.shape = shape; this.muzzle = muzzle; this.light = light;
  }
  build(model: Object3D): MeshBasicMaterial {
    const size = this.shape.size ?? this.profile.size;
    if (size === undefined) throw new Error('Muzzle flash requires a declared size');
    const material = new MeshBasicMaterial({ map: makeFlashTexture(), blending: AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false, fog: false, side: DoubleSide });
    const geometry = new PlaneGeometry(size, size), first = new Mesh(geometry, material), second = new Mesh(geometry, material);
    second.rotation.y = Math.PI / 2; second.position.z = this.shape.secondaryZ; second.scale.set(...this.shape.secondaryScale);
    this.quads.push(first, second); this.group.add(first, second);
    this.group.position.set(0, this.shape.y, this.muzzle.muzzleZ + this.shape.z); this.group.visible = false;
    model.add(this.group); return material;
  }
  fire(model: Object3D, random: { next: () => number }): void {
    this.frames = this.profile.frames; this.lightTime = this.profile.lightTime;
    for (let i = 0; i < 2; i++) {
      const quad = this.quads[i]; if (quad === undefined) throw new Error('Muzzle flash has not been built');
      quad.rotation.z = random.next() * Math.PI * 2; quad.scale.setScalar(.8 + random.next() * .5);
    }
    this.group.visible = true; this.light.intensity = this.profile.light; this.place(model);
  }
  advance(dt: number, model: Object3D): void {
    if (this.frames > 0 && --this.frames === 0) this.group.visible = false;
    if (this.lightTime > 0) {
      this.lightTime -= dt;
      this.light.intensity = this.lightTime <= 0 ? 0 : this.profile.light * Math.max(0, Math.min(1, this.lightTime / this.profile.lightTime));
      this.place(model);
    }
  }
  private place(model: Object3D): void {
    model.updateWorldMatrix(true, false);
    model.localToWorld(this.light.position.set(0, this.shape.lightY, this.muzzle.muzzleZ + this.shape.lightZ));
  }
}

/** Declared effect allocations; all live flash/brass values remain borrowed. */
export interface HitscanPresentationRow {
  readonly flash: { readonly profile: RangedFlashProfile; readonly shape: RangedFlashShape; readonly colour: number };
  readonly muzzle: { readonly muzzleZ: number };
  readonly brass: { readonly profile: { readonly count: number; readonly life: number }; readonly port: readonly [number, number, number]; readonly ejection: BrassEjectionRow };
  readonly tracer: { readonly count: number; readonly row: RangedTraceRow };
  readonly hitMuzzle: readonly [number, number, number];
}
/** Composes the existing flash, cases, traces and impact puffs without advancing an action.
 * Geometry/materials and the held model/camera are borrowed. Call each phase at its
 * original weapon boundary: build flash, prepare rosters, attach puffs, then fire,
 * hit/eject and after-pose publication. No reload, damage or random stream is owned.
 */
export class HitscanPresentation {
  readonly flash: RangedFlash;
  readonly puffs: Puffs = new Puffs();
  private cases: BrassCase[] = [];
  private traces: RangedTrace[] = [];
  private readonly port: Vector3;
  private readonly hitMuzzle: [number, number, number];
  private readonly a = new Vector3(); private readonly b = new Vector3(); private readonly c = new Vector3();
  private readonly rotation = new Quaternion();
  private life = 1;
  private readonly paint = (trace: RangedTrace, time: number, camera: PerspectiveCamera, resolution: Vector2): void => { trace.publish(time, camera, resolution, this.life); };
  private readonly frame: RangedFrame; private readonly scene: Scene; private readonly model: Object3D;
  private readonly camera: PerspectiveCamera; private readonly row: HitscanPresentationRow;
  constructor(frame: RangedFrame, scene: Scene, model: Object3D,
    camera: PerspectiveCamera, row: HitscanPresentationRow, muzzleLight = true) {
    this.frame = frame; this.scene = scene; this.model = model; this.camera = camera; this.row = row;
    const light = muzzleLight ? LightPool.for(scene).acquire(row.flash.colour, 0, 8, 2) : new PointLight(row.flash.colour, 0, 8, 2);
    this.flash = new RangedFlash(row.flash.profile, row.flash.shape, row.muzzle, light);
    this.port = new Vector3(...row.brass.port); this.hitMuzzle = [...row.hitMuzzle];
  }
  /** Allocate the same bounded rosters once, retaining the original borrowed backing. */
  prepare(geometry: BufferGeometry, material: Material): void {
    if (this.cases.length > 0 || this.traces.length > 0) throw new Error('Hitscan effects already prepared');
    this.cases = brassRoster(this.scene, geometry, material, this.row.brass.profile.count);
    this.traces = RangedTrace.roster(this.scene, this.row.tracer.row, this.row.tracer.count);
  }
  /** Attach at the original scene insertion phase, after mounting the held model. */
  mount(): void { this.scene.add(this.puffs.points); }
  hit(weapon: Weapon, targets: Targets | undefined, profile: HitscanProfile, bloom: number, speedFactor: number, time: number): void {
    this.hitMuzzle[2] = this.row.muzzle.muzzleZ;
    this.frame.publishHitscan(weapon, targets, profile, bloom, speedFactor, this.model, this.hitMuzzle, time, this.traces, this.puffs, this.a, this.b);
  }
  eject(): void {
    ejectBrass(this.cases, this.row.brass.ejection, this.model, this.camera, this.port, this.row.brass.profile.life, this.a, this.b, this.c, this.rotation);
  }
  /** Preserve case integration before puff/trace publication and the caller's source time. */
  publish(dt: number, time: number, renderer: Parameters<Puffs['update']>[1], tracerLife: number): void {
    this.life = tracerLife; stepBrass(this.cases, dt);
    this.frame.presentEffects(dt, time, renderer, this.camera, this.puffs, this.traces, this.paint);
  }
}
