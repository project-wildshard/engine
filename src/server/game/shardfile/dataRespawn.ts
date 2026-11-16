// TEMPLATE-E2E TC-E2 (J361, meta TEMPLATE-E2E-PLAN): a data shard's creatures respawn. A `creatures.spawns` row's optional
// `respawn` (seconds, 1 to 3600, shard-format 0.5.8) brings its body back at its `at`, whole, that long after it dies: the
// declared brain and group skip a dead actor and resume once it is alive again, so reviving the body restores them. The
// waits are the host's state (one adapter), so a save keeps the clock; a cell asleep spends it (SC10, as declared homes do).
import * as v from 'valibot';
import type { SimHost } from '@wildshard/engine/sim';

/** One spawn row's revive inputs (the format's `creatures.spawns` row). */
export interface RespawnRow { readonly id: string; readonly at: readonly [number, number, number]; readonly yaw: number; readonly respawn?: number | undefined }

const finite = v.pipe(v.number(), v.finite());
const Saved = v.strictObject({ version: v.literal(1), waits: v.array(v.tuple([v.string(), finite])) });
export const DATA_RESPAWN_STEP = 'data.respawn';

/** Install the respawn clocks for the rows that declare one; nothing when none does (no adapter, so old saves restore). */
export function installDataRespawns(host: SimHost, rows: readonly RespawnRow[]): { readonly waits: () => ReadonlyMap<string, number> } | null {
  const timed = new Map(rows.flatMap((row) => (row.respawn === undefined ? [] : [[row.id, row] as const])));
  if (timed.size === 0) return null;
  for (const id of timed.keys()) if (!host.entities.has(id)) throw new Error(`Respawn row ${id} names no body`);
  const waits = new Map<string, number>();
  host.events.on('actor.died', ({ actor }) => { const row = timed.get(actor.id); if (row?.respawn !== undefined) waits.set(row.id, row.respawn); }, host.scope);
  host.events.on('world.slept', ({ seconds }) => { for (const [id, left] of waits) waits.set(id, Math.max(Number.MIN_VALUE, left - seconds)); }, host.scope);
  const revive = (row: RespawnRow): void => {
    const body = host.entities.get(row.id); if (body === undefined) return;
    body.place(row.at[0], row.at[2], row.yaw, row.at[1]);
    body.revive();
    // A dead body has no motor (syncBodies drops it); if one is left, drop it so the next sync makes one at the spawn.
    if (body.motor !== null) { body.motor.dispose(); body.motor = null; }
  };
  host.onStep(DATA_RESPAWN_STEP, (dt) => {
    for (const [id, left] of waits) {
      const next = left - dt;
      if (next > 0) { waits.set(id, next); continue; }
      waits.delete(id);
      const row = timed.get(id); if (row !== undefined) revive(row);
    }
  }, {
    snapshot: () => ({ version: 1, waits: [...waits].sort(([a], [b]) => a.localeCompare(b)) }),
    restore: (value) => {
      const state = v.parse(Saved, value);
      waits.clear();
      for (const [id, left] of state.waits) { if (!timed.has(id)) throw new Error(`Incompatible respawn continuation: ${id}`); waits.set(id, left); }
    },
  });
  return { waits: () => waits };
}
