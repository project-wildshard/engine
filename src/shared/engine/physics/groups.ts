/**
 * Collision groups (project/archive/2026-09-23-physics.md §Architecture): who can touch whom. Rapier packs a collider's groups in one
 * u32 — membership in the high 16 bits, the filter (what it may touch) in the low 16 — and two colliders interact only
 * when each one's membership is in the other's filter, so every row below lists the full set it meets.
 */
export const GROUP: { readonly WORLD: number; // terrain, structures, props — static or kinematic
readonly PLAYER: number; // the player's capsule
readonly CREATURE: number; // animals and enemies (their movement capsule)
readonly HITBOX: number; // a creature's head / body hit volumes (queries only)
readonly PROJECTILE: number; // bolts, thrown things in flight
readonly ITEM: number; // coconuts, the barrel, drops, pickups — dynamic bodies the player can push
readonly DEBRIS: number; // small short-lived bodies (never touch the player)
readonly BORDER: number; // grid home boundary: unmounted creatures only
readonly SENSOR: number; } = {
  WORLD: 1 << 0,      // terrain, structures, props — static or kinematic
  PLAYER: 1 << 1,     // the player's capsule
  CREATURE: 1 << 2,   // animals and enemies (their movement capsule)
  HITBOX: 1 << 3,     // a creature's head / body hit volumes (queries only)
  PROJECTILE: 1 << 4, // bolts, thrown things in flight
  ITEM: 1 << 5,       // coconuts, the barrel, drops, pickups — dynamic bodies the player can push
  DEBRIS: 1 << 6,     // small short-lived bodies (never touch the player)
  BORDER: 1 << 8,     // grid home boundary: unmounted creatures only
  SENSOR: 1 << 7,     // pressure plates, triggers
} as const;
export type GroupName = keyof typeof GROUP;

const ALL = 0xffff;
const MEETS: Record<GroupName, number> = {
  WORLD: ALL,
  PLAYER: GROUP.WORLD | GROUP.CREATURE | GROUP.ITEM | GROUP.SENSOR,
  CREATURE: GROUP.WORLD | GROUP.PLAYER | GROUP.CREATURE | GROUP.ITEM | GROUP.BORDER,
  HITBOX: GROUP.WORLD | GROUP.PROJECTILE,
  PROJECTILE: GROUP.WORLD | GROUP.HITBOX,
  ITEM: GROUP.WORLD | GROUP.PLAYER | GROUP.CREATURE | GROUP.ITEM | GROUP.SENSOR,
  DEBRIS: GROUP.WORLD,
  SENSOR: GROUP.PLAYER | GROUP.ITEM,
  BORDER: GROUP.CREATURE,
};

/** The packed `collisionGroups` / `solverGroups` value for a collider of this kind. */
export function groups(kind: GroupName): number {
  return ((GROUP[kind] << 16) | MEETS[kind]) >>> 0;
}

// Independent name tags deduplicate the finite group vocabulary without a new
// Set/array/reducer for each ray. Tags identify names, not collision bit values:
// distinct groups still sum exactly even if their configured bits overlap.
const QUERY_TAGS = new Map(Object.keys(GROUP).map((kind, index) => [kind, 1 << index]));
function originalQueryMask(sees: readonly GroupName[]): number {
  return [...new Set(sees)].reduce((mask, kind) => mask + GROUP[kind], 0);
}

/** A query filter's packed groups: the querier is `as`, and it sees only the kinds in `sees`. */
export function queryGroups(sees: readonly GroupName[], as: GroupName = 'PLAYER'): number {
  if (sees === null || sees === undefined) return ((GROUP[as] << 16) | originalQueryMask(sees)) >>> 0;
  let seen = 0, mask = 0;
  for (const kind of sees) {
    const tag = QUERY_TAGS.get(kind);
    // Keep the original coercion/refusal behavior for undeclared runtime data.
    if (tag === undefined) return ((GROUP[as] << 16) | originalQueryMask(sees)) >>> 0;
    if ((seen & tag) === 0) { seen |= tag; mask += GROUP[kind]; }
  }
  return ((GROUP[as] << 16) | mask) >>> 0;
}
