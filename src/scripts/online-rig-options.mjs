import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** Admit the rig before a key read, build, database or listener can start.
 * @param {{saves?: 'memory', pgBin?: string, pgData?: string, socket: string}} options (`pgBin` 'pglite:' needs no `pgData`) */
export function rigOptions({ saves, pgBin = '', pgData = '', socket }) {
  const target = new URL(socket);
  if (!['ws:', 'wss:'].includes(target.protocol) || !['127.0.0.1', '[::1]'].includes(target.hostname) || target.username !== '' || target.password !== '') throw new Error('A rig signs loopback WebSocket addresses only');
  const memory = saves === 'memory' || pgBin === 'memory:';
  // FM8s: `pglite:` is PGlite in this process behind the rig's database front (online-rig.mjs), a database a proof can break on purpose
  if (!memory && pgBin !== 'pglite:' && (pgBin === '' || pgData === '')) throw new Error('A rig requires Postgres paths, pglite: or saves: memory');
  return { memory, pgBin, pgData };
}

/** A Unix socket path holds at most 103 bytes on macOS (104 with its NUL; Linux 107). v0.1.94's local QA ran from the
 * train's own clone (QA 11-25 row 88), and `<clone>/tmp/<lane>/qa-<id>/local/rig/pg.sock` ran to about 120, so the
 * PGlite socket's listen failed EINVAL. The socket stays in the work folder when it fits, and otherwise takes a short
 * path named by that folder's hash, so no checkout depth can break it.
 * @param {string} work @param {string} [short] the folder for a long work folder's socket (the OS temp folder) */
export function rigSocketPath(work, short = tmpdir()) {
  const inWork = join(resolve(work), 'pg.sock');
  if (Buffer.byteLength(inWork) <= 103) return inWork;
  return join(short, `ws-pg-${createHash('sha256').update(resolve(work)).digest('hex').slice(0, 16)}.sock`);
}
