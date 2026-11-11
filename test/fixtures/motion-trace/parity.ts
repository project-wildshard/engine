// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the shipped player and host against native Rapier.
import { readFileSync } from 'node:fs';
import { PerspectiveCamera, Vector3 } from 'three';
import type { NetCommand } from '@wildshard/wire/netCommand';
import { Scope } from '../../../src/shared/engine/app/scope';
import { app } from '../../../src/client/engine/app/runtime';
import { lockOn, type AimTarget } from '../../../src/client/engine/player/AimTargets';
import { Player } from '../../../src/client/engine/player/Player';
import { NET_BUTTONS } from '../../../src/shared/engine/input/netButtons';
import { FIXED_STEP } from '../../../src/shared/engine/core/fixedStep';
import { Physics } from '../../../src/shared/engine/physics/Physics';
import { groups } from '../../../src/shared/engine/physics/groups';
import { loadRapier, type Rapier } from '../../../src/shared/engine/physics/rapier';
import { tagCollider } from '../../../src/shared/engine/physics/surface';
import { addTerrain } from '../../../src/shared/engine/physics/terrain';
import { createSimHost, type SimCommand, type SimHost, type SimLevel, type SimTickCommand } from '../../../src/server/engine/sim';
import { leadPlayer } from '../../../src/shared/engine/sim/leadPlayer';
import type { PlayerSim } from '../../../src/server/engine/sim/playerSim';
import { SIM_CREATURE_RECIPE } from '../../../src/test/game/creatureRecipe';
import { SIM_LEVEL } from '../sim-level/level';

// P1-E5.3 B2: one command stream through the real `Player` and the real `PlayerSim`, each in its own world, built from one
// course. Every tick compares the feet (2 cm, E5-REPLICATION §9) and the flags that say what the player is doing. The A
// rows are measured here: a scenario's failing ticks are its debt in `ratchet.json`.

/** E5-REPLICATION §9. */
export const TOLERANCE = 0.02;

const RES = 121, SIZE = 240;
/** Where the pool starts (x falling), the water standing at y 0 over a 1:5 floor, and how deep it gets. */
export const POOL_X = -40; const POOL_DEEP = 3.5;
/** Terrain too steep to stand on (normal y 0.5), rising east from x 30 onto a plateau. */
export const HILL_X = 30; const HILL_RISE = 1.75; export const HILL_TOP = 10.5;
/** Terrain at 42°, rising north from z 30: the page's capsule stops at 40°, the host's at 45°. */
export const RAMP_Z = 30; const RAMP_RISE = 0.9;
/** A box 33 cm high: the page steps 35 cm, the host 30. */
export const STEP_Z = -20;
/** Two walls 74 cm apart, centred on x 0: a 76 cm capsule stops, a 70 cm capsule passes. */
export const GAP_Z = -40;
/** A block whose top is at y 3: walk off it. */
export const LEDGE = { x: 12, z: 12, half: 4, top: 3 } as const;
/** The kinematic deck: its pose at a tick, a slow carry in x with a bob. */
export const DECK = { x: 0, y: 1, z: -70, half: 3 } as const;
/** A deck low enough to walk onto, sliding in x. */
export const LOW_DECK = { x: 72, z: 70, half: 3, top: .2 } as const;
/** The floor function: a 30 cm deck with no collider. */
export const FLOOR_DECK = { x: -20, z: -70, half: 3, y: 0.3 } as const;
/** The bars a phased capsule walks through: `Course.gate`. */
export const GATE_Z = 55;

export function terrainHeight(x: number, z: number): number {
  if (x < POOL_X) return -Math.min(POOL_DEEP, (POOL_X - x) / 5);
  if (x >= HILL_X && Math.abs(z) < 25) return Math.min(HILL_TOP, (x - HILL_X) * HILL_RISE);
  if (z >= RAMP_Z && Math.abs(x) < 25) return Math.min(8, (z - RAMP_Z) * RAMP_RISE);
  return 0;
}
function courseGrid(): Float32Array {
  const grid = new Float32Array(RES * RES), d = SIZE / (RES - 1), half = SIZE / 2;
  for (let iz = 0; iz < RES; iz++) for (let ix = 0; ix < RES; ix++) grid[iz * RES + ix] = terrainHeight(ix * d - half, iz * d - half);
  return grid;
}
const deckAt = (tick: number): { x: number; y: number; z: number } => ({ x: DECK.x + Math.sin(tick * FIXED_STEP * .8) * 3, y: DECK.y + Math.sin(tick * FIXED_STEP * 1.3) * .2, z: DECK.z });
export const lowDeckAt = (tick: number): { x: number; y: number; z: number } => ({ x: LOW_DECK.x + Math.sin(tick * FIXED_STEP * .9) * 2, y: LOW_DECK.top - .1, z: LOW_DECK.z });

/** The same static and moving world, built into one side's physics. Queries are the same functions on both. */
export interface Course {
  readonly gate: number;
  /** The decks at `tick`, for the next physics step. */
  advance: (tick: number) => void;
  /** The decks at `tick`, now: nothing will step. */
  place: (tick: number) => void;
  /** The low deck off a row, for a client that can't work it out: `next` for the next physics step, and with `at` that pose now. */
  lowDeck: (next: { readonly x: number; readonly y: number; readonly z: number }, at?: { readonly x: number; readonly y: number; readonly z: number }) => void;
}
function buildCourse(physics: Physics): Course {
  const { R, world } = physics, grid = courseGrid();
  addTerrain(physics, grid, RES, SIZE);
  const box = (hx: number, hy: number, hz: number, x: number, y: number, z: number): number => {
    const collider = world.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setCollisionGroups(groups('WORLD')));
    tagCollider(collider, 'wood'); return collider.handle;
  };
  box(3, .165, 1, -12, .165, STEP_Z);
  box(3, 2, .5, 3.37, 2, GAP_Z); box(3, 2, .5, -3.37, 2, GAP_Z);
  box(LEDGE.half, LEDGE.top / 2, LEDGE.half, LEDGE.x, LEDGE.top / 2, LEDGE.z);
  const gate = box(3, 2, .25, -32, 2, GATE_Z);
  const rest = deckAt(0), deck = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(rest.x, rest.y, rest.z));
  tagCollider(world.createCollider(R.ColliderDesc.cuboid(DECK.half, .1, DECK.half).setCollisionGroups(groups('WORLD')), deck), 'wood');
  const low = lowDeckAt(0), lowDeck = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(low.x, low.y, low.z));
  tagCollider(world.createCollider(R.ColliderDesc.cuboid(LOW_DECK.half, .1, LOW_DECK.half).setCollisionGroups(groups('WORLD')), lowDeck), 'wood');
  return { gate, advance: tick => { deck.setNextKinematicTranslation(deckAt(tick)); lowDeck.setNextKinematicTranslation(lowDeckAt(tick)); },
    place: tick => {
      deck.setTranslation(deckAt(tick), false); lowDeck.setTranslation(lowDeckAt(tick), false);
      deck.setNextKinematicTranslation(deckAt(tick)); lowDeck.setNextKinematicTranslation(lowDeckAt(tick));
      world.propagateModifiedBodyPositionsToColliders();
    },
    lowDeck: (next, at) => {
      if (at !== undefined) { lowDeck.setTranslation(at, false); world.propagateModifiedBodyPositionsToColliders(); }
      lowDeck.setNextKinematicTranslation(next);
    } };
}
export const courseHeightAt = (x: number, z: number): number => terrainHeight(x, z);
const courseWaterAt = (x: number, _z: number): number | null => x < POOL_X ? 0 : null;
const courseFloors: readonly ((x: number, z: number) => number | undefined)[] = [
  (x, z) => Math.abs(x - FLOOR_DECK.x) < FLOOR_DECK.half && Math.abs(z - FLOOR_DECK.z) < FLOOR_DECK.half ? FLOOR_DECK.y : undefined,
];

/** A swell the sea scenario reads from both sides: it has a clock, so it needs one on each. */
const seaSwell = (x: number, z: number, seconds: number): number => Math.sin(seconds * 1.1 + x * .2) * .18 + Math.sin(seconds * .7 + z * .3) * .09;

/** One tick's input, in the player's own axes. Axes are multiples of 1/127, as they arrive off the wire. */
export interface MotionIntent {
  readonly keyX?: number; readonly keyY?: number; readonly stickX?: number; readonly stickY?: number;
  readonly yaw?: number; readonly pitch?: number;
  readonly sprint?: boolean; readonly crouch?: boolean; readonly dive?: boolean; readonly surface?: boolean;
  readonly jump?: boolean; readonly dodge?: boolean; readonly hover?: boolean;
  /** No command this tick: the page's device reads idle, and the host's tick has none. */
  readonly idle?: boolean;
}
/** What a scenario does to the player from outside, on both sides at once. A method a side has no way to honour is a
 *  row's job: it says so where it is written. */
export interface MotionEvents {
  shove: (fromX: number, fromZ: number, speed: number) => void;
  impulse: (x: number, y: number, z: number) => void;
  dash: (vx: number, vz: number, time: number) => void;
  dashTo: (x: number, z: number, stopAt: number, time: number) => void;
  reset: (x: number, y: number, z: number, yaw: number) => void;
  moveScale: (value: number) => void;
  effect: (moveScale: number, locked: boolean) => void;
  carried: (on: boolean) => void;
  boardLimit: (top: number | null) => void;
  dodgeCooldownScale: (scale: number) => void;
  phaseGate: () => void;
}
/** What the stream may steer on: the page's committed state last tick. */
export interface MotionView {
  readonly x: number; readonly y: number; readonly z: number;
  readonly grounded: boolean; readonly swimming: boolean; readonly hover: boolean;
}
export interface MotionScenario {
  /** `<row>.<what>`: the row whose done-when it measures */
  readonly id: string;
  readonly start: { readonly x: number; readonly y?: number; readonly z: number; readonly yaw: number };
  readonly ticks: number;
  readonly intent: (tick: number, view: MotionView) => MotionIntent;
  /** Outside events at the start of a tick. */
  readonly events?: (tick: number, on: MotionEvents, view: MotionView) => void;
  /** `legacy`: the tick's own world-space command (a headless tape), not a version-1 wire command. */
  readonly wire?: 'net' | 'legacy';
  /** A still lock-on target at this point: the page's `lockOn`, the wire's `lockTarget`, a real held body on the host. */
  readonly lockAt?: { readonly x: number; readonly z: number; readonly r0: number };
  /** The sea's swell instead of the pond's bob. */
  readonly sea?: boolean;
  /** A host with no water installed. */
  readonly dry?: boolean;
  /** A real held creature on the host, in the way: what the client knows of it is its row. */
  readonly bodyAt?: { readonly x: number; readonly z: number };
  /** What the page must really do here, or the scenario proves nothing: `rose` left the feet's start by half a metre up. */
  readonly reaches?: readonly MotionReach[];
}
export type MotionReach = 'air' | 'board' | 'dash' | 'rose' | 'slide' | 'swim' | 'wade';

/** A sample of one side after a tick. */
interface Sample { x: number; y: number; z: number; flags: string }
const flagWord = (s: { grounded: boolean; swimming: boolean; hover: boolean; wading: boolean; sliding: boolean; dashing: boolean; stroke: number }): string =>
  `${s.grounded ? 'G' : '-'}${s.swimming ? 'S' : '-'}${s.hover ? 'B' : '-'}${s.wading ? 'W' : '-'}${s.sliding ? 'L' : '-'}${s.dashing ? 'D' : '-'}:${s.stroke.toFixed(3)}`;

export const TARGET_ID = 'lock:1';
const axis = (key: number | undefined, stick: number | undefined): number => Math.max(-1, Math.min(1, (key ?? 0) + (stick ?? 0)));

/** The real Player on the page's fixed step: movers, physics, then the step, with a replay command and a real device. */
export class PageSide implements MotionEvents {
  readonly player: Player;
  readonly camera: PerspectiveCamera = new PerspectiveCamera();
  readonly physics: Physics;
  readonly course: Course;
  private readonly scope = new Scope('motion-parity');
  private readonly target: AimTarget | undefined;
  constructor(R: Rapier, scenario: MotionScenario) {
    const physics = this.physics = new Physics(R);
    this.course = buildCourse(physics);
    const { start } = scenario, player = this.player = new Player(this.camera, physics, document.createElement('canvas'), { waterLine: { update: () => undefined, setHint: () => undefined } });
    player.bindFrame(physics, player.motor, { heightAt: courseHeightAt, waterSurfaceAt: courseWaterAt, platforms: courseFloors });
    player.position.set(start.x, start.y ?? courseHeightAt(start.x, start.z), start.z); player.yaw = start.yaw;
    player.motor.resetAt(player.position);
    physics.step();
    if (scenario.sea === true) {
      // the drawn surface stays on a frame clock of its own: the step reads `swellAt`
      app.world.water.add({ id: 'sea', level: 0, surfaceAt: (x, z) => seaSwell(x, z, -1), swellAt: seaSwell, inside: () => false, restAt: () => null }, this.scope);
    }
    if (scenario.lockAt !== undefined) {
      this.target = { alive: true, kind: 'parity', position: new Vector3(scenario.lockAt.x, 0, scenario.lockAt.z), dims: SIM_CREATURE_RECIPE.spec.dims, lockable: true };
      lockOn.state = 'locked'; lockOn.target = this.target; lockOn.r0 = scenario.lockAt.r0;
    }
  }
  stepWorld(): void { this.physics.step(); }
  view(): MotionView {
    const { player: p } = this;
    return { x: p.position.x, y: p.position.y, z: p.position.z, grounded: p.onGround, swimming: p.swimming, hover: p.hover };
  }
  tick(tick: number, intent: MotionIntent): void {
    const { player } = this, moveX = axis(intent.keyX, intent.stickX), moveY = axis(intent.keyY, intent.stickY);
    this.course.advance(tick);
    if (intent.hover === true) player.setHover(!player.hover);
    this.physics.step();
    const button = (held: boolean | undefined, which: number): number => held === true ? which : 0;
    player.step(FIXED_STEP, { steer: { keyX: 0, keyY: 0, stickX: moveX, stickY: moveY }, yaw: intent.yaw ?? player.yaw, pitch: intent.pitch ?? 0,
      buttons: button(intent.crouch, NET_BUTTONS.crouch) | button(intent.sprint, NET_BUTTONS.sprint) | button(intent.jump, NET_BUTTONS.jump) | button(intent.dodge, NET_BUTTONS.dodge) | button(intent.dive, NET_BUTTONS.dive) | button(intent.surface, NET_BUTTONS.surface) });
  }
  sample(): Sample {
    const { player: p } = this;
    return { x: p.position.x, y: p.position.y, z: p.position.z, flags: flagWord({ grounded: p.onGround, swimming: p.swimming, hover: p.hover, wading: p.wading, sliding: p.sliding, dashing: p.dashing, stroke: p.strokeTime }) };
  }
  shove(fromX: number, fromZ: number, speed: number): void { this.player.shove(fromX, fromZ, speed); }
  impulse(x: number, y: number, z: number): void { this.player.impulse(new Vector3(x, y, z)); }
  dash(vx: number, vz: number, time: number): void { this.player.dash(vx, vz, time); }
  dashTo(x: number, z: number, stopAt: number, time: number): void { this.player.dashTo(x, z, stopAt, time); }
  reset(x: number, y: number, z: number, yaw: number): void { this.player.spawn(x, z, yaw, y); }
  moveScale(value: number): void { this.player.moveScale = value; }
  effect(moveScale: number, locked: boolean): void { this.player.effectMoveScale = moveScale; this.player.effectMoveLocked = locked; }
  carried(on: boolean): void { this.player.carried = on; }
  boardLimit(top: number | null): void { this.player.hoverSpeedLimit = top === null ? null : () => top; }
  dodgeCooldownScale(scale: number): void { this.player.dodgeCooldownScale = scale; }
  phaseGate(): void { this.player.motor.phased.add(this.course.gate); }
  dispose(): void {
    this.scope.dispose(); lockOn.state = 'off'; lockOn.target = null; lockOn.r0 = 0;
    this.player.motor.dispose(); this.physics.dispose();
  }
}

/** The real PlayerSim on the real tick. A wire scenario sends what a client would. */
export class HostSide implements MotionEvents {
  readonly host: SimHost;
  readonly player: PlayerSim;
  readonly course: Course;
  private readonly scenario: MotionScenario;
  private seq = 0;
  constructor(R: Rapier, scenario: MotionScenario) {
    const { start, lockAt, bodyAt } = scenario, body = lockAt ?? bodyAt;
    const level: SimLevel = { ...SIM_LEVEL, entities: body === undefined ? [] : [{ ...SIM_CREATURE_RECIPE, id: TARGET_ID, at: { x: body.x, y: 0, z: body.z } }], quests: [],
      // a level's own walking speed, as Sunscar authors one: A2's 18th difference
      ground: { size: SIZE, height: 0 }, player: { at: { x: start.x, y: start.y ?? courseHeightAt(start.x, start.z), z: start.z }, yaw: start.yaw, speed: 5 } };
    const host = this.host = createSimHost(level, { rapier: R, ground: false, heightAt: courseHeightAt });
    this.course = buildCourse(host.physics); this.scenario = scenario; this.player = leadPlayer(host);
    host.floors.push(...courseFloors);
    for (const actor of host.entities.values()) actor.harnessHold = true;
    if (scenario.dry !== true) host.useWater({ surfaceAt: courseWaterAt, ...(scenario.sea === true ? { bob: (x: number, z: number): number => seaSwell(x, z, host.clock.now) } : {}) });
  }
  tick(tick: number, intent: MotionIntent): void {
    const { host, player } = this;
    this.course.advance(tick);
    if (intent.idle === true) { host.step(); return; }
    host.step(new Map([[player.id, this.command(intent)]]));
  }
  private command(intent: MotionIntent): SimTickCommand {
    const { player, scenario } = this, yaw = intent.yaw ?? player.yaw;
    if (scenario.wire === 'legacy') {
      const moveX = axis(intent.keyX, intent.stickX), moveY = axis(intent.keyY, intent.stickY), sin = Math.sin(yaw), cos = Math.cos(yaw);
      const legacy: SimCommand = { moveX: -sin * moveY + cos * moveX, moveZ: -cos * moveY - sin * moveX, yaw, dive: intent.dive === true, surface: intent.surface === true,
        ...(intent.jump === true ? { jump: true } : {}), ...(intent.dodge === true ? { dodge: true } : {}), ...(intent.hover === true ? { hover: true } : {}) };
      return legacy;
    }
    const button = (on: boolean | undefined, bit: number): number => on === true ? bit : 0;
    const command: NetCommand = { seq: this.seq = (this.seq + 1) & 0xffff, viewTick: 0, yaw, pitch: intent.pitch ?? 0,
      steer: { keyX: intent.keyX ?? 0, keyY: intent.keyY ?? 0, stickX: intent.stickX ?? 0, stickY: intent.stickY ?? 0 },
      buttons: button(intent.sprint, NET_BUTTONS.sprint) | button(intent.crouch, NET_BUTTONS.crouch) | button(intent.dive, NET_BUTTONS.dive) | button(intent.surface, NET_BUTTONS.surface)
        | button(intent.jump, NET_BUTTONS.jump) | button(intent.dodge, NET_BUTTONS.dodge) | button(intent.hover, NET_BUTTONS.hover),
      ...(scenario.lockAt === undefined ? {} : { lockTarget: TARGET_ID }) };
    return command;
  }
  sample(): Sample {
    const { player: p } = this;
    return { x: p.position.x, y: p.position.y, z: p.position.z, flags: flagWord({ grounded: p.board.on ? p.board.onGround : p.fall.grounded, swimming: p.swim.on, hover: p.board.on,
      wading: p.footing.wading, sliding: p.footing.sliding, dashing: p.dash.t > 0, stroke: p.swim.strokeTime }) };
  }
  shove(fromX: number, fromZ: number, speed: number): void { this.player.knockBack(fromX, fromZ, speed); }
  impulse(x: number, y: number, z: number): void { this.player.addImpulse(new Vector3(x, y, z)); }
  dash(vx: number, vz: number, time: number): void { this.player.dashAt(vx, vz, time); }
  dashTo(x: number, z: number, stopAt: number, time: number): void { this.player.dashTo(x, z, stopAt, time); }
  reset(x: number, y: number, z: number, yaw: number): void { this.player.resetPose({ x, y, z }, yaw); }
  moveScale(value: number): void { this.player.moveScale = value; }
  effect(moveScale: number, locked: boolean): void { Object.assign(this.player.health.attributes, { moveSpeedMul: moveScale, moveLocked: locked ? 1 : 0 }); }
  carried(on: boolean): void { this.player.carried = on; }
  boardLimit(top: number | null): void { this.player.hoverSpeedLimit = top === null ? null : () => top; }
  dodgeCooldownScale(scale: number): void { this.player.health.attributes['dodgeCooldownMul'] = scale; }
  phaseGate(): void { this.player.motor.phased.add(this.course.gate); }
  dispose(): void { this.host.dispose(); }
}

export interface ParityResult {
  readonly id: string; readonly ticks: number;
  /** ticks over the tolerance or with unequal flags: this scenario's debt */
  readonly failing: number;
  readonly overTolerance: number; readonly flagTicks: number;
  readonly worst: number; readonly worstTick: number;
  /** the first failing tick, to start a row from */
  readonly first: { readonly tick: number; readonly page: string; readonly host: string } | null;
  /** what the page did, for `MotionScenario.reaches` */
  readonly reached: ReadonlySet<MotionReach>;
}

export async function loadCourseRapier(): Promise<Rapier> { return loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))); }

/** Run one scenario through both sides, tick for tick. */
export function runScenario(R: Rapier, scenario: MotionScenario): ParityResult {
  const page = new PageSide(R, scenario), host = new HostSide(R, scenario);
  try {
    let failing = 0, overTolerance = 0, flagTicks = 0, worst = 0, worstTick = 0, first: ParityResult['first'] = null;
    const reached = new Set<MotionReach>(), startY = page.player.position.y, { player } = page;
    for (let tick = 0; tick < scenario.ticks; tick++) {
      const view = page.view(), intent = scenario.intent(tick, view);
      if (scenario.events !== undefined) { scenario.events(tick, page, view); scenario.events(tick, host, view); }
      page.tick(tick, intent); host.tick(tick, intent);
      if (!player.onGround) reached.add('air');
      if (player.hover) reached.add('board');
      if (player.dashing) reached.add('dash');
      if (player.sliding) reached.add('slide');
      if (player.swimming) reached.add('swim');
      if (player.wading) reached.add('wade');
      if (player.position.y > startY + .5) reached.add('rose');
      const a = page.sample(), b = host.sample(), error = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      const over = error > TOLERANCE, flags = a.flags !== b.flags;
      if (error > worst) { worst = error; worstTick = tick; }
      if (over) overTolerance++;
      if (flags) flagTicks++;
      if (over || flags) {
        failing++;
        first ??= { tick, page: `${a.x.toFixed(3)},${a.y.toFixed(3)},${a.z.toFixed(3)} ${a.flags}`, host: `${b.x.toFixed(3)},${b.y.toFixed(3)},${b.z.toFixed(3)} ${b.flags}` };
      }
    }
    return { id: scenario.id, ticks: scenario.ticks, failing, overTolerance, flagTicks, worst, worstTick, first, reached };
  } finally { page.dispose(); host.dispose(); }
}
