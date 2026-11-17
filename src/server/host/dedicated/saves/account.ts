import type { Database, Sql } from './database';

// MMO-PLAN MP2.5 (delete and export): what the saves database holds for one signed-in player (`account:plr_…`), handed over whole or
// deleted. Deletion leaves anonymous ledger rows only: the account's receipts move to a fresh `deleted:<uuid>` player named
// "Deleted", with no Name tag and an empty profile, so the ledger still adds up and names nobody; its saves, place, Name and profile
// go. Guests are never handled here (they expire, MP2.3). The api-server deletes the account's email, sessions and passkeys itself.
// MP2.5f/g (review S2, S5): one rule for every player that goes, an account deleted or a guest expired (`expiry.ts`), in `anonymise`.

/** Everything the saves database holds for one account. */
export interface AccountExport {
  readonly player: Readonly<Record<string, unknown>>;
  readonly saves: readonly Readonly<Record<string, unknown>>[];
  readonly receipts: readonly Readonly<Record<string, unknown>>[];
  readonly places: readonly Readonly<Record<string, unknown>>[];
}

const ACCOUNT = /^account:plr_[0-9a-f]{32}$/u;
function only(account: string): void { if (!ACCOUNT.test(account)) throw new Error('Only an account is exported or deleted here'); }
const records = (rows: readonly unknown[]): Readonly<Record<string, unknown>>[] => rows.map(row => row as Record<string, unknown>);

/** The account's data, or undefined when this database has nothing of it. */
export async function exportAccount(db: Database, account: string): Promise<AccountExport | undefined> {
  only(account);
  const player = (await db.query('select id, name, tag, profile, created_at, seen_at from player where id = $1', [account])).rows[0];
  if (player === undefined) return undefined;
  const saves = await db.query('select epoch, shard, build, save_version, seq, doc, updated_at from player_save where player_id = $1 order by epoch, shard', [account]);
  const receipts = await db.query('select epoch, shard, serial, fact_id, grant_kind, name, amount, at from ledger_receipt where player_id = $1 order by epoch, shard, serial', [account]);
  const places = await db.query('select epoch, cell, pose, updated_at from player_place where player_id = $1 order by epoch', [account]);
  return { player: player as Record<string, unknown>, saves: records(saves.rows), receipts: records(receipts.rows), places: records(places.rows) };
}

/**
 * MP2.5f/g: what outlives a player that goes, an account deleted or a guest expired. The ledger and chat reports stay, naming
 * nobody: each player gets a fresh `deleted:<uuid>` (one per player, so its rows still add up and a moderator still sees one
 * speaker's reports together), its receipts move there under a "Deleted" player with no Name tag, and its chat reports keep what was
 * typed and shown (the evidence) with that id as reporter or speaker and "Deleted" for its Name. The caller deletes the rest.
 */
export async function anonymise(sql: Sql, players: readonly string[]): Promise<void> {
  if (players.length === 0) return;
  const pairs = [players, players.map(() => `deleted:${crypto.randomUUID()}`)];
  const gone = 'unnest($1::text[], $2::text[]) as gone (id, anonymous)';
  await sql.query(`insert into player (id, name) select gone.anonymous, 'Deleted' from ${gone} where exists (select 1 from ledger_receipt where player_id = gone.id)`, pairs);
  await sql.query(`update ledger_receipt set player_id = gone.anonymous from ${gone} where player_id = gone.id`, pairs);
  await sql.query(`update chat_report set reporter = gone.anonymous from ${gone} where reporter = gone.id`, pairs);
  await sql.query(`update chat_report set speaker = gone.anonymous, name = 'Deleted' from ${gone} where speaker = gone.id`, pairs);
}

/** Delete the account, leaving its receipts and chat reports under an id that names nobody; false when there was nothing to delete. */
export async function deleteAccount(db: Database, account: string): Promise<boolean> {
  only(account);
  const deleted = await db.transaction(async sql => {
    if ((await sql.query('select 1 from player where id = $1 for update', [account])).rows.length === 0) return false;
    await anonymise(sql, [account]);
    await sql.query('delete from player_save where player_id = $1', [account]);
    await sql.query('delete from player_place where player_id = $1', [account]);
    await sql.query('delete from player where id = $1', [account]);
    return true;
  });
  return deleted;
}
