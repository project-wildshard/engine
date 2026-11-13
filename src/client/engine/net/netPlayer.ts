// P1-E5.3-C6 (E5-REPLICATION §5.2): a Player on the wire. Each fixed step's controls become a command the server gets and the
// predictor steps at once; each frame takes the newest owner block and reconciles; `flush` runs once a frame, so at Low Power
// Mode's 2.47 steps a frame a bundle carries them all (J121). Nothing here knows how bytes travel or what the server runs.
import { Vector3 } from 'three';
import type { NetCommand } from '@wildshard/wire/netCommand';
import type { OwnHit, WeaponWire } from '../../../shared/engine/combat/Weapon';
import { NET_BUTTONS } from '../../../shared/engine/input/netButtons';
import { MAX_FIXED_STEPS } from '../../../shared/engine/core/fixedStep';
import { quantiseCommand } from '../../../shared/engine/net/command';
import type { DecodedFrame } from '../../../shared/engine/net/frame';
import type { NetRide } from '../../../shared/engine/net/messages';
import { PLAYER_CLASS } from '../../../shared/engine/net/netSchemas';
import type { Physics } from '../../../shared/engine/physics/Physics';
import type { Player, PlayerLink, PlayerWireInput } from '../player/Player';
import { AttackPrediction } from './attackPrediction';
import { heldOnOthers, slotKit, type HeldLook } from './heldOnOthers';
import type { NetClient } from './client';
import { predictedPlayer, PredictionWorld } from './predictionWorld';
import { Predictor } from './predictor';

/** Where this player's attacks are drawn: `EquipmentService`, on a page. */
export interface NetWeapons { readonly bindWire: (wire: WeaponWire | null) => void; readonly serverHit: (hit: OwnHit) => void; readonly attackRefused: () => void; readonly heldByServer: (row: string) => void; readonly mirrorArrows: (count: number) => void;
  /** RP5: an item as other players' bodies draw it, by row or (a kit with no slot map) by its place in the kit. */
  readonly heldLook?: (which: string | number) => HeldLook | null }

/** A traversal tool's line to the server. `lock` is a LOCK press naming its hook by index, and answers the `seq` that carries it. */
export interface NetHookWire { readonly lock: (hook: number | undefined) => number; readonly fire: () => void }

/** A page's ride: it gets on and off on the server's word (J48, P1-E5.3-D3). `mount` is the handle of the body under the rider. */
export interface NetRideSeat { readonly enter: (mount: number) => void; readonly leave: () => void }

/** The owner block's columns for the last attack the server started and the slot it says this player holds. */
const LAST_SWING = PLAYER_CLASS.owner.findIndex(column => column.name === 'lastSwingSeq'), HELD = PLAYER_CLASS.owner.findIndex(column => column.name === 'held');
/** Ticks between asks for a slot: a timed swap's whole length, so a slot the server is still raising is not asked for again. */
const ASK_TICKS = 30;
/** Asks for a slot before this page takes the server's word: long enough for a pickup or a purchase to land first. */
const MOST_ASKS = 10;

/** One client's own character. */
export class NetPlayer implements PlayerLink {
  readonly predictor: Predictor;
  readonly world: PredictionWorld;
  /** Its swings and shots, until the server rules on them (J47). */
  readonly attacks: AttackPrediction = new AttackPrediction();
  /** Its weapons' line to the server: what the next command carries. */
  readonly wire: WeaponWire = {
    // FM4: a swing made while the link is down is dropped and the page's hold card says why: it would otherwise go out late
    press: (started, heavy = false) => { if (!this.client.allows('Attack')) return; this.pressed = true; this.pressStarted ||= started; this.heavyPress ||= heavy; },
    hold: heavy => { this.heavy = heavy; },
    secondary: () => { if (this.client.allows('Ability')) this.gust = true; },
    fire: ads => { if (this.client.allows('Fire')) this.launcher = { slot: this.held, ads, fire: true }; },
    afterStep: run => { this.afterStep = run; },
    steps: () => this.frameSteps,
    nextSeq: () => (this.seq + 1) & 0xffff,
    shot: seq => { this.attacks.started(seq); },
    equip: row => {
      const slot = this.slots.get(row);
      if (slot === undefined) return;
      // FM4: a swap asked while the link is down isn't kept to send later; the hand goes back to what the server holds
      if (!this.client.allows('Equip')) { this.follow(this.held); return; }
      this.wanted = slot; this.asks = 0; this.askAt = 0; this.heavy = false;
    },
    mayEquip: () => this.client.allows('Equip'),
    interact: id => { this.client.act({ kind: 'interact', seq: this.seq, id }); },
    reload: () => { this.client.act({ kind: 'reload', seq: this.seq, slot: this.held }); },
  };
  /** The body a lock holds, by the server's name for it (J116). */
  lockTarget: () => string | undefined = () => undefined;
  /** Where a harness's move goes: the shell's, on a worker page. */
  place: (x: number, y: number, z: number, yaw: number) => void = () => undefined;
  /** Whether this page stands in the world a frame came from. A crossing's frames wait behind this until the page has made it. */
  inCell: (cell: number) => boolean = () => true;
  /** A hook tool's presses: the next command carries them (J116, `hookTarget`). */
  readonly hooks: NetHookWire = {
    lock: hook => { this.hookLocked = true; this.hookTarget = hook; return (this.seq + 1) & 0xffff; },
    fire: () => { this.hookFired = true; },
  };
  /** A page's presses to get on or off. */
  readonly ride = (action: 'offer' | 'mount' | 'dismount'): void => { this.client.act({ kind: 'ride', seq: this.seq, action }); };
  /** Biggest camera offset a correction has left, in metres: what a proof page reports. */
  worstOffset = 0;
  private readonly client: NetClient;
  private readonly player: Player;
  private seen: DecodedFrame | null = null;
  private respawnHeld = false;
  private pressed = false;
  private gust = false;
  private pressStarted = false;
  private heavy = false;
  private heavyPress = false;
  private held = 0;
  private afterStep: (() => void) | null = null;
  private frameSteps = 0;
  private deviceMode: 'frame' | 'live' | 'paused' = 'frame';
  private inputTick: number | null = null;
  private deviceDriver: { mode: () => 'frame' | 'live' | 'paused'; held: () => PlayerWireInput } | null = null;
  private launcher: NonNullable<NetCommand['launcher']> | null = null;
  private hookLocked = false;
  private hookTarget: number | undefined;
  private hookFired = false;
  private seq = 0;
  private weapons: NetWeapons | null = null;
  private seat: NetRideSeat | null = null;
  /** The ride this player has heard of and its page has not yet acted on: each frame takes them first. */
  private readonly heard: NetRide[] = [];
  /** The server's slot for each row this page can hold. A row it has no slot for is the server's own business. */
  private slots: ReadonlyMap<string, number> = new Map<string, number>();
  /** The slot this page holds and the server has not yet said it does. */
  private wanted: number | null = null;
  private asks = 0;
  private askAt = 0;
  private readonly off: readonly (() => void)[];
  constructor(client: NetClient, player: Player, physics: Physics) {
    this.client = client; this.player = player;
    this.world = new PredictionWorld(physics);
    this.predictor = new Predictor(predictedPlayer(player, this.world), PLAYER_CLASS.owner, row=>{client.correction(row);});
    this.attacks.onRefused(() => { this.weapons?.attackRefused(); });
    this.off = [client.onCombat(event => {
      // an own blow plays the moment it is heard: the predicted swing already ran (J47)
      if (event.kind !== 'hit' || event.confirmFor === 0) return;
      this.attacks.confirm(event.confirmFor);
      const kind = this.client.entities.get(event.target)?.initial['kind'];
      this.weapons?.serverHit({ kind: typeof kind === 'string' ? kind : '', at: new Vector3(...event.at), head: event.head, killed: event.killed, amount: event.amount, seq: event.confirmFor });
    }),
    client.onRide(event => { if (event.rider === client.welcome?.handle) this.heard.push(event); }),
    // A crossing is a snap (§5.2): nothing is sent until the next world's first frame seats this body there, in its coordinates.
    client.onFrame(() => { const driver = this.deviceDriver; if (driver !== null) this.pulseDevice(driver.mode(), driver.held); }),
    client.onTravel(() => { this.seen = null; }),
    // A new link is a new command stream: every saved move named the old one, and `adopt` lets them go on the first frame.
    client.onRejoin(() => { this.seen = null; this.seq = 0; this.heard.length = 0; this.attacks.clear(); })];
  }
  /** Draw this player's attacks on `weapons`: they stop settling their own contact and take the server's word. */
  bindWeapons(weapons: NetWeapons, slots: ReadonlyMap<string, number>): void {
    this.weapons = weapons; this.slots = slots; weapons.bindWire(this.wire);
    // RP5: other players' bodies draw what their slot holds as this page's kit does
    this.unlend(); this.unlend = heldOnOthers.lend(slotKit(() => this.slots, which => this.weapons?.heldLook?.(which) ?? null));
  }
  private unlend: () => void = () => undefined;
  /** A world has its own items, and so its own slots. */
  bindSlots(slots: ReadonlyMap<string, number>): void {
    this.slots = slots;
    if (this.weapons !== null) { this.unlend(); this.unlend = heldOnOthers.lend(slotKit(() => this.slots, which => this.weapons?.heldLook?.(which) ?? null)); } // RP5: its items too
  }
  /** Where this player's ride lands. A page with none takes no ride's words. */
  bindRide(seat: NetRideSeat | null): void { this.seat = seat; }
  /** The slot the server says this player holds. */
  get heldSlot(): number { return this.held; }
  /** The server has put this body somewhere: a frame has been heard. */
  get joined(): boolean { return this.seen !== null; }
  /** A death's authoritative pose is already reset on the server. Keep this page at the death until its overlay is dark. */
  holdRespawn(): void { this.respawnHeld = true; }
  /** Adopt the newest server pose under the dark, dropping commands from before the death. */
  resumeRespawn(): void { this.respawnHeld = false; this.seen = null; }

  /** A fixed step. False, with nothing sent, before the first frame or when a full ring says the server stopped answering. */
  step(input: PlayerWireInput): boolean {
    if (this.respawnHeld || this.seen === null || this.predictor.full) return false;
    if (!this.claimInputTick(0)) return false;
    const armed = this.armed(input);
    return this.sendCommand(armed, true, this.hooked(armed));
  }
  /** Bind current page activity and controls without consuming a device edge. */
  driveDevice(mode: () => 'frame' | 'live' | 'paused', held: () => PlayerWireInput): void {
    this.deviceDriver = { mode, held };
    this.pulseDevice(mode());
  }
  /** Keep sustained controls on the server's clock when GPU presentation is
   * slow. Reserve a render frame's bounded steps for presses/weapon sequences;
   * never replay an edge, grant elapsed-time credit, or change capture clocks. */
  pulseDevice(mode: 'frame' | 'live' | 'paused', readHeld?: () => PlayerWireInput): void {
    if (mode !== this.deviceMode || mode === 'paused') {
      this.deviceMode = mode;
      this.inputTick = mode === 'live' ? Math.max(0, (this.client.latest?.tick ?? 0) - MAX_FIXED_STEPS) : this.client.latest?.tick ?? null;
    }
    if (mode !== 'live' || readHeld === undefined || this.respawnHeld || this.player.ride !== null) return;
    this.reconcile(false);
    if (this.seen === null || this.predictor.full || this.pressed || this.gust || this.pressStarted || this.heavyPress
      || this.launcher !== null || this.afterStep !== null || this.hookLocked || this.hookFired) return;
    if (!this.claimInputTick(MAX_FIXED_STEPS)) return;
    const held = readHeld(), target = this.lockTarget();
    const edges = NET_BUTTONS.jump | NET_BUTTONS.dodge | NET_BUTTONS.hover | NET_BUTTONS.secondary | NET_BUTTONS.lock;
    const input = {...held, buttons: (held.buttons & ~edges) | (this.heavy ? NET_BUTTONS.heavy : 0), ...(target === undefined ? {} : {lockTarget: target})};
    this.sendCommand(input, false);
    for (let at = 1; at < MAX_FIXED_STEPS && !this.predictor.full && this.claimInputTick(MAX_FIXED_STEPS); at++) this.sendCommand(input, false);
    this.client.flush();
  }
  private claimInputTick(reserve: number): boolean {
    if (this.deviceMode === 'frame') return true;
    if (this.deviceMode === 'paused') return false;
    const tick = this.client.latest?.tick;
    if (tick === undefined) return false;
    const previous = this.inputTick;
    let consumed = previous === null || previous > tick ? Math.max(0, tick - MAX_FIXED_STEPS) : previous;
    consumed = Math.max(consumed, tick - MAX_FIXED_STEPS - reserve);
    this.inputTick = consumed;
    if (tick - consumed <= reserve) return false;
    this.inputTick++; return true;
  }
  private sendCommand(input: Parameters<NetClient['command']>[0], actions: boolean, wire = input): boolean {
    const seq = this.seq = this.client.command(wire);
    if (actions) {
      this.hookLocked = false; this.hookTarget = undefined; this.hookFired = false;
      this.frameSteps++;
      if (this.pressStarted || input.launcher?.fire === true) this.attacks.started(seq);
      this.pressed = false; this.gust = false; this.pressStarted = false; this.heavyPress = false; this.launcher = null;
    }
    this.world.poseFor(seq, false);
    const stepped = this.predictor.step(quantiseCommand({ ...input, seq, viewTick: 0 })), run = actions ? this.afterStep : null;
    if (actions) this.afterStep = null;
    run?.();
    return stepped;
  }
  /** The step's controls, with what the weapon in hand has for this command. */
  private armed(input: PlayerWireInput): PlayerWireInput & Partial<Pick<NetCommand, 'attack' | 'launcher' | 'lockTarget'>> {
    const { launcher } = this, buttons = input.buttons | (this.heavy || this.heavyPress ? NET_BUTTONS.heavy : 0) | (this.gust ? NET_BUTTONS.secondary : 0), lockTarget = this.lockTarget();
    return { ...input, buttons, ...(this.pressed ? { attack: { aim: this.player.sampleAimCommand() } } : {}), ...(launcher === null ? {} : { launcher }), ...(lockTarget === undefined ? {} : { lockTarget }) };
  }
  /** What goes to the server beyond what this body steps: a claw's JUMP moves the body only there, and only by `led`. */
  private hooked<T extends PlayerWireInput>(armed: T): T & Pick<NetCommand, 'hookTarget'> {
    const { hookLocked, hookFired, hookTarget } = this, lock = hookLocked ? NET_BUTTONS.lock : 0, jump = hookFired ? NET_BUTTONS.jump : 0;
    return { ...armed, buttons: armed.buttons | lock | jump, ...(hookTarget === undefined ? {} : { hookTarget }) };
  }
  /** The start of a render frame, before its fixed steps: the newest owner block, compared once. */
  reconcile(frameStart = true): void {
    if (frameStart) this.frameSteps = 0;
    const frame = this.client.latest;
    if (this.respawnHeld || frame === null || frame === this.seen || !this.inCell(frame.cell)) return;
    const first = this.seen === null, { seat } = this;
    this.seen = frame;
    this.world.frame(frame.tick, frame.lastSeq);
    for (const event of this.heard.splice(0)) if (event.kind === 'mount') seat?.enter(event.mount); else seat?.leave();
    const ridden = seat === null ? null : frame.ride;
    if (first) { this.predictor.adopt(frame.lastSeq, frame.owner, frame.tick, ridden); return; }
    this.predictor.reconcile(frame.lastSeq, frame.owner, frame.tick, ridden);
    const swung = PLAYER_CLASS.owner[LAST_SWING]?.value(frame.owner[LAST_SWING] ?? 0), held = PLAYER_CLASS.owner[HELD]?.value(frame.owner[HELD] ?? 0);
    this.attacks.frame(frame.lastSeq, typeof swung === 'number' ? swung : 0);
    if (typeof held === 'number') this.heldIs(held, frame.tick);
  }
  /** The slot the server says this player holds. It goes on asking for the page's until that lands or plainly will not. */
  private heldIs(held: number, tick: number): void {
    const moved = held !== this.held, { wanted } = this;
    this.held = held;
    if (wanted === held) { this.wanted = null; return; }
    if (wanted === null) { if (moved) this.follow(held); return; }
    if (tick < this.askAt) return;
    if (this.asks >= MOST_ASKS) { this.wanted = null; this.follow(held); return; }
    this.client.act({ kind: 'equip', seq: this.seq, slot: wanted });
    this.asks++; this.askAt = tick + ASK_TICKS;
  }
  private follow(slot: number): void {
    for (const [row, at] of this.slots) if (at === slot) { this.weapons?.heldByServer(row); return; }
  }
  /** The end of a render frame: send what its steps queued, and glide the camera. */
  present(dt: number): void {
    this.client.rendered();
    if (this.seen !== null) this.client.flush();
    this.predictor.update(dt);
    this.worstOffset = Math.max(this.worstOffset, this.player.renderOffset.length());
  }
  dispose(): void { for (const off of this.off) off(); this.weapons?.bindWire(null); this.unlend(); this.world.dispose(); }
}
