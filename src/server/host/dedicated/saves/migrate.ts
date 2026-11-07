// oxlint-disable-next-line import/no-nodejs-modules -- Migrations are files beside the running server.
import { readFile, readdir } from 'node:fs/promises';
import * as v from 'valibot';
import type { Database, Sql } from './database';

const MIGRATIONS = new URL('migrations/', import.meta.url);
const AppliedSchema = v.array(v.object({ name: v.string() }));

/**
 * E7.4: `api-server`'s migrations, for this repo's own database: `migrations/*.sql` in name order, each once, each in its own
 * transaction, recorded in `schema_migrations`. They run at startup and only add. Returns the names applied. A bundled server keeps the folder beside its entry, so `folder` names it there.
 */
export async function migrate(db: Database, folder: URL = MIGRATIONS): Promise<readonly string[]> {
  await db.exec('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const { rows } = await db.query('select name from schema_migrations');
  const applied = new Set(v.parse(AppliedSchema, rows).map(row => row.name));
  const pending = (await readdir(folder)).filter(name => name.endsWith('.sql') && !applied.has(name)).sort();
  for (const name of pending) {
    const text = await readFile(new URL(name, folder), 'utf8');
    await db.transaction(async (sql: Sql) => {
      await sql.exec(text);
      await sql.query('insert into schema_migrations (name) values ($1)', [name]);
    });
  }
  return pending;
}
