// FM5b4, FM4 10b, mode 10 (meta MMO-FAILURE-MODES-PLAN): the rig's second build. One signed release flow serves two builds: the
// page's view of the release can run ahead of the world's (the plan's two signed views), the page origin serves a signed
// code-retention file, and `move` carries the world and the page origin from build A to build B (and back).
import { expect, test } from 'vitest';
import { generateKeyPairSync, verify } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { WebSocket } from 'ws';
import { writeGridCollision } from '../cook/game/gridCollision.ts';
import { readSignedCodeRetention } from '../client/host/online/codeRetention.ts';
import { openRig } from '../scripts/online-rig.mjs';

const root = resolve('tmp/opus-mfm3');
const A = 'abcdef1-mfm3a', B = 'abcdef1-mfm3b';

test('a second build: page view ahead of the world, signed retention, and a move there and back', async () => {
  const { work, dist, next, keyFile, pair, publicHex } = fixture();
  let rig;
  try {
    rig = await openRig({ port: 0, gridRoot: work, dist, nextDist: next, work: join(work, 'rig'), keyFile, saves: 'memory', shard: 'brasscap-mesa', workers: 1 });
    expect([rig.build, rig.nextBuild]).toEqual([A, B]);
    /** @param {string} path */
    const release = async path => {
      const signed = await fetch(`${rig.releaseOrigin}${path}`).then(response => response.json());
      expect(verify(null, Buffer.from(signed.body), pair.publicKey, Buffer.from(signed.signature, 'hex'))).toBe(true);
      return JSON.parse(signed.body);
    };
    expect((await release('/release.json')).engineBuild).toBe(A);
    expect((await release('/__release.json')).engineBuild).toBe(A);

    // the page's view moves on; the world's view (what the server polls) stays, so the world keeps running A
    rig.pageView(B);
    const server = await release('/release.json'), page = await release('/__release.json');
    expect([server.engineBuild, page.engineBuild]).toEqual([A, B]);
    expect(page.serial).toBe(server.serial);
    await new Promise(resolve => { setTimeout(resolve, 1500); });
    expect((await fetch(`${rig.worldOrigin}/health`)).ok).toBe(true);
    await discovery(rig.socket, rig.base);

    // no retention file is a legacy page: 404
    expect((await fetch(`${rig.base}/code-retention.json`)).status).toBe(404);
    const retireAt = Date.now() + 60_000;
    rig.retain({ keptBuilds: [B], retireAt });
    const text = await fetch(`${rig.base}/code-retention.json`).then(response => response.text());
    const metadata = await readSignedCodeRetention(text, publicHex, { channel: 'production', engineBuild: B });
    expect(metadata).toMatchObject({ purpose: 'code-retention', engineBuild: B, keptBuilds: [B], retireAt });
    // a release-build mismatch is refused by the page's own reader
    await expect(readSignedCodeRetention(text, publicHex, { channel: 'production', engineBuild: A })).rejects.toThrow(/differs/u);
    expect(() => { rig?.retain({ engineBuild: B, keptBuilds: [A] }); }).toThrow();
    rig.retain(null);
    expect((await fetch(`${rig.base}/code-retention.json`)).status).toBe(404);
    rig.retain({ keptBuilds: [B] });

    // the move: both views name B, the world drains and comes back on B, the page origin serves B
    let heardCountdown = false;
    const before = server.serial;
    await rig.move(next, { published: async () => { heardCountdown = (await release('/release.json')).engineBuild === B; } });
    expect(heardCountdown).toBe(true);
    const moved = await release('/release.json');
    expect(moved.serial).toBeGreaterThan(before);
    expect((await release('/__release.json')).engineBuild).toBe(B);
    expect((await fetch(`${rig.base}/version.json`).then(response => response.json())).build).toBe(B);
    expect((await fetch(`${rig.worldOrigin}/health`)).ok).toBe(true);
    await discovery(rig.socket, rig.base);
    // the retention file follows the page origin to the next build's folder
    expect((await fetch(`${rig.base}/code-retention.json`)).status).toBe(200);

    // and back, so later cases start on A again
    await rig.move(dist);
    expect((await release('/release.json')).engineBuild).toBe(A);
    expect((await fetch(`${rig.base}/version.json`).then(response => response.json())).build).toBe(A);
    await discovery(rig.socket, rig.base);
    await rig.close();
    // the rig leaves no retention file in either fixture build
    expect([existsSync(join(dist, 'code-retention.json')), existsSync(join(next, 'code-retention.json'))]).toEqual([false, false]);
  } finally { await rig?.close(); rmSync(work, { recursive: true, force: true }); }
}, 240_000);

test('a rig without a second build refuses to move', async () => {
  const { work, dist, keyFile } = fixture();
  let rig;
  try {
    rig = await openRig({ port: 0, gridRoot: work, dist, work: join(work, 'rig'), keyFile, saves: 'memory', shard: 'brasscap-mesa', workers: 1 });
    await expect(rig.move(join(work, 'nowhere'))).rejects.toThrow(/second build/u);
  } finally { await rig?.close(); rmSync(work, { recursive: true, force: true }); }
}, 120_000);

/** @param {string} url @param {string} origin */
async function discovery(url, origin) {
  const socket = new WebSocket(url, { origin });
  try {
    const word = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error('Owned world sent no discovery')); }, 10_000);
      socket.once('message', bytes => { clearTimeout(timer); resolve(bytes); });
      socket.once('error', error => { clearTimeout(timer); reject(error); });
    });
    expect(/** @type {Buffer} */ (word)[0]).toBe(9);
  } finally { socket.terminate(); }
}

function fixture() {
  mkdirSync(root, { recursive: true });
  const work = mkdtempSync(join(root, 'rig-next-'));
  const pair = generateKeyPairSync('ed25519'), dist = join(work, 'dist'), next = join(work, 'next'), keyFile = join(work, 'key.json');
  for (const [folder, build] of [[dist, A], [next, B]]) {
    mkdirSync(folder);
    writeFileSync(join(folder, 'version.json'), JSON.stringify({ build }));
    writeFileSync(join(folder, 'index.html'), `owned preview ${build}`);
  }
  const publicHex = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
  writeFileSync(keyFile, JSON.stringify({ public: publicHex, private: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }) }), { mode: 0o600 });
  writeGridCollision(work, 'transport-fixture', [{ id: 'transport-road', mesh: { origin: { x: 0, z: 0 }, positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), indices: new Uint32Array([0, 1, 2]), colours: new Float32Array(9) }, duplicates: [], features: [] }]);
  return { work, dist, next, keyFile, pair, publicHex };
}
