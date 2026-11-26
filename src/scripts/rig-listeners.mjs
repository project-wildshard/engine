// Stable owned front doors let restarting rig children bind port 0 every time.
import { lstatSync } from 'node:fs';
import { connect, createServer } from 'node:net';

/** @param {import('node:net').Server} server @param {number} [port] */
export async function listenLoopback(server, port = 0) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(undefined); }); });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('The owned listener has no TCP address');
  return address.port;
}

/** The listener itself owns its port throughout child replacement; no port is probed then released. */
/** @param {number} [listen] a fixed loopback port (0: the OS's) */
export async function rigFront(listen = 0) {
  /** @type {{path: string}|{host: string, port: number}|undefined} */
  let target;
  /** @type {Set<import('node:net').Socket>} */
  const sockets = new Set();
  const track = (/** @type {import('node:net').Socket} */ socket) => {
    sockets.add(socket); socket.once('close', () => { sockets.delete(socket); });
    socket.on('error', () => { socket.destroy(); }); return socket;
  };
  const server = createServer(incoming => {
    if (target === undefined) { incoming.destroy(); return; }
    const client = track(incoming), upstream = track(connect(target));
    client.once('close', () => { upstream.destroy(); }); upstream.once('close', () => { client.destroy(); });
    client.pipe(upstream).pipe(client);
  });
  const port = await listenLoopback(server, listen);
  let closed = false;
  const clear = () => { target = undefined; for (const socket of sockets) socket.destroy(); };
  return { port, point: (/** @type {number} */ next) => {
    if (!Number.isInteger(next) || next < 1 || next > 65535 || next === port) throw new Error('A rig front needs a distinct bound backend port');
    clear(); target = { host: '127.0.0.1', port: next };
  },
  /** New connections go to `next`; open ones finish what is in flight on the old backend for `drainMs`, then close, so a browser's
   *  pooled keep-alive connection never reaches the old backend after that (a page host's swap, with no downtime). */
  retarget: (/** @type {number} */ next, drainMs = 1000) => {
    if (!Number.isInteger(next) || next < 1 || next > 65535 || next === port) throw new Error('A rig front needs a distinct bound backend port');
    target = { host: '127.0.0.1', port: next };
    const old = [...sockets];
    setTimeout(() => { for (const socket of old) socket.destroy(); }, drainMs).unref();
  }, pointSocket: (/** @type {string} */ path) => {
    if (Buffer.byteLength(path) >= 104 || !lstatSync(path).isSocket()) throw new Error('A rig front needs a short owned Unix socket path');
    clear(); target = { path };
  }, clear, close: async () => { if (closed) return; closed = true; clear(); await new Promise((resolve, reject) => { server.close(error => { if (error) reject(error); else resolve(undefined); }); }); } };
}

/** Only an owned child can announce its listener; an early exit or timeout is a setup failure.
 * @param {import('node:child_process').ChildProcess} child @param {string} kind @returns {Promise<number>} */
export function childListener(child, kind) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { error(new Error('Owned rig child did not announce its listener')); }, 60_000);
    function clean() { clearTimeout(timer); child.off('message', message); child.off('exit', exit); child.off('error', error); }
    /** @param {Error} cause */
    function error(cause) { clean(); reject(cause); }
    function exit() { error(new Error('Owned rig child exited before announcing its listener')); }
    /** @param {unknown} row */
    function message(row) {
      if (row === null || typeof row !== 'object' || !('kind' in row) || row.kind !== kind || !('pid' in row) || row.pid !== child.pid || !('port' in row) || typeof row.port !== 'number' || !Number.isInteger(row.port) || row.port < 1 || row.port > 65535) return;
      clean(); resolve(row.port);
    }
    child.on('message', message); child.once('exit', exit); child.once('error', error);
  });
}

/** FM8s: the rig database's own front door, on a fixed loopback port, before an owned database (`path`, a Unix socket, or a loopback port: a socket path
 *  over the OS limit, ~104 bytes on macOS, cannot listen). It can break the
 *  database on purpose: `hold` lets connections open (startup through its first ReadyForQuery) but sends no query on until `pass`, as a
 *  stalled database does, so a write waits rather than fails; `refuse` drops every connection and every new one, as a database that is
 *  down does. `stats` counts what it held and refused.
 * @param {number} port @param {string | number} path */
export async function databaseFront(port, path) {
  /** @type {'pass' | 'hold' | 'refuse'} */
  let mode = 'pass';
  const stats = { connections: 0, refused: 0, heldBytes: 0 };
  /** @type {Set<{ client: import('node:net').Socket, upstream: import('node:net').Socket, ready: boolean, held: Buffer[] }>} */
  const pairs = new Set();
  const server = createServer(client => {
    stats.connections++;
    client.on('error', () => { client.destroy(); });
    if (mode === 'refuse') { stats.refused++; client.destroy(); return; }
    const upstream = typeof path === 'number' ? connect({ host: '127.0.0.1', port: path }) : connect({ path }), pair = { client, upstream, ready: false, held: /** @type {Buffer[]} */ ([]) };
    pairs.add(pair);
    upstream.on('error', () => { upstream.destroy(); });
    const end = () => { pairs.delete(pair); client.destroy(); upstream.destroy(); };
    client.once('close', end); upstream.once('close', end);
    // the server's side is read whole for its first ReadyForQuery ('Z'): until then the startup goes through whatever the mode
    let pending = Buffer.alloc(0);
    upstream.on('data', chunk => {
      if (!pair.ready) {
        pending = Buffer.concat([pending, chunk]);
        while (!pair.ready && pending.length >= 5) {
          const length = pending.readInt32BE(1);
          if (pending.length < 1 + length) break;
          if (pending[0] === 0x5a) pair.ready = true;
          pending = pending.subarray(1 + length);
        }
      }
      client.write(chunk);
    });
    client.on('data', chunk => {
      if (mode === 'hold' && pair.ready) { pair.held.push(chunk); stats.heldBytes += chunk.length; return; }
      upstream.write(chunk);
    });
  });
  await listenLoopback(server, port);
  let closed = false;
  return { port, stats,
    /** @param {'pass' | 'hold' | 'refuse'} next */
    fault: next => {
      mode = next;
      if (next === 'refuse') for (const pair of pairs) { pair.client.destroy(); pair.upstream.destroy(); }
      if (next === 'pass') for (const pair of pairs) for (const chunk of pair.held.splice(0)) pair.upstream.write(chunk);
    },
    mode: () => mode,
    close: async () => {
      if (closed) return; closed = true;
      for (const pair of pairs) { pair.client.destroy(); pair.upstream.destroy(); }
      await new Promise((resolve, reject) => { server.close(error => { if (error) reject(error); else resolve(undefined); }); });
    } };
}
