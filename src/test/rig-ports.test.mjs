// QA 11-25 row 130: v0.1.96's train held at local QA (EADDRINUSE 127.0.0.1:19479) because another lane's rig held the same
// fixed WS_RIG_PORTS block. A run with no WS_RIG_PORTS takes a free block under a lock; two QA-shaped rigs open at once.
import { afterAll, expect, test } from 'vitest';
import { generateKeyPairSync, verify } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { writeGridCollision } from '../cook/game/gridCollision.ts';
import { importRigAt, reserveRigPorts } from '../scripts/rig-ports.mjs';

const base = resolve('tmp/rig-ports');
mkdirSync(base, { recursive: true });
const root = mkdtempSync(join(base, 'run-'));
afterAll(() => { rmSync(root, { recursive: true, force: true }); });
/** A pool of its own, clear of the real one, so a lane's live rig never meets this test. */
const pool = { first: 31_476 + (process.pid % 200) * 40, blocks: 8 };

test('an explicit WS_RIG_PORTS is used as given, with no lock and no probe', async () => {
  const locks = join(root, 'explicit');
  const held = await reserveRigPorts({ explicit: '19476', locks });
  expect(held).toMatchObject({ base: 19476, explicit: true });
  held.release();
  expect(existsSync(locks)).toBe(false);
});

test('runs at once take different blocks; a held port or a live lock is passed over, a dead one is taken', async () => {
  const locks = join(root, 'pool');
  const [one, two] = await Promise.all([reserveRigPorts({ explicit: '', locks, ...pool }), reserveRigPorts({ explicit: '', locks, ...pool })]);
  expect(one.explicit).toBe(false);
  expect(new Set([one.base, two.base]).size).toBe(2);
  expect(readdirSync(locks).sort()).toEqual([`${String(one.base)}.lock`, `${String(two.base)}.lock`].sort());
  // a port in the next free block held outside the pool (an older cut's fixed rig): that block is skipped
  const next = Math.max(one.base, two.base) + 4, outside = createServer();
  await new Promise(done => { outside.listen(next + 3, '127.0.0.1', () => { done(undefined); }); });
  try {
    const three = await reserveRigPorts({ explicit: '', locks, ...pool });
    expect(three.base).toBe(next + 4);
    three.release();
  } finally { await new Promise(done => { outside.close(() => { done(undefined); }); }); }
  one.release(); two.release(); one.release();
  expect(readdirSync(locks)).toEqual([]);
  // a lock whose process is gone is taken over; one whose process lives is not
  writeFileSync(join(locks, `${String(pool.first)}.lock`), JSON.stringify({ pid: 2 ** 22 + 7, token: 'gone' }));
  writeFileSync(join(locks, `${String(pool.first + 4)}.lock`), JSON.stringify({ pid: process.ppid, token: 'live' }));
  const taken = await reserveRigPorts({ explicit: '', locks, ...pool });
  expect(taken.base).toBe(pool.first);
  taken.release();
  expect(readdirSync(locks)).toEqual([`${String(pool.first + 4)}.lock`]);
});

test('two QA-shaped rigs (PGlite, named ports) run at once on one machine, and both serve', async () => {
  const locks = join(root, 'rigs'), work = join(root, 'grid'), dist = join(root, 'dist'), keyFile = join(root, 'key.json'), build = 'r130000-fixture';
  const pair = generateKeyPairSync('ed25519');
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, 'version.json'), JSON.stringify({ build }));
  writeFileSync(join(dist, 'index.html'), 'owned preview');
  writeFileSync(keyFile, JSON.stringify({ public: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('hex'), private: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }) }), { mode: 0o600 });
  writeGridCollision(work, 'transport-fixture', [{ id: 'transport-road', mesh: { origin: { x: 0, z: 0 }, positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), indices: new Uint32Array([0, 1, 2]), colours: new Float32Array(9) }, duplicates: [], features: [] }]);
  const reservations = await Promise.all([0, 1].map(() => reserveRigPorts({ explicit: '', locks, ...pool })));
  const rigs = [];
  try {
    const modules = await Promise.all(reservations.map(held => importRigAt(resolve('.'), held.base)));
    expect(modules.map(module => module.RELEASE_PORT)).toEqual(reservations.map(held => held.base + 3));
    const starts = await Promise.allSettled(modules.map((module, index) => module.openRig({ dist, work: join(root, `rig-${String(index)}`), keyFile,
      pgBin: 'pglite:', isolated: true, gridRoot: work, shard: 'brasscap-mesa', workers: 1, channel: 'staging' })));
    for (const started of starts) if (started.status === 'fulfilled') rigs.push(started.value);
    expect(starts.filter(started => started.status === 'rejected').map(started => String(started.reason?.message))).toEqual([]);
    for (const [index, rig] of rigs.entries()) {
      const at = reservations[index].base;
      expect(rig.ports).toEqual({ database: at, world: at + 1, page: at + 2, release: at + 3 });
      expect((await fetch(`${rig.base}/version.json`).then(response => response.json())).build).toBe(build);
      expect((await fetch(`${rig.worldOrigin}/health`)).ok).toBe(true);
      const signed = await fetch(`${rig.releaseOrigin}/release.json`).then(response => response.json());
      expect(verify(null, Buffer.from(signed.body), pair.publicKey, Buffer.from(signed.signature, 'hex'))).toBe(true);
      expect(JSON.parse(signed.body).socket).toBe(`ws://127.0.0.1:${String(at + 1)}/`);
    }
  } finally {
    await Promise.allSettled(rigs.map(rig => rig.close()));
    for (const held of reservations) held.release();
  }
}, 240_000);
