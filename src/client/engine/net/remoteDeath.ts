/**
 * REMOTE-PLAYERS RP11 (Jake, 2026-11-12 17:43: "it's an MMO ... everything, right?"): another player's death and return, as this
 * page sees them, layered last over the pose (gait, air, strike, board, then this).
 *
 * The server respawns a fallen player in the very tick he dies (shared/engine/combat/health.ts `update`, then
 * server/game/roomRespawn.ts `resetPose`): his row's hp comes back up and his row jumps to his checkpoint at once, so a row at
 * hp 0 is rare and the interpolator would draw him sliding across the map. So a death is the killing blow's `hit` (its
 * `killed`, through `killed()`), else a row at hp 0 after an alive one, else a jump across the ground (faster than anything
 * moves, `JUMP`; a fall straight down is no jump) that lands with `RISE_HP` more hp than it left with. A jump with less is a
 * teleport, and only snaps.
 *
 * On a death the body stays where it fell, whatever its row says: it falls on its back (`FALL_TIME`), lies there `LIE_TIME` with
 * its Name dimmed, fades out (`FADE_TIME`), and is gone until its row is alive again and still; then it snaps to the row (its
 * checkpoint) and fades in (`RISE_TIME`). No frame draws it between the two places, and a snap is no speed.
 *
 *   death.killed();                                 // the server's killing blow on it (a `hit` with `killed`)
 *   const at = death.place(x, y, z, yaw, hp, dt);   // first in a frame: where to draw the body, and whether that is a snap
 *   death.phase                                     // '' alive, or 'fall' | 'lie' | 'fade' | 'gone' | 'rise'
 *   death.layer(group, figure, tag);                // last in a frame: the body laid down, faded, its Name dimmed
 */
import * as THREE from 'three';

/** Where a death is, as `__onlinePlayers()` reports it: '' alive. */
export type DeathPhase = '' | 'fall' | 'lie' | 'fade' | 'gone' | 'rise';

/** Seconds: the fall to the ground, the lie there, the fade out, and the fade in at the checkpoint. */
export const FALL_TIME = 0.6, LIE_TIME = 2, FADE_TIME = 0.6, RISE_TIME = 0.5;
/** The Name's opacity while its player lies dead. */
export const NAME_DIM = 0.4;
/** Faster than this the row jumped (a respawn or a teleport), m/s: nothing a player rides goes this fast. */
const JUMP = 40;
/** A rise in hp over a jump past this is a return from death, not healing (4 hp/s) through a stalled frame or a teleport. */
const RISE_HP = 10;
/** How far the figure lifts as it lies, so its back rests on the ground rather than in it, metres. */
const LIE_LIFT = 0.12;
/** The meshes that fade: the castaway (models/castawayBody.ts) and its ground contact. A held item, a board and the talk ring
 *  are not drawn while dead. */
const FADES: ReadonlySet<string> = new Set(['CastawayBody', 'GroundContact']);

/** Where to draw the body this frame, and whether it got there by a snap (a speed of 0, not a move). */
export interface DeathPlaced { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number; readonly snap: boolean }

const BACK = new THREE.Vector3(1, 0, 0), lying = new THREE.Quaternion();

/** One other player's death and return. */
export class RemoteDeath {
  phase: DeathPhase = '';
  /** Seconds into the phase. */
  private t = 0;
  /** Where the body is drawn, and which way it faces. */
  private readonly at = { x: 0, y: 0, z: 0, yaw: 0 };
  private placed = false;
  /** The last row seen, to tell a jump from a move. */
  private readonly row = { x: 0, y: 0, z: 0 };
  /** The hp of the last frame that was no jump (NaN before one), and the hp a jump left with. */
  private hp = Number.NaN;
  private before = Number.NaN;
  private jumping = false;
  /** The row is alive again and still: the body comes back once it is gone. */
  private back = false;
  /** Each faded mesh's own material while it wears a clone of it; empty while whole. */
  private readonly own = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private laid = false;

  /** Read this frame's row: where it stands, its yaw and hp. Returns where the body is drawn. */
  place(x: number, y: number, z: number, yaw: number, hp: number, dt: number): DeathPlaced {
    const { row, at } = this;
    const leap = this.placed && dt > 0 && Math.hypot(x - row.x, z - row.z) / dt > JUMP;
    row.x = x; row.y = y; row.z = z;
    let snap = false;
    if (leap && !this.jumping) { this.jumping = true; this.before = this.hp; }
    else if (!leap && this.jumping) {
      this.jumping = false;
      // The jump has landed: more hp than it left with is a return from death; none is a teleport, which snaps (rising too).
      if (this.living && hp > this.before + RISE_HP) this.die();
      else if (this.living) snap = true;
    }
    if (!this.jumping) {
      if (this.phase === '' && hp <= 0 && this.hp > 0) this.die();
      this.hp = hp;
    }
    if (this.phase !== '' && !this.jumping && hp > 0) this.back = true;
    this.advance(dt);
    if (this.phase === 'rise' && this.t === 0) snap = true;
    // Alive (or rising) and not mid-jump, the body is where its row is; dead, or mid-jump, it holds.
    if (!this.placed || (this.living && !this.jumping)) { at.x = x; at.y = y; at.z = z; at.yaw = yaw; }
    this.placed = true;
    return { x: at.x, y: at.y, z: at.z, yaw: at.yaw, snap };
  }

  /** The server's killing blow: down where it is drawn, alive or still rising. */
  killed(): void { if (this.living) this.die(); }
  /** Alive, or fading back in: a death or a teleport can still happen to it. */
  private get living(): boolean { return this.phase === '' || this.phase === 'rise'; }

  /** After every other pose: the figure on its back, the body faded, the Name dimmed; whole again once alive. */
  layer(group: THREE.Object3D, figure: THREE.Object3D | null, tag: THREE.Sprite): void {
    const { phase, t } = this;
    group.visible = phase !== 'gone';
    const fall = phase === 'fall' ? Math.min(1, (t / FALL_TIME) ** 2) : phase === 'lie' || phase === 'fade' ? 1 : 0;
    if (figure !== null && (fall > 0 || this.laid)) {
      figure.quaternion.copy(lying.setFromAxisAngle(BACK, -(Math.PI / 2) * fall)); figure.position.y += LIE_LIFT * fall;
      this.laid = fall > 0;
    }
    const body = phase === 'fade' ? Math.max(0, 1 - t / FADE_TIME) : phase === 'rise' ? Math.min(1, t / RISE_TIME) : 1;
    if (body < 1) this.fade(group, body); else this.whole();
    const name = phase === 'fall' ? 1 + (NAME_DIM - 1) * fall : phase === 'lie' ? NAME_DIM : phase === 'fade' ? NAME_DIM * body : body;
    tag.material.opacity = name;
  }

  private die(): void { this.phase = 'fall'; this.t = 0; this.back = false; }
  /** The clock: each phase to the next on its time, and from gone to the return once the row is alive again. */
  private advance(dt: number): void {
    if (this.phase === '') return;
    this.t += dt;
    const next = (after: number, phase: DeathPhase): void => { if (this.t >= after) { this.phase = phase; this.t = 0; } };
    if (this.phase === 'fall') next(FALL_TIME, 'lie');
    else if (this.phase === 'lie') next(LIE_TIME, 'fade');
    else if (this.phase === 'fade') next(FADE_TIME, 'gone');
    else if (this.phase === 'gone') { if (this.back && !this.jumping) { this.phase = 'rise'; this.t = 0; } }
    else next(RISE_TIME, '');
  }
  /** The body's meshes at `opacity`, each on a clone of its shared material while it fades. */
  private fade(group: THREE.Object3D, opacity: number): void {
    if (this.own.size === 0) group.traverse(node => {
      if (!(node instanceof THREE.Mesh) || !FADES.has(node.name)) return;
      const mesh: THREE.Mesh = node, own = mesh.material, see = (material: THREE.Material): THREE.Material => {
        const clone = material.clone(); clone.userData = { ...material.userData, shared: false, opacity: material.opacity }; clone.transparent = true; clone.depthWrite = false;
        return clone;
      };
      this.own.set(mesh, own); mesh.material = Array.isArray(own) ? own.map(see) : see(own);
    });
    for (const mesh of this.own.keys()) for (const material of [mesh.material].flat()) material.opacity = (material.userData['opacity'] as number) * opacity;
  }
  /** Back on the shared materials, the clones freed. */
  private whole(): void {
    for (const [mesh, material] of this.own) { for (const clone of [mesh.material].flat()) clone.dispose(); mesh.material = material; }
    this.own.clear();
  }
}
