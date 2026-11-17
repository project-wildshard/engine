import type { Database } from './database';

// MMO-PLAN MP2.2d (MP2.3's first half, Q33): a device's guest progress becomes the account's the first time a join ticket seats the
// account from that device. One transaction: the account's `player` row is made, then, only if the account has no progress yet,
// every save, receipt and place the device holds (every epoch) moves to it. An account with progress keeps it; the device keeps its
// own. The move is the claim's "once": the device has nothing left to move. A Name's tag stays the device's row's; the account
// claims its own at its next join (MP2.4). Platform grants (titles, cosmetics; shard `@platform`) neither move nor count as
// progress: `player.profile` is filled by a ledger insert trigger, which a move never fires, and a moved grant would block the
// account's own grant of it forever (review M2). The account's `player` row is locked, so two devices claiming at once take turns.

const MOVED = ['player_save', 'ledger_receipt', 'player_place'] as const;

/**
 * How a claim went. `moved`: the device's progress is the account's now. `kept`: the account already had progress, so nothing moved
 * and nothing ever will (MP2.2g: the door stops asking for it). `none`: nothing to move and the account still empty.
 */
export type ClaimResult = 'moved' | 'kept' | 'none';

/** Move `device`'s progress to `account` unless the account has some. */
export function claimSaves(db: Database, device: string, account: string): Promise<ClaimResult> {
  return db.transaction(async sql => {
    await sql.query(`insert into player (id, name) select $2, coalesce((select name from player where id = $1), 'Guest')
      on conflict (id) do nothing`, [device, account]);
    await sql.query('select 1 from player where id = $1 for update', [account]);
    const held = await sql.query(`select 1 from player_save where player_id = $1 and shard <> '@platform'
      union all select 1 from ledger_receipt where player_id = $1 and shard <> '@platform'
      union all select 1 from player_place where player_id = $1 limit 1`, [account]);
    if (held.rows.length > 0) return 'kept';
    let moved = 0;
    for (const table of MOVED) {
      const { rows } = await sql.query(`with moved as (update ${table} set player_id = $2 where player_id = $1${table === 'player_place' ? '' : " and shard <> '@platform'"} returning 1) select count(*)::int as n from moved`, [device, account]);
      moved += (rows[0] as { n?: number } | undefined)?.n ?? 0;
    }
    return moved > 0 ? 'moved' : 'none';
  });
}
