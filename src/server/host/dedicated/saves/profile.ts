import * as v from 'valibot';
import type { Database, Sql } from './database';
import { within } from './saveStore';

// MMO-PLAN MP3.2 (M4, M6, O9, G25): a player's profile is the one thing that travels above the shards. It holds only what the
// platform controls: titles (M4's Title under the Name, O9's Founding Author), cosmetics and achievements. There is no global
// coin (G25): coins and anything else a shard invents stay in that shard's save. Catalogue gear joins with MP3.4's catalogue.
// Only a ledger grant changes it: the database itself refuses any other write (`0005-profile.sql`).

/** Where platform grants are filed in the ledger: no shard is called this, and no shard may file a profile kind. */
export const PLATFORM_SHARD = '@platform';
/** What a profile grant adds. */
export type ProfileKind = 'title' | 'cosmetic' | 'achievement';
/** One player's profile. */
export interface PlayerProfile { readonly titles: readonly string[]; readonly cosmetics: readonly string[]; readonly achievements: readonly string[] }
export const EMPTY_PROFILE: PlayerProfile = { titles: [], cosmetics: [], achievements: [] };
/** A platform grant: `factId` is stable, so the same grant offered twice is filed once. */
export interface ProfileGrant { readonly factId: string; readonly kind: ProfileKind; readonly name: string }

/** A grant's or a read's wait: a join must not hang on a database that has stopped answering. */
const GRANT_MS = 3000;
const ProfileSchema = v.strictObject({ titles: v.array(v.string()), cosmetics: v.array(v.string()), achievements: v.array(v.string()) });
const ProfileRowsSchema = v.array(v.object({ profile: ProfileSchema }));
const FiledSchema = v.array(v.object({ serial: v.unknown() }));
// The player row is locked first, so one player's grants take their serials in turn.
const LOCK = 'select id from player where id = $1 for update';
const FILE = `insert into ledger_receipt (player_id, epoch, shard, serial, fact_id, grant_kind, name, amount)
  select $1, $2, $3, coalesce(max(serial), 0) + 1, $4, $5, $6, 1 from ledger_receipt where player_id = $1 and epoch = $2 and shard = $3
  on conflict (player_id, epoch, shard, fact_id) do nothing returning serial`;

/**
 * File one platform grant in the ledger; its receipt is what adds it to the profile. False if this fact was already filed. A grant
 * that outlives the wait may still land: grant it again with the same `factId`, and it is filed once.
 */
export function grantProfile(db: Database, epoch: number, player: string, grant: ProfileGrant): Promise<boolean> {
  return within(GRANT_MS, () => db.transaction(async (sql: Sql) => {
    if ((await sql.query(LOCK, [player])).rows.length === 0) throw new Error(`No player ${player} to grant a profile ${grant.kind}`);
    const filed = await sql.query(FILE, [player, epoch, PLATFORM_SHARD, grant.factId, grant.kind, grant.name]);
    return v.parse(FiledSchema, filed.rows).length > 0;
  }));
}
/** A player's profile, or null if there is no such player. */
export async function readProfile(db: Database, player: string): Promise<PlayerProfile | null> {
  const [row] = v.parse(ProfileRowsSchema, (await within(GRANT_MS, () => db.query('select profile from player where id = $1', [player]))).rows);
  return row?.profile ?? null;
}
