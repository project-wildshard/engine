import { createClientChannelView, moverChannelValues, type ClientGeometryKernels } from './clientChannelView';
import { bindPageQuest, type RuntimeQuestPorts } from '../../../shared/game/quest/pageState';
import { bindPagePersistence, bindPageBossRecord, type PagePersistenceRows, type PagePersistence } from '../../../shared/game/quest/pagePersistence';
import { lightEmitterPresentation } from '../shardfile/lightEmitters';
import { residentWorldScope } from '../shardfile/hybridPresentation';
import { readBorrowedOwner, type BorrowedOwnerPath } from '../../../shared/game/plugin/borrowed';
import { createClientChannels, type ClientChannelObservation, type ClientChannelFrame } from '../../../shared/game/plugin/channels';
import type { World } from '@wildshard/engine/core/bootstrap';
import { installFollowedMovers, type FollowedMovers, type MoverView } from './followedMovers';
import { BossRowBar } from '../boss/barFeed';
import { easeField } from '@wildshard/engine/world/easedFields';
import { wirePage } from '../shardfile/wirePage';
import { liftPrompt } from '../../../shared/game/shardfile/wirePrompts';
import { WorldTargetHost, type WorldTargetLanding } from '../../../shared/game/shardfile/worldTargets';
import { outputDescriptor } from '../../../shared/game/shardfile/outputDescriptor';
import { parseWorldTargets, type WorldTargets } from '@wildshard/format/worldTargets';
import "../quest/presentation.css";
import { parseClientChannels, type ClientChannelProgram } from '@wildshard/format/clientChannels';
import { AdditiveBlending, type InstancedMesh, Euler, PerspectiveCamera, Quaternion, Scene, ShaderMaterial, Vector3, type Object3D, Group, type BufferGeometry, type Texture, type Material } from 'three';
import type { WorldRegistry } from '@wildshard/engine/world/registry';
import type { Scope } from '@wildshard/engine/app/scope';
import { ParticlePool, pointScale } from '@wildshard/engine/fx/ParticlePool';
import { CLIENT_SCRIPT_LIMITS, type ClientScriptFrame } from '@wildshard/engine/script/client';
import type { SystemSpec } from '@wildshard/engine/app/systems';
import { practiceRoom } from '@wildshard/engine/core/practiceRoom';
import type { Events } from '@wildshard/engine/events/events';
import type { HudVerbs, LevelContext } from '@wildshard/engine/level/context';
import type { MapPoi, MapQuest } from '@wildshard/engine/ui/Map';
import type { MapMark } from '@wildshard/engine/ui/Minimap';
import { Flags, test as testFlags } from '@wildshard/engine/world/interact/flags';
import type { BoxSpec } from '@wildshard/engine/physics/box';
import { boxInFrame } from '@wildshard/engine/physics/boxFrame';
import type { MoverPose } from '@wildshard/engine/physics/mover';
import type { Place, QuestPlace, Interactable } from '@wildshard/engine/world/interact/types';
import { questMessageHandlers, type QuestMessageRows, QuestState, type QuestDef, type QuestStep, type NpcDef } from '@wildshard/engine/quest/core';
import type { QuestView } from '@wildshard/engine/quest/viewPort';
import { QuestChip, NpcTalk, type LiveMarker, type NpcTalkOpts } from '@wildshard/engine/quest/view';
import {placesWithDiscovery,type PlacePoint,type Places} from '@wildshard/engine/quest/discovery';
import { DialogueBox } from '@wildshard/engine/quest/view/ui';
import { InteractionRules } from '../../../shared/game/quest/interactionRows';
import { parseQuestPageInteractions, type QuestPageInteractionsData } from '@wildshard/format/questInteractions';
import { QuestRewardBeat, type QuestRewardSpec, type QuestRewardPlayer } from '../quest/reward';
import { createLevelInstallation } from '@wildshard/engine/level/installation';
import type { ShardContext } from './context';
import type { BossDefinition, BossSaved, BossScript } from '@wildshard/engine/ai/BossBrain';
import type { Animal } from '@wildshard/engine/entities/AnimalView';
import { BossBar } from '@wildshard/engine/ui/BossBar';
import { app } from '@wildshard/engine/app/runtime';
import { CoinMotion } from '../loot/CoinMotion';
import { DirectorBossBrain, bindDirectorActions, type DirectorActionBinding, type BoundDirectorActions } from '../../../shared/game/plugin/director';
import { bindRuntimeCoins, type RuntimeBoss, type RuntimeCoins } from '../../../shared/game/plugin/runtimeRows';
import type { BossViewRows } from '../../../server/game/shardfile/bossRow';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { npcDef, type NpcRow } from '../../../shared/game/plugin/quests';
import { installPivotNpc, pivotNpcParts, type PivotNpcGeometry, type PivotNpcLevel, type PivotNpcPorts } from './geometry';
import { parseQuestNpcBinding, type QuestNpcTalkBinding } from '@wildshard/format/npcs';
import { parseBossProfile, parseMarkedBossPresentation, type MarkedBossPresentation } from '@wildshard/format/bossProfiles';
import { bodyBossFight, type HeldBossBrain } from '../../../shared/game/plugin/bodyBoss';
import { bossStorm } from './bossStorm';
import { enterMovers } from './moverViews';
import { installEnteredRuntimeAttachment, installEnteredRuntimeObserver, installEnteredRuntimeService, retainsRuntimeServices } from '../shard/retainedHooks';



/**
 * The client-script view adapter (SHARD-PLATFORM SF25, the render side; G66 "frozen, but alive-looking"). sp-x5's
 * `ClientScriptLane` runs presentation-only AssemblyScript and hands back detached frames (`offset`, `rotation`,
 * `scale`, particle requests); this adapter is the only thing that turns them into pixels:
 *
 * - **pose on top of the pose**: each frame, after the views have written their own pose (a creature view's sim sync,
 *   a placed panel), `apply` composes the script's offset (in the target's own frame), rotation and scale on top of it;
 *   `restore` puts the exact base back before the next sim sync, so a live entity's sim pose is never replaced and a
 *   static one never drifts. A frame is eased in over a few render frames (the lane ticks at 60 / divisor Hz).
 * - **particles**: every emitter's requests spawn into one pooled `THREE.Points` draw (the engine's `ParticlePool`),
 *   sized to the declared live limits (never above the lane's global ceiling), so the cost is one draw whatever the count.
 *   Their look (colour, size, velocity, gravity) is the emitter's numeric recipe; lifetimes are the lane's.
 * - **scope-owned**: disposal restores every base pose and frees the pool's geometry and material.
 *
 * The adapter never reads or writes a simulation: it sees the lane's copies and the view objects only.
 */





/** Keep authored quest state resident, but recreate modal input and cancel timers at every home exit. */
export class QuestViews {
  private readonly retained: boolean;
  private readonly resident: Scope;
  private entered: Scope | undefined;
  private readonly names = new Set<string>();
  constructor(private readonly context: ShardContext) {
    if (context.scope.disposed) throw new Error('Quest views need a live scope');
    this.retained = retainsRuntimeServices(context);
    this.resident = context.scope;
    this.entered = this.resident;
    if (this.retained) installEnteredRuntimeService(context, (scope) => {
      this.entered = scope;
      scope.onDispose(() => { if (this.entered === scope) this.entered = undefined; });
    });
  }
  /** Construct one resident widget, or one scoped widget per retained home entry. */
  view<T>(name: string, create: (scope: Scope) => T): () => T {
    if (!/^[a-z][a-z0-9.-]{0,63}$/u.test(name) || this.names.has(name) || this.names.size >= 16) throw new Error('Invalid or duplicate quest view');
    this.names.add(name);
    if (!this.retained) { const view = create(this.resident.child(name)); return () => view; }
    let current: T | undefined;
    installEnteredRuntimeService(this.context, (scope) => {
      const view = create(scope.child(name)); current = view;
      scope.onDispose(() => { if (current === view) current = undefined; });
    });
    return () => { if (current === undefined) throw new Error('Quest view left its home'); return current; };
  }
  /** Wire the newly constructed widgets without rebuilding quest data or NPC figures. */
  enter(run: () => void): void {
    if (!this.retained) run(); else installEnteredRuntimeService(this.context, run);
  }
  leave(run: () => void): void {
    if (this.retained) installEnteredRuntimeService(this.context, (scope) => { scope.onDispose(run); });
  }
  /** Preserve the original resident teardown order; entered views have already disposed when their cell left. */
  disposeLegacy(run: () => void): void { if (!this.retained) run(); }
  timeout(ms: number, run: () => void): ReturnType<Scope['timeout']> {
    const scope = this.entered;
    if (scope === undefined) throw new Error('Quest timer left its home');
    return scope.timeout(ms, run);
  }
  cancelTimer(timer: ReturnType<Scope['timeout']>): void { this.entered?.cancelTimer(timer); }
  /** Share modal input release while borrowing each world's stow, resume and pause policies. */
  panelHold(ports: {
    readonly hud: { holdPause: boolean; readonly entered: boolean; onResume?: () => void; setPaused: (on: boolean) => void };
    readonly weapons: { setEnabled: (on: boolean) => void };
    readonly menu: { readonly isOpen: boolean; close: (silent?: boolean) => void };
    readonly nolock: boolean; readonly touchUi: () => boolean;
    readonly stow?: (on: boolean) => void; readonly resume?: () => void;
    readonly panels?: readonly (() => { readonly isOpen: boolean; onOpen?: () => void; onClose?: () => void })[];
    readonly closeMenu?: boolean; readonly resetOnLeave?: boolean; readonly restartOnClose?: boolean;
  }): (on: boolean) => void {
    let timer: ReturnType<Scope['timeout']> = 0, still: Scope | null = null;
    const hold = (on: boolean): void => {
      if (on || ports.restartOnClose === true) this.cancelTimer(timer);
      ports.stow?.(on);
      // FC3 (G909): the world holds one still behind the open panel and resumes the moment it closes
      still?.dispose(); still = null;
      if (on) {
        still = (this.entered ?? this.resident).child('still'); this.context.app.ui.holdStill(still);
        ports.hud.holdPause = true; ports.weapons.setEnabled(false);
        if (ports.closeMenu === true && ports.menu.isOpen) ports.menu.close(true);
        if (document.pointerLockElement) document.exitPointerLock();
        return;
      }
      ports.resume?.(); ports.hud.onResume?.();
      timer = this.timeout(450, () => {
        ports.hud.holdPause = false;
        if (!ports.nolock && !ports.touchUi() && !document.pointerLockElement && ports.hud.entered && !ports.menu.isOpen
          && !(ports.panels?.some(panel => panel().isOpen) ?? false)) ports.hud.setPaused(true);
      });
    };
    if (ports.panels !== undefined) this.enter(() => { for (const view of ports.panels ?? []) {
      const panel = view(); panel.onOpen = () => { hold(true); }; panel.onClose = () => { hold(false); };
    } });
    if (ports.resetOnLeave === true) this.leave(() => { ports.hud.holdPause = false; timer = 0; });
    this.resident.onDispose(() => { this.cancelTimer(timer); });
    return hold;
  }
  /** The retained browser observer leaves with its cell; a resident one is assigned on the window for the scope. */
  exposeBrowser(name: string, observer: object): void {
    if (!this.retained) { this.resident.expose(window, name, observer); return; }
    installEnteredRuntimeObserver(this.context, name, observer);
  }
  /** The resident objective/caption keep their exact DOM insertion positions while hidden on the road. */
  retainRoot(root: HTMLElement, reset: () => void): void {
    if (!this.retained) return;
    installEnteredRuntimeAttachment(this.context, root);
    installEnteredRuntimeService(this.context, (scope) => {
      scope.onDispose(reset);
    });
  }
}

type Vec3 = readonly [number, number, number];
/** The part of a client lane the adapter reads: its published frames (read in the frame, never kept) and their tick. */
export interface ClientScriptFrames { readonly frame: (entity: number) => Readonly<ClientScriptFrame> | undefined; readonly tick: number }
/** One admitted emitter's numeric look (sp-x5's `platform.particles` recipe) and its declared live limit. */
export interface ClientScriptEmitterLook { readonly id: number; readonly live: number; readonly colour: Vec3; readonly size: number; readonly velocity: Vec3; readonly gravity: number }
/** One bound visual: the view object a pose composes onto (null: particles only) and where its particles start. */
export interface ClientScriptViewTarget {
  readonly entity: number;
  /** Read each frame: a creature's body is a row's, which may arrive late or come back as another body. */
  readonly object: Object3D | null;
  /** the particle origin in the adapter root's space */
  readonly anchor: (out: Vector3) => Vector3;
  readonly emitters: readonly ClientScriptEmitterLook[];
}
/** The adapter's readout (tests, the debug panel). */
export interface ClientScriptViewState { readonly targets: number; readonly posed: number; readonly particles: number; readonly capacity: number; readonly tick: number }

const VERTEX = /* glsl */ `
attribute vec3 aColour; attribute float aSize; attribute float aAlpha;
uniform float uScale; varying vec3 vColour; varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uScale / max(0.1, -mv.z);
  vColour = aColour; vAlpha = aAlpha;
}`;
const FRAGMENT = /* glsl */ `
varying vec3 vColour; varying float vAlpha;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0; float d = dot(p, p);
  if (d > 1.0 || vAlpha <= 0.0) discard;
  gl_FragColor = vec4(vColour, vAlpha * (1.0 - d));
}`;
const PARK_Y = -10_000;

interface Posed { readonly target: ClientScriptViewTarget; object: Object3D | null; readonly base: { p: Vector3; q: Quaternion; s: Vector3 }; saved: boolean;
  /** the eased pose being drawn */ readonly offset: Vector3; readonly rotation: Vector3; readonly scale: Vector3 }

/** a deterministic jitter in [-1, 1] from integers (no clock, no Math.random) */
function jitter(a: number, b: number, c: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35) ^ Math.imul(c + 0x27d4eb2f, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h ^= h >>> 12;
  return ((h >>> 0) / 0xffffffff) * 2 - 1;
}

/** Applies one client lane's frames to its bound views and particles; disposed with `scope`. */
export class ClientScriptViews {
  private readonly lane: ClientScriptFrames;
  private readonly targets: ReadonlyMap<number, ClientScriptViewTarget>;
  // Particle requests are emitted in entity order, as the lane's sorted frames were.
  private readonly order: readonly number[];
  private readonly posed: readonly Posed[];
  private readonly pool: ParticlePool<'aColour' | 'aSize' | 'aAlpha'> | null;
  private readonly lifetimes: Float32Array;
  private readonly gravity: Float32Array;
  private readonly material: ShaderMaterial | null;
  private seen = -1;
  private alive = 0;
  private disposed = false;
  private readonly _v = new Vector3();
  private readonly _q = new Quaternion();
  private readonly _e = new Euler();

  constructor(lane: ClientScriptFrames, targets: readonly ClientScriptViewTarget[], ports: { root: Object3D; scope: Scope }) {
    this.lane = lane;
    this.targets = new Map(targets.map((t) => [t.entity, t])); this.order = [...this.targets.keys()].sort((a, b) => a - b);
    if (this.targets.size !== targets.length) throw new Error('client script views: one view per bound entity');
    this.posed = targets.map((target): Posed => ({ target, object: null, saved: false,
      base: { p: new Vector3(), q: new Quaternion(), s: new Vector3(1, 1, 1) }, offset: new Vector3(), rotation: new Vector3(), scale: new Vector3(1, 1, 1) }));
    const capacity = Math.min(CLIENT_SCRIPT_LIMITS.particlesLive, targets.reduce((n, t) => n + t.emitters.reduce((m, e) => m + e.live, 0), 0));
    this.lifetimes = new Float32Array(capacity); this.gravity = new Float32Array(capacity);
    if (capacity > 0) {
      const material = new ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms: { uScale: { value: 600 } }, transparent: true, depthWrite: false, blending: AdditiveBlending });
      const pool = new ParticlePool({ capacity, material, renderOrder: 6, parkY: PARK_Y,
        attributes: { aColour: { itemSize: 3, dynamic: true }, aSize: { itemSize: 1, dynamic: true }, aAlpha: { itemSize: 1, dynamic: true } } });
      pool.points.name = 'client-script-particles';
      const scale = material.uniforms['uScale'];
      pool.points.onBeforeRender = (renderer, _scene, camera) => { if (scale !== undefined && camera instanceof PerspectiveCamera) scale.value = pointScale(renderer, camera); };
      ports.root.add(pool.points);
      this.pool = pool; this.material = material;
    } else { this.pool = null; this.material = null; }
    ports.scope.onDispose(() => { this.dispose(); });
  }

  /** Put every composed view back to the base it had before `apply` (run before the views write their own pose). */
  restore(): void {
    for (const p of this.posed) {
      if (!p.saved || p.object === null) continue;
      p.object.position.copy(p.base.p); p.object.quaternion.copy(p.base.q); p.object.scale.copy(p.base.s); p.saved = false;
    }
  }

  /** Compose the latest frames onto the views and advance the particles by `dt` seconds (run after the views' own pose). */
  apply(dt: number): void {
    if (this.disposed) return;
    this.restore();
    const lane = this.lane, ease = 1 - Math.exp(-Math.max(0, dt) * 14);
    for (const p of this.posed) {
      const frame = lane.frame(p.target.entity), o = p.object = p.target.object;
      if (o === null) continue;
      if (frame !== undefined) {
        p.offset.lerp(this._v.fromArray(frame.offset), ease); p.rotation.lerp(this._v.fromArray(frame.rotation), ease); p.scale.lerp(this._v.fromArray(frame.scale), ease);
      }
      p.base.p.copy(o.position); p.base.q.copy(o.quaternion); p.base.s.copy(o.scale); p.saved = true;
      o.position.add(this._v.copy(p.offset).applyQuaternion(p.base.q));
      o.quaternion.multiply(this._q.setFromEuler(this._e.set(p.rotation.x, p.rotation.y, p.rotation.z, 'YXZ')));
      o.scale.multiply(p.scale);
    }
    const tick = lane.tick;
    if (tick > this.seen) { this.seen = tick; for (const entity of this.order) { const frame = lane.frame(entity); if (frame !== undefined) this.emit(frame); } }
    this.particles(dt);
  }

  private emit(frame: ClientScriptFrame): void {
    const pool = this.pool, target = this.targets.get(frame.entity);
    if (pool === null || target === undefined) return;
    for (const request of frame.particles) {
      const look = target.emitters.find((e) => e.id === request.emitter); if (look === undefined) continue;
      const at = target.anchor(this._v);
      for (let k = 0; k < request.count; k++) {
        const i = pool.claim(), j = (n: number): number => jitter(frame.tick, frame.entity * 31 + k, n);
        if (this.lifetimes[i] === undefined) continue;
        if ((this.lifetimes[i] ?? 0) <= 0) this.alive++;
        pool.place(i, { x: at.x + j(1) * 0.15, y: at.y + j(2) * 0.08, z: at.z + j(3) * 0.15 });
        pool.vel[i * 3] = look.velocity[0] * (1 + j(4) * 0.25) + j(5) * 0.1; pool.vel[i * 3 + 1] = look.velocity[1] * (1 + j(6) * 0.25); pool.vel[i * 3 + 2] = look.velocity[2] * (1 + j(7) * 0.25) + j(8) * 0.1;
        pool.life[i] = request.lifetimeTicks / 60; this.lifetimes[i] = request.lifetimeTicks / 60; this.gravity[i] = look.gravity;
        pool.data.aColour.set(look.colour, i * 3); pool.data.aSize[i] = look.size; pool.data.aAlpha[i] = 1;
      }
    }
  }

  private particles(dt: number): void {
    const pool = this.pool; if (pool === null || this.alive === 0) return;
    const { pos, vel, life } = pool, alpha = pool.data.aAlpha;
    for (let i = 0; i < pool.capacity; i++) {
      const total = this.lifetimes[i] ?? 0; if (total <= 0) continue;
      const left = (life[i] ?? 0) - dt;
      if (left <= 0) { life[i] = 0; this.lifetimes[i] = 0; alpha[i] = 0; pos[i * 3 + 1] = PARK_Y; this.alive--; continue; }
      life[i] = left;
      vel[i * 3 + 1] = (vel[i * 3 + 1] ?? 0) + (this.gravity[i] ?? 0) * dt;
      pos[i * 3] = (pos[i * 3] ?? 0) + (vel[i * 3] ?? 0) * dt; pos[i * 3 + 1] = (pos[i * 3 + 1] ?? 0) + (vel[i * 3 + 1] ?? 0) * dt; pos[i * 3 + 2] = (pos[i * 3 + 2] ?? 0) + (vel[i * 3 + 2] ?? 0) * dt;
      const u = left / total; alpha[i] = Math.min(1, u * 3) * Math.min(1, (1 - u) * 6 + 0.2);
    }
    pool.posAttr.needsUpdate = true; pool.attr.aColour.needsUpdate = true; pool.attr.aSize.needsUpdate = true; pool.attr.aAlpha.needsUpdate = true;
  }

  state(): ClientScriptViewState {
    return { targets: this.targets.size, posed: this.posed.filter(p => p.object !== null).length, particles: this.alive, capacity: this.pool?.capacity ?? 0, tick: this.seen };
  }

  /** Restore every base pose and free the particle draw; further `apply` calls draw nothing. */
  dispose(): void {
    if (this.disposed) return;
    this.restore(); this.disposed = true;
    const pool = this.pool;
    if (pool !== null) { pool.points.removeFromParent(); pool.points.geometry.dispose(); }
    this.material?.dispose();
  }
}

/** Run the adapter in the page's frame: restore at input (before the views' sim sync), compose at late. */
export function driveClientScriptViews(views: ClientScriptViews, ports: { system: (spec: { id: string; phase: 'input' | 'late'; run: (dt: number) => void }) => void; id: string }): void {
  ports.system({ id: `${ports.id}.restore`, phase: 'input', run: () => { views.restore(); } });
  ports.system({ id: `${ports.id}.apply`, phase: 'late', run: (dt) => { views.apply(dt); } });
}

/** World position and label for a quest objective, with an optional dialogue NPC. */
export interface QuestTarget {
  position: Vector3;
  label: string;
  short?: string;
  npc?: QuestPresentationNpc;
}
/** Authored dialogue and proximity hooks for a quest giver or step target. */
export interface QuestPresentationNpc {
  npc: NpcDef;
  at: Vector3;
  label: string;
  speaker: NpcTalkOpts['speaker'];
  radius?: number;
  /** A target NPC is offered only during this step; omit for a persistent quest giver. */
  step?: string;
  onOpen?: NonNullable<NpcTalkOpts['onOpen']>;
  onDone?: NonNullable<NpcTalkOpts['onDone']>;
}
/** A quest step with its display title and world target. */
export interface PresentedQuestStep extends Omit<QuestStep, 'objective'> {
  title: string;
  target: QuestTarget;
}
/** Quest data whose steps have authored presentation targets. */
export interface PresentedQuestDef extends Omit<QuestDef, 'steps'> { steps: PresentedQuestStep[] }
/** Scoped marker, dialogue, reward and toast choices for the existing quest UI. */
export interface QuestPresentationOptions {
  flags?: Flags;
  /** Resolve existing POI-local markers; simple target positions need no resolver. */
  place?: (at: Place) => { x: number; y: number; z: number };
  /** Admitted world coordinates keyed by the authored marker placement. */
  placements?: Readonly<Record<string, { readonly x: number; readonly y: number; readonly z: number }>>;
  introTitle?: string;
  npc?: QuestPresentationNpc;
  npcs?: QuestPresentationNpc[];
  places?: PlacePoint[];
  reward?: QuestRewardSpec | false;
  /** Existing adventures can retain their authored beat strings and leftovers. */
  messages?: QuestMessageRows;
  /** A borrowed page beat follows the sting, without owning a cursor or save. */
  afterStep?: (step: QuestStep | null) => void;
  stepToast?: (step: QuestStep, previous: QuestStep | null, quest: QuestView) => string;
  stepCompleteToast?: false | ((step: QuestStep) => string);
  completeToast?: (quest: QuestView) => string;
  chip?: () => { label: string; count: string };
  markers?: () => LiveMarker[];
  worldPins?: boolean;
  mapMarkers?: boolean;
  minimapMarks?: boolean;
}
/** Owned play services required to present a quest without owning its state. */
export interface QuestPresentationHost {
  scope: Scope;
  player: QuestRewardPlayer;
  toast: (text: string) => void;
  sting: () => void;
  pin?: HudVerbs['pin'];
  fullMap?: { setQuest?: (source: () => MapQuest | null) => void; addQuest?: (source: () => MapQuest | null) => () => void; addPois?: (source: () => MapPoi[]) => () => void };
  minimap?: { addMarks: (source: () => readonly MapMark[]) => () => void } | null;
  prompts?: NpcTalk['prompt'][];
  stowWeapon?: (on: boolean) => void;
  setViewmodel?: (on: boolean) => void;
  dayNight?: { phase: number } | null;
}
/** The live quest presentation and its entered-scope update/disposal ports. */
export interface QuestPresentation<Q extends QuestView = QuestState> {
  quest: Q;
  chip: QuestChip;
  markers: () => LiveMarker[];
  places: Places | null;
  reward: QuestRewardBeat | null;
  update: (dt: number, t: number) => void;
  dispose: () => void;
}
/** Structural play-context port; a ShardContext supplies all of it. */
export interface QuestPresentationContext {
  scope: Scope;
  app: { events: Events };
  manifest: { slug: string };
  system: (spec: SystemSpec) => void;
  hud: Pick<HudVerbs, 'pin'>;
  game: { runtime?: {
    world: { player: QuestRewardPlayer; sky: { dayNight?: { phase: number } | null } } | null;
    play: {
      hud: { toast: (text: string) => void };
      music: { sting: (name: 'chunk') => void };
      weapons: { visible: boolean; stowed: boolean };
      fullMap: NonNullable<QuestPresentationHost['fullMap']>;
      minimap?: QuestPresentationHost['minimap'];
    } | null;
    interactables: NpcTalk['prompt'][];
  } };
}

/** Frozen callbacks keep their closed Place vocabulary until NEXT N5. */
function legacyQuestPlace(at: QuestPlace): Place {
  const poi = at.poi;
  if (poi === 'world' || poi === 'hut' || poi === 'lookout' || poi === 'wreck' || poi === 'shrine' || poi === 'cave' || poi === 'pier') return { ...at, poi };
  throw new Error('Authored quest frame requires a live frame resolver');
}

/** The MAP card a quest shows: read from the view, so the page's quest and a client's replica draw the same card. */
export function questCard(quest: QuestView, introTitle?: string): MapQuest {
  return { title: quest.isStarted ? quest.def.title : introTitle ?? quest.def.title, objective: quest.objective(), hint: quest.isComplete ? '' : quest.hint() };
}
/** Shared wiring for older adventures that own their frame order. New shards use installQuestPresentation.
 * The chip, card, pins and marks read a `QuestView`; only places and talks write flags, so only they need `flags`. */
export function presentQuest<Q extends QuestView & { readonly flags?: Flags }>(host: QuestPresentationHost, source: Q, options: QuestPresentationOptions = {}): QuestPresentation<Q> {
  // J130: on the wire a view reads the server's rows, and the page's quest only carries its flag book
  const quest: QuestView & { readonly flags?: Flags | undefined } = Object.assign(Object.create(wirePage.quest(source.def)) as QuestView, { flags: source.flags });
  const messages=options.messages===undefined?null:questMessageHandlers(quest,options.messages,{toast:host.toast,sting:host.sting,
    ...(options.afterStep===undefined?{}:{afterStep:options.afterStep})});
  const scope = host.scope.child(`quest.${quest.def.id}`);
  if (options.place !== undefined && options.placements !== undefined) throw new Error('Quest presentation requires one frame resolver');
  const legacy = options.place, placements = options.placements;
  const resolve = (at: QuestPlace): { x: number; y: number; z: number } => {
    if (placements !== undefined) {
      const point = placements[JSON.stringify(at)];
      if (point === undefined) throw new Error('Quest marker lacks an admitted frame placement');
      return point;
    }
    if (legacy !== undefined) return legacy(legacyQuestPlace(at));
    if (at.poi !== 'world' || at.anchor !== undefined) throw new Error('Quest POI markers require a place resolver');
    return { x: at.x, y: (at.y ?? 0) + (at.dy ?? 0), z: at.z };
  };
  const markers = (): LiveMarker[] => quest.markers().map((m) => {
    const p = resolve(m.at);
    return { id: m.id, label: m.label, short: m.short ?? m.label, x: p.x, z: p.z };
  });
  const chip = new QuestChip({ chip: options.chip ?? (() => quest.chip()), markers: options.markers ?? markers });
  scope.onDispose(() => { chip.line.scope.dispose(); });
  const onStep = (step: QuestStep | null, prev: QuestStep | null): void => {
    if (prev && typeof options.stepCompleteToast === 'function') host.toast(options.stepCompleteToast(prev));
    if(messages!==null){messages.step(step,prev);return;}
    if (step) host.toast(options.stepToast?.(step, prev, quest) ?? (prev === null ? `New quest · ${quest.def.title}` : `Objective · ${quest.objective()}`));
    host.sting();options.afterStep?.(step);
  };
  const onComplete = (): void => { if(messages!==null)messages.complete();else host.toast(options.completeToast?.(quest) ?? `Quest complete · ${quest.def.title}`); };
  scope.onDispose(quest.observe({ step: onStep, complete: onComplete }));
  const card = (): MapQuest => questCard(quest, options.introTitle);
  if (host.fullMap?.addQuest) scope.onDispose(host.fullMap.addQuest(card));
  else host.fullMap?.setQuest?.(card);
  const flags = options.flags ?? quest.flags;
  if (flags === undefined && (options.places !== undefined || options.npc !== undefined || (options.npcs?.length ?? 0) > 0)) throw new Error('Quest places and talks write flags: they need an owner');
  const places = options.places && flags ? placesWithDiscovery(options.places, flags, host.toast, markers) : null;
  if (options.mapMarkers !== false && host.fullMap?.addPois) scope.onDispose(host.fullMap.addPois(() => places?.mapPois() ?? markers().map((m) => ({ x: m.x, z: m.z, label: m.label, short: m.short, kind: 'quest' }))));
  if (options.minimapMarks !== false && host.minimap) scope.onDispose(host.minimap.addMarks(() => markers().map((m) => ({ x: m.x, z: m.z, color: '#8fe3ff' }))));

  const pins = new Map<string, { root: HTMLElement; distance: HTMLElement; position: Vector3 }>();
  if (options.worldPins !== false && host.pin) {
    const all = [...(quest.def.intro?.markers ?? []), ...quest.def.steps.flatMap((step) => step.markers ?? [])];
    for (const m of all) {
      // The same id can occur at a different position in a later step; projection reads the active marker.
      if (pins.has(m.id)) continue;
      const root = document.createElement('span'); root.className = 'ws-quest-pin';
      const label = document.createElement('span'), distance = document.createElement('b');
      root.append(label, distance);
      const position = new Vector3(); pins.set(m.id, { root, distance, position });
      host.pin(() => {
        if (scope.disposed || practiceRoom.open) return null;
        const active = quest.markers().find((a) => a.id === m.id);
        if (!active) return null;
        const at = resolve(active.at); position.set(at.x, at.y + 2.2, at.z);
        label.textContent = active.short ?? active.label;
        return position;
      }, root);
      scope.onDispose(() => { root.remove(); });
    }
  }
  const npcs = [...(options.npc ? [options.npc] : []), ...(options.npcs ?? [])];
  const dialogue = npcs.length > 0 ? new DialogueBox(scope.child('dialogue')) : null;
  const talks = dialogue && flags ? npcs.map((npc) => {
    const talk = new NpcTalk({ ...npc, radius: npc.radius ?? 3.2, flags, dialogue });
    const prompt = { ...talk.prompt, get radius() { return npc.step === undefined || quest.current?.id === npc.step || talk.talking ? talk.prompt.radius : 0; } };
    host.prompts?.push(prompt);
    scope.onDispose(() => {
      const i = host.prompts?.indexOf(prompt) ?? -1; if (i >= 0) host.prompts?.splice(i, 1);
      npc.speaker.talking = false;
    });
    return talk;
  }) : [];
  let stowed = false;
  scope.onDispose(() => { if (stowed) host.stowWeapon?.(false); });
  const reward = options.reward !== undefined && options.reward !== false ? new QuestRewardBeat({ ...host, scope, objective: chip.line.root }, options.reward) : null;
  const update = (dt: number, t: number): void => {
    if (scope.disposed || practiceRoom.open) return;
    chip.update(t, host.player);
    places?.update(host.player.position.x, host.player.position.z, host.player.position.y);
    for (const pin of pins.values()) pin.distance.textContent = `${Math.round(Math.hypot(pin.position.x - host.player.position.x, pin.position.z - host.player.position.z))} m`;
    dialogue?.update(dt); for (const talk of talks) talk.update(host.player.position);
    const talking = talks.some((talk) => talk.talking);
    if (talking !== stowed) { stowed = talking; host.stowWeapon?.(stowed); }
    reward?.update(dt);
  };
  return { quest: source, chip, markers, places, reward, update, dispose: () => { scope.dispose(); } };
}

/** One call in play(ctx): Wendell's chip, MAP card, diamonds, world pins, discovery, dialogue and reward. */
export function installQuestPresentation(ctx: QuestPresentationContext, source: QuestState | QuestDef | PresentedQuestDef, options: QuestPresentationOptions = {}): QuestPresentation {
  const runtime = ctx.game.runtime, world = runtime?.world, play = runtime?.play;
  if (!runtime || !world || !play || ctx.scope.disposed) throw new Error('Quest presentation requires a live play host');
  const flags = options.flags ?? (source instanceof QuestState ? source.flags : new Flags(ctx.manifest.slug));
  const def: QuestDef | null = source instanceof QuestState ? null : { ...source, steps: source.steps.map((s) => {
    if (!('target' in s)) return s;
    const { target, title, ...step } = s;
    return { ...step, objective: title, markers: s.markers ?? [{ id: s.id, label: target.label, ...(target.short === undefined ? {} : { short: target.short }), at: { poi: 'world', x: target.position.x, y: target.position.y, z: target.position.z } }] };
  }) };
  const quest = source instanceof QuestState ? source : new QuestState(def ?? source as QuestDef, flags, ctx.app.events, ctx.scope);
  const targetNpcs = source instanceof QuestState ? [] : source.steps.flatMap((s) => 'target' in s && s.target.npc ? [{ ...s.target.npc, step: s.id }] : []);
  const targetPlaces = source instanceof QuestState ? [] : source.steps.flatMap((s) => 'target' in s ? [{ id: `${source.id}.${s.id}`, label: s.target.label, x: s.target.position.x, y: s.target.position.y, z: s.target.position.z, r: 12 }] : []);
  const alreadyComplete = quest.isComplete;
  const reward: QuestRewardSpec | false = options.reward ?? { kicker: 'Quest complete', title: quest.def.title, subtitle: '', when: () => !alreadyComplete && quest.isComplete, finish: () => undefined };
  const presentation = presentQuest({ scope: ctx.scope, player: world.player, toast: (text) => { play.hud.toast(text); }, sting: () => { play.music.sting('chunk'); },
    pin: ctx.hud.pin, fullMap: play.fullMap, minimap: play.minimap ?? null, prompts: runtime.interactables,
    dayNight: world.sky.dayNight ?? null, setViewmodel: (on) => { play.weapons.visible = on; }, stowWeapon: (on) => { play.weapons.stowed = on; } }, quest, { ...options, flags, reward,
      stepCompleteToast: options.stepCompleteToast ?? ((step) => `Step complete · ${step.chip ?? step.objective}`),
      places: options.places ?? targetPlaces, npcs: [...(options.npcs ?? []), ...targetNpcs] });
  ctx.system({ id: `game.quest.${quest.def.id}`, phase: 'update', when: (live) => live.state === 'play', run: presentation.update });
  if (!(source instanceof QuestState)) {
    const disposeView = presentation.dispose;
    presentation.dispose = () => { disposeView(); quest.dispose(); };
  }
  return presentation;
}

/** Keep quest state resident while rebuilding its ordinary presentation and input in each entered cell scope. */
export function installEnteredQuestPresentation(context: ShardContext, quest: QuestState, options: QuestPresentationOptions = {}): () => QuestPresentation | null {
  if (!retainsRuntimeServices(context)) throw new Error('Entered quest presentation needs a retained context');
  let current: QuestPresentation | null = null;
  installEnteredRuntimeService(context, scope => {
    // A fresh ordinary installation binds pins and systems to this entry without registering new retained installers.
    const installation = createLevelInstallation(context.app, scope, context.app.levelAdapters, () => context.progress);
    const presentation = installQuestPresentation({ ...context, ...installation.context }, quest, options);
    current = presentation;
    scope.onDispose(() => { presentation.dispose(); if (current === presentation) current = null; });
  });
  return () => current;
}


/** Authored native installation and flag bit grants on the existing motion owner. */
export interface ClientMoverInstallation {
  readonly viewSystemId?: string;
  readonly socketLiftPrompts?: boolean;
  readonly systemId: string;
  readonly permissions?: readonly { readonly mover: string; readonly flags: readonly { readonly name: string; readonly bit: number }[] }[];
}
/** Declared visual channels and input prompts, with clocks lent by their existing owners. */
export function bindClientChannels(programs: readonly ClientChannelProgram[], ports: {
  readonly targets: ReadonlyMap<string, unknown>; readonly nativeOwners?: readonly string[]; readonly copiedOwners?: readonly string[];
  readonly initialPoses?: readonly (MoverPose & { readonly id: string })[];
  readonly bindings?: readonly { readonly updateMovers: (pose: (id: string) => MoverPose) => void }[];
  readonly kernels?: ClientGeometryKernels; readonly observed?: (id: string, frame: ClientChannelFrame) => void;
}): {
  readonly movers: ReadonlyMap<string, MoverView>; readonly interactables: readonly Interactable[];
  readonly runtime: FollowedMovers | null;
  /** Release borrowed view/prompt references; their geometry and materials stay caller-owned. */
  readonly dispose: () => void;
  readonly installMovers: (ctx: LevelContext, world: World, source: Shardfile, row: ClientMoverInstallation, flags: Pick<Flags, 'has'>) => FollowedMovers;
  readonly evaluate: (id: string, observation: ClientChannelObservation) => void;
  readonly view: (id: string) => ReturnType<typeof createClientChannelView>;
  readonly prompt: (id: string) => Interactable;
  readonly bindPrompts: (bind: Parameters<typeof createClientChannelPrompt>[1]) => void;
  readonly updateMovers: (pose?: (id: string) => MoverPose) => void;
} {
  let runtime: FollowedMovers | null = null, installed = false;
  const owners = ports.nativeOwners ?? [];
  if (owners.length > 32 || new Set(owners).size !== owners.length) throw new Error('Invalid native mover view owners');
  const copiedOwners = ports.copiedOwners ?? [];
  if (copiedOwners.length > 32 || new Set([...owners, ...copiedOwners]).size !== owners.length + copiedOwners.length) throw new Error('Invalid copied mover view owners');
  const copiedViews: { id: string; view: ReturnType<typeof createClientChannelView> }[] = [];
  const pending = new Set<InstancedMesh>(); let batching = false;
  const changed = (mesh: InstancedMesh): void => { if (batching) pending.add(mesh); else mesh.instanceMatrix.needsUpdate = true; };
  const rows = parseClientChannels(programs), movers = new Map<string, MoverView>(owners.map(id => [id, { pose: () => undefined }]));
  const views = new Map<string, ReturnType<typeof createClientChannelView>>(), bound = new Set<string>();
  for (const row of rows) {
    if (row.bindings === undefined && row.geometry === undefined && row.connectors === undefined) continue;
    const view = createClientChannelView(row, ports.targets, ports.kernels, changed); views.set(row.id, view);
    if (row.mover === undefined) continue;
    const id = row.mover;
    if (copiedOwners.includes(id)) {
      if (view.reads.some(read => read.startsWith('field.'))) throw new Error('Copied pose view has no native field grant');
      copiedViews.push({ id, view }); continue;
    }
    if (!movers.has(id) || bound.has(id)) throw new Error('Mover channels require one borrowed native owner');
    bound.add(id); movers.set(id, { pose: (pose, fields) => {
      view.evaluate({ time: 0, delta: 0, values: moverChannelValues(view.reads, pose, fields) }); ports.observed?.(id, view.frame);
    } });
  }
  const prompts = new Map<string, ReturnType<typeof createClientChannelPrompt>>();
  let promptRows: readonly { id: string; lane: ReturnType<typeof createClientChannelPrompt> }[] = [];
  let interactables: readonly Interactable[] = Object.freeze([]), promptsBound = false;
  const binding = Object.freeze({ movers, get runtime() { return runtime; }, get interactables() { return interactables; },
    dispose: () => {
      movers.clear(); views.clear(); prompts.clear(); pending.clear(); copiedViews.length = 0;
      promptRows = []; interactables = Object.freeze([]); runtime = null;
      installed = true; promptsBound = true;
    },
    installMovers: (ctx: LevelContext, world: World, source: Shardfile, row: ClientMoverInstallation, flags: Pick<Flags, 'has'>) => {
      if (installed) throw new Error('Client motion is already installed');
      const grants = row.permissions ?? [];
      if (grants.length > 32 || new Set(grants.map(grant => grant.mover)).size !== grants.length
        || grants.some(grant => !source.movers.some(mover => mover.id === grant.mover) || grant.flags.length > 16
          || new Set(grant.flags.map(flag => flag.name)).size !== grant.flags.length
          || grant.flags.some(flag => flag.name.length === 0 || !Number.isSafeInteger(flag.bit) || flag.bit < 0 || flag.bit > 65536))) throw new Error('Invalid client mover flag grants');
      installed = true;
      runtime = installFollowedMovers(ctx, world, { data: source.movers, views: movers, systemId: row.systemId,
        restoreFlags: new Set(source.movers.flatMap(mover => mover.restoreFrom !== undefined && flags.has(mover.restoreFrom.flag) ? [mover.restoreFrom.flag] : [])),
        onDispose: () => { runtime = null; } });
      if (row.socketLiftPrompts === true) binding.bindPrompts({ socketLifts: { entryways: source.entryways, runtime: () => runtime } });
      if (row.viewSystemId !== undefined) ctx.system({ id: row.viewSystemId, phase: 'update', run: () => {
        const active = runtime;
        if (active === null) return;
        const pose = active.pose.bind(active);
        for (const child of ports.bindings ?? []) child.updateMovers(pose);
        binding.updateMovers();
      } });
      return runtime;
    },
    view: (id: string) => { const view = views.get(id); if (view === undefined) throw new Error('Unknown declared visual channel'); return view; },
    prompt: (id: string) => { const prompt = prompts.get(id); if (prompt === undefined) throw new Error('Unknown declared prompt channel'); return prompt.spot; },
    evaluate: (id: string, observation: ClientChannelObservation) => {
      const view = views.get(id), prompt = prompts.get(id);
      if (view === undefined && prompt === undefined) throw new Error('Unknown declared client channel');
      view?.evaluate(observation); prompt?.evaluate(observation);
    },
    // Bind in the caller's original phase: no service, input, body or clock is installed here.
    bindPrompts: (bind: Parameters<typeof createClientChannelPrompt>[1]) => {
      if (promptsBound) throw new Error('Declared prompts are already bound');
      const next = rows.flatMap(row => row.prompt === undefined ? [] : [{ row, lane: createClientChannelPrompt(row, bind) }]);
      for (const { row, lane } of next) prompts.set(row.id, lane);
      promptRows = next.flatMap(({ row, lane }) => row.mover === undefined ? [] : [{ id: row.mover, lane }]);
      interactables = Object.freeze(next.map(({ lane }) => lane.spot)); promptsBound = true;
    },
    // Native views are published by the existing mover callback; only copied-pose prompts evaluate here.
    updateMovers: (provided?: (id: string) => MoverPose) => {
      const active = runtime;
      if (provided === undefined && active === null) return;
      const pose = provided ?? ((id: string) => { if (active === null) throw new Error('Missing client motion owner'); return active.pose(id); });
      batching = true;
      try {
        for (const row of copiedViews) row.view.evaluate({ time: 0, delta: 0, values: moverChannelValues(row.view.reads, pose(row.id), {}) });
        for (const row of promptRows) row.lane.evaluate({ time: 0, delta: 0, values: moverChannelValues(row.lane.reads, pose(row.id), {}) });
      } finally {
        batching = false;
        for (const mesh of pending) mesh.instanceMatrix.needsUpdate = true;
        pending.clear();
      }
    },
  });
  const initial = ports.initialPoses;
  if (initial !== undefined) {
    if (initial.length > 32 || new Set(initial.map(pose => pose.id)).size !== initial.length) throw new Error('Invalid initial channel poses');
    const poses = new Map(initial.map(pose => [pose.id, pose]));
    binding.updateMovers(id => { const pose = poses.get(id); if (pose === undefined) throw new Error('Missing initial channel pose'); return pose; });
  }
  return binding;
}

/** Declarative prompt dispatch over existing named handlers and admitted lift/mover owners. */
export interface ClientPromptBindings {
  readonly named?: ReadonlyMap<string, (spot: Interactable) => void>;
  readonly socketLifts?: { readonly entryways: Shardfile['entryways']; readonly runtime: () => FollowedMovers | null };
}
/** A channel-owned prompt: copied coordinates plus a separately bound real input action. */
export function createClientChannelPrompt(input: unknown,
  bind: ClientPromptBindings | ((action: NonNullable<ClientChannelProgram['prompt']>['action']) => (spot: Interactable) => void)): {
    readonly spot: Interactable; readonly reads: readonly string[]; readonly evaluate: (observation: ClientChannelObservation) => void;
  } {
  const program = parseClientChannels([input])[0];
  if (program?.prompt === undefined) throw new Error('Missing declared client prompt');
  const declaration = structuredClone(program.prompt);
  if (typeof bind !== 'function' && (bind.named?.size ?? 0) > 64) throw new Error('Prompt action table exceeds its bound');
  const resolve = typeof bind === 'function' ? bind : (row: NonNullable<ClientChannelProgram['prompt']>['action']): ((spot: Interactable) => void) => {
    if (row.kind === 'named') { const handler = bind.named?.get(row.name); if (handler === undefined) throw new Error('Unknown named prompt action'); return handler; }
    const ports = bind.socketLifts, entry = ports?.entryways.find(value => value.kind === 'socketLift' && value.edge === row.edge), lift = entry?.lift;
    if (ports === undefined || lift === undefined) throw new Error('Unknown socket lift prompt action');
    return () => { if (ports.runtime() !== null) wirePage.send(liftPrompt(lift.mover, row.action)); };
  };
  const action = resolve(Object.freeze(declaration.action));
  const lane = createClientChannels(program);
  const spot: Interactable = { label: declaration.label, radius: declaration.radius,
    position: new Vector3(...declaration.at), onInteract: () => undefined };
  spot.onInteract = () => { action(spot); };
  const evaluate = (observation: ClientChannelObservation): void => {
    lane.evaluate(observation);
    const { x, y, z } = lane.frame;
    if (x === undefined || y === undefined || z === undefined) throw new Error('Missing prompt coordinates');
    spot.position.set(x, y, z);
  };
  return Object.freeze({ spot, reads: lane.reads, evaluate });
}
/** Bounded installation policy for an existing quest figure and its talk prompt.
 * Figure geometry, placement, dialogue, flags and save owners are borrowed.
 */
export interface NpcInstallationRow {
  readonly id: string; readonly label: string; readonly radius: number; readonly file: string;
  readonly copyPrompt: boolean; readonly updateOrder: 'figure-first' | 'talk-first';
  readonly bark?: { readonly enter: number; readonly leave: number };
  readonly approach?: { readonly radius: number; readonly unlessFlag: string };
}
/** A figure already knows its pose and its collider; the installer changes neither. */
export interface QuestTalkFigure {
  readonly group: Object3D; readonly collider: BoxSpec; talking: boolean;
}
/** Borrowed owners for an NPC's original scene, registry and reading clock. */
export interface NpcInstallationPorts<F extends QuestTalkFigure> {
  readonly create: () => F; readonly npc: NpcDef; readonly dialogue: () => DialogueBox; readonly flags: Flags;
  readonly scene: Object3D; readonly registry: Pick<WorldRegistry, 'add'>; readonly prompts: Interactable[];
  readonly at: (figure: F) => Vector3;
  readonly advance: (figure: F, dt: number, time: number, player: Vector3) => void;
  readonly own?: (figure: F, register: () => void) => void;
  readonly open?: (figure: F) => void; readonly done?: () => void;
  readonly bark?: (figure: F) => void;
  readonly approach?: { readonly at: (figure: F) => Vector3; readonly run: (figure: F) => void };
  readonly stow?: (talking: boolean) => void; readonly lod?: (figure: F, distance: number) => void;
}
/** The same installed figure, talk and prompt, advanced at the caller's original phase. */
export interface NpcTalkInstallation<F extends QuestTalkFigure> {
  readonly fig: F; readonly talk: NpcTalk; readonly prompt: Interactable;
  readonly update: (dt: number, time: number, player: Vector3) => void;
  readonly lod: (camera: Vector3) => void;
}
/** Install a preflighted NPC row through the existing NpcTalk. No second timer,
 * saved state or resource owner is created; optional entry ownership is lent.
 * Greeting hysteresis and one-time approach actions retain their authored order.
 */
export function installNpcTalk<F extends QuestTalkFigure>(row: NpcInstallationRow, ports: NpcInstallationPorts<F>): NpcTalkInstallation<F> {
  const text = (value: string): boolean => typeof value === 'string' && value.length > 0 && value.length <= 4096;
  const radius = (value: number): boolean => Number.isFinite(value) && value > 0 && value <= 1000;
  if (!text(row.id) || !text(row.label) || !text(row.file) || row.file.startsWith('/') || row.file.split('/').some(part => part === '..') ||
    !radius(row.radius) || typeof row.copyPrompt !== 'boolean' || !['figure-first', 'talk-first'].includes(row.updateOrder) ||
    !text(ports.npc.id) || !text(ports.npc.name) || ports.npc.dialogue.length > 1024) throw new Error('Invalid NPC installation row');
  if (row.bark !== undefined && (!radius(row.bark.enter) || !radius(row.bark.leave) || row.bark.leave <= row.bark.enter || ports.bark === undefined)) throw new Error('Invalid NPC greeting owner or range');
  if (row.approach !== undefined && (!radius(row.approach.radius) || !text(row.approach.unlessFlag) || ports.approach === undefined)) throw new Error('Invalid NPC approach owner or range');
  const fig = ports.create();
  ports.scene.add(fig.group);
  const register = (): void => { ports.registry.add({ id: row.id, name: ports.npc.name, category: 'people', file: row.file,
    colliders: [boxInFrame(fig.collider, fig.group, 'wood', false)], follows: fig.group, followRotation: false }); };
  if (ports.own === undefined) register(); else ports.own(fig, register);
  const at = ports.at(fig);
  const talk = new NpcTalk({ get dialogue() { return ports.dialogue(); }, flags: ports.flags, npc: ports.npc,
    at, radius: row.radius, label: row.label, speaker: fig,
    onOpen: () => { ports.open?.(fig); }, onDone: () => { ports.done?.(); }, onEmpty: () => { ports.done?.(); } });
  const prompt = talk.prompt;
  if (row.copyPrompt) prompt.position = at.clone();
  ports.prompts.push(prompt);
  let barked = false, approached = false, stowed = false;
  return { fig, talk, prompt,
    update: (dt, time, player) => {
      if (row.updateOrder === 'figure-first') ports.advance(fig, dt, time, player);
      talk.update(player);
      if (row.updateOrder === 'talk-first') ports.advance(fig, dt, time, player);
      if (talk.talking !== stowed) { stowed = talk.talking; ports.stow?.(stowed); }
      if (row.bark !== undefined) {
        const distance = at.distanceToSquared(player);
        if (!barked && distance < row.bark.enter ** 2) { barked = true; ports.bark?.(fig); }
        else if (barked && distance > row.bark.leave ** 2) barked = false;
      }
      if (row.approach !== undefined && !approached && !ports.flags.has(row.approach.unlessFlag) &&
        ports.approach !== undefined && player.distanceToSquared(ports.approach.at(fig)) < row.approach.radius ** 2) {
        approached = true; ports.approach.run(fig);
      }
    }, lod: camera => { ports.lod?.(fig, camera.distanceTo(at)); },
  };
}

/** Posed people already implement their native head, update and distance policy. */
export interface PosedQuestTalkFigure extends QuestTalkFigure {
  readonly talkPoint: Vector3; update: (dt: number, time: number, player: Vector3) => void; lod: (distance: number) => void;
}
type QuestNpcTalkModel<F extends QuestTalkFigure> = {
  readonly kind: 'posed'; readonly create: (at: { x: number; y: number; z: number }, yaw: number) => F & PosedQuestTalkFigure;
  readonly bark: (figure: F) => void;
} | (Omit<NpcInstallationPorts<F>, 'dialogue' | 'flags' | 'scene' | 'registry' | 'prompts' | 'npc' | 'done'> & { readonly kind: 'borrowed' });
/** Root rows select real posed or borrowed figure factories and named completion owners. */
export type QuestNpcTalkPorts<F extends QuestTalkFigure> = Pick<NpcInstallationPorts<F>, 'dialogue' | 'flags' | 'scene' | 'registry' | 'prompts'> & {
  readonly figures: ReadonlyMap<string, QuestNpcTalkModel<F>>;
  readonly groundAt?: (x: number, z: number) => number;
  readonly calls: ReadonlyMap<string, () => void>;
};
/** Install posed NPCs in their declared order, retaining the caller's update clock and actual figure ownership. */
export function installDeclaredNpcTalks<F extends QuestTalkFigure>(source: Pick<Shardfile, 'questNpcs'>, ports: QuestNpcTalkPorts<F>): (NpcTalkInstallation<F> & { readonly kind: string })[] {
  const rows = (source.questNpcs ?? []).filter((row): row is QuestNpcTalkBinding => 'kind' in row);
  if (rows.length === 0) throw new Error('Missing declared posed quest NPCs');
  const bound = rows.map(row => {
    const model = ports.figures.get(row.figure), done = row.done === undefined ? undefined : ports.calls.get(row.done.call);
    if (model === undefined || row.done !== undefined && done === undefined) throw new Error('Unbound quest NPC figure or completion');
    const ground = ports.groundAt;
    if ((model.kind === 'posed' || row.prompt !== undefined) && ground === undefined) throw new Error('Unbound quest NPC ground');
    if (model.kind === 'posed' && (row.at === undefined || row.yaw === undefined || row.install.approach !== undefined)) throw new Error('Missing posed quest NPC placement or approach owner');
    if (model.kind === 'borrowed' && row.at !== undefined) throw new Error('Borrowed quest NPC placement belongs to its native owner');
    if (model.kind === 'borrowed' && (row.install.bark !== undefined && model.bark === undefined || row.install.approach !== undefined && model.approach === undefined)) throw new Error('Unbound quest NPC greeting or approach');
    return { row, model, done, ground };
  });
  const installed: (NpcTalkInstallation<F> & { readonly kind: string })[] = [];
  for (const { row, model, done, ground } of bound) {
    const common = { ...ports, npc: row.npc, done: () => { if (done !== undefined && testFlags(ports.flags, row.done?.when)) done(); } };
    let person: NpcTalkInstallation<F>;
    if (model.kind === 'borrowed') person = installNpcTalk(row.install, { ...common, ...model });
    else {
      if (row.at === undefined || row.yaw === undefined || ground === undefined) throw new Error('Missing posed quest NPC placement');
      const at = row.at, yaw = row.yaw;
      person = installNpcTalk(row.install, { ...common, create: () => model.create({ ...at, y: ground(at.x, at.z) }, yaw),
        at: figure => figure.talkPoint, advance: (figure, dt, time, player) => { figure.update(dt, time, player); },
        lod: (figure, distance) => { figure.lod(distance); }, open: model.bark, bark: model.bark });
    }
    if (row.prompt !== undefined && ports.groundAt !== undefined) person.prompt.position.set(row.prompt.at.x, ports.groundAt(row.prompt.at.x, row.prompt.at.z) + row.prompt.height, row.prompt.at.z);
    installed.push({ ...person, kind: row.figure });
  }
  return installed;
}

/** The page's coins, on the cosmetic stream: looked up on each throw, as the burst always has. */
const coinBurst = (scene: Scene): CoinMotion => new CoinMotion(scene, () => app.rng.stream('cosmetic').next());

/** A quest's coin reward: the burst that flies the coins to the player, `pay`, which pays once per save, and `spawn`, any other coins through the same burst. */
export interface QuestReward { readonly burst: CoinMotion; readonly pay: () => undefined; readonly spawn: (amount: number, toast: string) => void }

/**
 * A declared quest's coin reward (SHARD-PLATFORM M3; Signal Dunes and Sky Reach): `amount` coins burst out of the player through the platform purse
 * (`coins`), the `toast` after the last lands; `paid` / `markPaid` are the save's once-only record (a quest flag, a shard
 * save). The burst lives on the play scene, or on a scene of its own headless.
 */
export function questReward(ctx: ShardContext, o: { readonly player: Vector3; readonly coins: RuntimeCoins; readonly amount: number; readonly paid: () => boolean; readonly markPaid: () => void; readonly toast: string }): QuestReward {
  const scene = ctx.game.runtime?.world?.game.scene ?? new Scene(), burst = coinBurst(scene);
  // J130: on a page the coins a burst flies are the server's, already in the purse's line: they land and count for nothing.
  const spawn = (amount: number, toast: string): void => { burst.spawn(o.player, amount, () => undefined, () => { ctx.game.runtime?.play?.hud.toast(toast); }); };
  const pay = (): undefined => {
    if (o.paid()) return undefined;
    o.markPaid(); spawn(o.amount, o.toast);
    return undefined;
  };
  return { burst, pay, spawn };
}

/**
 * A quest's one-call presentation with its coin reward (ENGINE §20): the chip, markers, MAP card, places and step toasts,
 * the held reward beat (`reward`, shown while the quest is complete and `unpaid` holds) that pays; entered
 * for a retained home, installed in plain play, absent headless (the reward then pays at once on completion). A quest
 * still open toasts `newQuest` on the first frame. The burst animates under the system `id` and is freed with the level.
 */
export function presentRewardedQuest(ctx: ShardContext, quest: QuestState, reward: QuestReward, o: { readonly id: string; readonly player: Vector3; readonly unpaid: () => boolean; readonly newQuest: string; readonly presentation: Omit<QuestPresentationOptions, 'reward'>; readonly beat: Omit<QuestRewardSpec, 'when' | 'finish'> }): () => QuestPresentation | null {
  const runtime = ctx.game.runtime, live = runtime?.world && runtime.play ? runtime : null, { burst, pay } = reward;
  const presentation: QuestPresentationOptions = { ...o.presentation, reward: { ...o.beat, when: () => o.unpaid() && quest.isComplete, finish: pay } };
  const entered = live !== null && retainsRuntimeServices(ctx) ? installEnteredQuestPresentation(ctx, quest, presentation) : null;
  const view = live === null || entered !== null ? null : installQuestPresentation(ctx, quest, presentation);
  ctx.scope.onDispose(quest.observe({ complete: () => { if (live === null) pay(); } }));
  if (!quest.isComplete) ctx.game.runtime?.play?.hud.toast(o.newQuest);
  ctx.system({ id: o.id, phase: 'update', run: (dt) => { burst.update(dt, o.player); } });
  ctx.scope.onDispose(() => { burst.update(3, o.player); burst.dispose(); });
  return () => entered === null ? view : entered();
}

/** A rewarded quest's strings: the reward's toast, the new-quest toast's lead, the quest's title and the beat's kicker and subtitle. */
export interface RewardedQuestStrings { readonly reward: string; readonly newQuest: string; readonly quest: string; readonly rewardKicker: string; readonly rewardSubtitle: string }
/** The NPC's existing resource owners lend geometry/material, flags and dressing; the binding supplies only data. */
export interface QuestNpcPorts {
  readonly player: Vector3;
  readonly flags: Pick<Flags, 'has'>;
  readonly model: (id: string) => { readonly geometry: NonNullable<PivotNpcPorts['source']>; readonly material?: Material } | null;
  readonly dress?: PivotNpcPorts['dress'];
}
/** Bind an admitted quest NPC without replacing its model, material, motion, collider or missing-model policy. */
export function installQuestNpc(ctx: PivotNpcLevel, input: unknown, ports: QuestNpcPorts): ReturnType<NonNullable<RewardedQuestPorts['npc']>> {
  const binding = parseQuestNpcBinding(input), resource = ports.model(binding.npc.figure.model);
  if (resource === null && binding.missing === 'omit') return null;
  const met = (): boolean => binding.met === 'flag' && ports.flags.has(binding.npc.metFlag);
  const figure = installPivotNpc({ root: ctx.root, piece: piece => { ctx.piece(piece); },
    system: spec => { ctx.system({ ...spec, id: binding.system }); } }, binding.npc, {
    source: resource?.geometry ?? null, ...(resource?.material === undefined ? {} : { material: resource.material }),
    groundAt: (x, z) => {
      if (binding.ground.at !== null && (x !== binding.ground.at.x || z !== binding.ground.at.z)) throw new Error(binding.ground.error);
      return binding.ground.height;
    }, player: ports.player, met, file: binding.sourceFile,
    ...(ports.dress === undefined ? {} : { dress: ports.dress }),
  });
  if (resource === null && binding.update === 'always') ctx.system({ id: binding.system, phase: 'update', run: (dt, t) => { figure.update(dt, t, ports.player, met()); } });
  return { row: binding.npc, figure, label: binding.label };
}
/** Bind a root-declared NPC by identity; missing declarations refuse before any model or resource is borrowed. */
export function installDeclaredQuestNpc(ctx: PivotNpcLevel, source: Pick<Shardfile, 'questNpcs'>, id: string, ports: QuestNpcPorts): ReturnType<typeof installQuestNpc> {
  const binding = source.questNpcs?.find(row => row.npc.id === id);
  if (binding === undefined) throw new Error(`Undeclared quest NPC ${id}`);
  return installQuestNpc(ctx, binding, ports);
}
/** What `installRewardedQuest` is lent beyond the runtime quest's ports (flags, facts, marker places). */
export interface RewardedQuestPorts extends RuntimeQuestPorts {
  /** The declared quest's id and the reward burst's system id. */
  readonly id: string; readonly rewardId: string;
  readonly strings: RewardedQuestStrings;
  readonly player: Vector3; readonly coins: RuntimeCoins;
  /** The save's once-only reward record. */
  readonly paid: () => boolean; readonly markPaid: () => void;
  /** Whether the held reward beat still shows (absent: unpaid when the quest was bound). */
  readonly unpaid?: () => boolean;
  /** The quest-giver: its row and its installed figure, made after the reward and before the presentation (absent or null: none). */
  readonly npc?: () => { readonly row: NpcRow; readonly figure: Pick<QuestPresentationNpc, 'speaker'> & { readonly head: Vector3 }; readonly label: string } | null;
  /** The presentation's other options (the places, their discovery flags). */
  readonly presentation: Omit<QuestPresentationOptions, 'reward' | 'npc' | 'introTitle'>;
  /** The reward beat's held view (absent: the player's own). */
  readonly beat?: Pick<QuestRewardSpec, 'at' | 'yaw' | 'pitch' | 'holdSeconds'>;
}
/**
 * A shard's declared quest with its coin reward in one call (SHARD-PLATFORM M3; Signal Dunes and Sky Reach): the
 * shardfile's quest bound over the shard's flags, its coins once per save through the purse, its quest-giver, and the
 * rewarded presentation (`presentRewardedQuest`) titled by the quest's strings.
 */
export function installRewardedQuest(ctx: ShardContext, source: Shardfile, o: RewardedQuestPorts): { quest: QuestState; reward: QuestReward; view: () => QuestPresentation | null } {
  const { strings: s, player } = o;
  const bound = bindPageQuest(ctx, source, o.id, { flags: o.flags, ...(o.facts === undefined ? {} : { facts: o.facts }), ...(o.place === undefined ? {} : { place: o.place }) });
  const quest = bound.state, paidAtLoad = o.paid();
  const reward = questReward(ctx, { player, coins: o.coins, amount: bound.reward.coins, paid: o.paid, markPaid: o.markPaid, toast: s.reward });
  const giver = o.npc?.() ?? null, npc = giver === null ? null
    : { npc: npcDef(giver.row), at: giver.figure.head, label: giver.label, speaker: giver.figure.speaker, radius: giver.row.talkRadius };
  const view = presentRewardedQuest(ctx, quest, reward, { id: o.rewardId, player, unpaid: o.unpaid ?? (() => !paidAtLoad), newQuest: `${s.newQuest} · ${s.quest}`,
    presentation: { ...o.presentation, introTitle: s.quest, ...(npc === null ? {} : { npc }) },
    beat: { kicker: s.rewardKicker, title: s.quest, subtitle: s.rewardSubtitle, ...o.beat } });
  return { quest, reward, view };
}

/** Enter a page's declared movers: the feed's owner, lent to the quest page's mover facet. */
export const enterPageMovers: typeof enterMovers = (...args) => enterMovers(...args);

/** A real prompt awaiting its admitted page action; using it before binding refuses. */
export function questPagePrompt(label:string,position:Vector3,radius:number):Interactable {
  return {label,position,radius,onInteract:()=>{throw new Error('Quest prompt is not bound');}};
}

/** Create named prompt frames from admitted rows, borrowing the actual world positions. */
/** Admitted shard page rows, or independently admitted presentation over caller-owned native rules. */
type QuestPageSource=Pick<Shardfile,'questHost'>|({readonly actions:readonly unknown[]}&Readonly<Record<string,unknown>>);
function questPageData(source:QuestPageSource):QuestPageInteractionsData {
  const data='actions' in source?source:source.questHost?.page;
  if(data===undefined)throw new Error('Page interactions need admitted presentation rows');
  return parseQuestPageInteractions(data);
}
function questPageObservations(data:QuestPageInteractionsData,owners:ReadonlyMap<string,unknown>,provided?:ReadonlyMap<string,()=>boolean>,needed?:ReadonlySet<string>):Map<string,()=>boolean> {
  const observations=new Map(provided);
  for(const row of data.bindings?.observations??[])if(!observations.has(row.target)&&(needed===undefined||needed.has(row.target))){
    const target=readBorrowedOwner(owners,row);if(target===null||typeof target.value!=='boolean')throw new Error(`Invalid borrowed observation ${row.target}`);
    observations.set(row.target,()=>{const current=readBorrowedOwner(owners,row);if(current===null||typeof current.value!=='boolean')throw new Error('Borrowed observation changed type');return current.value;});
  }
  return observations;
}
/** Resolve selected positions and conditional label/reach owners before returning any unregistered prompt. */
export function createQuestPagePrompts<const Names extends readonly string[]>(source:QuestPageSource,
  owners:ReadonlyMap<string,unknown>,names:Names,ports?:{readonly flags:Pick<Flags,'has'>;readonly observations?:ReadonlyMap<string,()=>boolean>}):{readonly [K in keyof Names]:Interactable} {
  if(names.length>128)throw new Error('Quest prompt selection must be bounded');
  const data=questPageData(source);
  const frames=names.map(id=>{
    const row=data.prompts?.find(entry=>entry.id===id);if(row===undefined)throw new Error(`Undeclared quest prompt ${id}`);
    if((row.when!==undefined||(row.labels?.length??0)>0)&&ports===undefined)throw new Error('Conditional quest prompt needs its flag owner');
    const field=readBorrowedOwner(owners,row.at);if(!(field?.value instanceof Vector3))throw new Error('Quest prompt needs its actual position');
    return {row,position:field.value};
  });
  const needed=new Set(frames.flatMap(({row})=>[row.when].concat((row.labels??[]).map(label=>label.when))).flatMap(condition=>(condition?.all??[]).concat(condition?.any??[],condition?.none??[])));
  const observations=questPageObservations(data,owners,ports?.observations,needed);
  const state={has:(id:string):boolean=>observations.get(id)?.()??ports?.flags.has(id)??false};
  return frames.map(({row,position})=>row.when===undefined&&row.labels===undefined?questPagePrompt(row.label,position,row.radius):{
    position,get label(){return row.labels?.find(label=>testFlags(state,label.when))?.text??row.label;},
    get radius(){return testFlags(state,row.when)?row.radius:0;},onInteract:()=>{throw new Error('Quest page prompt is not bound');},
  }) as {readonly [K in keyof Names]:Interactable};
}

/** Borrowed view ports for declared page interaction presentation. Native rules remain the state owner. */
export interface QuestPageInteractionPorts {
  readonly flags:Pick<Flags,'has'|'set'>; readonly rules?:InteractionRules;
  /** Compiled presentation effects resolve scene resources from this context. */
  readonly context?: Pick<ShardContext, 'scope' | 'product'>;
  readonly interactions?:ConstructorParameters<typeof InteractionRules>[1];
  /** Construct these admitted prompts under the reserved borrowed owner `prompts`. */
  readonly promptIds?:readonly string[];
  /** Register the preflighted actual prompts in their declared binding order. */
  readonly interactables?:Interactable[];
  readonly labels?:ReadonlyMap<string,Pick<Interactable,'label'>>;
  readonly visible?:ReadonlyMap<string,{visible:boolean}>;
  readonly calls?:ReadonlyMap<string,()=>void>;
  readonly observations?:ReadonlyMap<string,()=>boolean>;
  readonly toast:(text:string)=>void;
  /** Borrow the entered quest timer; exit cancellation remains with its original scope. */
  readonly timer?:Pick<QuestViews,'timeout'>;
  /** Actual world objects, named by the admitted bounded binding rows. */
  readonly owners?:ReadonlyMap<string,unknown>;
}
/** Validated presentation actions; run returns the native acceptance and action supplies a prompt callback. */
export interface QuestPageInteractions {
  readonly run:(id:string)=>boolean; readonly action:(id:string)=>()=>void; readonly prompt:(id:string)=>Interactable;
  /** Lend the platform's admitted dispatcher to the actual held weapon; never supplies shard callbacks. */
  readonly bindWorldTargets: (landing: WorldTargetLanding) => void;
}
/** Bind page view rows only after every native rule and borrowed target resolves; seed saved view state once. */
export function bindQuestPageInteractions(source:QuestPageSource,ports:QuestPageInteractionPorts,worldTargets?:WorldTargets):QuestPageInteractions {
  const data=questPageData(source);
  const promptOwners=new Map(ports.owners),owners=ports.promptIds===undefined?(ports.owners??promptOwners):promptOwners,made=new Map<string,Interactable>();
  if(ports.promptIds!==undefined){
    if(owners.has('prompts'))throw new Error('Quest prompt owner already bound');
    const prompts=createQuestPagePrompts(source,owners,ports.promptIds,{flags:ports.flags,...(ports.observations===undefined?{}:{observations:ports.observations})});
    for(const [i,id] of ports.promptIds.entries()){const prompt=prompts[i];if(prompt===undefined||made.has(id))throw new Error('Duplicate quest prompt selection');made.set(id,prompt);}
    promptOwners.set('prompts',Object.fromEntries(made));
  }
  const labels=new Map(ports.labels), visible=new Map(ports.visible), calls=new Map(ports.calls), observations=questPageObservations(data,owners,ports.observations);
  const field=(row:BorrowedOwnerPath):ReturnType<typeof readBorrowedOwner>=>readBorrowedOwner(owners,row);
  for(const row of data.bindings?.labels??[])if(!labels.has(row.target)){
    const target=field(row);if(target===null||typeof target.value!=='string')throw new Error(`Invalid borrowed label ${row.target}`);
    labels.set(row.target,{get label(){const value=target.receiver[target.key];if(typeof value!=='string')throw new Error('Borrowed label changed type');return value;},set label(value){target.receiver[target.key]=value;}});
  }
  for(const row of data.bindings?.visible??[])if(!visible.has(row.target)){
    const target=field(row);if(target===null||typeof target.value!=='boolean')throw new Error(`Invalid borrowed visibility ${row.target}`);
    visible.set(row.target,{get visible(){return target.receiver[target.key]===true;},set visible(value){target.receiver[target.key]=value;}});
  }
  const callable=(value:unknown):value is (...args:readonly unknown[])=>unknown=>typeof value==='function';
  for(const row of data.bindings?.calls??[])if(!calls.has(row.target)){
    const initial=readBorrowedOwner(owners,row);
    if(!(row.optional===true&&(initial?.value??null)===null)&&(initial===null||!callable(initial.value)))throw new Error(`Invalid borrowed call ${row.target}`);
    const argument=(arg:NonNullable<typeof row.args>[number]):unknown=>{
      if(typeof arg!=='object')return arg;
      const value=readBorrowedOwner(owners,arg);if(!(value?.value instanceof Vector3)||!Number.isFinite(value.value.x)||!Number.isFinite(value.value.y)||!Number.isFinite(value.value.z))throw new Error(`Missing borrowed point argument ${row.target}`);return value.value;
    };
    for(const arg of row.args??[])argument(arg);
    const timer=ports.timer;if(row.delay!==undefined&&timer===undefined)throw new Error(`Missing quest timer ${row.target}`);
    const invoke=():void=>{const current=readBorrowedOwner(owners,row);if(row.optional===true&&(current?.value??null)===null)return;
      if(current===null||!callable(current.value))throw new Error(`Invalid borrowed call ${row.target}`);current.value.call(current.receiver,...(row.args??[]).map(argument));};
    calls.set(row.target,()=>{if(row.delay===undefined)invoke();else timer?.timeout(row.delay,invoke);});
  }
  const rules=ports.rules??('actions' in source?new InteractionRules(ports.flags,ports.interactions??{marks:[],rows:[]}):InteractionRules.fromDeclared(source,ports.flags));
  const view={has:(id:string):boolean=>observations.get(id)?.()??rules.has(id)};
  type Effect=QuestPageInteractionsData['actions'][number]['after'];
  const compile=(rows:Effect):(()=>void)[] => (rows??[]).map(row=>{
    if(row.kind==='emitter'){
      const context=ports.context;if(context===undefined)throw new Error('Emitter effects require their presentation context');
      const emitters=lightEmitterPresentation(residentWorldScope(context),context.product.slug);
      return ()=>{emitters.set(row.target,row.value);};
    }
    if(row.kind==='toast')return ()=>{
      const progress=row.progress;if(progress===undefined){ports.toast(row.text);return;}
      const lit=progress.flags.filter(flag=>rules.has(flag)).length;
      ports.toast(lit<progress.flags.length?`${row.text} · ${String(lit)}/${String(progress.flags.length)}`:progress.complete);
    };
    if(row.kind==='mark'){if(!rules.data.marks.some(mark=>mark.id===row.target))throw new Error(`Unknown page interaction mark ${row.target}`);return ()=>{rules.mark(row.target,row.value);};}
    if(row.kind==='call'){const call=calls.get(row.target);if(call===undefined)throw new Error(`Missing page interaction command ${row.target}`);return call;}
    if(row.kind==='label'){const target=labels.get(row.target);if(target===undefined)throw new Error(`Missing page interaction label ${row.target}`);return ()=>{target.label=row.text;};}
    const target=visible.get(row.target);if(target===undefined)throw new Error(`Missing page interaction visibility ${row.target}`);return ()=>{target.visible=row.value;};
  });
  const actions=new Map(data.actions.map(row=>{
    if(row.interaction!==undefined)rules.row(row.interaction);
    const before=compile(row.before),after=compile(row.after),refused=new Map(Object.entries(row.refused??{}).map(([reason,effects])=>[reason,compile(effects)]));
    const refusal=(reason:string):false=>{const text=row.denied?.[reason];if(text!==undefined)ports.toast(text);for(const effect of refused.get(reason)??[])effect();return false;};
    return [row.id,():boolean=>{
      for(const need of row.needs??[])if(!testFlags(view,need))return refusal(need.else??'refused');
      const beat=():void=>{for(const effect of before)effect();};
      if(row.interaction!==undefined){const result=rules.run(row.interaction,beat);if(!result.ok)return refusal(result.reason);}
      else beat();
      for(const effect of after)effect();return true;
    }] as const;
  }));
  const initial=(data.initial??[]).map(row=>({when:row.when,effects:compile(row.effects)}));
  const read=(id:string):(()=>boolean)=>{const action=actions.get(id);if(action===undefined)throw new Error(`Unknown page interaction ${id}`);return action;};
  const registered:Interactable[]=[];
  const isPrompt=(target:Record<string,unknown>):target is Record<string,unknown>&Interactable=>typeof target['label']==='string'
    &&target['position'] instanceof Vector3&&typeof target['radius']==='number'&&Number.isFinite(target['radius'])&&target['radius']>=0&&typeof target['onInteract']==='function';
  const prompts=(data.bindings?.prompts??[]).map(row=>{
    const prompt=readBorrowedOwner(owners,row),action=read(row.target);
    if(prompt===null||typeof prompt.value!=='function')throw new Error(`Invalid borrowed prompt ${row.target}`);
    if(ports.interactables!==undefined){if(prompt.key!=='onInteract'||!isPrompt(prompt.receiver))throw new Error(`Invalid registered quest prompt ${row.target}`);registered.push(prompt.receiver);}
    return ()=>{prompt.receiver[prompt.key]=()=>{action();};};
  });
  for(const row of data.world??[])if(row.action!==undefined)read(row.action);
  const targetData = worldTargets ?? ('files' in source && typeof source['files'] === 'object' && source['files'] !== null
    ? outputDescriptor({files:source['files']})?.sections.get('world/targets') : undefined);
  // Effects name native interaction identities, independently of page action aliases.
  const targetActions = new Map<string, {run:()=>boolean}>();
  if (targetData !== undefined) for (const row of rules.data.rows) {
    const matches = data.actions.filter(action => action.interaction === row.id);
    if (matches.length === 1) {
      const action = matches[0]; if (action !== undefined) targetActions.set(row.id, {run:read(action.id)});
    }
  }
  const parsedTargets = targetData === undefined ? undefined : parseWorldTargets(targetData);
  const contacts = parsedTargets === undefined || parsedTargets.targets.length === 0 ? null : new WorldTargetHost(parsedTargets, {
    flags:{has:id=>rules.has(id),set:id=>{ports.flags.set(id);}}, interactions:targetActions, hints:{show:ports.toast},
  });
  for(const bind of prompts)bind();
  for(const row of initial)if(testFlags(view,row.when))for(const effect of row.effects)effect();
  ports.interactables?.push(...registered);
  return {run:id=>read(id)(),action:id=>{const action=read(id);return ()=>{action();};},prompt:id=>{const prompt=made.get(id);if(prompt===undefined)throw new Error(`Undeclared quest prompt ${id}`);return prompt;},
    bindWorldTargets:landing=>{if(contacts===null)throw new Error('Missing admitted world targets');landing.bindWorldTargets(contacts);}};
}

/** Live page owners lent to the already admitted quest stages. */
export interface PageQuestStagePorts {
  readonly flags: Pick<Flags, 'has' | 'set'>;
  readonly actor?: (id: string) => { readonly alive: boolean } | null;
  readonly observations?: ReadonlyMap<string, () => boolean>;
  readonly bindings?: ReadonlyMap<string, readonly DirectorActionBinding[]>;
  readonly motion?: Pick<FollowedMovers, 'atEnd'> & Partial<Pick<FollowedMovers, 'pose'>>;
}
/** Advance a declared event stage; tick stages are registered with the page owner. */
export interface PageQuestStages { readonly advance: (id: string) => void }
/** Use the native quest's stage rows on the page without creating another saved cursor. */
export function bindPageQuestStages(ctx: Pick<ShardContext, 'system'>, source: Pick<Shardfile, 'questHost'>, ports: PageQuestStagePorts): PageQuestStages {
  const host = source.questHost;
  if (host === undefined || host === null) throw new Error('Missing admitted page quest host');
  const observations = new Map<string, () => boolean>();
  for (const row of host.observations) {
    if (row.kind === 'all-dead') {
      const actor = ports.actor;
      if (actor === undefined) throw new Error('Quest stage needs its live actor owner');
      observations.set(row.binding, () => row.actors.length > 0 && row.actors.every(id => actor(id)?.alive === false));
    } else if (row.kind === 'owner') {
      const owner = ports.observations?.get(row.owner);
      if (owner === undefined) throw new Error(`Unbound page quest observation ${row.owner}`);
      observations.set(row.binding, owner);
    } else if (row.kind === 'mover') {
      const motion = ports.motion;
      if (motion === undefined) throw new Error(`Unbound page quest mover ${row.mover}`);
      const pose = motion.pose?.bind(motion);
      if (row.state === 'enabled' && pose === undefined) throw new Error(`Missing page mover pose ${row.mover}`);
      const read = row.state === 'at-end' ? () => motion.atEnd(row.mover) : () => {
        if (pose === undefined) throw new Error('Missing page mover pose'); return pose(row.mover).enabled;
      };
      read(); observations.set(row.binding, read);
    } else {
      throw new Error(`Quest ${row.kind} observation needs its native mechanic owner`);
    }
  }
  const observe = (binding: string): boolean => {
    const owner = observations.get(binding);
    if (owner === undefined) throw new Error(`Unbound page quest observation ${binding}`);
    return owner();
  };
  const stages = new Map<string, BoundDirectorActions>();
  for (const row of host.stages) {
    const stage = bindDirectorActions(row.row, { flags: ports.flags, observe, bindings: ports.bindings?.get(row.row.id) ?? [],
      initial: row.seed !== undefined && ports.flags.has(row.seed.flag) ? row.seed.initial : row.initial });
    stages.set(row.row.id, stage);
    if (row.tick) ctx.system({ id: row.row.id, phase: 'update', run: stage.advance });
  }
  return { advance: id => {
    const stage = stages.get(id);
    if (stage === undefined) throw new Error(`Undeclared page quest stage ${id}`);
    stage.advance();
  } };
}

/** A declared NPC's existing copied geometry provider; prepared pivots stay prepared. */
export type QuestNpcModelSource =
  { readonly kind: 'mesh'; readonly read: () => BufferGeometry | null } |
  { readonly kind: 'pivots'; readonly read: () => { readonly geometry: BufferGeometry; readonly map: Texture; readonly pivots?: PivotNpcGeometry } | null;
    readonly material: (map: Texture) => Material };
/** Model identity and preparation form, shared by page and Explorer consumers. */
export interface QuestNpcModelRow { readonly id: string; readonly kind: QuestNpcModelSource['kind']; readonly material?: string }

function questNpcModelReader(row: QuestNpcModelRow, source: QuestNpcModelSource): QuestNpcPorts['model'] {
  if (row.kind !== source.kind) throw new Error('Quest model provider has the wrong preparation form');
  return id => {
    if (id !== row.id) throw new Error(`Unknown quest model ${id}`);
    if (source.kind === 'mesh') {
      const geometry = source.read();
      return geometry === null ? null : { geometry };
    }
    const copied = source.read();
    if (copied === null) return null;
    copied.geometry.dispose();
    if (copied.pivots === undefined) throw new Error('Missing authored NPC pivots');
    return { geometry: copied.pivots, material: source.material(copied.map) };
  };
}
/** An Explorer specimen uses the same admitted figure row and model provider as its live NPC. */
export function questNpcSpecimen(source: Pick<Shardfile, 'questNpcs'>, id: string, ports: QuestNpcModelSource): Group;
export function questNpcSpecimen(source: Pick<Shardfile, 'questNpcs'>, id: string, model: QuestNpcModelRow, ports: QuestNpcModelSource): Group;
/** The admitted figure supplies its model identity; the borrowed provider supplies the preparation form. */
export function questNpcSpecimen(source: Pick<Shardfile, 'questNpcs'>, id: string, modelOrPorts: QuestNpcModelRow | QuestNpcModelSource, borrowed?: QuestNpcModelSource): Group {
  const binding = source.questNpcs?.find(row => row.npc.id === id);
  if (binding === undefined || 'kind' in binding) throw new Error(`Undeclared quest NPC ${id}`);
  let model: QuestNpcModelRow, ports: QuestNpcModelSource;
  if ('read' in modelOrPorts) { ports = modelOrPorts; model = { id: binding.npc.figure.model, kind: ports.kind }; }
  else { if (borrowed === undefined) throw new Error('Missing quest model provider'); model = modelOrPorts; ports = borrowed; }
  const copied = questNpcModelReader(model, ports)(binding.npc.figure.model);
  return copied === null ? new Group() : pivotNpcParts(binding.npc, copied.geometry, copied.material).root;
}

/** Saved quest presentation rows shared by native and flag-backed rewards. */
export interface PersistedQuestRows {
  readonly id: string; readonly rewardId: string; readonly npc: string;
  readonly strings: RewardedQuestStrings; readonly persistence: PagePersistenceRows;
  readonly model?: QuestNpcModelRow;
  readonly places: readonly PlacePoint[];
  readonly markers?: Readonly<Record<string, NonNullable<ReturnType<NonNullable<RuntimeQuestPorts['place']>>>>>;
  readonly presentationFlags?: boolean; readonly projectProgress?: boolean;
  readonly unpaid?: 'live' | 'initial';
  readonly beat?: { readonly at: { readonly x: number; readonly y: number; readonly z: number };
    readonly toward: { readonly x: number; readonly z: number }; readonly pitch: number; readonly holdSeconds: number };
  readonly finishFlags?: readonly string[];
  readonly stages?: readonly { readonly system: string; readonly data: unknown; readonly initial: readonly Readonly<Record<string, boolean>>[] }[];
  /** A bounded transient startup repair; saved flags are its continuation. */
  readonly repair?: { readonly data: unknown; readonly initial: readonly Readonly<Record<string, boolean>>[];
    readonly legacyObservation: string; readonly advances: number };
}
/** Borrow the existing model/material owner and purse; rows own quest composition. */
export interface PersistedQuestPorts {
  readonly player: Vector3; readonly flags?: Flags; readonly coins?: RuntimeCoins;
  readonly model: QuestNpcPorts['model'] | QuestNpcModelSource; readonly dress?: QuestNpcPorts['dress'];
}
/** Live quest services over the original durable flag, reward and boss owners. */
export interface PersistedQuest {
  readonly quest: QuestState; readonly flags: Flags; readonly reward: QuestReward; readonly burst: CoinMotion;
  readonly view: QuestPresentation | null; readonly persistence: PagePersistence;
  readonly facts: PagePersistence['facts']; readonly finished: () => void;
}
export function installPersistedQuest(ctx: ShardContext, source: Shardfile,
  rows: PersistedQuestRows & { readonly persistence: PagePersistenceRows & { readonly boss: NonNullable<PagePersistenceRows['boss']> } },
  ports: PersistedQuestPorts): PersistedQuest & { readonly persistence: PagePersistence & { readonly boss: NonNullable<PagePersistence['boss']> } };
export function installPersistedQuest(ctx: ShardContext, source: Shardfile, rows: PersistedQuestRows, ports: PersistedQuestPorts): PersistedQuest;
/** Compose declared NPCs, saved rewards and flag stages without replacing a save owner. */
export function installPersistedQuest(ctx: ShardContext, source: Shardfile, rows: PersistedQuestRows, ports: PersistedQuestPorts): PersistedQuest {
  const flags = ports.flags ?? new Flags(ctx.manifest.slug);
  const persistence = bindPagePersistence(ctx, source, rows.persistence, flags, ctx.manifest.slug);
  if (rows.projectProgress === true) persistence.bindProgress(ctx.game.runtime?.play?.progress);
  if (rows.repair !== undefined) {
    const repairRow = rows.repair;
    if (!Number.isSafeInteger(repairRow.advances) || repairRow.advances < 1 || repairRow.advances > 16) throw new Error('Quest repair must be bounded');
    const legacy = !persistence.rewarded.read() && persistence.legacyPaid;
    const repair = bindDirectorActions(repairRow.data, { flags, bindings: [], initial: repairRow.initial, observe: binding => {
      if (binding !== repairRow.legacyObservation) throw new Error('Unknown quest repair observation');
      return legacy;
    } });
    for (let step = 0; step < repairRow.advances; step++) repair.advance();
  }
  const beat = rows.beat;
  let model: QuestNpcPorts['model'];
  if (typeof ports.model === 'function') model = ports.model;
  else {
    if (rows.model === undefined) throw new Error('Missing declared quest model');
    model = questNpcModelReader(rows.model, ports.model);
  }
  const installed = installRewardedQuest(ctx, source, { id: rows.id, rewardId: rows.rewardId, strings: rows.strings,
    flags, facts: persistence.facts, player: ports.player, coins: ports.coins ?? bindRuntimeCoins(ctx, null),
    paid: persistence.rewarded.read, markPaid: () => { persistence.rewarded.write(true); },
    ...(rows.unpaid === 'live' ? { unpaid: () => !persistence.rewarded.read() } : {}),
    ...(rows.markers === undefined ? {} : { place: marker => rows.markers?.[marker.id] }),
    presentation: { places: [...rows.places], ...(rows.presentationFlags === true ? { flags } : {}) },
    ...(beat === undefined ? {} : { beat: { at: new Vector3(beat.at.x, beat.at.y, beat.at.z),
      yaw: Math.atan2(-(beat.toward.x - beat.at.x), -(beat.toward.z - beat.at.z)), pitch: beat.pitch, holdSeconds: beat.holdSeconds } }),
    npc: () => installDeclaredQuestNpc(ctx, source, rows.npc, { player: ports.player, flags, model,
      ...(ports.dress === undefined ? {} : { dress: ports.dress }) }),
  });
  for (const row of rows.stages ?? []) {
    const stage = bindDirectorActions(row.data, { flags, bindings: [], initial: row.initial });
    ctx.system({ id: row.system, phase: 'update', run: stage.advance });
  }
  return { quest: installed.quest, flags, reward: installed.reward, burst: installed.reward.burst, facts: persistence.facts, persistence,
    get view() { return installed.view(); }, finished: () => {
      persistence.rewarded.write(true);
      for (const flag of rows.finishFlags ?? []) flags.set(flag);
    } };
}

/** What a boss row's browser encounter is given: its rows, its view-free script, its body and its record. */
export interface BossViewSpec {
  readonly definition: BossDefinition;
  /** The row a server publishes this fight under, where that isn't its definition's id. */
  readonly row?: string;
  /** The encounter's authored stage rows (`DirectorBossBrain`). */
  readonly stages: unknown;
  readonly script: BossScript;
  /** The player's live position (the arena check, the reward's target). */
  readonly player: Vector3;
  /** The boss's live body: a hit on it is refused while `shielded`. */
  readonly body: () => Animal | null;
  readonly shielded: () => boolean;
  readonly saved: BossSaved;
  readonly persist: (value: BossSaved) => void;
  /** What a page shows of a win a server's row reports, where a page's script would have shown it. */
  readonly won?: () => void;
  /** A fight began on a server's row: what `won` will say is read now, ahead of the win's own flags. */
  readonly started?: () => void;
  /** A quest armed the fight on a server's row, where `installBossView`'s summon would have said so. */
  readonly summoned?: () => void;
  /** The one point an intro faces, for a fight whose intro doesn't turn to its body. */
  readonly introAt?: Vector3;
  /** The first fall's reward (absent: the victory callback pays it). */
  readonly spawnReward?: () => void;
  /** Toast the brain's own lines on the HUD (a later fall's); absent, the shard's victory callback says it. */
  readonly toast?: boolean;
}

/**
 * A boss row's encounter in the browser (SHARD-PLATFORM BR-2), the twin of `installBossRow` in the renderer-free host:
 * the engine's `BossBrain` under its authored stages over the shard's view-free script, with the engine's `BossBar` (boss
 * bar, name card, skip hold), the player's weapons locked through the intro, respawn / face-toward on the player's motor,
 * its toasts on the HUD when asked, and `damage.modify` refusing hits on the body while the script is shielded. Signal's Dune Matriarch
 * and Sky Reach's Storm Roc are these.
 */
export class BossView extends DirectorBossBrain {
  private readonly pinned: () => Animal | null;
  /** J130: a bar has one driver. On the wire the row draws it and this page's brain never steps. */
  private readonly rowBar: BossRowBar | null;
  private readonly rowId: string;
  constructor(ctx: ShardContext, spec: BossViewSpec) {
    const bar = new BossBar(), motor = (): { position: Vector3; yaw: number } | null => ctx.game.runtime?.world?.player ?? null, aim = new Vector3();
    const faceToward = (target: Vector3): void => { const m = motor(); if (m) m.yaw = Math.atan2(m.position.x - target.x, m.position.z - target.z); };
    ctx.scope.onDispose(() => { bar.scope.dispose(); });
    ctx.answer('damage.modify', (request) => { const body = spec.body(); return request !== null && body !== null && request.target === body.combatActor() && spec.shielded() ? null : request; });
    super(spec.definition, spec.script, { events: ctx.app.events, player: { position: spec.player },
      lockInput: (on) => { ctx.game.runtime?.play?.weapons.setEnabled(!on); }, skipHeld: () => ctx.app.input.held('skip'),
      respawn: (pos, yaw) => { const m = motor(); if (m) { m.position.copy(pos); m.yaw = yaw; } },
      faceToward, spawnReward: () => { spec.spawnReward?.(); }, toast: spec.toast === true ? (message) => { ctx.game.runtime?.play?.hud.toast(message); } : undefined,
      persist: spec.persist }, bar, spec.saved, spec.stages);
    this.pinned = spec.body; this.rowId = spec.row ?? spec.definition.id;
    this.rowBar = new BossRowBar(bar, { ...spec.definition, id: spec.row ?? spec.definition.id }, null, { lock: on => { ctx.game.runtime?.play?.weapons.setEnabled(!on); }, ...(spec.won === undefined ? {} : { won: spec.won }), ...(spec.summoned === undefined ? {} : { summoned: spec.summoned }),
      face: body => { faceToward(spec.introAt ?? (wirePage.head(body, aim) ? aim : spec.script.rewardPoint())); },
      attempt: outcome => { if (outcome === 'started') spec.started?.(); ctx.app.events.emit('boss.attempt', { boss: spec.definition.id, outcome }); } });
  }
  /** The boss's body is drawn at any distance (no tier draw-distance shrink), whichever body is up this frame. */
  override update(dt: number, t: number): void {
    const body = this.pinned();
    if (body !== null) body.drawPinned = true;
    if (this.rowBar !== null) {
      const rows = wirePage.encounters(), row = rows.find(entry => entry.id === this.rowId), rowBody = row === undefined ? null : wirePage.rowBody(row.body);
      if (rowBody !== null) rowBody.drawPinned = true;
      this.rowBar.draw(rows, dt); return;
    }
    super.update(dt, t);
  }
}

/**
 * Registers a browser boss with the level's encounters under `id`: armed now when `armed`, answering the health model's
 * death checkpoint, updated each frame. `summon` arms a dormant boss (`onSummon` runs then, e.g. its summons toast).
 */
export function installBossView<T extends BossView>(ctx: ShardContext, id: string, brain: T, armed: boolean, onSummon?: () => void): { boss: T; summon: () => void } {
  const live = ctx.app.encounters.boss(id, brain, ctx.scope);
  if (armed) live.arm();
  ctx.answer('death.checkpoint', (value) => live.onPlayerDeath() || value === true);
  ctx.system({ id, phase: 'update', run: (dt, t) => { live.update(dt, t); } });
  return { boss: live, summon: () => { if (live.state === 'dormant') { live.arm(); onSummon?.(); } } };
}

/** A body boss's rows: its encounter definition, its authored stages and its spawned or held fight profile. */
export interface RowBossRows { readonly definition: BossDefinition; readonly stages: unknown; readonly profile: unknown; /** The server's row for this fight. */ readonly row?: string }
/** A boss record: the saved state to start from and how it persists. */
export interface RowBossRecord { readonly saved: BossSaved; readonly persist: (value: BossSaved) => void; /** The record as it stands now. */ readonly read: () => BossSaved }
/**
 * What a `RowBossView` is lent. A spawned body (a fresh body per checkpoint): the bound body row, its arena
 * presentation (reward floor, respawn, storm, toasts), its admitted shardfile (the storm shells' look materials), its
 * coins through the purse and the victory's beat. A held body: the retained body, its brain and the victory callback,
 * which pays and toasts itself.
 */
export type RowBossPorts = { readonly player: Vector3; readonly record: RowBossRecord;
  /** A page on a server shows a win without writing it: `won` hears the row's win, `started` its fight beginning. */
  readonly won: () => void; readonly started: () => void } & ({
  readonly body: RuntimeBoss; readonly presentation: MarkedBossPresentation; readonly reward: number; readonly coins: RuntimeCoins;
  readonly source: Shardfile; readonly onDown?: () => void;
} | { readonly held: Animal | null; readonly brain: HeldBossBrain | null; readonly victory: (at: Vector3) => void });

interface RowBossMade { readonly spec: BossViewSpec; readonly at: Vector3 | null; readonly weather: { storm: number }; readonly after: () => void }
function rowBossSpec(ctx: ShardContext, rows: RowBossRows, ports: RowBossPorts): RowBossMade {
  const profile = parseBossProfile(rows.profile), { player, record } = ports, saved = record.saved;
  const base = { definition: rows.definition, stages: rows.stages, player, saved, persist: record.persist, ...(rows.row === undefined ? {} : { row: rows.row }),
    started: () => { Object.assign(saved, record.read()); ports.started(); } };
  if ('held' in ports) {
    if (profile.pattern !== 'held') throw new Error(`${rows.definition.id} requires its declared held-body pattern`);
    const fight = bodyBossFight(profile, { body: ports.held, brain: ports.brain, victory: ports.victory });
    return { spec: { ...base, script: fight.script, body: () => ports.held, shielded: fight.shielded, won: ports.won, introAt: fight.script.rewardPoint() }, at: null, weather: { storm: 0 }, after: () => undefined };
  }
  if (profile.pattern !== 'spawned') throw new Error(`${rows.definition.id} requires its declared spawned-body pattern`);
  const look = ports.presentation, body = ports.body, onDown = ports.onDown;
  const at = new Vector3(body.row.at[0], look.floor, body.row.at[1]);
  const scene = ctx.game.runtime?.world?.game.scene ?? new Scene(), burst = coinBurst(scene), weather = bossStorm(ctx, ports.source, player, look.storm)(scene);
  const fight = bodyBossFight<Animal>(profile, { body: { spawn: (previous) => body.spawn(previous), retire: (a) => { body.retire(a); } }, rewardPoint: at,
    respawnPoint: () => ({ pos: new Vector3(look.respawn.x, ctx.manifest.ground.terrain?.heightAt(look.respawn.x, look.respawn.z) ?? 0, look.respawn.z), yaw: look.respawn.yaw }),
    victory: () => { ctx.game.runtime?.play?.hud.toast(saved.rewardTaken ? look.toasts.rewardAgain : look.toasts.reward); onDown?.(); },
    update: (dt, strength) => { weather(dt, strength); burst.update(dt, player); } });
  return { at, weather: fight.weather, spec: { ...base, script: fight.script, body: fight.body, shielded: fight.invulnerable, toast: true,
    won: () => {
      const first = !saved.rewardTaken;
      ctx.game.runtime?.play?.hud.toast(first ? look.toasts.reward : look.toasts.rewardAgain);
      if (first) burst.spawn(player, ports.reward, () => undefined, () => undefined);
      saved.rewardTaken = true; ports.won();
    },
    summoned: () => { ctx.game.runtime?.play?.hud.toast(look.toasts.summoned); },
    spawnReward: () => { saved.rewardTaken = true; record.persist(saved); burst.spawn(player, ports.reward, ports.coins, () => undefined); } },
    after: () => {
      if (saved.defeated) onDown?.();
      ctx.scope.onDispose(() => { burst.update(3, player); burst.dispose(); const animal = fight.body(); if (animal) body.retire(animal); fight.adopt(null); });
      // J130: a page on a server steps no fight, so its row says when the storm blows, by the same phases and at the same ease.
      ctx.system({ id: `${rows.definition.id}.storm`, phase: 'update', run: dt => {
        const row = wirePage.encounters().find(entry => entry.id === (rows.row ?? rows.definition.id));
        const goal = (row?.state === 'fight' || row?.state === 'beat') && profile.fight.stormPhases.includes(row.phase) ? 1 : 0;
        fight.weather.storm = easeField(fight.weather.storm, goal, dt, { seconds: profile.fight.stormFade });
        weather(dt, fight.weather.storm); burst.update(dt, player);
      } });
    } };
}

/**
 * A declared body boss in the browser (SHARD-PLATFORM SF27; Signal's Dune Matriarch, spawned, and Sky Reach's Storm Roc,
 * held): its profile through the platform's view-free `bossFight`, the `BossView` over it. A spawned body adds the
 * presentation row's views (its storm through `bossStorm`, the reward's coin burst from the arena floor, the respawn on
 * the ground) and its toasts; the view refuses hits while the fight is invulnerable.
 */
export class RowBossView extends BossView {
  /** The arena's reward point (a spawned body's spot on the floor; null held). */
  readonly at: Vector3 | null;
  /** The storm's strength 0..1 (captures and tests read it). */
  readonly weather: { storm: number };
  /** The boss's body while it is up. */
  readonly body: () => Animal | null;
  constructor(ctx: ShardContext, rows: RowBossRows, ports: RowBossPorts) {
    const made = rowBossSpec(ctx, rows, ports);
    super(ctx, made.spec);
    this.at = made.at; this.weather = made.weather; this.body = made.spec.body;
    made.after();
  }
}

/** Actual owners lent to the same held or spawned presentation interpreter. */
export type DeclaredFightPorts = { readonly player: Vector3; readonly flags: Pick<Flags, 'has' | 'set'>;
  readonly facts: (name: string, actor: string) => unknown; readonly armed: boolean } & ({
  readonly kind: 'held'; readonly held: Animal | null;
  readonly record: RowBossRecord; readonly reward: (amount: number, label: string) => void;
} | { readonly kind: 'spawned'; readonly source: Shardfile; readonly coins?: RuntimeCoins;
  readonly body: RuntimeBoss;
  readonly dress?: (animal: Animal) => void;
});
/** Bind authored boss presentation at the caller's original phase, on its
 * population's actual body/controller and original record, flags and reward. */
export function bindDeclaredFight(ctx: ShardContext, row: BossViewRows | undefined, ports: DeclaredFightPorts): {
  boss: RowBossView; summon: () => void;
} {
  if (row === undefined) throw new Error('Missing declared browser fight');
  const toast = (text: string): void => { ctx.game.runtime?.play?.hud.toast(text); };
  const victory = (): void => {
    if (row.victory.once && ports.flags.has(row.victory.flag)) { if (row.victory.again !== undefined) toast(row.victory.again); return; }
    ports.flags.set(row.victory.flag); ports.facts(row.victory.fact, row.id);
    if (ports.kind === 'held') ports.reward(row.reward, row.victory.rewardLabel ?? '');
  };
  /** A win as a server's row reports it: what `victory` says, and nothing it writes. The win's own flag can reach a page first, so `again` is what stood as the fight began. */
  let again = ports.flags.has(row.victory.flag);
  const told = { started: (): void => { again = ports.flags.has(row.victory.flag); }, won: (): void => {
    if (row.victory.once && again) { if (row.victory.again !== undefined) toast(row.victory.again); return; }
    again = true;
    if (ports.kind === 'held') ports.reward(row.reward, row.victory.rewardLabel ?? '');
  } };
  let boss: RowBossView, summoned: (() => void) | undefined;
  const rows = { definition: row.definition, stages: row.stages, profile: row.profile, ...(row.row === undefined ? {} : { row: row.row }) };
  if (ports.kind === 'held') {
    boss = new RowBossView(ctx, rows, { player: ports.player, held: ports.held, brain: ports.held === null ? null : { phase: 0, fighting: false, restart: () => undefined }, victory, record: ports.record, ...told });
  } else {
    if (row.record === undefined) throw new Error('Spawned presentation requires its declared record');
    const body = ports.body;
    const record = bindPageBossRecord(ctx, ports.source, row.record, ports.flags);
    const presentation = parseMarkedBossPresentation(row.presentation);
    boss = new RowBossView(ctx, rows, { player: ports.player, body, record: { saved: record.read(), persist: record.write, read: record.read }, presentation,
      reward: row.reward, coins: ports.coins ?? bindRuntimeCoins(ctx, null), onDown: victory, source: ports.source, ...told });
    summoned = () => { toast(presentation.toasts.summoned); };
  }
  return installBossView(ctx, row.id, boss, ports.armed, summoned);
}
