/**
 * meta IPHONE13-DRIFTWOOD DW3 (mini-driftwood13e): the outer ring's strip colliders, built as the player nears them.
 *
 * After control the grid builds the A1 outer ring: about 80 seam strips of ~2,000 triangles, each a Rapier trimesh with
 * FIX_INTERNAL_EDGES. One build is 0.7 ms in Node but 3 to 28 ms in desktop Safari and several times that on an iPhone 13,
 * and a build cannot be sliced, so the Driftwood dock's seconds 5 to 9 were a run of 55 to 115 ms frames while the player
 * stood still hundreds of metres from any of them. With the device slot `debug.outerCollidersNear` on, a strip's collider
 * is built only once the player's feet come within REACH (plus four seconds of travel) of the strip's bounds; a caller
 * that needs every one (a distant entry, a recovery) flushes the rest at once. The strips themselves (their data, the
 * road drawn from them) are unchanged.
 */
import { jsonSlot } from '@wildshard/engine/saves/slots';
import { TIER } from '@wildshard/engine/core/tier';
import type { StripMesh } from '@wildshard/engine/sim/strips';

export const OUTER_COLLIDERS_NEAR_SLOT = 'debug.outerCollidersNear';
export const OUTER_COLLIDERS_NEAR_DEFAULT = false;
/** Unset at phone Low: on. Three alternating cooled iPhone 13 pairs on Driftwood at the 30 cap (engine 522275ccb plus the
 *  vertex pack fix and this slot, 2026-11-20) all favoured it at the dock: 9, 18 and 8 frames over 50 ms in 30 s with it
 *  on against 30, 43 and 11 off, and no outer collider build over 4 ms (off: 1.2 to 1.4 s of them from second 5). The
 *  pier was unchanged (3/3/3 on, 0/3/1 off; no collider builds in it). */
export const OUTER_COLLIDERS_NEAR_PHONE_LOW = true;
/** metres from a strip's bounds at which its collider is built (the rings' L1 reach is 400 m; a player walks 4.3 m/s) */
export const REACH = 120;
/** colliders built in one fixed step while none is close (beyond CLOSE): one, so an approach spreads them */
const CLOSE = 40;

/** The slot's value: a boolean wins; unset, OUTER_COLLIDERS_NEAR_PHONE_LOW at phone Low, else OUTER_COLLIDERS_NEAR_DEFAULT. */
export function outerCollidersNear(saved: unknown, phoneLow = false): boolean {
  if (typeof saved === 'boolean') return saved;
  return phoneLow ? OUTER_COLLIDERS_NEAR_PHONE_LOW : OUTER_COLLIDERS_NEAR_DEFAULT;
}
let picked: boolean | undefined;
/** Whether outer strip colliders wait for the player; read once per page. */
export function outerCollidersNearOn(): boolean {
  if (picked !== undefined) return picked;
  let saved: unknown = null, phoneLow = false;
  try { saved = jsonSlot(OUTER_COLLIDERS_NEAR_SLOT, 'device').read(); } catch { /* storage blocked: the default */ }
  phoneLow = TIER === 'phone'; // QA 11-24 row 31: every phone, Low or High (nothing drawn changes)
  picked = outerCollidersNear(saved, phoneLow);
  return picked;
}

type Mesh = Pick<StripMesh, 'origin' | 'positions' | 'indices'>;
interface Waiting { readonly mesh: Mesh; readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number }

/** Strip colliders waiting for the player, in the physics world's frame (the strips' own origins). */
export class NearColliders {
  private waiting: Waiting[] = [];
  private readonly install: (mesh: Mesh) => void;
  constructor(install: (mesh: Mesh) => void) {
    this.install = install;}

  get pending(): number { return this.waiting.length; }

  /** Hold `mesh`'s collider until the player nears it. */
  add(mesh: Mesh): void {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    const p = mesh.positions;
    for (let i = 0; i + 2 < p.length; i += 3) {
      const x = p[i] ?? 0, z = p[i + 2] ?? 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    if (minX > maxX) { minX = maxX = 0; minZ = maxZ = 0; }
    this.waiting.push({ mesh, minX: minX + mesh.origin.x, maxX: maxX + mesh.origin.x, minZ: minZ + mesh.origin.z, maxZ: maxZ + mesh.origin.z });
  }

  /** One fixed step at the feet (`x`, `z`, physics frame) moving at `speed` m/s: every waiting strip within CLOSE is
   *  built now, and at most one more within REACH plus four seconds of travel. Returns how many were built. */
  step(x: number, z: number, speed: number): number {
    if (this.waiting.length === 0) return 0;
    const reach = REACH + Math.min(Math.max(speed, 0), 60) * 4;
    let built = 0, far = false, kept = 0;
    // DF11: the waiting list compacts in place (a fresh keep list every fixed step was frame garbage); same order kept
    const waiting = this.waiting;
    for (let i = 0; i < waiting.length; i++) {
      const w = waiting[i];
      if (w === undefined) continue;
      const d = Math.hypot(Math.max(0, w.minX - x, x - w.maxX), Math.max(0, w.minZ - z, z - w.maxZ));
      if (d <= CLOSE || (d <= reach && !far)) { if (d > CLOSE) far = true; this.install(w.mesh); built++; }
      else waiting[kept++] = w;
    }
    waiting.length = kept;
    return built;
  }

  /** Build every waiting collider now (a distant entry or recovery needs the whole ring). */
  flush(): number {
    const all = this.waiting; this.waiting = [];
    for (const w of all) this.install(w.mesh);
    return all.length;
  }
}
