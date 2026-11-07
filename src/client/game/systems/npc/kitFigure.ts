/** Client-only presentation of a figure built from kit meshes and moved by its admitted pose rows. */
import * as THREE from 'three';
import * as v from 'valibot';
import type { Scope } from '@wildshard/engine/app/scope';
import { lowPolyLookMaterial } from '@wildshard/engine/world/lowpolyKit';
import type { SkyRig } from '@wildshard/engine/world/skyRig';
import { KitFigureSchema, type KitFigureRows } from '@wildshard/format/kitFigure';
import { FigureRowSchema } from '@wildshard/format/figures';
import { playClips, type ClipCtx } from '../../../../shared/game/plugin/animation';
import { installChannelPrograms } from '../../../../shared/game/plugin/channelPrograms';
import { createClientScene, bindWorldSceneParts } from '../../plugin/scene';
import type { SceneHandles } from '../../shardfile/sceneHandles';
import { FigureRows } from './figureRows';

/** What the shard lends the recipe: its kit geometries and any extra objects (a fire, its smoke), by recipe id, and the
 *  product's client channels holding the figure's attention group `npc.<name>`. */
export interface KitFigurePorts { readonly geometry: ReadonlyMap<string, THREE.BufferGeometry>; readonly objects?: ReadonlyMap<string, THREE.Object3D>; readonly channels: unknown }

/** 0 → 1 → 0 over a gesture: eased in over its first quarter, out over its last */
function ease(u: number): number {
  const a = Math.min(1, u / 0.25), b = Math.min(1, (1 - u) / 0.25), s = Math.max(0, Math.min(a, b));
  return s * s * (3 - 2 * s);
}

/**
 * A kit figure (format/kitFigure `KitFigureSchema`): the recipe built at the figure's own origin, every bound part and
 * lent object published as `<name>.<part>.source` (the group as `<name>.source`) for its figure row, and per frame the
 * gestures, the turn to face the player and the head's attention (its channel programs: owner `focus` what it observes,
 * owner `figure` the pose they keep) and the pose clips. `companions` hide with a `hide` figure.
 */
export class KitFigure {
  readonly group: THREE.Group = new THREE.Group();
  readonly companions: THREE.Object3D[] = [];
  readonly presentation: FigureRows;
  private readonly rows: KitFigureRows;
  private readonly drawDistance: number;
  private readonly bones: Record<string, THREE.Object3D> = {};
  private readonly figure: THREE.Object3D;
  private readonly pose: ClipCtx = { bones: {}, t: 0, phase: 0, speed: 0, alive: true, deathT: 0, attack: -1, mem: {} };
  private readonly focus = { distance: 0, toward: 0, talking: 0, turns: 1, playerY: 0, headY: 0, override: 0, overrideYaw: 0, overridePitch: 0, offsetYaw: 0, offsetPitch: 0 };
  private readonly gaze = { turn: 0, headYaw: 0, headPitch: 0, glanceT: 0, glanceYaw: 0, glancePitch: 0 };
  private readonly motion: ReturnType<typeof installChannelPrograms>;
  private readonly timers: number[];
  private readonly armed: boolean[];
  private gesture = -1;
  private clock = 0;

  /** `name` the figure catalogue id, `figure` its figure row, `input` its kit rows. */
  constructor(sky: SkyRig, name: string, figure: unknown, input: unknown, ports: KitFigurePorts, resources: SceneHandles, owner?: Scope) {
    const rows = this.rows = v.parse(KitFigureSchema, input);
    const made = createClientScene(rows.scene.recipe, { geometry: ports.geometry, materials: new Map([['coat', lowPolyLookMaterial(sky, rows.material)]]), objects: ports.objects ?? new Map() });
    const parts = new Map<string, THREE.Object3D>(ports.objects);
    for (const [part, object] of Object.entries(bindWorldSceneParts(made, rows.scene.parts, rows.scene.bindings))) if (object instanceof THREE.Object3D) parts.set(part, object);
    const figurePart = parts.get('figure');
    if (figurePart === undefined) throw new Error(`Kit figure ${name} has no figure pivot`);
    this.figure = figurePart;
    this.group.name = made.root.name; this.group.add(...made.root.children);
    resources.publish(`${name}.source`, this.group);
    for (const [part, object] of parts) { this.bones[part] = object; resources.publish(`${name}.${part}.source`, object); }
    this.pose.bones = this.bones;
    this.motion = installChannelPrograms(ports.channels, `npc.${name}`, new Map<string, unknown>([['figure', this.gaze], ['focus', this.focus]]));
    this.timers = rows.gestures.map(row => row.starts.find(start => start.kind === 'every')?.first ?? 0);
    this.armed = rows.gestures.map(() => true);
    this.drawDistance = v.parse(FigureRowSchema, figure).drawDistance;
    this.presentation = new FigureRows(resources, figure, owner);
  }

  get model(): this { return this; }
  get position(): THREE.Vector3 { return this.group.position; }
  get talking(): boolean { return this.presentation.talking; }
  set talking(on: boolean) { this.presentation.talking = on; }
  /** the head's world position (the talk prompt / the name tag) */
  headWorld(out: THREE.Vector3): THREE.Vector3 { return this.presentation.headWorld(out); }
  dispose(): void { this.presentation.dispose(); }

  private start(i: number): void {
    this.gesture = i; this.clock = 0;
    const every = this.rows.gestures[i]?.starts.find(start => start.kind === 'every');
    if (every !== undefined) this.timers[i] = every.base;
  }

  /** Choose a gesture when none plays: a signal first, then the first approach or timer whose band holds the player. */
  private choose(d: number, t: number, dt: number): void {
    const gestures = this.rows.gestures;
    for (const [i, row] of gestures.entries()) {
      for (const start of row.starts) if (start.kind === 'approach' && d > start.rearm) this.armed[i] = true;
      if (row.starts.some(start => start.kind === 'signal') && this.presentation.takeSignal(row.id)) { this.start(i); return; }
    }
    if (this.gesture >= 0) return;
    for (const [i, row] of gestures.entries()) for (const start of row.starts) {
      if (start.kind === 'approach' && this.armed[i] === true && d < start.inside && d > start.beyond) { this.armed[i] = false; this.start(i); return; }
      if (start.kind === 'every' && d >= start.from && d < start.to) {
        const left = (this.timers[i] ?? 0) - dt;
        if (left > 0) { this.timers[i] = left; return; }
        this.start(i); this.timers[i] = start.base + (Math.sin(t * start.frequency) + 1) * start.span; return;
      }
    }
  }

  update(dt: number, t: number, player: THREE.Vector3): void {
    const view = this.presentation, rows = this.rows;
    if (!view.active) return;
    view.syncAnchors();
    const gp = this.group.position, dx = player.x - gp.x, dz = player.z - gp.z, d = Math.hypot(dx, dz);
    if (rows.hide) {
      const near = d < this.drawDistance;
      if (near !== this.figure.visible) { this.figure.visible = near; for (let i = 0; i < Math.min(this.companions.length, 8); i++) { const c = this.companions[i]; if (c !== undefined) c.visible = near; } }
      view.lod(d);
      if (!near) return;
    } else view.lod(d);
    const row = rows.gestures[this.gesture];
    if (row !== undefined) { this.clock += dt; if (this.clock > row.seconds) this.gesture = -1; }
    this.choose(d, t, dt);
    const playing = rows.gestures[this.gesture], weight = playing === undefined ? 0 : playing.eased ? ease(this.clock / Math.max(1e-6, playing.seconds)) : 1;
    // its facing from the placed pose (a placement's matrix decomposes to Euler (π, a, π) past ±90°: rotation.y alone is not the yaw)
    const e = this.group.matrixWorld.elements, focus = this.focus, offer = playing?.offer !== undefined && d < playing.offer.within ? playing.offer : undefined;
    focus.distance = d; focus.toward = Math.atan2(dx, dz) - Math.atan2(e[8], e[10]); focus.talking = Number(this.talking); focus.turns = Number(playing?.turns ?? true);
    focus.playerY = player.y; focus.headY = gp.y + rows.neck + 0.1; focus.override = Number(playing?.look !== undefined);
    focus.overrideYaw = playing?.look?.yaw ?? 0; focus.overridePitch = playing?.look?.pitch ?? 0;
    focus.offsetYaw = offer === undefined ? 0 : offer.yaw * weight; focus.offsetPitch = offer === undefined ? 0 : offer.pitch * weight;
    this.motion.evaluate({ time: t, delta: dt, values: {} });
    const pose = this.pose, mem = pose.mem; pose.t = t; pose.phase = this.clock;
    mem['gesture'] = playing?.code ?? 0; mem['weight'] = weight; mem['turn'] = this.gaze.turn; mem['talking'] = Number(this.talking);
    mem['headPitch'] = this.gaze.headPitch; mem['headYaw'] = this.gaze.headYaw;
    playClips(rows.pose, pose);
  }
}
