/**
 * The player modes (SHARD-PLATFORM SF34, G3 "fixed core + modes"): the platform owns the core verbs and the HUD; a level
 * runs the approved modes through this one registry. Two kinds:
 *
 * - **Motor modes**, the Player's own law: `foot`, `board` (the hoverboard, player/board.ts), `swim` and `wade` (the water
 *   law, read from the level's water bodies). Every level gets the same rules; a level only supplies water, hover-only
 *   pieces (`Piece.mode`, world/registry.ts) and its swim arms (`LevelSpec.hands.swim`).
 * - **Driven modes** a level brings (`ride`, `grapple`, later `glide` / `climb` / `drive`): a driver that owns the whole
 *   frame (`enter(id, driver)`: input, fixed step and pose, until `exit`), or a traversal that moves the capsule on the
 *   fixed steps it claims (`traverse`). Each declares its input context and the baseline HUD slot that shows it (E332: a
 *   mode never adds or moves a HUD control).
 *
 * The registry is per Player and made on first use (`playerModes(player)`); nothing is installed by importing this file.
 * It adds no motion law: entering a driven mode hands the Player's existing `ride` slot the driver, and a traversal
 * answers the Player's existing `player.traversal` ask, so the motion is the shipping law, step for step.
 */
import { CableTraversal } from '../sim/cableTraversal';
import { parseModes, type ModeRows } from '@wildshard/format/modes';
import type { Flags } from '../world/interact/flags';
import type { Scope } from '../app/scope';
import type { Events } from '../events/events';
import type { RideCommandSample } from '../input/commands';
import type { InputContextDef } from '../../../server/engine/level/context';

/** The Player's own modes: on foot, the hoverboard, swimming and wading (the water's two depths). */
export type MotorMode = 'foot' | 'board' | 'swim' | 'wade';
/** The approved modes a level brings (G3): ride and grapple ship; glide, climb and drive are approved, not yet built. */
export type DrivenMode = 'ride' | 'grapple' | 'glide' | 'climb' | 'drive';
/** Every player mode. */
export type PlayerModeId = MotorMode | DrivenMode;
/** Where a mode shows on the shared HUD, always a baseline control: RideHUD's band, the HOVER button, a relabelled LOCK or
 *  JUMP disc, or nothing. Changing which control or where it sits is a HUD change (E332), never a mode's own call. */
export type ModeHud = 'ride' | 'hover' | 'lock' | 'jump' | 'none';

/**
 * A ride a predictor drives (J48, P1-E5.3-D3). The engine holds no riding law, so its state is flat words it does not read,
 * but for the feet, which it compares. On the wire the words are the server's (`SimRide.capture`), and in a saved move they
 * run on past them with the capsule's. Neither allocates.
 */
export interface PredictedRide {
  /** The feet, live: words 0 to 2. Word 3 says whether they stand on ground. */
  readonly feet: { readonly x: number; readonly y: number; readonly z: number };
  /** One fixed step's controls, off the command rather than the device, so a replay reads what the first run read. */
  read: (command: RideCommandSample, dt: number) => void;
  /** Write the ride and its capsule into `out` at `at`. */
  capture: (out: Float64Array, at: number) => void;
  /** Put a `capture` back. */
  restore: (from: Float64Array, at: number) => void;
  /** Take the server's words, over what `restore` put back. */
  adopt: (words: ArrayLike<number>) => void;
}

/** A driver that owns the player's frame while its mode is entered (the Player's `ride` slot). */
export interface PlayerModeDriver {
  /** The input phase: read the controls into this mode's intents. */
  drive: (dt: number) => void;
  /** Each fixed step: move the body. */
  step: (dt: number) => void;
  /** The frame's pose: place the player and the camera from the interpolated body. */
  pose: (dt: number, alpha: number) => void;
  /** The controls the last input phase consumed (the recorded command, version 1). */
  sampleCommand?: () => RideCommandSample;
  /** Leave the mode (the driver's own way off: dismount). */
  dismount: () => void;
  /** Present on a wire: the fixed step reads the command, and a predictor keeps it. */
  readonly predicted?: PredictedRide | undefined;
}

/** A driven mode's declaration: its input context, its HUD slot and its hooks. */
export interface PlayerModeDef {
  readonly id: DrivenMode;
  /** The baseline HUD control that shows this mode. */
  readonly hud: ModeHud;
  /** The input context its verbs read: registered for the mode's scope; the mode pushes it with `PlayerModeHandle.context`. */
  readonly context?: InputContextDef;
  /** A traversal (grapple): asked on each fixed step the frame is not driven; true = it moved the capsule this step, and the
   *  Player's walk, board and swim stand down for it. */
  readonly traverse?: (dt: number) => boolean;
  /** Runs as the mode is entered (after the driver takes the frame) and exited (after the frame is handed back). */
  readonly enter?: () => void;
  readonly exit?: () => void;
}

/** A registered driven mode (`D`: the page Player's frame driver, or a headless host's SimPlayerDriver). */
export interface PlayerModeHandle<D = PlayerModeDriver> {
  readonly id: DrivenMode;
  /** Entered (a driver holds the frame) or traversing (the last fixed step's traversal moved the capsule). */
  readonly active: boolean;
  /** Hand the frame to `driver` until `exit`. */
  enter: (driver: D) => void;
  exit: () => void;
  /** Push (true) or pop (false) the mode's input context. */
  context: (on: boolean) => void;
}

/** What the registry reads and writes on the Player (structural, so a headless or test player can stand in): its driver
 *  slot (`D`: the page Player's `ride`, or SimHost's mode driver, sim.ts) and its motor state. */
export interface ModePlayer<D = PlayerModeDriver> {
  ride: D | null;
  readonly hover: boolean;
  readonly swimming: boolean;
  readonly wading: boolean;
}
/** The input service's context stack, as the registry uses it. */
export interface ModeInput {
  register: (def: InputContextDef, scope: Scope) => void;
  push: (id: string, scope: Scope) => void;
  pop: (id: string) => void;
}

/** The Player's motor mode right now: the board over the water, swimming over wading. */
export function motorMode(player: Pick<ModePlayer, 'hover' | 'swimming' | 'wading'>): MotorMode {
  return player.hover ? 'board' : player.swimming ? 'swim' : player.wading ? 'wade' : 'foot';
}

/**
 * Does a mode-only piece collide (`Piece.mode` on the page, SimHost's board-only colliders headless)? Only while the
 * player's current mode is the piece's: one rule for both hosts.
 */
export function modeCollides(pieceMode: PlayerModeId, current: PlayerModeId | undefined): boolean { return current === pieceMode; }

/** One player's mode registry: the page Player's (`playerModes(player)`), or a headless host's (`SimHost.modes`). */
export class PlayerModes<D = PlayerModeDriver> {
  private readonly defs = new Map<DrivenMode, PlayerModeDef>();
  private readonly traversing = new Set<DrivenMode>();
  private entered: { readonly id: DrivenMode; readonly driver: D } | null = null;

  private readonly player: ModePlayer<D>;
  private readonly asked: () => boolean;
  /** `asked`: a host of several players says whether the running `player.traversal` ask is for this registry's. */
  constructor(player: ModePlayer<D>, asked: () => boolean = () => true) { this.player = player; this.asked = asked; }

  /**
   * Declare a driven mode for `scope`'s lifetime: its context is registered with `input`, its traversal answers `events`'
   * `player.traversal` ask (after any earlier answer, which it passes through). A later declaration of the same id (the
   * next level's, before the last one's scope ends) replaces it until its own scope ends.
   */
  register(def: PlayerModeDef, scope: Scope, ports: { readonly events?: Events; readonly input?: ModeInput } = {}): PlayerModeHandle<D> {
    if (def.traverse !== undefined && ports.events === undefined) throw new Error(`Player mode ${def.id} traverses: it needs the events`);
    if (def.context !== undefined && ports.input === undefined) throw new Error(`Player mode ${def.id} has an input context: it needs the input`);
    this.defs.set(def.id, def);
    scope.onDispose(() => {
      if (this.defs.get(def.id) !== def) return; // a later declaration replaced it
      if (this.entered?.id === def.id) this.exit(def.id);
      this.defs.delete(def.id); this.traversing.delete(def.id);
    });
    const { events, input } = ports, context = def.context, traverse = def.traverse;
    if (context !== undefined && input !== undefined) input.register(context, scope);
    if (traverse !== undefined && events !== undefined) {
      events.answer('player.traversal', (dt) => {
        if (typeof dt !== 'number' || !this.asked()) return dt; // an earlier answer stands
        const moved = traverse(dt);
        if (moved) this.traversing.add(def.id); else this.traversing.delete(def.id);
        return moved;
      }, scope);
    }
    let pushed = false;
    const isActive = (): boolean => this.active(def.id);
    return {
      id: def.id,
      get active(): boolean { return isActive(); },
      enter: (driver) => { this.enter(def.id, driver); },
      exit: () => { this.exit(def.id); },
      context: (on) => {
        if (context === undefined || input === undefined || on === pushed) return;
        pushed = on;
        if (on) input.push(context.id, scope); else input.pop(context.id);
      },
    };
  }

  /** Hand the frame to `driver` in mode `id` (the Player's `ride` slot); a declared `enter` hook runs after. */
  enter(id: DrivenMode, driver: D): void {
    if (this.entered !== null && this.entered.id !== id) throw new Error(`Player mode ${this.entered.id} holds the frame`);
    this.entered = { id, driver };
    this.player.ride = driver;
    this.defs.get(id)?.enter?.();
  }

  /** Hand the frame back (a no-op when `id` does not hold it); a declared `exit` hook runs after. */
  exit(id: DrivenMode): void {
    if (this.entered?.id !== id) return;
    this.entered = null;
    this.player.ride = null;
    this.defs.get(id)?.exit?.();
  }

  /** Is `id` the current mode (a motor mode, the entered driver or a traversal that moved the capsule last step)? */
  active(id: PlayerModeId): boolean { return this.current() === id; }

  /** The current mode: the entered driver, else a traversal holding the capsule, else the Player's motor mode. */
  current(): PlayerModeId {
    if (this.entered !== null && this.player.ride === this.entered.driver) return this.entered.id;
    const [traversal] = this.traversing;
    return traversal ?? motorMode(this.player);
  }

  /** The declared mode `id`, if any. */
  def(id: DrivenMode): PlayerModeDef | undefined { return this.defs.get(id); }

  /** Last claimed traversal modes, in answer order; guest clocks and targets belong to their own continuation. */
  snapshotTraversals(): DrivenMode[] { return [...this.traversing]; }

  /** Restore only declared traversal identities, without calling their motion laws or enter hooks. */
  restoreTraversals(ids: readonly DrivenMode[]): void {
    if (ids.length > 5 || new Set(ids).size !== ids.length || ids.some(id => this.defs.get(id)?.traverse === undefined)) throw new Error('Invalid traversal mode continuation');
    this.traversing.clear(); for (const id of ids) this.traversing.add(id);
  }
}

const registries = new WeakMap<ModePlayer, PlayerModes>();
/** The Player's mode registry, made on first use. */
export function playerModes(player: ModePlayer): PlayerModes {
  let modes = registries.get(player);
  if (modes === undefined) { modes = new PlayerModes(player); registries.set(player, modes); }
  return modes;
}

/** Admitted cable declarations share the enclosing page/native mode scope, never another cell's player registry. */
const cableOwners = new WeakMap<Scope, { readonly rows: string; readonly flags: Pick<Flags, 'has' | 'set'>; readonly owner: CableTraversal }>();
/** Install the bounded cable rows once at ordinary mode setup; repeated quest bindings must agree exactly. */
export function installCableModes(scope: Scope, rows: ModeRows['traverse'], flags: Pick<Flags, 'has' | 'set'>): CableTraversal {
  if (scope.disposed) throw new Error('Cable mode scope is disposed');
  const input = parseModes({ traverse: rows }).traverse, fingerprint = JSON.stringify(input), existing = cableOwners.get(scope);
  if (existing !== undefined) {
    if (existing.rows !== fingerprint || existing.flags !== flags) throw new Error('Cable modes already have another declaration or flags owner');
    return existing.owner;
  }
  const owner = new CableTraversal(input, flags);
  cableOwners.set(scope, { rows: fingerprint, flags, owner });
  scope.onDispose(() => { cableOwners.delete(scope); });
  return owner;
}
/** Borrow this scope's real installed cable owner. A missing mode install refuses rather than constructing a fallback. */
export function cableModes(scope: Scope): CableTraversal {
  const entry = cableOwners.get(scope);
  if (scope.disposed || entry === undefined) throw new Error('Cable modes are not installed');
  return entry.owner;
}
