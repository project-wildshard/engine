// Qyran in a room: the page's wind law on a body the world raises, on the shipped product. His own save joins a world's, and an older one loads.
// oxlint-disable-next-line import/no-nodejs-modules -- Rapier is a shipped binary.
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { expect, test } from 'vitest';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { serializeSimSnapshot, snapshotSimHostBytes } from '../src/shared/engine/sim/snapshot';
import { encounterRows } from '../src/shared/engine/sim/encounterRows';
import { actRoutes } from '../src/shared/engine/sim/actRoutes';
import { ELITE_MOMENTS, shardRows } from '../src/shared/engine/sim/shardRows';
import type { SimHost } from '../src/server/engine/sim';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { createTrustedHeadlessResident } from '../src/server/host/headlessRuntime';
import { builtProduct } from './fixtures/builtProduct';

const ADAPTER = 'nalati.patrol.wind';
async function nalati(snapshot?: string) {
  const directory = builtProduct('nalati-grasslands'), product = await loadHeadlessProduct(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing output');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  return createTrustedHeadlessResident({ product, shard: product.shardfile, assets, rapier: await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))) }, snapshot, { room: true });
}
const row = (host: SimHost) => {
  const read = encounterRows(host).get('encounter:qyran');
  if (read === undefined) throw new Error('No Qyran row');
  return read();
};
const body = (host: SimHost) => { const found = [...host.entities.values()].find(actor => actor.kind === 'eagle'); return found ?? null; };
const lead = (host: SimHost) => { const [first] = host.players.values(); if (first === undefined) throw new Error('No player'); return first; };
const stand = (host: SimHost, x: number, z: number): void => { const player = lead(host), at = new Vector3(x, host.groundHeightAt(x, z) + .1, z); player.position.copy(at); player.motor.resetAt(at); };
const storm = (host: SimHost): void => { actRoutes(host).climate?.({ op: 'force', name: 'storm', at: 0.1 }); };
const words = (host: SimHost): string[] => shardRows(host).calls.splice(0).map(call => call.name === 'elite.moment:qyran' ? `${call.name}.${ELITE_MOMENTS[call.args[0] ?? -1] ?? '?'}` : call.name);

test('he rides the wind over his rock, stoops, grounds, falls and stays fallen through a save', { timeout: 120_000 }, async () => {
  const live = await nalati(), { host } = live, heard = new Set<string>();
  try {
    expect(host.adapters.has(ADAPTER)).toBe(true);
    expect(row(host).state).toBe('absent');
    stand(host, 180, 40); storm(host);
    let i = 0; for (; i < 2400 && body(host) === null; i++) host.step();
    const eagle = body(host); if (eagle === null) throw new Error('No storm brought him');
    expect(eagle.variant).toBe('qyran'); expect(eagle.motor ?? null).toBeNull();
    for (i = 0; i < 300; i++) { host.step(); for (const name of words(host)) heard.add(name); }
    expect(eagle.position.y - host.groundHeightAt(eagle.position.x, eagle.position.z)).toBeGreaterThan(10);
    for (i = 0; i < 1800 && !heard.has('elite.wind:qyran'); i++) { host.step(); for (const name of words(host)) heard.add(name); stand(host, eagle.position.x + 30, eagle.position.z); }
    expect(heard).toContain('elite.wind:qyran');
    expect(row(host).state).toBe('engaged');
    let low = Infinity;
    for (i = 0; i < 900 && !heard.has('elite.moment:qyran.grounded'); i++) { host.step(); for (const name of words(host)) heard.add(name); low = Math.min(low, eagle.position.y - host.groundHeightAt(eagle.position.x, eagle.position.z)); if (i % 40 === 0) stand(host, eagle.position.x + 30, eagle.position.z); }
    expect(heard).toContain('elite.moment:qyran.cry'); expect(heard).toContain('elite.moment:qyran.grounded');
    expect(low).toBeLessThan(5);
    const held = serializeSimSnapshot(snapshotSimHostBytes(host));
    const back = await nalati(held);
    try {
      const again = body(back.host); expect(again?.entityId).toBe(eagle.entityId); expect(again?.position.y).toBeCloseTo(eagle.position.y, 3);
      for (i = 0; i < 30; i++) back.host.step();
      expect(row(back.host).state).toBe('engaged');
    } finally { back.dispose(); }
    // a player who stays put takes the stoop, and it throws them
    stand(host, eagle.position.x + 6, eagle.position.z); heard.clear();
    const hp = lead(host).health.attributes.health;
    for (i = 0; i < 1500 && lead(host).health.attributes.health === hp; i++) { host.step(); words(host); const { position } = lead(host); stand(host, position.x, position.z); }
    expect(lead(host).health.attributes.health).toBe(hp - 30);
    eagle.hp = 0; eagle.alive = false;
    for (i = 0; i < 30; i++) host.step();
    expect(row(host).state).toBe('dead');
    expect(eagle.position.y - host.groundHeightAt(eagle.position.x, eagle.position.z)).toBeLessThan(1);
    const orb = row(host).reward; if (orb === null || orb === undefined) throw new Error('He left no orb');
    expect(orb.y - host.groundHeightAt(orb.x, orb.z)).toBeLessThan(2); // not left in the sky he fell from
    stand(host, orb.x + .4, orb.z + .4); host.step(); actRoutes(host).claims.get('qyran.reward')?.(lead(host).id);
    expect(row(host).reward).toBeNull();
    const fallen = serializeSimSnapshot(snapshotSimHostBytes(host));
    const third = await nalati(fallen);
    try { expect(row(third.host).state).toBe('dead'); expect(row(third.host).sleep).toBeGreaterThan(0); for (i = 0; i < 30; i++) third.host.step(); expect(row(third.host).state).toBe('dead'); } finally { third.dispose(); }
  } finally { live.dispose(); }
});

test('in a room he deals with whoever is nearest, and his fight outlives their leaving', { timeout: 120_000 }, async () => {
  const live = await nalati(), { host } = live;
  try {
    stand(host, 180, 40); storm(host);
    for (let i = 0; i < 2400 && body(host) === null; i++) host.step();
    const eagle = body(host); if (eagle === null) throw new Error('No storm brought him');
    const far = lead(host), near = host.addPlayer('bot:2', { x: eagle.position.x + 6, y: host.groundHeightAt(eagle.position.x + 6, eagle.position.z) + .1, z: eagle.position.z });
    const hold = (player: typeof near, x: number, z: number): void => { const at = new Vector3(x, host.groundHeightAt(x, z) + .1, z); player.position.copy(at); player.motor.resetAt(at); };
    const hp = near.health.attributes.health, farHp = far.health.attributes.health;
    for (let i = 0; i < 2400 && near.health.attributes.health === hp; i++) { host.step(); words(host); hold(near, eagle.position.x + 6, eagle.position.z); hold(far, 180 + 60, 40); if (eagle.position.y - host.groundHeightAt(eagle.position.x, eagle.position.z) < 20) break; }
    const spot = near.position.clone();
    for (let i = 0; i < 600 && near.health.attributes.health === hp; i++) { host.step(); words(host); hold(near, spot.x, spot.z); hold(far, spot.x + 60, spot.z); }
    expect(near.health.attributes.health).toBe(hp - 30); expect(far.health.attributes.health).toBe(farHp);
    host.removePlayer(near.id);
    for (let i = 0; i < 120; i++) host.step();
    expect(row(host).state).toBe('engaged');
  } finally { live.dispose(); }
});
