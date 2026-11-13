// REMOTE-PLAYERS RP8 (Jake, 2026-11-12: "hoverboard spinning as he's turning… just everything"): the board under another
// player who hovers. The board the rider rides in first person (render/hoverboardGeometry.ts, the viewmodel's), at world
// scale (1.4 m), the rider side-on on it, its repulsor halos breathing, a bob. The deck turns with the rider's yaw and banks
// into a turn from the yaw rate: the rate is smoothed, then the bank, so a row's jitter never shakes the deck.
import * as THREE from 'three';
import type { DummyJoint, DummyJoints } from '../practice/TrainingDummy';
import { buildHoverboard } from '../render/hoverboardGeometry';

/** The board's length in the world (the viewmodel's deck is 0.9 m), and the scale that makes it. */
export const BOARD_LENGTH = 1.4;
const SCALE = BOARD_LENGTH / 0.9;
/** How far the deck floats over the row, and where its top face is over that (the viewmodel's half thickness and grip). */
export const DECK_LIFT = 0.22;
const DECK_TOP = (0.032 / 2 + 0.006) * SCALE;
/** The most a deck rolls into a turn, in radians (about 26°). */
export const BANK_MAX = 0.45;
/** How fast the yaw rate and then the bank settle, per second: two stages, so jitter is filtered twice and a turn's end
 *  still levels the deck inside half a second. */
export const RATE_SETTLE = 14, BANK_SETTLE = 14;
/** How fast the deck's heading catches the rider's, per second. */
export const DECK_SETTLE = 16;
/** A yaw step bigger than this in one frame is a snap (a respawn, a teleport), not a turn: the deck jumps with it. */
const SNAP = 1;
const GRAVITY = 9.81;

/** Wraps an angle into (-π, π]. */
export function wrapAngle(angle: number): number {
  const turned = angle % (Math.PI * 2);
  return turned > Math.PI ? turned - Math.PI * 2 : turned <= -Math.PI ? turned + Math.PI * 2 : turned;
}

/** How far a value settling at `rate` per second moves toward its target in `dt`. */
const settle = (dt: number, rate: number): number => 1 - Math.exp(-dt * rate);

/** A deck's motion: its heading, the rider's smoothed yaw rate (rad/s, + is a left turn), its bank (rad, + is rolled into a
 *  left turn, its left edge down) and the yaw it last saw (null until a row puts it anywhere). */
export interface DeckMotion { deckYaw: number; yawRate: number; bank: number; lastYaw: number | null }
export const deckAtRest = (): DeckMotion => ({ deckYaw: 0, yawRate: 0, bank: 0, lastYaw: null });

/**
 * One frame of a deck under a rider whose row says `yaw` (a row's yaw, + turns left) and who moves at `speed` (m/s). The bank
 * is the roll of a turn made at that speed and rate (tan bank = speed × rate / g), capped at BANK_MAX: turning on the spot
 * spins the deck level, carving at speed rolls it into the turn.
 */
export function stepDeck(motion: DeckMotion, yaw: number, speed: number, dt: number): DeckMotion {
  if (motion.lastYaw === null) return Object.assign(motion, { deckYaw: yaw, yawRate: 0, bank: 0, lastYaw: yaw });
  if (!(dt > 0)) return motion;
  const step = wrapAngle(yaw - motion.lastYaw);
  motion.lastYaw = yaw;
  if (Math.abs(step) > SNAP) return Object.assign(motion, { deckYaw: yaw, yawRate: 0, bank: 0 });
  // The smoothed rate is held to the most that still banks under the cap at this speed, so a hard turn's end starts levelling
  // at once (on the spot there is no cap: a spin is level anyway). Each stage settles by its rate, alike at any frame rate.
  const most = speed > 0 ? (GRAVITY * Math.tan(BANK_MAX)) / speed : Infinity;
  motion.yawRate = Math.max(-most, Math.min(most, motion.yawRate + (step / dt - motion.yawRate) * settle(dt, RATE_SETTLE)));
  const target = Math.max(-BANK_MAX, Math.min(BANK_MAX, Math.atan((Math.max(0, speed) * motion.yawRate) / GRAVITY)));
  motion.bank += (target - motion.bank) * settle(dt, BANK_SETTLE);
  motion.deckYaw = wrapAngle(motion.deckYaw + wrapAngle(yaw - motion.deckYaw) * settle(dt, DECK_SETTLE));
  return motion;
}

/** The rider's stance on the deck, each joint's turn from its rest: knees bent forward over shins kept upright (no ankle
 *  bone, so a shin's tilt would tip the toes into the deck), feet apart along the deck (the figure stands
 *  side-on, so its left and right are the deck's nose and tail), arms out for balance, the head turned to the nose. */
const STANCE: Partial<Record<DummyJoint, THREE.Euler>> = {
  leftThigh: new THREE.Euler(0.42, 0, 0.2), rightThigh: new THREE.Euler(0.42, 0, -0.2),
  leftShin: new THREE.Euler(-0.42, 0, 0), rightShin: new THREE.Euler(-0.42, 0, 0),
  spine: new THREE.Euler(0.16, 0.12, 0), neck: new THREE.Euler(0, 0.45, 0),
  leftUpperArm: new THREE.Euler(0.1, 0, 0.55), rightUpperArm: new THREE.Euler(0.1, 0, -0.55),
  leftForeArm: new THREE.Euler(0.45, 0, 0), rightForeArm: new THREE.Euler(0.45, 0, 0),
};
/** How far the bent legs bring the soles up toward the hips (thigh 0.43 m, shin 0.42 m, as castawayBody.ts builds them). */
const CROUCH = 0.85 - Math.cos(0.2) * (0.43 * Math.cos(0.42) + 0.42);
/** The figure turned side-on (regular: the left foot to the nose, the chest to the rider's right of travel). */
const SIDE_ON = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
const NOSE_AHEAD = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const UP = new THREE.Vector3(0, 1, 0), AHEAD = new THREE.Vector3(0, 0, 1);
const heading = new THREE.Quaternion(), roll = new THREE.Quaternion(), bent = new THREE.Quaternion();

/**
 * The board under one other player, in their body's group (which faces the row's yaw, +z ahead). `deck` is the board;
 * `show()` moves it, and the rider's figure and stance with it, every frame.
 */
export class BoardUnder {
  readonly deck: THREE.Group = new THREE.Group();
  readonly motion: DeckMotion = deckAtRest();
  private readonly pulse: THREE.MeshStandardMaterial;
  private readonly glow: THREE.MeshBasicMaterial;
  private readonly rest = new Map<DummyJoint, THREE.Quaternion>();
  private t = 0;
  private riding = false;
  constructor() {
    const board = new THREE.Group();
    ({ pulse: this.pulse, glow: this.glow } = buildHoverboard(board));
    this.glow.fog = true; // the viewmodel's halos skip fog a metre from the eye; a rider across the bay is in it
    board.scale.setScalar(SCALE);
    this.deck.name = 'RemoteHoverboard'; this.deck.visible = false; this.deck.position.y = DECK_LIFT; this.deck.add(board);
  }
  /** The rest of every joint the stance turns, kept when the body is dressed. */
  fit(joints: DummyJoints): void {
    for (const joint of Object.keys(STANCE) as DummyJoint[]) { const bone = joints[joint]; if (bone !== undefined) this.rest.set(joint, bone.quaternion.clone()); }
  }
  /**
   * A frame: on a board, the deck at the rider's smoothed heading (relative to the body's group, which faces the row's yaw),
   * rolled by its bank, bobbing, the figure on it side-on in the stance; off one, the figure stood back up once.
   */
  show(riding: boolean, yaw: number, speed: number, dt: number, figure: THREE.Object3D | null, joints: DummyJoints): void {
    const { deck, motion } = this;
    deck.visible = riding;
    if (!riding) {
      if (this.riding) { figure?.quaternion.identity(); for (const [joint, rest] of this.rest) joints[joint]?.quaternion.copy(rest); }
      this.riding = false; motion.lastYaw = null; motion.bank = 0; motion.yawRate = 0; deck.userData['bank'] = 0;
      return;
    }
    this.riding = true; this.t += dt;
    stepDeck(motion, yaw, speed, dt);
    // The group faces the row's yaw: the deck turns the rest of the way to its own heading, then rolls about its length
    // (+z here); a left turn's bank puts its left edge (+x here) down.
    heading.setFromAxisAngle(UP, wrapAngle(motion.deckYaw - yaw)).multiply(roll.setFromAxisAngle(AHEAD, -motion.bank));
    const bob = Math.sin(this.t * 1.7) * 0.025 + Math.sin(this.t * 2.9) * 0.012;
    deck.quaternion.copy(heading).multiply(NOSE_AHEAD); deck.position.y = DECK_LIFT + bob;
    deck.userData['bank'] = motion.bank; deck.userData['deckYaw'] = motion.deckYaw;
    if (figure !== null) { figure.quaternion.copy(heading).multiply(SIDE_ON); figure.position.y += DECK_TOP + bob - CROUCH; }
    for (const [joint, rest] of this.rest) { const angle = STANCE[joint]; if (angle !== undefined) joints[joint]?.quaternion.copy(rest).multiply(bent.setFromEuler(angle)); }
    // The repulsors breathe, brighter with speed, as the viewmodel's do.
    this.pulse.emissiveIntensity = 1.8 + Math.sin(this.t * 6) * 0.25 + Math.min(1, speed / 14) * 1.2;
    this.glow.opacity = Math.min(1, 0.32 + Math.sin(this.t * 9) * 0.06 + Math.min(1, speed / 14) * 0.25);
  }
}
