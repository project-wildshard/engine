import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { rigFront } from './rig-listeners.mjs';
import { openChaosProxy } from './chaos-proxy-core.mjs';
import { setTimeout as delay } from 'node:timers/promises';

/** Start the real signed Brasscap server from the existing client build.
 * @param {string} dist @param {string} scratch @param {{gridRoot?: string}} [options] */
export async function openT1OnlineRig(dist, scratch, { gridRoot } = {}) {
  const { openRig } = await import('./online-rig.mjs');
  const work = resolvePath(scratch, 't1/online');
  // The rig claims fresh folders. A worker Playwright restarts after a failed test reopens this group's rig over the last
  // one's, so the group's own scratch starts empty (every rig in it has closed with its worker).
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const pair = generateKeyPairSync('ed25519');
  const key = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
  const keyFile = join(work, 'key.json');
  writeFileSync(keyFile, JSON.stringify({ public: key, private: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }) }), { mode: 0o600 });
  const page = await rigFront(), pageOrigin = `http://127.0.0.1:${String(page.port)}`;
  let proxy, rig, world;
  const close = async () => {
    const results = await Promise.allSettled([page.close(), world?.close(), proxy?.close(), rig?.close()]);
    const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
    if (errors.length > 0) throw new AggregateError(errors, 'T1 rig cleanup failed');
  };
  try {
    // Sign the final public socket on the initial release. Publishing a new
    // serial merely to discover a proxy port would drain this same world.
    world = await rigFront();
    rig = await openRig({ port: 0, socket: `ws://127.0.0.1:${String(world.port)}/`, dist, work: join(work, 'rig'), keyFile, saves: 'memory', shard: 'brasscap-mesa', workers: 1, gridRoot, origins: [pageOrigin] });
    // A deployed page carries its signed /code-retention.json (page-release signs it); without one the page's read is a
    // console 404, which every T1 online test counts as an error. Serve the deploy's file: the current build kept.
    // Only a build named by its source commit has a retention list to sign; a named fixture build (the rig tests') has none.
    if (/^[0-9a-f]{7,40}(?:-[a-z0-9]+)?$/u.test(rig.build)) rig.retain({ keptBuilds: [rig.build] });
    proxy = await openChaosProxy({ work: join(work, 'proxy'), pageUpstream: rig.base, releaseUpstream: rig.releaseOrigin, worldUpstream: rig.worldOrigin, pagePort: 0, worldPort: 0 });
    page.point(Number(new URL(proxy.ready.pageOrigin).port));
    world.point(Number(new URL(proxy.ready.worldOrigin).port));
    const token = readFileSync(proxy.ready.tokenFile, 'utf8');
    const controlUrl = proxy.ready.controlUrl;
    /** @param {{scenario: string, rules: readonly import('./t1-online-rig.mjs').T1FaultRule[]}} [body] */
    const control = async body => {
      const response = await fetch(controlUrl, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (!response.ok) throw new Error('The T1 chaos control refused its request');
      return /** @type {{counters:{matches:Record<string,number>}}} */ (await response.json());
    };
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await fetch(`${rig.worldOrigin}/health`).then(response => response.ok).catch(() => false)) {
        return { base: pageOrigin, stamp: { release: `${pageOrigin}/__release.json`, key },
          arm: async (scenario, rules) => { await control({ scenario, rules }); },
          matches: async route => (await control()).counters.matches[route] ?? 0,
          close };
      }
      await delay(100);
    }
    throw new Error('The Brasscap memory server did not become healthy');
  } catch (error) {
    try { await close(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'T1 rig setup and cleanup failed', { cause: cleanup }); }
    throw error;
  }
}
