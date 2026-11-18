// ONE-FORMAT CC59c (Q-CC32, Q-CC34): an encounter phase's `adds`. Each add is a declared spawn row that waits out of the
// world (as an absent `when` body does: under every floor, not alive, so no brain runs it and no blow lands) until its
// encounter fights at that phase or later (its phase change's beat included), or a decision's `spawn` command calls it. Once out, it is an ordinary creature
// for the rest of that fight: it dies and respawns by its own row. When the fight resets (the encounter is armed or
// dormant again) the adds still standing leave, and wait for the phase once more. Waiting and called adds are the host's
// state (one adapter, installed only when some phase lists adds, so older saves restore).
import * as v from 'valibot';
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { SimHost } from '@wildshard/engine/sim';
import { ABSENT_Y } from './declaredSpawnWhen';

export const ENCOUNTER_ADDS_STEP = 'data.encounter-adds';
const Saved = v.strictObject({ version: v.literal(1), absent: v.array(v.string()), released: v.array(v.string()) });
type SpawnRow = Shardfile['creatures']['spawns'][number];
type Body = NonNullable<ReturnType<SimHost['entities']['get']>> & { hidden?: boolean };
/** What the adds read of a fight: its state and its 0-based phase. */
export interface AddsFight { readonly boss: { readonly state: string; readonly phase: number } }
/** The decision side of the adds: which rows are adds, and calling one out early. */
export interface EncounterAdds { readonly has: (id: string) => boolean; readonly call: (id: string) => void }

/** Install the adds every encounter phase lists; null when none does. */
export function installEncounterAdds(host: SimHost, rows: Shardfile['encounters'], spawns: readonly SpawnRow[], fights: ReadonlyMap<string, AddsFight>, restoring = false): EncounterAdds | null {
  const owners = new Map<string, { readonly encounter: string; readonly phase: number }>();
  for (const row of rows) {
    row.phases.forEach((phase, index) => {
      for (const add of phase.adds ?? []) {
        if (owners.has(add)) throw new Error(`Encounter add ${add} is listed twice`);
        owners.set(add, { encounter: row.id, phase: index });
      }
    });
  }
  if (owners.size === 0) return null;
  const rowOf = new Map(spawns.map(row => [row.id, row]));
  for (const id of owners.keys()) {
    const row = rowOf.get(id);
    if (row === undefined || !host.entities.has(id)) throw new Error(`Encounter add ${id} names no spawn`);
    if (row.when !== undefined) throw new Error(`Encounter add ${id} also has a when`);
  }
  const absent = new Set<string>(), released = new Set<string>();
  const body = (id: string): Body | undefined => host.entities.get(id);
  const leave = (id: string): void => {
    const b = body(id); if (b === undefined) return;
    Object.assign(b, { hidden: true }); b.alive = false; b.position.y = ABSENT_Y; b.motor?.resetAt?.(b.position);
    host.flags.clear(`dead:${id}`); absent.add(id);
  };
  const enter = (id: string): void => {
    const b = body(id), row = rowOf.get(id); if (b === undefined || row === undefined) return;
    released.add(id);
    if (!absent.has(id)) return;
    Object.assign(b, { hidden: false }); absent.delete(id);
    b.place(row.at[0], row.at[2], row.yaw, row.at[1]); b.revive(); b.motor?.resetAt?.(b.position);
    host.flags.clear(`dead:${id}`);
  };
  const settle = (): void => {
    for (const [id, owner] of owners) {
      const state = fights.get(owner.encounter)?.boss.state ?? 'dormant';
      if (state === 'armed' || state === 'dormant') {
        // a reset fight: every add waits again
        if (released.has(id) || !absent.has(id)) { released.delete(id); leave(id); }
      } else if ((state === 'fight' || state === 'beat') && !released.has(id) && (fights.get(owner.encounter)?.boss.phase ?? 0) >= owner.phase) enter(id);
    }
  };
  if (!restoring) for (const id of owners.keys()) leave(id);
  host.onStep(ENCOUNTER_ADDS_STEP, () => { settle(); }, {
    snapshot: () => ({ version: 1, absent: [...absent].sort(), released: [...released].sort() }),
    restore: (value) => {
      const state = v.parse(Saved, value);
      absent.clear(); released.clear();
      for (const id of [...state.absent, ...state.released]) if (!owners.has(id)) throw new Error(`Incompatible encounter-adds continuation: ${id}`);
      for (const id of state.absent) { const b = body(id); if (b !== undefined) Object.assign(b, { hidden: true }); absent.add(id); }
      for (const id of state.released) released.add(id);
    },
  });
  return { has: id => owners.has(id), call: id => { if (owners.has(id)) enter(id); } };
}
