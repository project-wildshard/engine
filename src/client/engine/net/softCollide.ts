// QA-FEEDBACK-2026-11-19 row 54 (Jake, 16:13 Cancún, Driftwood's dock: "we walk through each other"): soft collision between
// players. Each player is a body as wide as its capsule. This page steers only its own player, and only through the move it sends:
// the toward part of a move into another body fades out as the two meet, and two bodies that overlap each steer themselves apart.
// The server steps that move like any other through the same character controller, so walls hold, nothing reconciles against
// it, and the server's movement checks stay as they were. It is soft: pressing into someone shoves them slowly, and a body that
// is stuck pressing into another for YIELD_AFTER lets go of it, so a narrow dock or gate can never be held shut.
import { PLAYER_CAPSULE } from '../../../shared/engine/physics/CharacterMotor';

/** A body's radius, the player capsule's (0.38 m), and centre to centre where two bodies touch (0.76 m). */
export const BODY_RADIUS: number = PLAYER_CAPSULE.radius;
export const CONTACT: number = 2 * BODY_RADIUS;
/** m before contact where the toward part of a move starts to fade, so a walk into someone slows to them rather than into them. */
export const BLOCK_LEAD = 0.5;
/** The share of a move into a body kept at contact: pressing into someone who stands free shoves them at about 0.7 m/s. */
export const LEAK = 0.3;
/** m of overlap past which nothing of the move into a body is kept: a body that won't give way stops you there. */
export const LEAK_DEPTH = 0.2;
/** s of closing speed the fade starts early by: two players walking at each other (8.6 m/s) start slowing 1 m sooner. */
export const BRAKE_TIME = 0.12;
/** A full stick's share each body steers itself apart by, reached at PUSH_FULL m of overlap (1.7 m/s of a 4.3 m/s walk). */
export const PUSH_MAX = 0.4;
export const PUSH_FULL = 0.3;
/** s: a growing push eases toward its aim with this time constant, so it never snaps on; a shrinking one lets go at once, so
 *  two bodies settle at contact instead of coasting past it. */
export const PUSH_EASE = 0.1;
/** m apart in height past which two bodies don't meet (one on a roof, one under it). */
export const BODY_TALL = 1.6;
/** s pressing into a body (toward it past YIELD_PRESS of a stick, within YIELD_NEAR, moving under YIELD_SPEED) before you pass. */
export const YIELD_AFTER = 1.2;
export const YIELD_PRESS = 0.3;
export const YIELD_NEAR: number = CONTACT + 0.1;
export const YIELD_SPEED = 0.35;
/** m apart that ends a pass: from then on the two collide again. */
export const YIELD_CLEAR: number = CONTACT + 0.4;
/** s: the most a body is led by (netClock's INTERP_MAX_MS, 0.2 s, and a little of the link). */
export const LEAD_MAX = 0.3;
/** s: a body's drawn velocity eases with this time constant; past TRACK_SNAP m/s a move is a snap, not a velocity. */
export const TRACK_EASE = 0.08;
export const TRACK_SNAP = 25;
/** m ahead of the feet that the push probes for deep water (the dodge's pier-edge probe, DASH_PROBE). */
export const PUSH_PROBE = 0.5;

/** Another body: where it is drawn this frame (the interpolated row, never a raw snapshot) and a key that stays its own. */
export interface SoftBody { key: number; x: number; y: number; z: number }
/** This page's player for one frame: its feet, its horizontal velocity (m/s), and whether deep water lies at (x, z). */
export interface SoftSelf { readonly x: number; readonly y: number; readonly z: number; readonly vx: number; readonly vz: number; readonly deep: (x: number, z: number) => boolean }
/** A move in world terms, a stick's worth (length up to 1). */
export interface SoftMove { x: number; z: number }

interface Contact { nx: number; nz: number; block: number }
interface Pair { press: number; passing: boolean; seen: boolean;
  /** The side this player met it from, a unit xz. */
  sx: number; sz: number }
interface Track { x: number; z: number; vx: number; vz: number; seen: boolean }

/** What a proof reads. */
export interface SoftReport { readonly push: number; readonly contacts: number; readonly passing: number; readonly nearest: number | null; readonly probed: number }

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/** How much of a move toward a body at `d` m (centre to centre) is taken away. */
export function blockAt(d: number): number {
  if (d >= CONTACT + BLOCK_LEAD) return 0;
  if (d >= CONTACT) return (1 - LEAK) * (CONTACT + BLOCK_LEAD - d) / BLOCK_LEAD;
  return 1 - LEAK + LEAK * clamp01((CONTACT - d) / LEAK_DEPTH);
}
/** How hard a body at `d` m pushes this one away, a share of a full stick. */
export const pushAt = (d: number): number => d >= CONTACT ? 0 : PUSH_MAX * clamp01((CONTACT - d) / PUSH_FULL);

/** One page's soft collision: `frame` reads where every body is, `steer` bends each step's move by it. */
export class SoftCollide {
  /** The eased push, world xz, a share of a stick. */
  readonly push: SoftMove = { x: 0, z: 0 };
  private readonly contacts: Contact[] = [];
  /** The contacts' objects, kept from frame to frame. */
  private readonly pool: Contact[] = [];
  private readonly pairs = new Map<number, Pair>();
  /** Every body's drawn place and velocity, kept while it is drawn. */
  private readonly tracks = new Map<number, Track>();
  /** The last move asked for, before its bend: whether this player is pressing into someone. */
  private readonly asked: SoftMove = { x: 0, z: 0 };
  private nearest: number | null = null;
  private probed = 0;

  /** Once a frame: the contacts the next steps bend round, and the push eased toward its aim. `active` false (on a board, in
   *  water, in a saddle, carried): nothing bends and the push lets go. `lead` (s) is how far behind this player's own present
   *  another body is drawn (the interpolation delay): each body is led by its drawn velocity that far, so a player walking
   *  at you is met where it is, not where it was. */
  frame(self: SoftSelf, bodies: Iterable<SoftBody>, dt: number, active = true, lead = 0): void {
    const { contacts, pairs, push, tracks } = this, ahead = Math.max(0, Math.min(LEAD_MAX, lead)), follow = dt <= 0 ? 0 : 1 - Math.exp(-dt / TRACK_EASE);
    contacts.length = 0; this.nearest = null;
    for (const pair of pairs.values()) pair.seen = false;
    for (const track of tracks.values()) track.seen = false;
    let aimX = 0, aimZ = 0, count = 0;
    if (active) for (const body of bodies) {
      // its drawn velocity, eased; a snap (a respawn, a crossing) is no velocity
      let track = tracks.get(body.key);
      if (track === undefined) { track = { x: body.x, z: body.z, vx: 0, vz: 0, seen: true }; tracks.set(body.key, track); }
      else if (dt > 0) {
        const vx = (body.x - track.x) / dt, vz = (body.z - track.z) / dt, fast = Math.hypot(vx, vz) > TRACK_SNAP;
        track.vx = fast ? 0 : track.vx + (vx - track.vx) * follow; track.vz = fast ? 0 : track.vz + (vz - track.vz) * follow;
        track.x = body.x; track.z = body.z;
      }
      track.seen = true;
      if (Math.abs(body.y - self.y) >= BODY_TALL) continue;
      let dx = self.x - (body.x + track.vx * ahead), dz = self.z - (body.z + track.vz * ahead), d = Math.hypot(dx, dz);
      if (this.nearest === null || d < this.nearest) this.nearest = d;
      // how fast the two close: the fade starts that much sooner, so a meeting at a walk stops at contact, not through it
      const closing = d < 1e-4 ? 0 : Math.max(0, -((self.vx - track.vx) * dx + (self.vz - track.vz) * dz) / d), early = closing * BRAKE_TIME;
      if (d - early >= CONTACT + BLOCK_LEAD) { pairs.delete(body.key); continue; }
      const pair = pairs.get(body.key) ?? { press: 0, passing: false, seen: true, sx: 0, sz: 0 };
      pair.seen = true; pairs.set(body.key, pair);
      // the two stand on one spot: part by the key, so both pages agree on a way and neither waits for the other
      if (d < 1e-4) { const angle = (body.key * 2.399963) % (Math.PI * 2); dx = Math.cos(angle); dz = Math.sin(angle); } else { dx /= d; dz /= d; }
      if (pair.passing) { if (d > YIELD_CLEAR) pair.passing = false; else continue; }
      // the side it came from: outside contact it is the true one; inside, a body this player walks into that seems to have
      // crossed (a late row, a fast meeting) is still on its side, fully met, so nobody tunnels through
      if (d >= CONTACT || (pair.sx === 0 && pair.sz === 0)) { pair.sx = dx; pair.sz = dz; }
      else if (dx * pair.sx + dz * pair.sz < 0 && this.asked.x * pair.sx + this.asked.z * pair.sz < 0) { dx = pair.sx; dz = pair.sz; d = 0; }
      const toward = -(this.asked.x * dx + this.asked.z * dz);
      pair.press = toward > YIELD_PRESS && d < YIELD_NEAR && Math.hypot(self.vx, self.vz) < YIELD_SPEED ? pair.press + dt : Math.max(0, pair.press - dt);
      if (pair.press >= YIELD_AFTER) { pair.passing = true; pair.press = 0; continue; }
      const contact = this.pool[count] ??= { nx: 0, nz: 0, block: 0 };
      contact.nx = dx; contact.nz = dz; contact.block = blockAt(d - early); contacts.push(contact); count++;
      // the one pressing in is the shover: only the other gives way, so a free body is shoved rather than both standing off
      if (toward <= 0) { const shove = pushAt(d); aimX += dx * shove; aimZ += dz * shove; }
    }
    for (const [key, track] of tracks) if (!track.seen) tracks.delete(key);
    for (const [key, pair] of pairs) if (!pair.seen) pairs.delete(key);
    const aim = Math.hypot(aimX, aimZ);
    if (aim > PUSH_MAX) { aimX *= PUSH_MAX / aim; aimZ *= PUSH_MAX / aim; }
    // never off a pier: a push whose way ahead is deep water is dropped (walls the controller holds by itself)
    if (aim > 1e-4 && self.deep(self.x + aimX / aim * PUSH_PROBE, self.z + aimZ / aim * PUSH_PROBE)) { aimX = 0; aimZ = 0; this.probed++; }
    const ease = dt <= 0 ? 0 : 1 - Math.exp(-dt / PUSH_EASE), now = Math.hypot(push.x, push.z), aimed = Math.hypot(aimX, aimZ);
    if (aimed <= now) { push.x = aimX; push.z = aimZ; } else { push.x += (aimX - push.x) * ease; push.z += (aimZ - push.z) * ease; }
    if (Math.hypot(push.x, push.z) < 1e-3 && aim === 0) { push.x = 0; push.z = 0; }
  }

  /** One step's move, bent: the part into each body it meets fades by how close it is, and the push is added. Writes `out`. */
  steer(move: Readonly<SoftMove>, out: SoftMove): SoftMove {
    this.asked.x = move.x; this.asked.z = move.z;
    let x = move.x, z = move.z;
    for (const { nx, nz, block } of this.contacts) {
      const toward = -(x * nx + z * nz);
      if (toward > 0) { x += nx * toward * block; z += nz * toward * block; }
    }
    x += this.push.x; z += this.push.z;
    const length = Math.hypot(x, z);
    if (length > 1) { x /= length; z /= length; }
    out.x = x; out.z = z;
    return out;
  }

  private readonly world: SoftMove = { x: 0, z: 0 };
  private readonly out: SoftMove = { x: 0, z: 0 };
  /** A step's stick (strafe +right, forward +ahead, along `yaw`) bent; null when nothing bends it, so its bytes stay as asked. */
  bend(str: number, fwd: number, yaw: number): { readonly str: number; readonly fwd: number } | null {
    if (this.idle) { this.asked.x = 0; this.asked.z = 0; return null; }
    return worldToStick(this.steer(stickToWorld(str, fwd, yaw, this.world), this.out), yaw);
  }

  /** Nothing to bend: no contact and no push left. */
  get idle(): boolean { return this.contacts.length === 0 && this.push.x === 0 && this.push.z === 0; }

  get report(): SoftReport {
    let passing = 0;
    for (const pair of this.pairs.values()) if (pair.passing) passing++;
    return { push: Math.hypot(this.push.x, this.push.z), contacts: this.contacts.length, passing, nearest: this.nearest, probed: this.probed };
  }
}

/** A step's stick (strafe +right, forward +ahead) as a world move along `yaw` (Player.stepCommand's own turn). */
export function stickToWorld(str: number, fwd: number, yaw: number, out: SoftMove): SoftMove {
  const sin = Math.sin(yaw), cos = Math.cos(yaw);
  out.x = -sin * fwd + cos * str; out.z = -cos * fwd - sin * str;
  return out;
}
/** Its inverse: a world move as the stick along `yaw`. */
export function worldToStick(move: Readonly<SoftMove>, yaw: number): { str: number; fwd: number } {
  const sin = Math.sin(yaw), cos = Math.cos(yaw);
  return { str: cos * move.x - sin * move.z, fwd: -sin * move.x - cos * move.z };
}
