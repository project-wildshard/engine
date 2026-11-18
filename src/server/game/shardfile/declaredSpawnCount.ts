// ONE-FORMAT OF29b (OF28b, Q-CC35 (b)): a declared spawn row's `count: { per, max }`. The row keeps `max` bodies: its own,
// and `max - 1` copies (`<id>.2` up to `<id>.<max>`, a stride apart beside its `at`, each with its own seed). The cell
// stands one body per `per` players in it (at least one), to `max`; the rest are absent, as OF29a's `when` holds a body
// out (`declaredSpawnWhen.ts`); a living body the players outgrew leaves, a dead one keeps to its `respawn`. A copy of a
// group's member joins that group's roster right after it. The expansion is the simulation's view of the shard: every
// sim entry point reads the same expanded rows, so a save restores the same bodies.
import type { Shardfile } from '@wildshard/format/shardSchema';

type SpawnRow = Shardfile['creatures']['spawns'][number];

/** Metres between a counted row's copies, along x from its `at`. */
export const COUNT_STRIDE = 1.5;

/** A copy's place in its row: the `slot` (2 to `max`) and its row's `per`. */
export interface CountSlot { readonly slot: number; readonly per: number }

const expanded = new WeakMap<Shardfile, Shardfile>(), slots = new WeakMap<Shardfile, ReadonlyMap<string, CountSlot>>();

/** The shard as the simulation runs it: each counted row followed by its copies. A shard with no `count` is itself. */
export function countedShard(shard: Shardfile): Shardfile {
  if (slots.has(shard)) return shard;
  const known = expanded.get(shard); if (known !== undefined) return known;
  if (!shard.creatures.spawns.some(row => row.count !== undefined)) { slots.set(shard, new Map()); return shard; }
  const spawns: SpawnRow[] = [], bySlot = new Map<string, CountSlot>(), copies = new Map<string, string[]>();
  for (const row of shard.creatures.spawns) {
    spawns.push(row);
    if (row.count === undefined) continue;
    const ids: string[] = [];
    for (let slot = 2; slot <= row.count.max; slot++) {
      const id = `${row.id}.${String(slot)}`, { count: _count, ...rest } = row;
      spawns.push({ ...rest, id, seed: (row.seed + slot - 1) >>> 0, at: [row.at[0] + COUNT_STRIDE * (slot - 1), row.at[1], row.at[2]] });
      bySlot.set(id, { slot, per: row.count.per }); ids.push(id);
    }
    copies.set(row.id, ids);
  }
  const groups = shard.creatures.groups.map(group => ({ ...group, members: group.members.flatMap(member => [member, ...copies.get(member) ?? []]) }));
  const out: Shardfile = { ...shard, creatures: { ...shard.creatures, spawns, groups } };
  expanded.set(shard, out); slots.set(out, bySlot);
  return out;
}

/** The copies `countedShard` made, by id; empty for a shard it did not expand. */
export function countSlots(shard: Shardfile): ReadonlyMap<string, CountSlot> { return slots.get(shard) ?? new Map(); }

/** How many of a counted row's bodies stand for `players` in the cell: one per `per`, at least one. */
export function countStanding(players: number, per: number): number { return Math.max(1, Math.ceil(players / per)); }
