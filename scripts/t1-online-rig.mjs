import { generateKeyPairSync, randomInt } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve as resolvePath } from 'node:path';
import { openChaosProxy } from './chaos-proxy-core.mjs';
import { setTimeout as delay } from 'node:timers/promises';

/** Reserve the rig's six loopback ports together, then hand them to its owners. */
async function ports() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const first = randomInt(20000, 55000), listeners = [];
    try {
      for (let offset = 0; offset < 6; offset++) {
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
  const pageOrigin = `http://127.0.0.1:${String(first + 4)}`;
  const rig = await openRig({ dist, work, keyFile, saves: 'memory', shard: '_template', workers: 1, socket: `ws://127.0.0.1:${String(first + 5)}/`, origins: [pageOrigin] });
  let proxy;
  try {
    proxy = await openChaosProxy({ work: join(work, 'proxy'), pageUpstream: rig.base, releaseUpstream: `http://127.0.0.1:${String(RELEASE_PORT)}`, worldUpstream: `http://127.0.0.1:${String(WORLD_PORT)}`, pagePort: first + 4, worldPort: first + 5 });
    const token = readFileSync(proxy.ready.tokenFile, 'utf8');
    const controlUrl = proxy.ready.controlUrl;
    /** @param {{scenario: string, rules: readonly import('./t1-online-rig.mjs').T1FaultRule[]}} [body] */
    const control = async body => {
      const response = await fetch(controlUrl, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (!response.ok) throw new Error('The T1 chaos control refused its request');
      return /** @type {{counters:{matches:Record<string,number>}}} */ (await response.json());
    };
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await fetch(`http://127.0.0.1:${String(WORLD_PORT)}/health`).then(response => response.ok).catch(() => false)) {
        return { base: pageOrigin, stamp: { release: `${pageOrigin}/__release.json`, key },
          arm: async (scenario, rules) => { await control({ scenario, rules }); },
          matches: async route => (await control()).counters.matches[route] ?? 0,
          close: async () => { await proxy.close(); await rig.close(); } };
      }
      await delay(100);
    }
    throw new Error('The Template memory server did not become healthy');
  } catch (error) { await proxy?.close(); await rig.close(); throw error; }
}
