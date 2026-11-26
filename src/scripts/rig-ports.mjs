// QA 11-25 row 130: a rig's four loopback ports (Postgres, world, pages, release from WS_RIG_PORTS) chosen per run. v0.1.96's
// train held at local QA with EADDRINUSE 127.0.0.1:19479 because another lane's rig held the same fixed block. A run with no
// WS_RIG_PORTS now takes a free block under a lock file, so two rigs on one machine never collide; an explicit WS_RIG_PORTS
// is used as given. The release port is stamped into the page build before the rig opens (WILDSHARD_RELEASE_URL) and a
// pglite: rig needs named ports, so the rig cannot simply listen on port 0: the block is known before the build and held
// until the rig closes or this process exits.
import { mkdirSync, openSync, closeSync, readFileSync, rmSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { freeFixturePorts } from './online-rig-owned.mjs';

/** The pool: 24 blocks of four from 19476 (the QA rig's old fixed block) to 19571, below seat-hold's old 19576. */
export const RIG_PORT_FIRST = 19476, RIG_PORT_BLOCKS = 24;
/** Lock files shared by every checkout and worktree on this machine; WS_RIG_PORT_LOCKS moves them (a test's own folder). */
export const rigPortLocks = () => process.env.WS_RIG_PORT_LOCKS ?? join(homedir(), '.cache', 'wildshard', 'rig-ports');

/** @param {number} pid */
const alive = pid => {
  try { process.kill(pid, 0); return true; } catch (error) { return !(error instanceof Error && 'code' in error && error.code === 'ESRCH'); }
};
/** The holder a lock names, or undefined when it names no live process. @param {string} file */
const holder = file => {
  let text = '';
  try { text = readFileSync(file, 'utf8'); } catch { return undefined; }
  const pid = Number(JSON.parse(text === '' ? '{}' : text).pid);
  return Number.isSafeInteger(pid) && pid > 0 && alive(pid) ? pid : undefined;
};

/** Create the lock file, or false when a live holder has it. A lock whose process is gone is taken over.
 * @param {string} file @param {string} body */
function lock(file, body) {
  for (let tries = 0; tries < 2; tries++) {
    try {
      const fd = openSync(file, 'wx', 0o600);
      try { writeSync(fd, body); } finally { closeSync(fd); }
      return true;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
      let live;
      try { live = holder(file); } catch { live = 1; } // half-written by a peer this instant: treat as held
      if (live !== undefined) return false;
      rmSync(file, { force: true });
    }
  }
  return false;
}

/**
 * The rig's base port for this run. An explicit `WS_RIG_PORTS` is returned as is (no lock, nothing probed: the caller named
 * it). Otherwise the first block in the pool whose lock this process takes and whose four ports bind on 127.0.0.1.
 * `release()` frees the lock; the process's exit frees it too.
 * @param {{ explicit?: string, locks?: string, first?: number, blocks?: number }} [options]
 * @returns {Promise<{ base: number, explicit: boolean, release: () => void }>}
 */
export async function reserveRigPorts({ explicit = process.env.WS_RIG_PORTS, locks = rigPortLocks(), first = RIG_PORT_FIRST, blocks = RIG_PORT_BLOCKS } = {}) {
  if (explicit !== undefined && explicit !== '') return { base: Number(explicit), explicit: true, release: () => undefined };
  mkdirSync(locks, { recursive: true, mode: 0o700 });
  const token = `${String(process.pid)}-${String(Date.now())}-${Math.random().toString(16).slice(2)}`;
  const body = JSON.stringify({ pid: process.pid, token, at: new Date().toISOString() });
  for (let index = 0; index < blocks; index++) {
    const base = first + index * 4, file = join(locks, `${String(base)}.lock`);
    if (!lock(file, body)) continue;
    let released = false;
    const release = () => {
      if (released) return;
      released = true; process.off('exit', release);
      try { if (JSON.parse(readFileSync(file, 'utf8')).token === token) rmSync(file, { force: true }); } catch { /* already gone */ }
    };
    process.on('exit', release);
    try { await freeFixturePorts([base, base + 1, base + 2, base + 3]); }
    catch { release(); continue; } // something outside the pool (an older cut's fixed rig) holds a port here
    let ours = false;
    try { ours = JSON.parse(readFileSync(file, 'utf8')).token === token; } catch { /* taken over meanwhile */ }
    if (!ours) { released = true; process.off('exit', release); continue; } // a peer reclaimed the same stale lock first
    return { base, explicit: false, release };
  }
  throw new Error(`No free rig port block: all ${String(blocks)} blocks from ${String(first)} are locked or in use (locks in ${locks}); name one with WS_RIG_PORTS`);
}

/** Loads one at a time: the module reads the environment while it evaluates, after `import()` has already yielded. */
let loading = Promise.resolve();
/** A fresh `online-rig.mjs` from `checkout` that reads its ports from `base`: the module reads WS_RIG_PORTS once when it
 * loads, so each base gets its own module instance, loads alone, and the environment is put back after.
 * @param {string} checkout @param {number} base */
export function importRigAt(checkout, base) {
  const url = pathToFileURL(join(checkout, 'src', 'scripts', 'online-rig.mjs'));
  url.searchParams.set('rig-ports', String(base));
  const load = loading.then(async () => {
    const before = process.env.WS_RIG_PORTS;
    process.env.WS_RIG_PORTS = String(base);
    try { return await import(url.href); }
    finally { if (before === undefined) delete process.env.WS_RIG_PORTS; else process.env.WS_RIG_PORTS = before; }
  });
  loading = load.then(() => undefined, () => undefined);
  return load;
}
