// TEMPLATE-E2E TC-E2 (J361, meta TEMPLATE-E2E-PLAN): a shard's creatures respawn. A `creatures.spawns` row's optional
// `respawn` (seconds, 1 to 3600, shard-format 0.5.8) brings its body back at its `at`, whole, that long after it dies: the
// declared brain and group skip a dead actor and resume once it is alive again, so reviving the body restores them. The
// waits are the host's state (one adapter), so a save keeps the clock; a cell asleep spends it (SC10, as declared homes do).
// In a room each clock runs at the speed of the players near its spawn (J109, as the keeper's homes; OF19c1 found Dunes
// rev 4's declared homes without it).
import * as v from 'valibot';
import type { SimHost } from '@wildshard/engine/sim';
import { CREDIT_PREFIX } from '@wildshard/engine/quest/players';
import { spawnAbsent } from './declaredSpawnWhen';
import { roomRefillRate } from '@wildshard/engine/entities/creatureRefill';
import { hostDay } from './declaredClimate';

/** OF22b3: what else a return waits for once its seconds are spent (the format's `respawnWhen`, shard-format 0.54.0). */
export interface RespawnWhen { readonly spread?: number; readonly away?: number; readonly night?: true; readonly fade?: number }
/** One spawn row's revive inputs (the format's `creatures.spawns` row). */
export interface RespawnRow { readonly id: string; readonly at: readonly [number, number, number]; readonly yaw: number; readonly respawn?: number | undefined;
  readonly respawnWhen?: RespawnWhen | undefined }

const finite = v.pipe(v.number(), v.finite());
const Pairs = v.array(v.tuple([v.string(), finite]));
/** `fades` (OF22b3) is written only while a body fades, so a save with none is the version-1 save it always was. */
const Saved = v.strictObject({ version: v.literal(1), waits: Pairs, fades: v.exactOptional(Pairs) });
export const DATA_RESPAWN_STEP = 'data.respawn';

/** Install the respawn clocks for the rows that declare one; nothing when none does (no adapter, so old saves restore). */
export function installDataRespawns(host: SimHost, rows: readonly RespawnRow[]): { readonly waits: () => ReadonlyMap<string, number> } | null {
  const timed = new Map(rows.flatMap((row) => (row.respawn === undefined ? [] : [[row.id, row] as const])));
  if (timed.size === 0) return null;
  for (const id of timed.keys()) if (!host.entities.has(id)) throw new Error(`Respawn row ${id} names no body`);
  const waits = new Map<string, number>(), fades = new Map<string, number>();
  // OF22b3: a `spread` adds one draw a death from the respawn stream, made only by a row that declares one (the spawn stream, saved with the world)
  const due = (row: RespawnRow): number => (row.respawn ?? 0) + ((row.respawnWhen?.spread ?? 0) > 0 ? (row.respawnWhen?.spread ?? 0) * host.rng.stream('spawn').next() : 0);
  // OF22b3: no player within `away` of the spawn, and night for a night return (the day the `when: night` rows read)
  const ready = (row: RespawnRow): boolean => {
    const away = row.respawnWhen?.away ?? 0;
    if (row.respawnWhen?.night === true && hostDay(host)?.dayPhase !== 'night') return false;
    return away <= 0 || [...host.players.values()].every(player => host.parked.has(player.id) || Math.hypot(player.position.x - row.at[0], player.position.z - row.at[2]) >= away);
  };
  host.events.on('actor.died', ({ actor }) => { const row = timed.get(actor.id); if (row?.respawn !== undefined) { fades.delete(row.id); waits.set(row.id, due(row)); } }, host.scope);
  host.events.on('world.slept', ({ seconds }) => {
    for (const [id, left] of waits) waits.set(id, Math.max(Number.MIN_VALUE, left - seconds));
    for (const [id, left] of fades) fades.set(id, Math.max(0, left - seconds));
  }, host.scope);
  const revive = (row: RespawnRow): void => {
    const body = host.entities.get(row.id); if (body === undefined) return;
    body.place(row.at[0], row.at[2], row.yaw, row.at[1]);
    body.revive();
    host.flags.clear(`dead:${row.id}`);
    // A data cell keeps a dead body's motor (no body bands drop it): stand its capsule at the spawn, no sweep. Under body
    // bands a dead body has none, and the next sync makes one where it now stands.
    body.motor?.resetAt?.(body.position);
    // SB34c: the world sees the body alive again; each player's credit for the kill stays in their own book
    host.flags.clear(`${CREDIT_PREFIX}${row.id}`);
  };
  host.onStep(DATA_RESPAWN_STEP, (dt) => {
    // Logical revision migration carries body health and flags, without adapter clocks or death events.
    // Reconcile after restore, never during installation (exact restore still supplies its remaining wait).
    for (const [id, row] of timed) {
      const body = host.entities.get(id);
      if (body !== undefined && spawnAbsent(body)) { waits.delete(id); continue; } // OF29a: an absent body waits for its `when`, not a timer
      if (body?.alive === false && !waits.has(id) && !fades.has(id) && row.respawn !== undefined) waits.set(id, due(row));
      else if (body?.alive === true) { host.flags.clear(`dead:${id}`); fades.delete(id); }
    }
    for (const [id, left] of waits) {
      // J109, as a keeper's home: a room's clock runs at the speed of the players near the spawn; one player's is plain dt
      const at = timed.get(id)?.at, next = left - dt * (at === undefined ? 1 : roomRefillRate(host.players, at[0], at[2], host.parked));
      if (next > 0) { waits.set(id, next); continue; }
      const row = timed.get(id); if (row === undefined) { waits.delete(id); continue; }
      // OF22b3: spent, it waits at zero for its conditions, then fades (the island's ReturnGate: a 1.5 s corpse fade)
      if (!ready(row)) { waits.set(id, 0); continue; }
      waits.delete(id);
      if ((row.respawnWhen?.fade ?? 0) > 0) fades.set(id, row.respawnWhen?.fade ?? 0); else revive(row);
    }
    for (const [id, left] of fades) {
      const next = left - dt, row = timed.get(id);
      if (next > 0 || row === undefined) { fades.set(id, Math.max(0, next)); continue; }
      // as the island's: the fade runs on, and the new body stands once the conditions hold at its end
      if (!ready(row)) { fades.set(id, 0); continue; }
      fades.delete(id); revive(row);
    }
  }, {
    snapshot: () => ({ version: 1, waits: [...waits].sort(([a], [b]) => a.localeCompare(b)),
      ...(fades.size === 0 ? {} : { fades: [...fades].sort(([a], [b]) => a.localeCompare(b)) }) }),
    restore: (value) => {
      const state = v.parse(Saved, value);
      waits.clear(); fades.clear();
      for (const [id, left] of state.waits) { if (!timed.has(id)) throw new Error(`Incompatible respawn continuation: ${id}`); waits.set(id, left); }
      for (const [id, left] of state.fades ?? []) { if (!timed.has(id)) throw new Error(`Incompatible respawn continuation: ${id}`); fades.set(id, left); }
    },
  });
  return { waits: () => waits };
}
