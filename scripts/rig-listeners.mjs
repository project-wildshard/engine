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
export async function rigFront() {
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
  const port = await listenLoopback(server);
  let closed = false;
  const clear = () => { target = undefined; for (const socket of sockets) socket.destroy(); };
  return { port, point: (/** @type {number} */ next) => {
    if (!Number.isInteger(next) || next < 1 || next > 65535 || next === port) throw new Error('A rig front needs a distinct bound backend port');
    clear(); target = { host: '127.0.0.1', port: next };
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
