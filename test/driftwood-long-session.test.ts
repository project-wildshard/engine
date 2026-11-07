// oxlint-disable-next-line import/no-nodejs-modules -- The session runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Vector3 } from 'three';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { createTrustedHeadlessResident, type TrustedHeadlessResident } from '../src/server/host/headlessRuntime';
import { mixedPopulation } from '../src/server/game/population/mixedRoster';
import { serializeSimSnapshot, snapshotSimHost, snapshotSimHostBytes } from '../src/shared/engine/sim/snapshot';
import { canonicalSimDigest } from './fake/simState';
import { builtProduct } from './fixtures/builtProduct';

// A long session on Driftwood's shipped rows and real return delays, solo. The roster held 34 bodies and room for 221
// returns, and the 222nd threw about 43 minutes into a session that kept clearing the island.

const SLUG = 'driftwood-isle', STEP = 'driftwood.island', FULL = 255;

async function shipped(): Promise<(snapshot?: string) => Promise<TrustedHeadlessResident>> {
  const directory = builtProduct(SLUG), product = await loadHeadlessProduct(directory), shard = product.shardfile;
  const descriptor = outputDescriptor(shard);
  if (descriptor === undefined) throw new Error(`Missing admitted ${SLUG} output`);
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  return snapshot => createTrustedHeadlessResident({ shard, assets, rapier, product }, snapshot);
}
const clearIsland = (resident: TrustedHeadlessResident): void => {
  for (const body of mixedPopulation(resident.host, STEP).bodies()) {
    const actor = body.actor; if (actor === null || !actor.alive) continue;
    resident.host.combat.hit({ source: 'env', sourceTags: ['dmg.legacy', 'cover.checked'], target: actor.combatActor(),
      amount: actor.maxHp * 10, point: actor.position.clone(), dir: new Vector3(0, 0, 1) });
  }
};
const second = (resident: TrustedHeadlessResident): void => { for (let i = 0; i < 60; i++) resident.step([]); };

test('a session that keeps clearing Driftwood passes the roster bound, reuses dead slots and saves there', async () => {
  const open = await shipped(), live = await open(), population = mixedPopulation(live.host, STEP);
  let restored: TrustedHeadlessResident | undefined;
  try {
    const bodies = () => population.bodies();
    expect(bodies()).toHaveLength(34);
    let seconds = 0;
    for (; bodies().length < FULL; seconds++) { clearIsland(live); second(live); if (seconds > 3600) throw new Error('The roster never filled'); }
    const atBound = new Set(bodies().map(body => body.id));
    for (let i = 0; i < 1200; i++) { clearIsland(live); second(live); }
    expect(bodies()).toHaveLength(FULL);
    const fresh = bodies().filter(body => !atBound.has(body.id));
    // every return past the bound took a slot a dead body left, and stood up alive
    expect(fresh.length).toBeGreaterThan(20);
    expect(fresh.some(body => body.actor !== null)).toBe(true);
    expect(new Set(bodies().map(body => body.id)).size).toBe(FULL);

    const wire = serializeSimSnapshot(snapshotSimHostBytes(live.host));
    restored = await open(wire);
    expect(canonicalSimDigest(snapshotSimHost(restored.host))).toBe(canonicalSimDigest(snapshotSimHost(live.host)));
    for (let i = 0; i < 300; i++) { clearIsland(live); clearIsland(restored); second(live); second(restored); }
    expect(canonicalSimDigest(snapshotSimHost(restored.host))).toBe(canonicalSimDigest(snapshotSimHost(live.host)));
  } finally { live.dispose(); restored?.dispose(); }
}, 180_000);
