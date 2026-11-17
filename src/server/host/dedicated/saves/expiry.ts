import type { Scope } from '@wildshard/engine/app/scope';
import type { Database } from './database';

// MMO-PLAN MP2.3 (Q33: "Guest ids expire after 7 idle days"; Q30: "unclaimed ids can expire way faster" than 180 days). A guest is
// a `device:` id; nobody has seen it (`player.seen_at`, touched by every save and Name claim) for the idle days, so it goes whole:
// saves, receipts, place, its platform grants and the Name tag it held. Accounts (`account:plr_…`) never expire here; deleting one
// is MP2.5's. A device a sign-in claimed (MP2.2d) has only its `player` row left, which goes the same way.
// Off unless `GUEST_EXPIRY_DAYS` is set: switching it on deletes every Friends-grid guest idle that long, which is Jake's call.

/** How many guests one statement takes, so a first sweep over a big table holds no long lock. */
const BATCH = 500;
const DAY_MS = 86_400_000, HOUR_MS = 3_600_000;
/** `player_id` tables first: each references `player`. */
const OWNED = ['ledger_receipt', 'player_save', 'player_place'] as const;

/** Delete guests unseen for `days` before `nowMs`, `batch` at a time; how many went. */
export async function expireGuests(db: Database, days: number, nowMs: number = Date.now(), batch: number = BATCH): Promise<number> {
  const before = new Date(nowMs - days * DAY_MS).toISOString();
  let gone = 0;
  for (;;) {
    const went = await db.transaction(async sql => {
      const { rows } = await sql.query(`select id from player where id like 'device:%' and seen_at < $1 order by seen_at limit $2 for update skip locked`, [before, batch]);
      const ids = rows.map(row => String((row as { id: unknown }).id));
      if (ids.length === 0) return 0;
      for (const table of OWNED) await sql.query(`delete from ${table} where player_id = any($1::text[])`, [ids]);
      await sql.query('delete from player where id = any($1::text[])', [ids]);
      return ids.length;
    });
    gone += went;
    if (went < batch) return gone;
  }
}

/** The switch: a whole number of idle days, at least 1, else off. */
export function guestExpiryDays(env: Readonly<Record<string, string | undefined>>): number | undefined {
  const raw = env['GUEST_EXPIRY_DAYS'];
  if (raw === undefined || !/^[1-9][0-9]{0,3}$/u.test(raw)) return undefined;
  return Number(raw);
}

/** What the server's sweep runs on. */
export interface GuestExpiry {
  readonly days: number;
  readonly sweep: (days: number) => Promise<number>;
  readonly log: (line: Record<string, unknown>) => void;
}
/** Sweep an hour after boot (a restart loop never sweeps), then every 24 hours, until `scope` ends. */
export function startGuestExpiry(scope: Scope, { days, sweep, log }: GuestExpiry): void {
  const run = async (): Promise<void> => {
    try { log({ at: 'guests.expired', days, players: await sweep(days) }); }
    catch (error) { log({ at: 'guests.expire-failed', error: error instanceof Error ? error.message : String(error) }); }
  };
  scope.timeout(HOUR_MS, () => { void run(); scope.interval(DAY_MS, () => { void run(); }); });
}
