import { Pool } from 'pg';
import type { Database, Sql, SqlResult } from './database';

/** The VPS's own Postgres over its local socket (J180), and no more connections than the world's writes need. */
const POOL_SIZE = 4;
/** A connection may take this long: a local socket that takes longer has stopped. */
const CONNECT_MS = 3000;
/** Idle connections close, so an empty world holds none. */
const IDLE_MS = 30_000;

interface Queryable { readonly query: (text: string, params?: unknown[]) => Promise<{ readonly rows: unknown[] }> }
function sqlOf(target: Queryable): Sql {
  return {
    query: async (text: string, params: readonly unknown[] = []): Promise<SqlResult> => { const { rows } = await target.query(text, [...params]); return { rows }; },
    exec: async (text: string): Promise<void> => { await target.query(text); },
  };
}
/** J180: each channel's saves database on the VPS. Preview has no game server of its own yet. */
export const SAVES_DATABASES = { production: 'saves_production', staging: 'saves_staging' } as const;
/** Where apt's Postgres keeps its socket. Nothing listens on TCP (Q92). */
const LOCAL_SOCKET = '/var/run/postgresql';
/** The saves database of `channel`, over the local socket. */
export function savesUrl(channel: string): string {
  if (channel !== 'production' && channel !== 'staging') throw new Error(`No saves database for ${channel}`);
  return `postgresql:///${SAVES_DATABASES[channel]}?host=${LOCAL_SOCKET}`;
}
/** The saves database at `url`. */
export function openPg(url: string, onError: (error: Error) => void = () => undefined): Database {
  const pool = new Pool({ connectionString: url, max: POOL_SIZE, connectionTimeoutMillis: CONNECT_MS, idleTimeoutMillis: IDLE_MS });
  // An idle connection dying must be heard, or it ends the process.
  pool.on('error', onError);
  return { ...sqlOf(pool),
    transaction: async <Result>(work: (sql: Sql) => Promise<Result>): Promise<Result> => {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const result = await work(sqlOf(client));
        await client.query('commit');
        return result;
      } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
    },
    close: async (): Promise<void> => { await pool.end(); } };
}
