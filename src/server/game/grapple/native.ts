import type { GrappleMode } from '@wildshard/format/modes';
import type { GrappleProfile } from '@wildshard/format/grapple';
import * as v from 'valibot';
import { Euler, MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import { fovForAspect } from '@wildshard/engine/combat/blocks/melee';
import type { SimHost } from '@wildshard/engine/sim';
import type { PlayerSim } from '@wildshard/engine/sim/playerSim';
import { actRoutes, lockedHook } from '@wildshard/engine/sim/actRoutes';
import { publishWorldState, type StateNetRow } from '@wildshard/engine/sim/shardRows';
import { grappleCourse } from '../../../shared/game/grapple/course';
import { GRAPPLE_PHASES, grappleRow, NO_HOOK } from '../../../shared/game/grapple/feed';
import { type GrappleBody, type GrapplePorts, GrappleSim, type GrappleView } from '../../../shared/game/grapple/sim';

/** Standard tick services for the first player; content supplies profile rows, never authored handlers. */
export interface GrappleTickContext {
  commands: () => readonly ({ readonly kind: 'script'; readonly actorId: string; readonly value: number } | { readonly kind: string; readonly jump?: boolean })[];
  emit: (effect: { readonly kind: 'fact'; readonly name: string; readonly actorId: string }) => void;
  /** Another player's tape; `press` is the only way in for a player without one. */
  commandsOf?: (id: string) => readonly ({ readonly kind: 'script'; readonly actorId: string; readonly value: number } | { readonly kind: string; readonly jump?: boolean })[];
}
/** One player's grapple controls this tick. */
export interface GrapplePress {
  readonly lock?: boolean; readonly fire?: boolean; readonly pitch?: number;
  /** The hook a LOCK press picked, by index: a client's own camera chose it, and the server has none to choose with. */
  readonly hook?: number;
}
/** A world's grapple: one claw a player. */
export interface NativeGrapple {
  /** the first player's claw */
  readonly sim: GrappleSim;
  /** a player's claw, once it has played a tick */
  readonly clawOf: (id: string) => GrappleSim | undefined;
  /** Any player's LOCK, JUMP and aim for the next tick, beside their tape. */
  readonly press: (id: string, press: GrapplePress) => void;
  /** whether a crossing holds the course's guard open */
  readonly guardOpen: () => boolean;
}

const finite = v.pipe(v.number(), v.finite());
const Xyz = v.strictObject({ x: finite, y: finite, z: finite });
const Phase = v.picklist(['idle', 'fire', 'bite', 'lift', 'zip', 'vault', 'settle', 'miss', 'reel', 'dock']);
const Claw = { pitch: finite, last: Xyz, fall: v.strictObject({ vy: finite, grounded: v.boolean() }), velocity: Xyz,
  sim: v.strictObject({ phase: Phase, armedMiss: v.boolean(), clock: finite, blocked: finite, liftY: finite, missEnd: Xyz,
    target: v.nullable(v.strictObject({ hook: Xyz, landing: Xyz, approach: Xyz, lifts: v.boolean() })) }) };
const ClawSaved = v.strictObject(Claw);
type SavedClaw = v.InferOutput<typeof ClawSaved>;
const Saved = v.strictObject({ ...Claw, guard: v.array(finite), others: v.exactOptional(v.record(v.string(), ClawSaved)) });

const NEAR = 0.08, FAR = 2600;
/** The headless eye: a camera's projection and heading as plain matrices, at the page camera's near and far. */
function headlessView(host: Pick<PlayerSim, 'position' | 'yaw'>, claw: { pitch: number }, profile: GrappleProfile): GrappleView {
  const { eye, aspect, portraitFov } = profile.headless, fov = fovForAspect(portraitFov, aspect);
  const top = NEAR * Math.tan(MathUtils.DEG2RAD * 0.5 * fov), height = 2 * top, width = aspect * height, left = -0.5 * width;
  const projection = new Matrix4().makePerspective(left, left + width, top, top - height, NEAR, FAR);
  const position = new Vector3(), turn = new Quaternion(), euler = new Euler(), unit = new Vector3(1, 1, 1), world = new Matrix4(), inverse = new Matrix4();
  return {
    eye: position,
    update: () => {
      const p = host.position;
      position.set(p.x, p.y + eye, p.z); turn.setFromEuler(euler.set(claw.pitch, host.yaw, 0, 'YXZ'));
      world.compose(position, turn, unit); inverse.copy(world).invert();
    },
    project: (point, out) => out.copy(point).applyMatrix4(inverse).applyMatrix4(projection),
    forward: out => { const e = world.elements; return out.set(-(e[8] ?? 0), -(e[9] ?? 0), -(e[10] ?? 0)).normalize(); },
  };
}

/** One player's claw and the tick-start pose it runs from. */
class PlayerClaw {
  readonly velocity = new Vector3();
  readonly state: { pitch: number; last: Vector3; fall: { vy: number; grounded: boolean } };
  readonly sim: GrappleSim;
  readonly view: GrappleView;
  pressed: GrapplePress | null = null;
  constructor(readonly player: PlayerSim, host: SimHost, profile: GrappleProfile, course: GrappleSim['course'], rise: boolean) {
    this.state = { pitch: 0, last: player.position.clone(), fall: { vy: player.velocity.y, grounded: player.fall.grounded } };
    const body: GrappleBody = { get position() { return player.position; }, velocity: this.velocity,
      get onGround() { return player.fall.grounded; }, set onGround(on) { player.fall.grounded = on; },
      // the motor is read each time: a restore rebuilds the player's motor on the restored physics after install
      get motor() { return player.motor; } };
    const ports: GrapplePorts = { get physics() { return host.physics; }, body };
    this.view = headlessView(player, this.state, profile);
    this.sim = new GrappleSim(ports, course, { rise: () => rise });
  }
  save(): SavedClaw {
    const { state, velocity } = this;
    return { pitch: state.pitch, last: { x: state.last.x, y: state.last.y, z: state.last.z }, fall: { ...state.fall },
      velocity: { x: velocity.x, y: velocity.y, z: velocity.z }, sim: this.sim.snapshot() };
  }
  /** This claw as a client reads it. */
  rows(): readonly StateNetRow[] {
    const { sim, player: { id } } = this, target = sim.target?.hook;
    const hook = target === undefined ? NO_HOOK : sim.course.hooks.findIndex(row => row.x === target.x && row.y === target.y && row.z === target.z);
    return [{ name: grappleRow(id, 'phase'), value: GRAPPLE_PHASES.indexOf(sim.phase) }, { name: grappleRow(id, 'clock'), value: sim.clock }, { name: grappleRow(id, 'hook'), value: hook },
      { name: grappleRow(id, 'armed'), value: Number(sim.armedMiss) }, { name: grappleRow(id, 'mx'), value: sim.missEnd.x }, { name: grappleRow(id, 'my'), value: sim.missEnd.y }, { name: grappleRow(id, 'mz'), value: sim.missEnd.z }];
  }
  load(saved: SavedClaw): void {
    const { state, velocity } = this;
    state.pitch = saved.pitch; state.last.set(saved.last.x, saved.last.y, saved.last.z); state.fall = { ...saved.fall };
    velocity.set(saved.velocity.x, saved.velocity.y, saved.velocity.z); this.sim.restore(saved.sim);
  }
}

/** Install traversal on the server's actual player motors and tick boundary: every player has a claw, and the one course
 * guard stands open while any of them holds a crossing. One player saves the one claw's exact bytes. */
export function installGrapple(host: SimHost, context: GrappleTickContext, profile: GrappleProfile, mode: GrappleMode, hooks: readonly { readonly x: number; readonly y: number; readonly z: number }[], guardHandles: readonly number[], rise = false): NativeGrapple {
  const course = grappleCourse({ ...profile.course, mode, hooks });
  const claws = new Map<string, PlayerClaw>(), pending = new Map<string, GrapplePress>();
  const clawFor = (player: PlayerSim): PlayerClaw => {
    let claw = claws.get(player.id);
    if (claw?.player !== player) { claw = new PlayerClaw(player, host, profile, course, rise); claws.set(player.id, claw); }
    return claw;
  };
  const firstPlayer = (): PlayerSim => { const first = host.players.values().next(); if (first.done === true) throw new Error('Simulation host has no player'); return first.value; };
  const first = clawFor(firstPlayer());
  let guard = [...guardHandles];
  const open = (): boolean => { for (const claw of claws.values()) if (claw.sim.guardOpen()) return true; return false; };
  const setGuard = (): void => { const opened = open(); guard.forEach(handle => { host.physics.world.getCollider(handle).setEnabled(!opened); }); };
  const moved = new Vector3(), walked = { vy: 0, grounded: true };
  const tape = (commands: ReturnType<GrappleTickContext['commands']>): GrapplePress => {
    let lock = false, fire = false, pitch: number | undefined, hook: number | undefined;
    for (const command of commands) {
      if ('jump' in command && command.kind === 'player' && command.jump) fire = true;
      if ('actorId' in command) {
        if (command.actorId === profile.headless.lock) { lock = true; hook = lockedHook(command.value); }
        if (command.actorId === profile.headless.aim) pitch = command.value;
      }
    }
    return { lock, fire, ...(pitch === undefined ? {} : { pitch }), ...(hook === undefined ? {} : { hook }) };
  };
  const stepClaw = (claw: PlayerClaw, press: GrapplePress, dt: number): void => {
    const { player, sim, state, velocity, view } = claw;
    if (press.pitch !== undefined) state.pitch = press.pitch;
    view.update?.();
    // no lock-on headless (SimHost has none), so an empty LOCK arms the miss shot as the page's does with no enemy locked
    if (press.lock === true && press.hook !== undefined) sim.lockHook(view, press.hook);
    else if (press.lock === true) sim.lock(view, null, false);
    const fired = press.fire === true && sim.fire(view);
    setGuard();
    if (fired || sim.phase !== 'idle') {
      // the grapple answers before the walk: run it from where the tick began, and keep the walk only if it declines
      const p = player.position, fall = player.fall, moves = player.velocity;
      moved.copy(p); walked.vy = moves.y; walked.grounded = fall.grounded;
      p.copy(state.last); moves.y = state.fall.vy; fall.grounded = state.fall.grounded;
      velocity.set(0, moves.y, 0);
      const settling = sim.phase === 'settle' && sim.target?.lifts === true;
      if (sim.traverse(dt)) moves.y = velocity.y;
      else { p.copy(moved); moves.y = walked.vy; fall.grounded = walked.grounded; }
      if (settling && sim.phase === 'idle' && profile.fact !== undefined) context.emit({ kind: 'fact', name: profile.fact.name, actorId: profile.fact.entity });
    }
    setGuard(); sim.drainEvents();
    const p = player.position;
    state.last.set(p.x, p.y, p.z); state.fall.vy = player.velocity.y; state.fall.grounded = player.fall.grounded;
  };
  actRoutes(host).lock = profile.headless.lock;
  publishWorldState(host, 'grapple', () => [...claws.values()].flatMap(claw => claw.rows()));
  host.leading.push(player => claws.get(player.id)?.sim.busy() === true); // a crossing keeps the body until it lands or bails
  host.onStep(profile.headless.step, dt => {
    for (const id of claws.keys()) if (!host.players.has(id)) { claws.delete(id); pending.delete(id); }
    for (const player of host.players.values()) {
      const claw = clawFor(player), press = pending.get(player.id) ?? null;
      pending.delete(player.id);
      stepClaw(claw, { ...tape(claw === first ? context.commands() : context.commandsOf?.(player.id) ?? []), ...press }, dt);
    }
  }, { snapshot: () => {
    const { pitch, last, fall, velocity, sim } = first.save(), others = [...claws.values()].filter(claw => claw !== first).map(claw => [claw.player.id, claw.save()]);
    return JSON.stringify({ pitch, last, fall, guard, velocity, sim, ...(others.length === 0 ? {} : { others: Object.fromEntries(others) }) });
  }, restore: value => {
    if (typeof value !== 'string') throw new Error('Invalid grapple continuation');
    const saved = v.parse(Saved, JSON.parse(value));
    first.load(saved); guard = saved.guard; pending.clear();
    for (const [id, row] of Object.entries(saved.others ?? {})) {
      const player = host.players.get(id); if (player === undefined) throw new Error('Unknown grapple player');
      clawFor(player).load(row);
    }
  } });
  return { sim: first.sim, clawOf: id => claws.get(id)?.sim, press: (id, press) => {
    if (!host.players.has(id)) throw new RangeError(`Unknown grapple player ${id}`);
    pending.set(id, { ...pending.get(id), ...press });
  }, guardOpen: open };
}
