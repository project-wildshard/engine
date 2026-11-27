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
/** Separate from the rig pool and below the default ephemeral ranges on the CI hosts. */
const pool = { first: 21_476 + (process.pid % 200) * 40, blocks: 8 };

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
  try {
    expect(one.explicit).toBe(false);
    expect(new Set([one.base, two.base]).size).toBe(2);
    expect(readdirSync(locks).sort()).toEqual([`${String(one.base)}.lock`, `${String(two.base)}.lock`].sort());
  } finally { one.release(); two.release(); one.release(); }
  expect(readdirSync(locks)).toEqual([]);

  // Let the OS choose the busy port. No assertion depends on an adjacent block being free.
  const outside = createServer();
  await new Promise((done, reject) => { outside.once('error', reject); outside.listen(0, '127.0.0.1', () => { done(undefined); }); });
  try {
    const address = outside.address();
    if (address === null || typeof address === 'string') throw new Error('Expected a loopback port');
    await expect(reserveRigPorts({ explicit: '', locks, first: address.port - 3, blocks: 1 })).rejects.toThrow('No free rig port block');
    expect(readdirSync(locks)).toEqual([]);
  } finally { await new Promise(done => { outside.close(() => { done(undefined); }); }); }

  const deadLock = `${String(one.base)}.lock`, liveLock = `${String(two.base)}.lock`;
  writeFileSync(join(locks, deadLock), JSON.stringify({ pid: 2 ** 22 + 7, token: 'gone' }));
  writeFileSync(join(locks, liveLock), JSON.stringify({ pid: process.pid, token: 'live' }));
  await expect(reserveRigPorts({ explicit: '', locks, first: two.base, blocks: 1 })).rejects.toThrow('No free rig port block');
  const taken = await reserveRigPorts({ explicit: '', locks, first: one.base, blocks: 1 });
  taken.release();
  expect(taken.base).toBe(one.base);
  expect(readdirSync(locks)).toEqual([liveLock]);
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
