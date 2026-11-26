import { expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { generateKeyPairSync, verify } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { WebSocket } from 'ws';
import { writeGridCollision } from '../cook/game/gridCollision.ts';
import { openT1OnlineRig } from '../scripts/t1-online-rig.mjs';
import { openRig } from '../scripts/online-rig.mjs';

const root = resolve('tmp/codex-pagesize');
const fixtureBuild = 'd520000-fixture';

test('memory/T1 rigs own actual HTTP/WS endpoints across replacement and cleanup', async () => {
  const { work, dist, keyFile, pair } = fixture(), rigs = [];
  try {
    const starts = await Promise.allSettled([0, 1].map(index => openRig({ port: 0, gridRoot: work, dist, work: join(work, `rig-${index}`), keyFile, saves: 'memory', shard: 'brasscap-mesa', workers: 1 })));
    for (const started of starts) if (started.status === 'fulfilled') rigs.push(started.value);
    expect(starts.filter(started => started.status === 'rejected').map(started => started.reason.message)).toEqual([]);
    const ports = rigs.flatMap(rig => Object.values(rig.ports));
    expect(ports.every(port => Number.isInteger(port) && port > 0)).toBe(true);
    expect(new Set(ports).size).toBe(ports.length);
    for (const rig of rigs) {
      expect((await fetch(`${rig.base}/version.json`).then(response => response.json())).build).toBe(fixtureBuild);
      expect((await fetch(`${rig.worldOrigin}/health`)).ok).toBe(true);
      const signed = await fetch(`${rig.releaseOrigin}/release.json`).then(response => response.json());
      expect(verify(null, Buffer.from(signed.body), pair.publicKey, Buffer.from(signed.signature, 'hex'))).toBe(true);
      expect(JSON.parse(signed.body).socket).toBe(rig.socket);
      await discovery(rig.socket, rig.base);
    }
    const t1 = await openT1OnlineRig(dist, join(work, 't1-native'), { gridRoot: work });
    try {
      const signed = await fetch(t1.stamp.release).then(response => response.json());
      const body = JSON.parse(signed.body);
      expect(new URL(t1.base).port).not.toBe('0');
      await discovery(body.socket, t1.base);
      await t1.arm('native-forward', []);
      // A release change must not drain the shared worker after its six-second grace.
      await new Promise(resolve => { setTimeout(resolve, 8000); });
      await discovery(body.socket, t1.base);
    } finally { await t1.close(); }
    const rig = rigs[0], before = { ...rig.ports };
    await rig.stop(); await rig.start(); await rig.pagesServe(dist);
    expect(rig.ports).toEqual(before);
    expect((await fetch(`${rig.worldOrigin}/health`)).ok).toBe(true);
    expect((await fetch(`${rig.base}/version.json`)).ok).toBe(true);
    await rig.close();
    await expect(fetch(rig.base)).rejects.toThrow();
    await expect(fetch(rig.worldOrigin)).rejects.toThrow();
    expect((await fetch(`${rigs[1].worldOrigin}/health`)).ok).toBe(true);
  } finally { await Promise.all(rigs.map(rig => rig.close())); rmSync(work, { recursive: true, force: true }); }
}, 180_000);

async function discovery(url, origin) {
  const socket = new WebSocket(url, { origin });
  try {
    const word = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error('Owned world sent no discovery')); }, 10_000);
      socket.once('message', bytes => { clearTimeout(timer); resolve(bytes); });
      socket.once('error', error => { clearTimeout(timer); reject(error); });
    });
    expect(word[0]).toBe(9);
  } finally { socket.terminate(); }
}

function nativeBin() {
  let bin = process.env.FAILMODE_PG_BIN;
  if (bin === undefined) try { bin = execFileSync('pg_config', ['--bindir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* Inspect installed server versions below. */ }
  if (bin !== undefined && existsSync(join(bin, 'postgres'))) return bin;
  if (existsSync('/usr/lib/postgresql')) for (const version of readdirSync('/usr/lib/postgresql').sort().reverse()) {
    const installed = join('/usr/lib/postgresql', version, 'bin');
    if (existsSync(join(installed, 'postgres'))) return installed;
  }
  return undefined;
}

function fixture() {
  mkdirSync(root, { recursive: true });
  const work = mkdtempSync(join(root, 'rig-zero-'));
  const pair = generateKeyPairSync('ed25519'), dist = join(work, 'dist'), keyFile = join(work, 'key.json');
  mkdirSync(dist);
  writeFileSync(join(dist, 'version.json'), JSON.stringify({ build: fixtureBuild }));
  writeFileSync(join(dist, 'index.html'), 'owned preview');
  writeFileSync(keyFile, JSON.stringify({ public: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('hex'), private: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }) }), { mode: 0o600 });
  writeGridCollision(work, 'transport-fixture', [{ id: 'transport-road', mesh: { origin: { x: 0, z: 0 }, positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), indices: new Uint32Array([0, 1, 2]), colours: new Float32Array(9) }, duplicates: [], features: [] }]);
  return { work, dist, keyFile, pair };
}

const bin = nativeBin();
test.runIf(bin !== undefined || process.env.CI !== undefined || process.env.FAILMODE_PG_BIN !== undefined)('native PostgreSQL uses an owned OS-assigned TCP endpoint and survives world restart', async () => {
  if (bin === undefined) throw new Error('Native CI qualification requires PostgreSQL server binaries (FAILMODE_PG_BIN)');
  const { work, dist, keyFile } = fixture();
  let native;
  try {
    native = await openRig({ port: 0, gridRoot: work, dist, work: join(work, 'native-rig'), keyFile, pgBin: bin, pgData: join(work, 'native-data'), shard: 'brasscap-mesa', workers: 1 });
    expect(new Set(Object.values(native.ports)).size).toBe(4);
    const client = new native.Client({ connectionString: native.DATABASE });
    try {
      await client.connect();
      expect((await client.query("select current_setting('data_directory') as data")).rows[0].data).toBe(join(work, 'native-data'));
      await client.query('create table ds20_owned (value integer)');
      await client.query('insert into ds20_owned values (27)');
      await native.stop(); await native.start();
      expect((await client.query('select value from ds20_owned')).rows).toEqual([{ value: 27 }]);
      expect((await fetch(`${native.worldOrigin}/health`)).ok).toBe(true);
    } finally { await client.end(); }
    await native.close();
    expect(existsSync(join(work, 'native-data', 'postmaster.pid'))).toBe(false);
  } finally { await native?.close(); rmSync(work, { recursive: true, force: true }); }
}, 120_000);
