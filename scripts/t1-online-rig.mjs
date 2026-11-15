import { generateKeyPairSync, randomInt } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve as resolvePath } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

/** Reserve the rig's four loopback ports together, then hand them to its owners. */
async function ports() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const first = randomInt(20000, 55000), listeners = [];
    try {
      for (let offset = 0; offset < 4; offset++) {
        const server = createServer();
        listeners.push(server);
        await new Promise((resolve, reject) => { server.once('error', reject); server.listen(first + offset, '127.0.0.1', resolve); });
      }
      return first;
    } catch { /* Another lane owns a port: choose a fresh group. */ }
    finally { await Promise.all(listeners.map(server => new Promise(resolve => { server.close(() => resolve(undefined)); }))); }
  }
  throw new Error('No free loopback port group for the T1 rig');
}

/** Start the real signed Template server from the existing client build.
 * @param {string} dist @param {string} scratch */
export async function openT1OnlineRig(dist, scratch) {
  const first = await ports();
  process.env.WS_RIG_PORTS = String(first);
  const { openRig, RELEASE_PORT, WORLD_PORT } = await import('./online-rig.mjs');
  const work = resolvePath(scratch, 't1/online');
  mkdirSync(work, { recursive: true });
  const pair = generateKeyPairSync('ed25519');
  const key = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
  const keyFile = join(work, 'key.json');
  writeFileSync(keyFile, JSON.stringify({ public: key, private: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }) }), { mode: 0o600 });
  const rig = await openRig({ dist, work, keyFile, saves: 'memory', shard: '_template', workers: 1 });
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await fetch(`http://127.0.0.1:${String(WORLD_PORT)}/health`).then(response => response.ok).catch(() => false)) {
        return { base: rig.base, stamp: { release: `http://127.0.0.1:${String(RELEASE_PORT)}/release.json`, key }, close: rig.close };
      }
      await delay(100);
    }
    throw new Error('The Template memory server did not become healthy');
  } catch (error) { await rig.close(); throw error; }
}
