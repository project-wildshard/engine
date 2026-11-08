import { Vector3 } from 'three';
import { Scope } from '../../../shared/engine/app/scope';
import { StrikeRunner } from '../../../shared/engine/ai/strikes';
import { PlayerHealth } from '../../../shared/engine/combat/health';
import { FIXED_STEP } from '../../../shared/engine/core/fixedStep';
import type { CharacterMotor, MotorOptions } from '../../../shared/engine/physics/CharacterMotor';
import { floorBelow } from '../../../shared/engine/physics/query';
import { applyImpulse } from '../../../shared/engine/player/impulse';
import { hardFallHit } from '../../../shared/engine/player/fall';
import { hitShoveSpeed, shoveHop, startShove, type ShoveState } from '../../../shared/engine/player/shove';
import { HOVER_HARD_LANDING, type BoardState } from '../../../shared/engine/player/board';
import { hoverSpeed } from '../../../shared/engine/player/hoverSpeed';
import { COYOTE_MS, type JumpState } from '../../../shared/engine/player/jump';
import { pondBob, type SwimState } from '../../../shared/engine/player/swim';
import { localWalkingMove, wadeScale } from '../../../shared/engine/player/walk';
import { PlayerModes, type ModePlayer } from '../../../shared/engine/player/modes';
import { commandedWalk, pressDodge, resetMotion, setBoard, stepPlayerMotion, type MotionFooting, type MotionPlatform, type MotionRide, type MotionWorld, type PlayerMotionState } from '../../../shared/engine/player/motion';
import { LOCK_REACH, type LockState, type MotionLock } from '../../../shared/engine/player/lockOrbit';
import { targetRadius } from '../../../shared/engine/combat/lungeTarget';
import { dashToward, startDash, type DashState, type DodgeState } from '../../../shared/engine/player/dash';
import { validateLocalMovement } from '../../../shared/engine/input/commands';
import { netSimCommand } from '../../../shared/engine/sim/netMotion';
import type { SimCommand, SimExternalPlayer, SimHost, SimPlayerBody, SimPlayerDriver, SimPlayerMotionSample, SimRide, SimTickCommand, SimWalkingControl } from '../sim';

/** The world-space command a tick's input means. */
/** Developer boost is a Developer page's, on its own server: a standalone worker says so at boot, and any other host ignores the button. */
let developerBoost = false;
export function allowDeveloperBoost(): void { developerBoost = true; }
export function simCommandOf(input: SimTickCommand): SimCommand { return 'seq' in input ? netSimCommand(input) : input; }
/** A board whose "riding near the ride height" is the fall's ground. */
function boardOn(fall: { grounded: boolean }): BoardState & { on: boolean } {
  return { on: false, hoverAir: false, hoverBob: 0, get onGround() { return fall.grounded; }, set onGround(on) { fall.grounded = on; } };
}
/** How a host makes a player's body. */
export interface PlayerSimBody {
  /** The page's own player: this sim reads it and leaves its motion to the page. */
  readonly borrowed?: SimPlayerBody | undefined;
  /** A player a frozen region holds logically, with no capsule. */
  readonly bodiless?: boolean;
  readonly id: string;
  readonly at: { readonly x: number; readonly y: number; readonly z: number };
  readonly yaw: number;
  readonly motor: (health: PlayerHealth) => CharacterMotor | undefined;
}

/**
 * One player of a SimHost (P1-E5.2a): its body, health, strike runner and the movement law's state. The law is the client
 * Player's, step for step; a host runs one `input` for every player before its physics step and one `move` after it.
 */
export class PlayerSim implements PlayerMotionState {
  readonly id: string;
  readonly position: Vector3;
  /** This player's strike clock; the host also lists it by id, so a strike is resolved like any other actor's. */
  readonly strike: StrikeRunner = new StrikeRunner();
  /** The loadout slot this player holds, for the wire. The loadout writes it each tick and keeps the saved truth. */
  held = 0;
  /** For the wire (P1-E5.3-E1): seconds into the running swing, null with none, and the `seq` of the last swing or shot that left. The seats write it each tick and keep the saved truth. */
  readonly swing: { t: number | null; seq: number } = { t: null, seq: 0 };
  /** Transient world velocity (m/s), the client Player's impulse law (player/impulse.ts). */
  readonly impulse: Vector3 = new Vector3();
  /** The one world velocity (m/s, y negative = falling) through every mode, the client Player's `velocity`. */
  readonly velocity: Vector3 = new Vector3();
  /** Whether the motor last stood it on ground. At rest (grounded, still) an idle tick leaves the player untouched. */
  readonly fall = { grounded: true };
  /** The client Player's moveScale: what its owner (an input lock: 0, a slowing zone) scales the version-1 walk by, and
   *  what a mounted driver's reins read. Saved while it is not 1. */
  moveScale = 1;
  /** The running creature-hit knockback, the client Player's shove law (player/shove.ts). */
  readonly shove: ShoveState = { t: 0, vx: 0, vz: 0 };
  /** The hoverboard (SF72): on the board, each step runs the client Player's board law (player/board.ts) instead of the
   * walk, and the board-only colliders (SimHost.boardColliders) collide. Off by default. Riding near the ride height is
   * the fall's own ground, as on the client's Player. */
  readonly board: BoardState & { on: boolean } = boardOn(this.fall);
  /** SF34: the swim (player/swim.ts, the client Player's water law), only on a host with water (useWater): on once the
   *  feet float, with the law's dive, haul-out and stroke clocks. */
  readonly swim: SwimState & { on: boolean; stood: boolean } = { on: false, diving: false, climbTo: null, climbCooldown: 0, strokeTime: 0, stood: false };
  /**
   * SF34: this player's modes, the page Player's own registry (player/modes.ts): the motor mode (foot, board, swim, wade)
   * read from this state, and a driven mode a runtime declares and enters (`modes.register(def, scope)`,
   * `modes.enter('ride', ride)`), whose SimRide then owns the step ahead of any useDriver driver until `modes.exit`. The
   * entered ride is not snapshot state: the installer re-enters it from its own adapter's continuation before native restore.
   */
  readonly modes: PlayerModes<SimRide>;
  /** The on-foot jump clocks (player/jump.ts), the client Player's. Saved once they differ from a fresh player's. */
  readonly jump: JumpState = { ago: Infinity, left: 0 };
  /** The running dash: a dodge's burst or a lunge (dashTo), the client Player's dash law (player/dash.ts). */
  readonly dash: DashState = { t: 0, vx: 0, vz: 0 };
  /** The dodge clocks (cooldown, the burst's i-frames read by its health's `dodging`). */
  readonly dodge: DodgeState = { cd: 0, t: 0 };
  /** The fixed step the swell reads: the host's own. */
  get tick(): number { return this.host.state.tick; }
  /** The board's live speed cap where something rules one (the grid, GridSimulation): the page's `hoverSpeedLimit`. Never saved:
   *  its owner puts it back. */
  hoverSpeedLimit: (() => number) | null = null;
  /** Developer boost, held this tick. Never saved. */
  private boosted = false;
  /** The orbit radius a lock holds (player/lockOrbit.ts). */
  readonly lock: LockState = { r0: 0 };
  /** The body this player's lock holds, as its last command named it; null with none. */
  private lockId: string | null = null;
  /** Counts this player's teleports, for the wire: a client hears one even when no command is on its way (P1-E5.3-C2). Never saved. */
  resets = 0;
  /** Something else owns the position (a cable's seat): the step leaves it alone, and the client takes no local step. */
  carried = false;
  /** The motion step's read of the feet: the page's, and the next step reads it. Saved while it is not dry, firm ground. */
  readonly footing: MotionFooting = { water: null, depth: 0, wading: false, onPlatform: false, sliding: false };
  private readonly host: SimHost;
  private readonly body: SimPlayerBody;
  /** The page lends this player; its motion, impulse and knockback stay the page's. */
  readonly borrowed: boolean;
  private bodyMotor: CharacterMotor | undefined;
  private driver: SimPlayerDriver | undefined;
  private walkingControl: SimWalkingControl | undefined;
  private motionObserver: { receive: (sample: SimPlayerMotionSample | null) => void; sample: { velocityX: number; velocityZ: number; grounded: boolean; swimming: boolean; hover: boolean } } | undefined;
  private external: { value: SimExternalPlayer; health: PlayerHealth; scope: Scope } | undefined;
  /** What carries this player now (P1-E5.3-D1): the motion step dispatches to it. */
  private ride: SimRide | null = null;
  private readonly commanded = { speed: 4.3, crouching: false };
  private readonly localMove = { x: 0, z: 0 };
  /** The motion step's world (player/motion.ts): this player's motor, the host's queries, and the host's moments. */
  private readonly world: MotionWorld = this.motionWorld();
  // This tick's command and what `input` decided, for `move`.
  private command: SimCommand | undefined;
  private tickDriver: SimPlayerDriver | undefined;
  private tickRide: SimRide | null = null;
  private delegated = false;
  /** A traversal owned this player's last move. */
  private traversed = false;
  /** A net room's queue gave this player no command this tick (J125): its motion waits for one. */
  private still = false;
  private walking: SimWalkingControl = this.commanded;

  constructor(host: SimHost, body: PlayerSimBody, scope: Scope) {
    this.host = host; this.id = body.id;
    this.modes = new PlayerModes<SimRide>(this.modePlayer(), () => host.traversing === null || host.traversing === this);
    if (body.borrowed !== undefined) {
      this.borrowed = true; this.body = body.borrowed; this.position = body.borrowed.position;
    } else {
      const position = new Vector3(body.at.x, body.at.y, body.at.z);
      const health = new PlayerHealth(host.events, { now: () => host.clock.now * 1000, position: () => position, dodging: () => this.dodge.t > 0, dodgeGuard: () => this.health.effectTags.includes('guard.dodge') }, body.id);
      this.borrowed = false; this.position = position;
      this.bodyMotor = body.bodiless === true ? undefined : body.motor(health);
      this.bodyMotor?.resetAt(position);
      const readMotor = (): CharacterMotor => { if (this.bodyMotor === undefined) throw new Error('Frozen simulation has no player motor'); return this.bodyMotor; };
      const writeMotor = (motor: CharacterMotor): void => { this.bodyMotor = motor; };
      this.body = { id: body.id, position, yaw: body.yaw, health,
        get motor(): CharacterMotor { return readMotor(); }, set motor(motor: CharacterMotor) { writeMotor(motor); } };
      host.combat.playerRules(scope, { target: health });
      // a creature's blow knocks this player back, as the client's PlayerHurt shoves its Player on `feel.blow`
      host.events.on('damage.dealt', ({ req, dealt }) => {
        if (req.target === this.health && this.external === undefined && this.hasMotor && req.sourceTags.includes('feel.blow')) this.knockBack(req.point.x, req.point.z, hitShoveSpeed(dealt));
      }, scope);
    }
  }
  get yaw(): number { return this.body.yaw; }
  set yaw(value: number) { this.body.yaw = value; }
  get health(): PlayerHealth { return this.body.health; }
  set health(value: PlayerHealth) { this.body.health = value; }
  get motor(): CharacterMotor { return this.body.motor; }
  set motor(value: CharacterMotor) { this.body.motor = value; }
  /** True only while this host owns the player's capsule and controller. */
  get hasMotor(): boolean { return this.borrowed || this.bodyMotor !== undefined; }
  /** Dispose an owned capsule with the host. */
  disposeMotor(): void { if (!this.borrowed) this.bodyMotor?.dispose(); }
  /** The original capsule law also reconstructs a saved motor for a bodyless restore target. */
  motorOptions(fallback: () => MotorOptions): MotorOptions {
    if (this.borrowed) throw new Error('Borrowed player motor belongs to its world owner');
    return this.bodyMotor?.opts ?? fallback();
  }
  /** Freeze a regional player after its checkpoint. */
  detachMotor(): void {
    if (this.borrowed) throw new Error('Borrowed player motor belongs to its world owner');
    if (this.bodyMotor !== undefined) this.releaseMotor().dispose();
  }
  /** Transfer ownership after a prepared frame commit has already retired the old collider. */
  releaseMotor(): CharacterMotor {
    if (this.borrowed || this.bodyMotor === undefined) throw new Error('Invalid regional motor release');
    const motor = this.bodyMotor; this.bodyMotor = undefined; return motor;
  }
  /** Commit a prepared motor, without allocating or stepping during the fixed-step frame change. */
  attachMotor(motor: CharacterMotor): void {
    if (this.borrowed || this.bodyMotor !== undefined || this.host.disposed) throw new Error('Invalid regional motor attachment');
    this.bodyMotor = motor;
  }
  /** Bind the page traveller to an owned bodyless region; deactivation leaves the page's health and motor intact. */
  bindExternal(value: SimExternalPlayer): () => void {
    if (this.host.disposed || this.borrowed || this.hasMotor || this.external !== undefined || value.health.id !== this.id) throw new Error('Invalid external regional player');
    const scope = new Scope(`sim:${this.host.level.id}:traveller`), binding = { value, health: this.health, scope };
    this.external = binding; this.health = value.health;
    this.host.combat.playerRules(scope, { target: value.health });
    return () => {
      if (this.external !== binding) return;
      scope.dispose(); this.health = binding.health; this.external = undefined;
    };
  }
  /** Drop an external binding with its host. */
  releaseExternal(): void { this.external?.scope.dispose(); this.external = undefined; }
  /** Trusted page-object alias used only by same-engine continuation encoding, never author-selected query input. */
  isExternalObject(value: unknown): boolean { return this.external !== undefined && value === this.external.value.owner; }
  /** The bound page traveller's pose into this player, or throw while none is bound. */
  followExternal(): void {
    const external = this.external;
    if (external === undefined) throw new Error('External regional player is not bound');
    const { position, yaw } = external.value;
    if (![position.x, position.y, position.z, yaw].every(Number.isFinite)) throw new RangeError('Invalid external player pose');
    this.position.copy(position); this.yaw = yaw;
  }
  private claim<T>(what: string, slot: () => T | undefined, value: T, set: (next: T | undefined) => void): () => void {
    if (this.host.disposed || this.host.embedded || this.borrowed || !this.hasMotor || slot() !== undefined) throw new Error(`${what} belongs to one owned active host`);
    set(value);
    let installed = true, forget: () => void = () => undefined;
    const remove = (): void => {
      if (!installed) return;
      installed = false; forget();
      if (slot() === value) set(undefined);
    };
    forget = this.host.scope.capture('disposers', remove); return remove;
  }
  /** Bind one active motion driver to this owned player. Borrowed, frozen and disposed hosts refuse; the returned remover
   * releases the scope's reference early. Reinstall alongside its continuation adapter before native restore. */
  useDriver(driver: SimPlayerDriver): () => void { return this.claim('Player driver', () => this.driver, driver, next => { this.driver = next; }); }
  /** Bind one scoped on-foot control without replacing the native riding/input driver. A delegated mode still owns motion;
   * borrowed hosts refuse. */
  useWalkingControl(control: SimWalkingControl): () => void { return this.claim('Walking control', () => this.walkingControl, control, next => { this.walkingControl = next; }); }
  /** Observe owned movement before gameplay callbacks. Native motion samples the one velocity, excluding transient impulse
   * velocity, and the post-move ground/hover state. An alternative driver supplies its own sample or null is delivered. The native sample is reused: copy scalars if
   * retaining it. Observers and delegated mutable samples own their continuation; absent preserves all bytes. */
  observeMotion(observer: (sample: SimPlayerMotionSample | null) => void): () => void {
    const binding = { receive: observer, sample: { velocityX: 0, velocityZ: 0, grounded: true, swimming: false, hover: false } };
    return this.claim('Player motion observer', () => this.motionObserver, binding, next => { this.motionObserver = next; });
  }
  private refuseBorrowed(what: string): void {
    if (this.host.disposed || this.host.embedded) throw new Error(`Borrowed simulation player owns its ${what}`);
  }
  /** Shove this player: add transient world velocity in m/s, carried by the motor with each step's own move and decayed
   * after it exactly as the client Player's `impulse` (player/impulse.ts). A borrowed player owns its impulse. */
  addImpulse(velocity: Readonly<Vector3>): void {
    this.refuseBorrowed('impulse');
    applyImpulse(this, velocity, this.ride !== null || this.carried || this.moveLocked);
  }
  /** Knock this player `speed` m/s away from (fromX, fromZ), exactly as the client Player's `shove`: the knockback
   * overrides the walk input and fades over SHOVE_TIME through the motor, and a grounded player hops off the ground. */
  knockBack(fromX: number, fromZ: number, speed: number): void {
    this.refuseBorrowed('knockback');
    if (![fromX, fromZ, speed].every(Number.isFinite)) throw new RangeError('Invalid player knockback');
    if (this.board.on || this.swim.on) return; // the client Player ignores a creature's knockback on the board and swimming
    startShove(this.shove, this.position.x, this.position.z, fromX, fromZ, this.yaw, speed);
    this.dash.t = 0; // a knockback ends a dash
    const { fall } = this;
    if (fall.grounded) { this.velocity.y = shoveHop(this.velocity.y); fall.grounded = false; }
  }
  /** Dash this player at (vx, vz) m/s for `time` s, whatever the input says: the client Player's `dash` (a shard's
   * knock-down). The dash law's own rules hold (player/dash.ts: a wall ends it, a knockback cancels it, its last step
   * brakes). False (nothing happens) on the board or for no time. */
  dashAt(vx: number, vz: number, time: number): boolean {
    this.refuseBorrowed('dash');
    if (![vx, vz, time].every(Number.isFinite)) throw new RangeError('Invalid player dash');
    if (this.board.on || this.swim.on) return false;
    return startDash(this.dash, vx, vz, time);
  }
  /** Dash this player toward (x, z), stopping `stopAt` m short, over `time` s: the client Player's `dashTo`, a sword's
   * lunge (combat/sweptMeleeCore `sweptLunge` gives the numbers). The dash overrides the walk, a wall ends it, a knockback
   * cancels it. False (nothing happens) when already that close, or on the board. */
  dashTo(x: number, z: number, stopAt: number, time: number): boolean {
    this.refuseBorrowed('dash');
    if (![x, z, stopAt, time].every(Number.isFinite)) throw new RangeError('Invalid player dash');
    if (this.board.on || this.swim.on) return false;
    return dashToward(this.dash, this.position.x, this.position.z, x, z, stopAt, time);
  }
  /** Step on or off the hoverboard, the client Player's `setHover` (player/motion.ts). The board-only colliders follow on
   * the next step, before physics, as the client's movers sync before its world step. */
  setBoard(on: boolean): void {
    this.refuseBorrowed('board');
    if (on !== this.board.on) setBoard(this, this.world, on);
  }
  /** Reposition this owned native traveller without stepping the world. Like the page's spawn, release the old ride,
   * velocity, dash and swimming state. */
  resetPose(feet: { x: number; y: number; z: number }, yaw: number): void {
    if (this.host.disposed || this.host.embedded || this.borrowed || !this.hasMotor) throw new Error('Player pose belongs to an owned active host');
    if (![feet.x, feet.y, feet.z, yaw].every(Number.isFinite)) throw new RangeError('Invalid native player pose');
    this.setBoard(false);
    resetMotion(this, this.world, feet.x, feet.y, feet.z, yaw);
    this.motor.release(); this.swim.stood = false; this.resets++;
  }
  /** Nothing the client commands moves this player now: a traversal or carry has them (a boat, a cable, a grapple's pull), or
   *  a fall's fade. Its client takes no step and compares nothing until this ends; the client's own moves wait. */
  get led(): boolean { return this.traversed || this.carried || this.host.respawn.fading(this.id) || this.host.leading.some(leads => leads(this)); }
  /** The body under this player, or null on foot. */
  get ridden(): string | null { return this.ride?.mount() ?? null; }
  /** The ride as the wire's flat words, and how many. 0 on foot. */
  rideWords(out: Float64Array): number { return this.ride?.capture(out, 0) ?? 0; }
  /** The registry's view of this player: the ride slot and the motor state. */
  private modePlayer(): ModePlayer<SimRide> {
    const read = (): SimRide | null => this.ride, write = (ride: SimRide | null): void => { this.ride = ride; };
    const hover = (): boolean => this.board.on, swimming = (): boolean => this.swim.on, wading = (): boolean => this.wading;
    return { get ride() { return read(); }, set ride(driver) { write(driver); }, get hover() { return hover(); }, get swimming() { return swimming(); }, get wading() { return wading(); } };
  }
  /** The current mode (SF34): an entered driven mode, else the motor mode (board, swim, wade, foot). */
  get mode(): ReturnType<PlayerModes['current']> { return this.modes.current(); }
  /** Water over the standing feet (SF34: a host with water, on foot, grounded, the feet more than 2 cm under). */
  get wading(): boolean { return this.footing.wading; }
  /** A status effect holds this player still: the page's `effectMoveLocked`. */
  get moveLocked(): boolean { return (this.health.attributes['moveLocked'] ?? 0) > 0; }
  /** A saved read of the feet, or for a save older than it, what the step would have left at this pose. */
  get lockHeld(): string | null { return this.lockId; }
  /** A saved lock, or none in a save without one. */
  restoreLock(saved: { readonly target: string; readonly r0: number } | undefined): void { this.lockId = saved?.target ?? null; this.lock.r0 = saved?.r0 ?? 0; }
  /** What a command's lock means here: a real living body in reach, or nothing at all, so a bad target costs the client its
   *  orbit and never the server anything. A new body starts its orbit at the radius the feet stand at. */
  private resolveLock(id: string | undefined, steer: NonNullable<SimCommand['steer']>): MotionLock | undefined {
    const body = id === undefined ? undefined : this.host.entities.get(id), p = this.position;
    const r = body === undefined ? Infinity : Math.hypot(body.position.x - p.x, body.position.z - p.z);
    if (id === undefined || body === undefined || !body.alive || !(r <= LOCK_REACH)) { this.lockId = null; return undefined; }
    if (id !== this.lockId) { this.lockId = id; this.lock.r0 = r; }
    return { x: body.position.x, z: body.position.z, radius: targetRadius(body), fwd: Math.max(-1, Math.min(1, steer.keyY + steer.stickY)), str: Math.max(-1, Math.min(1, steer.keyX + steer.stickX)) };
  }
  restoreFooting(saved: MotionFooting | undefined): void {
    if (saved !== undefined) { Object.assign(this.footing, saved); return; }
    const { footing, position: p } = this, water = this.board.on ? null : this.world.water(p.x, p.z);
    footing.water = water; footing.depth = water === null ? 0 : Math.max(0, water - p.y);
    footing.wading = !this.swim.on && !this.swim.stood && this.fall.grounded && footing.depth > 0.02;
    footing.onPlatform = false; footing.sliding = false;
  }
  /** This host's side of the motion step, built before the constructor runs, so every read of the host is lazy. What it has no way to know is absent here: floor functions, a grid limit on the board, an authored
   *  coyote window. */
  private motionWorld(): MotionWorld {
    const motor = (): CharacterMotor => this.motor, water = (): boolean => this.host.water !== undefined;
    const walking = (): SimWalkingControl => this.walking, ride = (): MotionRide | null => this.ride;
    const floors = (): readonly MotionPlatform[] => this.host.floors;
    const coyote = (): number => this.host.level.player.coyoteMs ?? COYOTE_MS;
    return {
      get motor() { return motor(); },
      get ride() { return ride(); },
      get hasWater() { return water(); },
      // the level's water (useWater): the board rides its surface, as the client's; none without it
      water: (x, z) => this.host.water?.surfaceAt(x, z) ?? null,
      heightAt: (x, z) => this.host.heightAt(x, z),
      get platforms() { return floors(); },
      floor: (x, z, fromY, maxDrop) => floorBelow(this.host.physics, x, z, fromY, maxDrop, this.motor.collider, this.motor.solidOnly),
      bob: (x, z) => this.host.water?.bob?.(x, z) ?? pondBob(this.host.clock.now),
      foot: {
        speed: (wadeT) => this.walking.speed * wadeScale(wadeT) * this.moveScale * (this.health.attributes['moveSpeedMul'] ?? 1),
        get crouching() { return walking().crouching; },
        get coyoteMs() { return coyote(); },
      },
      boardTop: () => hoverSpeed(this.hoverSpeedLimit?.(), this.boosted),
      boardCapped: () => this.hoverSpeedLimit !== null || this.boosted,
      jumped: () => { this.host.events.emit('player.jump', true); },
      dodged: () => { this.host.events.emit('player.dodge', true); },
      lunged: () => undefined,
      dodgeScale: () => this.health.attributes['dodgeCooldownMul'] ?? 1,
      // a hard landing files the client's fall hit (Player.onLand(hard) → PlayerHurt.fall)
      landed: (hard) => { if (hard) this.host.combat.hit(hardFallHit(this.health, this.position)); },
      boardLanded: (speed) => { if (speed > HOVER_HARD_LANDING) this.host.combat.hit(hardFallHit(this.health, this.position)); },
      swimChanged: (on) => { this.host.events.emit('player.swim', on); },
      stroked: () => undefined,
      scratch: null,
    };
  }
  /** Check this tick's command before the host moves anything, and resolve raw axes to a world move. */
  take(input: SimTickCommand | undefined, still = false): void {
    this.still = still;
    // P1-E5.3-A17: a press during a fall's fade moves nothing
    if (input === undefined || this.host.respawn.fading(this.id)) { this.command = undefined; return; }
    const command = simCommandOf(input);
    if (![command.moveX, command.moveZ, command.yaw].every(Number.isFinite)) throw new RangeError('Invalid simulation command');
    validateLocalMovement(command);
    if ((command.dive !== undefined && typeof command.dive !== 'boolean') || (command.surface !== undefined && typeof command.surface !== 'boolean')) throw new RangeError('Invalid held swim control');
    if (command.commandVersion !== 1 || command.steer === undefined) { this.lockId = null; this.command = command; return; }
    localWalkingMove(command.steer, command.yaw, this.localMove);
    const lock = this.resolveLock(command.lockTarget, command.steer);
    this.command = { ...command, moveX: this.localMove.x, moveZ: this.localMove.z, ...(lock === undefined ? {} : { lock }) };
  }
  /** The tick's input phase, before the world steps: the drivers, the walk's speed and the HOVER press. */
  input(): void {
    const { command } = this;
    // an entered ride (SF34, modes.enter) owns the motion ahead of a useDriver driver. Its read may throw the rider: then the
    // tick goes on, on foot. Commands drive a ride as they drive a walk (J125), so a tick with none reads nothing
    if (!this.still) this.ride?.read(command, FIXED_STEP);
    const ride = this.ride, driver = ride === null ? this.driver : undefined, delegated = ride !== null || driver?.input(command, FIXED_STEP, this.host) === true;
    this.tickDriver = driver; this.tickRide = ride; this.delegated = delegated;
    const observe = this.motionObserver;
    if (observe !== undefined) { observe.sample.velocityX = 0; observe.sample.velocityZ = 0; }
    commandedWalk(this, command, this.commanded);
    const walking = this.walkingControl ?? this.commanded;
    this.walking = walking;
    if (!Number.isFinite(walking.speed) || walking.speed < 0 || typeof walking.crouching !== 'boolean') throw new RangeError('Invalid walking control');
    // the HOVER press lands in the ordinary input phase; an active alternative driver owns its own motion switches
    this.boosted = developerBoost && command?.boost === true;
    if (!delegated && command?.hover === true) this.setBoard(!this.board.on);
  }
  /** The tick's motion phase, after the world steps. */
  move(): void {
    const { command, delegated } = this, driver = this.tickDriver, host = this.host;
    const observe = this.motionObserver;
    if (command?.dodge === true) pressDodge(this, command, this.world);
    // An unanswered ask returns its numeric dt input; only an explicit true claims motion.
    const traversal: unknown = delegated ? false : host.askTraversal(this);
    const traversed = traversal === true;
    this.traversed = traversed;
    if (this.tickRide !== null) { if (this.ride !== null && !this.still) stepPlayerMotion(this, command, this.world, FIXED_STEP); }
    else if (delegated) driver?.step(FIXED_STEP, host);
    else if (traversed) this.impulse.set(0, 0, 0);
    else if (this.carried || this.moveLocked) { this.impulse.set(0, 0, 0); this.velocity.set(0, 0, 0); this.fall.grounded = false; }
    else if (!this.still) stepPlayerMotion(this, command, this.world, FIXED_STEP);
    if (command?.attack !== undefined) host.startStrike(this.id, command.attack.targetId);
    if (observe !== undefined) {
      let sample: SimPlayerMotionSample | null;
      if (delegated || traversed) {
        sample = !delegated ? null : this.tickRide?.motionSample() ?? driver?.motionSample?.() ?? null;
        if (sample !== null && (![sample.velocityX, sample.velocityZ].every(Number.isFinite)
          || typeof sample.grounded !== 'boolean' || typeof sample.swimming !== 'boolean' || typeof sample.hover !== 'boolean')) throw new RangeError('Invalid delegated player motion sample');
      } else {
        const native = observe.sample;
        native.velocityX = this.velocity.x; native.velocityZ = this.velocity.z;
        native.grounded = this.fall.grounded; native.swimming = this.swim.on; native.hover = this.board.on;
        sample = native;
      }
      observe.receive(sample);
    }
    this.command = undefined;
  }
  /** A second step this tick, after the world's, for a client catching up (J125). A ride is the command's motion, so it takes one. A driver or a
   *  traversal leads the body at its own pace, one step a tick, and the client predicts none of it (`led`). */
  catchUp(input: SimTickCommand): void {
    if ((this.delegated && this.tickRide === null) || this.traversed) return;
    this.take(input); this.input(); this.move();
  }
  /** The strike actor view of this player. */
  actor(): { position: Vector3; yaw: number; scale: number; alive: boolean; startAttack: (seconds: number) => void; cancelAttack: () => void; setMotion: (yaw: number, speed: number, turn: number) => void } {
    return { position: this.position, yaw: this.yaw, scale: 1, alive: this.health.alive,
      startAttack: (_seconds: number) => { /* Weapon runner owns the clock. */ }, cancelAttack: () => { /* Weapon runner owns the clock. */ },
      setMotion: (_yaw: number, _speed: number, _turn: number) => { /* Commands own player movement. */ } };
  }
}
