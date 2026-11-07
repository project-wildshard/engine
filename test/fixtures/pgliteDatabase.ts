import { PGlite, type Transaction } from '@electric-sql/pglite';
import type { Database, Sql, SqlResult } from '../../src/server/host/dedicated/saves/database';

// The SQL port on PGlite, as `api-server` tests its own: real Postgres compiled to WASM, in-process.
interface Queryable { readonly query: Transaction['query']; readonly exec: Transaction['exec'] }
function sqlOf(target: Queryable): Sql {
  return {
    query: async (text: string, params: readonly unknown[] = []): Promise<SqlResult> => { const { rows } = await target.query(text, [...params]); return { rows }; },
    exec: async (text: string): Promise<void> => { await target.exec(text); },
  };
}
/** A fresh in-memory database. */
export async function openPglite(): Promise<Database & { readonly pglite: PGlite }> {
  const pglite = new PGlite();
  await pglite.waitReady;
  return { ...sqlOf(pglite), pglite,
    transaction: async <Result>(work: (sql: Sql) => Promise<Result>): Promise<Result> => await pglite.transaction(async (tx: Transaction): Promise<Result> => await work(sqlOf(tx))) as Result,
    close: async (): Promise<void> => { await pglite.close(); } };
}
