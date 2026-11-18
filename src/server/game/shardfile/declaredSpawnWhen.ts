// ONE-FORMAT OF29a (OF28c, Q-CC35): a declared spawn row's `when`. A body whose row says `when` stands in the world only
// while its condition holds; the rest of the time it is absent: out of the world (deep under it, as a hidden native body
// is), not alive, so no brain runs it, no blow lands on it and its leaving pays no death, credit or loot. Conditions:
// `quest` from that stage on (any player in the cell at or past it), `time` by day (dawn to golden) or by night (dusk
// and night) on the host's day (its clock, else the shard's `world/days` row, `hostDay`), `wave` index N of a set once every body of wave N-1 has fallen (wave 1 at once). A row naming several needs
// them all. A body killed while present stays to its own `respawn` row; one that comes back while its condition is off
// leaves on the next step. The absent bodies and the opened waves are the host's state (one adapter), so a save keeps them.
import * as v from 'valibot';
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { SimHost } from '@wildshard/engine/sim';
import { questBooks } from '@wildshard/engine/quest/players';
import { hostDay } from './declaredClimate';
import { countStanding, type CountSlot } from './declaredSpawnCount';

type SpawnRow = Shardfile['creatures']['spawns'][number];
type When = NonNullable<SpawnRow['when']>;
type Body = NonNullable<ReturnType<SimHost['entities']['get']>> & { hidden?: boolean };

/** Where an absent body waits: under every floor, as a hidden native body does (`riding/roster.ts`). */
export const ABSENT_Y = -1e4;
export const SPAWN_WHEN_STEP = 'data.spawn-when';
const Saved = v.strictObject({ version: v.literal(1), absent: v.array(v.string()), opened: v.array(v.string()) });

/** True when `body` is a declared spawn held out of the world by its `when`. */
export function spawnAbsent(body: object): boolean { return 'hidden' in body && body.hidden === true; }

const waveKey = (set: string, index: number): string => `${set}#${String(index)}`;

/** Install the `when` gate for the rows that declare one; nothing when none does (no adapter, so older saves restore). */
export function installDeclaredSpawnWhen(host: SimHost, rows: readonly SpawnRow[], restoring = false, counted: ReadonlyMap<string, CountSlot> = new Map()): { readonly absent: () => ReadonlySet<string> } | null {
  const gated = rows.filter(row => row.when !== undefined || counted.has(row.id));
  if (gated.length === 0) return null;
  for (const row of gated) if (!host.entities.has(row.id)) throw new Error(`Spawn row ${row.id} names no body`);
  const absent = new Set<string>(), opened = new Set<string>();
  const waves = new Map<string, string[]>();
  for (const row of gated) if (row.when?.wave !== undefined) {
    const key = waveKey(row.when.wave.set, row.when.wave.index), members = waves.get(key) ?? [];
    members.push(row.id); waves.set(key, members);
  }
  const body = (id: string): Body | undefined => host.entities.get(id);
  const fallen = (key: string): boolean => (waves.get(key) ?? []).every(id => { const b = body(id); return b !== undefined && !b.alive && !spawnAbsent(b); });
  const quest = (when: When['quest']): boolean => {
    if (when === undefined) return true;
    const books = questBooks(host);
    for (const player of host.players.keys()) if ((books.of(player).quests.find(state => state.def.id === when.id)?.index ?? -1) >= when.stage) return true;
    return false;
  };
  const night = (): boolean => { const phase = hostDay(host)?.dayPhase; return phase === 'dusk' || phase === 'night'; };
  const met = (when: When): boolean => quest(when.quest)
    && (when.time === undefined || (when.time === 'night') === night())
    && (when.wave === undefined || when.wave.index === 1 || opened.has(waveKey(when.wave.set, when.wave.index)));
  // OF29b: a counted row's copy `slot` stands once the cell's players call for that many bodies
  const holds = (row: SpawnRow): boolean => { const slot = counted.get(row.id); return (slot === undefined || countStanding(host.players.size, slot.per) >= slot.slot) && (row.when === undefined || met(row.when)); };
  const leave = (row: SpawnRow, b: Body): void => {
    Object.assign(b, { hidden: true }); b.alive = false; b.position.y = ABSENT_Y; b.motor?.resetAt?.(b.position);
    host.flags.clear(`dead:${row.id}`); absent.add(row.id);
  };
  const enter = (row: SpawnRow, b: Body): void => {
    Object.assign(b, { hidden: false }); absent.delete(row.id);
    b.place(row.at[0], row.at[2], row.yaw, row.at[1]); b.revive(); b.motor?.resetAt?.(b.position);
    host.flags.clear(`dead:${row.id}`);
  };
  const settle = (): void => {
    // a wave opens once the one before it has fallen, and stays open
    for (const key of waves.keys()) {
      const [set, index] = [key.slice(0, key.lastIndexOf('#')), Number(key.slice(key.lastIndexOf('#') + 1))];
      if (index > 1 && !opened.has(key) && waves.has(waveKey(set, index - 1)) && fallen(waveKey(set, index - 1))) opened.add(key);
    }
    for (const row of gated) {
      const b = body(row.id); if (b === undefined) continue;
      const on = holds(row);
      if (!on && b.alive) leave(row, b);
      else if (on && absent.has(row.id)) enter(row, b);
    }
  };
  if (!restoring) settle();
  host.onStep(SPAWN_WHEN_STEP, () => { settle(); }, {
    snapshot: () => ({ version: 1, absent: [...absent].sort(), opened: [...opened].sort() }),
    restore: (value) => {
      const state = v.parse(Saved, value), known = new Set(gated.map(row => row.id));
      absent.clear(); opened.clear();
      for (const id of state.absent) {
        const b = body(id);
        if (!known.has(id) || b === undefined) throw new Error(`Incompatible spawn-when continuation: ${id}`);
        Object.assign(b, { hidden: true }); absent.add(id);
      }
      for (const key of state.opened) { if (!waves.has(key)) throw new Error(`Incompatible spawn-when continuation: ${key}`); opened.add(key); }
    },
  });
  return { absent: () => absent };
}
