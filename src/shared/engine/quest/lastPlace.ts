/**
 * LastPlace — where a death puts you back on a shard with named places (E295, DRIFTWOOD-TOP10 row 4): the LAST NAMED
 * PLACE YOU REACHED, not the spawn. Walking into a place's radius is what discovers it (quest/core.ts
 * `placesWithDiscovery`), so the newest discovery is always the checkpoint; walking back into an older one (already
 * discovered) makes that one the checkpoint again, so you come back near where you were, not across the island.
 *
 * The point you come back to is where YOU stood: the first walkable footing inside the place after you entered it (on
 * the ground or a registry floor, not swimming, not wading, not on the board / the zipline / a horse — main.ts decides
 * `grounded` with the physics `floorBelow`). A place's centre can be the sea, a roof or a cliff face; your own footing
 * never is. You face into the place. No place reached yet → null, and the caller uses the shard's spawn.
 *
 *   const last = new LastPlace(() => places.points);
 *   last.observe({ x, y, z, grounded });     // a few times a second, not while dying
 *   last.stand                                // { id, label, x, y, z, yaw } | null
 *   last.reset()                              // "Exit to main menu" → ENTER WORLD starts over at the spawn
 */

export interface PlaceArea { id: string; label: string; x: number; z: number; r: number }
/** where to put the player back: feet (x, y, z) on walkable footing, facing `yaw` (0 = −Z, Player.ts) */
export interface Stand { id: string; label: string; x: number; y: number; z: number; yaw: number }
/** the player's feet and whether they stand on walkable footing right now */
export interface Feet { x: number; y: number; z: number; grounded: boolean }
/** What a tracker holds between ticks. */
export interface LastPlaceSaved { readonly inside: string | null; readonly pending: string | null; readonly stand: Stand | null }

/** the place (x, z) is in: of the ones whose radius holds it, the one it is deepest inside (distance / radius) */
export function placeAt(places: readonly PlaceArea[], x: number, z: number): PlaceArea | null {
  let best: PlaceArea | null = null, bk = 1;
  for (const p of places) {
    const k = Math.hypot(p.x - x, p.z - z) / p.r;
    if (k < bk) { bk = k; best = p; }
  }
  return best;
}

/** the yaw that looks from (x, z) toward (tx, tz): forward = (−sin yaw, −cos yaw) */
export function yawToward(x: number, z: number, tx: number, tz: number): number {
  const dx = tx - x, dz = tz - z;
  return dx * dx + dz * dz < 1e-6 ? 0 : Math.atan2(-dx, -dz);
}

export class LastPlace {
  /** the place the feet are in now (null: between places) */
  private inside: string | null = null;
  /** entered, but no walkable footing inside it yet */
  private pending: PlaceArea | null = null;
  private stand_: Stand | null = null;

  private readonly places: () => readonly PlaceArea[];

  constructor(places: () => readonly PlaceArea[]) { this.places = places; }

  /** the checkpoint: the last place reached and where you stood in it (null: none reached yet) */
  get stand(): Stand | null { return this.stand_; }

  observe(f: Feet): void {
    const here = placeAt(this.places(), f.x, f.z);
    const id = here?.id ?? null;
    if (id !== this.inside) { this.inside = id; this.pending = here; }
    if (this.pending === null || !f.grounded) return;
    const p = this.pending;
    this.stand_ = { id: p.id, label: p.label, x: f.x, y: f.y, z: f.z, yaw: yawToward(f.x, f.z, p.x, p.z) };
    this.pending = null;
  }

  reset(): void { this.inside = null; this.pending = null; this.stand_ = null; }

  /** The tracker's state, for a saved room. */
  saved(): LastPlaceSaved { return { inside: this.inside, pending: this.pending?.id ?? null, stand: this.stand_ }; }
  load(saved: LastPlaceSaved): void {
    this.inside = saved.inside; this.stand_ = saved.stand;
    this.pending = saved.pending === null ? null : this.places().find(place => place.id === saved.pending) ?? null;
  }
}

/** a place's map label as the death card's words: "WRECK COVE" → "Wreck Cove", "THE LOOKOUT" → "the Lookout" */
export function placeName(label: string): string {
  const words = label.trim().toLowerCase().split(/\s+/).filter((w) => w !== '');
  return words.map((w, i) => (i === 0 && w === 'the' ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
}
