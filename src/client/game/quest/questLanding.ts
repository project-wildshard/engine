/**
 * Meta MOSSGATE-ZONE MZ31 (QA 11-19 row 35, Jake in Glowfen: "I'm setting these lanterns and nothing happens. It's just so
 * anticlimactic."): a declared quest beat lands where it happened. A step's `feedback` (format 0.56 `quests[].steps[]`)
 * flares its spot, spreads a warm light over the ground round it, pops a small burst of sparks and sounds one of the engine's
 * own synth voices (`InteractSfx`, no recording). A quest's `onComplete.payoff` is a bigger landing, the score's reward take
 * (`dawn`) and then the next goal on the tracker. The world change is the shard's own `onComplete.scene` (its declared scene
 * hook, the one a dialogue choice or an encounter's victory already runs), so this reader adds no second event path.
 *
 * A beat lands once, on the frame its step's `done` first holds while its quest runs. What a save already finished stays
 * quiet: on the wire the page's flags mirror the server's only from the world's first frame (`finishedAfterSeen`), so the
 * reader takes what is done then as already landed.
 */
import * as THREE from 'three';
import type { Scope } from '@wildshard/engine/app/scope';
import type { QuestState } from '@wildshard/engine/quest/core';
import { test } from '@wildshard/engine/world/interact/flags';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { audioLog } from '@wildshard/engine/audio/audioLog';
import { ownedArray } from '@wildshard/engine/core/ownedBuffer';
import { InteractSfx } from '@wildshard/engine/audio/interactSfx';
import type { ShardContext } from '../plugin/context';
import { wirePage } from '../shardfile/wirePage';

type DeclaredQuest = Shardfile['quests']['quests'][number];
/** A step's declared landing (format 0.56). */
export type QuestFeedback = NonNullable<DeclaredQuest['steps'][number]['feedback']>;
/** A quest's declared payoff (format 0.56). */
export type QuestPayoff = NonNullable<NonNullable<DeclaredQuest['onComplete']>['payoff']>;
export type LandingSound = NonNullable<QuestFeedback['sound']>;

/** What the reader borrows from the entered page: never a cursor, a save or a flag write of its own. */
export interface QuestLandingPorts {
  /** the scene the flares draw in */
  readonly root: THREE.Object3D;
  /** one of the engine's synth interaction voices at a place; true when it sounded */
  readonly sound: (sound: LandingSound, at: THREE.Vector3) => boolean;
  /** the score's reward take */
  readonly music: (name: 'dawn') => void;
  readonly toast: (text: string) => void;
  /** where a landing with no declared height stands: the feet's height */
  readonly feet: () => THREE.Vector3;
  /** run `then` once the page's flags are the save's (the wire's first frame), now when off the wire; returns its cancel */
  readonly settled: (then: () => void) => () => void;
  /** a per-frame update for the reader's lifetime */
  readonly frame: (run: (dt: number) => void) => void;
}

/** Beat defaults: a step is a lamp's worth of light, a payoff a whole clearing's. */
const STEP = { colour: '#ffb050', radius: 6, sound: 'chime' as LandingSound, size: 1 };
const PAYOFF = { colour: '#ffe6a8', radius: 14, sound: 'glyph' as LandingSound, size: 1.8 };
/** How long one landing draws, seconds. */
const LIFE = 3.4;
/** The next goal shows once the reward caption has had its moment. */
const NEXT_AFTER = 4.5;
const SPARKS = 28;
const SPARK_OWNER = { owner: 'game/quest-landing', kind: 'geometry-cpu' } as const;

let glow: THREE.CanvasTexture | null = null;
/** One soft radial falloff, shared by every flare and pool (made once, on the first landing). */
function glowTexture(): THREE.CanvasTexture {
  if (glow !== null) return glow;
  const size = 128, canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
  const g = canvas.getContext('2d');
  if (g !== null) {
    const fall = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    fall.addColorStop(0, 'rgba(255,255,255,1)'); fall.addColorStop(0.25, 'rgba(255,255,255,0.75)');
    fall.addColorStop(0.6, 'rgba(255,255,255,0.22)'); fall.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = fall; g.fillRect(0, 0, size, size);
  }
  glow = new THREE.CanvasTexture(canvas); glow.colorSpace = THREE.SRGBColorSpace;
  return glow;
}

const additive = (colour: THREE.Color, map: THREE.Texture | null): THREE.MeshBasicMaterial =>
  new THREE.MeshBasicMaterial({ color: colour, map, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false, side: THREE.DoubleSide });
const ease = (t: number): number => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;
/** 0 → 1 over [a, b], 1 → 0 over [c, d]. */
const envelope = (t: number, a: number, b: number, c: number, d: number): number =>
  t < a ? 0 : t < b ? (t - a) / (b - a) : t < c ? 1 : t < d ? 1 - (t - c) / (d - c) : 0;

/** One beat in the world: a flare over the spot, light spreading over the ground and a pop of sparks. A declared effect: it
 *  owns its meshes and frees them when it ends (`done`). */
export class Landing {
  readonly group: THREE.Group = new THREE.Group();
  private age = 0;
  private readonly flare: THREE.Sprite;
  private readonly pool: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private readonly wave: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly column: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial> | null;
  private readonly sparks: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly velocity: Float32Array;
  private readonly radius: number;
  private readonly size: number;
  constructor(at: THREE.Vector3, colour: THREE.Color, radius: number, size: number, payoff: boolean) {
    this.radius = radius; this.size = size;
    const map = glowTexture();
    this.group.name = payoff ? 'quest-payoff' : 'quest-landing'; this.group.position.copy(at); this.group.renderOrder = 8;
    this.flare = new THREE.Sprite(new THREE.SpriteMaterial({ color: colour, map, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false }));
    this.flare.position.y = 1.3 * size; this.group.add(this.flare);
    this.pool = new THREE.Mesh(new THREE.CircleGeometry(1, 48), additive(colour, map));
    this.pool.rotation.x = -Math.PI / 2; this.pool.position.y = 0.06; this.group.add(this.pool);
    this.wave = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 64), additive(colour, null));
    this.wave.rotation.x = -Math.PI / 2; this.wave.position.y = 0.08; this.group.add(this.wave);
    // a payoff raises a shaft of light the clearing can see
    this.column = payoff ? new THREE.Mesh(new THREE.CylinderGeometry(0.55 * size, 1.1 * size, 18, 24, 1, true), additive(colour, null)) : null;
    if (this.column !== null) { this.column.position.y = 9; this.group.add(this.column); }
    const positions = ownedArray(Float32Array, SPARKS * 3, SPARK_OWNER); this.velocity = ownedArray(Float32Array, SPARKS * 3, SPARK_OWNER);
    for (let i = 0; i < SPARKS; i++) {
      const a = (i / SPARKS) * Math.PI * 2 + Math.sin(i * 12.9898) * 0.4, out = 1.2 + ((i * 7) % 5) * 0.35;
      positions[i * 3 + 1] = 1.1 * size;
      this.velocity[i * 3] = Math.cos(a) * out * size; this.velocity[i * 3 + 1] = (3.6 + ((i * 3) % 4) * 0.7) * size; this.velocity[i * 3 + 2] = Math.sin(a) * out * size;
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.sparks = new THREE.Points(geometry, new THREE.PointsMaterial({ color: new THREE.Color(1, 0.86, 0.45), size: 0.22 * size, map, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.group.add(this.sparks);
    this.update(0);
  }
  /** Advance by `dt` seconds; false once it has ended and freed its meshes. */
  update(dt: number): boolean {
    this.age += dt; const t = this.age;
    if (t >= LIFE * (this.column === null ? 1 : 1.4)) { this.dispose(); return false; }
    // the flare: a bright burst that swells in a quarter second and dies by 1.4 s
    const burst = envelope(t, 0, 0.12, 0.3, 1.4);
    this.flare.scale.setScalar((0.6 + ease(t / 0.35) * 3.4) * this.size); this.flare.material.opacity = burst;
    // the light: spreads to its radius in 0.9 s, holds, then fades
    const reach = 0.4 + ease(t / 0.9) * (this.radius - 0.4);
    this.pool.scale.setScalar(reach); this.pool.material.opacity = 0.95 * envelope(t, 0, 0.15, 2.2, LIFE);
    // its edge runs out past it as a ring
    this.wave.scale.setScalar(0.5 + ease(t / 1.3) * this.radius * 1.15); this.wave.material.opacity = 0.8 * envelope(t, 0, 0.1, 0.4, 1.4);
    if (this.column !== null) { this.column.scale.y = ease(t / 0.8); this.column.material.opacity = 0.42 * envelope(t, 0, 0.3, 3, LIFE * 1.4); }
    // the pop: sparks thrown up and out, falling back
    const p = this.sparks.geometry.getAttribute('position') as THREE.BufferAttribute, arr = p.array as Float32Array;
    for (let i = 0; i < SPARKS; i++) {
      this.velocity[i * 3 + 1] = (this.velocity[i * 3 + 1] ?? 0) - 6.5 * dt;
      for (let k = 0; k < 3; k++) arr[i * 3 + k] = (arr[i * 3 + k] ?? 0) + (this.velocity[i * 3 + k] ?? 0) * dt;
    }
    p.needsUpdate = true; this.sparks.material.opacity = envelope(t, 0, 0.05, 0.9, 1.8);
    return true;
  }
  dispose(): void {
    this.group.removeFromParent();
    for (const child of this.group.children) {
      if (child instanceof THREE.Mesh || child instanceof THREE.Points || child instanceof THREE.Sprite) {
        (child.geometry as THREE.BufferGeometry).dispose(); (child.material as THREE.Material).dispose();
      }
    }
  }
}

/** One declared beat, resolved against the step or payoff defaults. */
function beat(row: QuestFeedback, base: typeof STEP, feet: () => THREE.Vector3): { at: THREE.Vector3; colour: THREE.Color; radius: number; sound: LandingSound; size: number } {
  const y = row.at.y ?? feet().y;
  return { at: new THREE.Vector3(row.at.x, y, row.at.z), colour: new THREE.Color(row.colour ?? base.colour), radius: row.radius ?? base.radius, sound: row.sound ?? base.sound, size: base.size };
}

/** Whether a declared quest names any landing. */
export const landsAny = (def: DeclaredQuest): boolean => def.onComplete?.payoff !== undefined || def.steps.some(step => step.feedback !== undefined);

/**
 * Land `quests`' declared beats on `ports` for `scope`'s life. Returns what it landed, in order (`quest/step` or
 * `quest/payoff`), for a test or a probe.
 */
export function installQuestLandings(quests: readonly QuestState[], ports: QuestLandingPorts, scope: Scope): string[] {
  const watched = quests.filter(quest => landsAny(quest.def as DeclaredQuest));
  const landed: string[] = [];
  if (watched.length === 0) return landed;
  const live: Landing[] = [];
  /** per quest: its steps already landed (or done before it ran), whether it ran, whether its payoff fired */
  const seen = new Map(watched.map(quest => [quest, { steps: new Set<string>(), started: false, paid: false }]));
  let settled = false, nextIn = -1, next = '';
  const take = (): void => {
    for (const [quest, state] of seen) {
      state.started = quest.isStarted; state.paid = quest.isComplete;
      for (const step of quest.def.steps) if (test(quest.flags, step.done)) state.steps.add(step.id);
    }
    settled = true;
  };
  scope.onDispose(ports.settled(take));
  const land = (quest: QuestState, key: string, row: QuestFeedback, base: typeof STEP, payoff: boolean): void => {
    const b = beat(row, base, ports.feet), landing = new Landing(b.at, b.colour, b.radius, b.size, payoff);
    ports.root.add(landing.group); live.push(landing);
    const sounded = ports.sound(b.sound, b.at);
    audioLog('sfx', `quest.${payoff ? 'payoff' : 'step'}:${b.sound}`, sounded, `${quest.def.id}/${key}`);
    landed.push(`${quest.def.id}/${key}`);
  };
  ports.frame((dt) => {
    for (let i = live.length - 1; i >= 0; i--) if (live[i]?.update(dt) === false) live.splice(i, 1);
    if (nextIn >= 0) { nextIn -= dt; if (nextIn < 0) ports.toast(`Next · ${next}`); }
    if (!settled) return;
    for (const [quest, state] of seen) {
      const def = quest.def as DeclaredQuest;
      if (!state.started) {
        if (!quest.isStarted) continue;
        // a quest that starts now: what was done before it ran is not its beat
        state.started = true;
        for (const step of def.steps) if (test(quest.flags, step.done)) state.steps.add(step.id);
        continue;
      }
      for (const step of def.steps) {
        if (step.feedback === undefined || state.steps.has(step.id) || !test(quest.flags, step.done)) continue;
        state.steps.add(step.id); land(quest, step.id, step.feedback, STEP, false);
      }
      const payoff = def.onComplete?.payoff;
      if (payoff !== undefined && !state.paid && quest.isComplete) {
        state.paid = true; land(quest, 'payoff', payoff, PAYOFF, true);
        if (payoff.music !== 'none') ports.music('dawn');
        if (payoff.next !== undefined) { next = payoff.next; nextIn = NEXT_AFTER; }
      }
    }
  });
  scope.onDispose(() => { for (const landing of live) landing.dispose(); live.length = 0; });
  return landed;
}

/** The entered page's ports: its scene, the engine's synth voices, the score, the toast line and the wire's first frame. Null
 *  where the context has no live play host (a headless or menu context): nothing lands there. */
export function enteredLandingPorts(ctx: Pick<ShardContext, 'game' | 'system' | 'scope'>, id: string): QuestLandingPorts | null {
  const runtime = ctx.game.runtime, world = runtime?.world, play = runtime?.play;
  if (world === undefined || world === null || play === undefined || play === null) return null;
  const sfx = new InteractSfx(play.audio);
  return {
    root: world.game.rootScene,
    sound: (sound, at) => sfx.interact(sound, at),
    music: (name) => { play.music.sting(name); },
    toast: (text) => { play.hud.toast(text); },
    feet: () => world.player.position,
    settled: (then) => { if (wirePage.following) return wirePage.whenSettled(then); then(); return () => undefined; },
    frame: (run) => { ctx.system({ id: `game.quest-landings.${id}`, phase: 'update', when: (live) => live.state === 'play', run: (dt) => { run(dt); } }); },
  };
}
