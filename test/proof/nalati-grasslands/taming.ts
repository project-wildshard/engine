import { originalNalatiPhysics } from '../../fixtures/nalati-physics-original';
// oxlint-disable-next-line import/no-nodejs-modules -- read the original native proof input without inferring its full generated JSON type
import {readFileSync} from 'node:fs';
import * as v from 'valibot';
import { loadHeadlessProduct } from '../../../src/server/host/headlessProduct';
// oxlint-disable-next-line import/no-nodejs-modules -- The witness refuses incomplete native gameplay rather than report a passing flag.
import assert from 'node:assert/strict';
import type { SimHost } from '../../../src/server/engine/sim';
import { snapshotSimHostBytes, serializeSimSnapshot } from '../../../src/shared/engine/sim/snapshot';
import type { Rapier } from '../../../src/shared/engine/physics/rapier';
import { createNativeProofResident, prepareProductPlan as prepareHeadlessRuntime } from '../../fixtures/headless-native';
import {createNalatiTamingPilot} from './tamingPilot';
import source from '../../fixtures/nalati-product-source';
import { createNativeBakeReader } from '@wildshard/engine/game/population/nativeBake';
import { nativeTamingOf } from '@wildshard/engine/game/riding/nativeTaming';
import { mountedPlayerOf } from '@wildshard/engine/game/riding/native';
import { canonicalSimDigest } from '../../fake/simState';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

const physics=(()=>{
 const rows:unknown=originalNalatiPhysics();
 const finite=v.pipe(v.number(),v.finite());
 v.assert(v.object({spawns:v.array(v.object({id:v.string(),at:v.pipe(v.array(finite),v.length(3))}))}),rows);return rows;
})();

const nalatiBake=()=>createNativeBakeReader(physics,{label:'Nalati',resolution:256,size:500,parked:false,rig:'segments',provenance:'piece',shapes:[1,2,6,9]},{file:'data/physics-ground.bin',bytes:readFileSync('src/shards/nalati-grasslands/data/physics-ground.bin')},[0,1].map(index=>({file:`data/physics-colliders-${index}.bin`,bytes:readFileSync(`src/shards/nalati-grasslands/data/physics-colliders-${index}.bin`)}))).read();

function law(host: SimHost) {
  const value = nativeTamingOf(host); if (value === undefined) throw new Error('Missing native taming owner'); return value;
}

/** One actual native journey from a documented fixture spawn beside the authored stallion, plus one mid-round checkpoint.
 * This certifies the ordinary living stallion, not the unplayed Argymaq encounter, companion laws or quest facts.
 */
export async function nalatiTamingWitness(rapier: Rapier, assets: ReadonlyMap<string, Uint8Array>, replay: boolean): Promise<object> {
  const actor = nalatiBake().actors.find(a => a.kind === 'horse' && a.variant === 'stallion');
  if (actor === undefined) throw new Error('Missing authored wild stallion');
  const spawn = physics.spawns.find(a => a.id === actor.id);
  if (spawn === undefined) throw new Error('Missing authored wild stallion placement');
  const [spawnX, , spawnZ] = spawn.at;
  if (spawnX === undefined || spawnZ === undefined) throw new Error('Missing authored wild stallion coordinates');
  const product = await loadHeadlessProduct('out/nalati-grasslands');
  const originalPlan = await prepareHeadlessRuntime({ shard: source, assets, rapier, product });
  const heightAt = originalPlan.ports?.heightAt; if (heightAt === undefined) throw new Error('Missing actual terrain');
  // Declared assembly reads the product's shardfile, including its spawn.
  // Keep every shipped section/blob; replace only this documented fixture start.
  const x = spawnX + 2, z = spawnZ, fixture = { ...product.shardfile, spawn: { x, y: heightAt(x, z) + 0.1, z, yaw: 0 } };
  const preparation = { shard: fixture, assets, rapier, product: { ...product, shardfile: fixture } }, entry = prepareHeadlessRuntime;
  const first = await createNativeProofResident(preparation, entry);
  let restored: Awaited<ReturnType<typeof createNativeProofResident>> | undefined;
  try {
    assert.equal(leadPlayer(first.host).position.x, x, 'Fixture must start beside the authored living stallion');
    assert.equal(leadPlayer(first.host).position.z, z, 'Fixture must start beside the authored living stallion');
    const original = first.host.entities.get(actor.id); if (original === undefined) throw new Error('Missing native authored stallion');
    const pilot = createNalatiTamingPilot();
    let breakingTicks = 0, prompt = false, checkpointTick = 0;
    for (let tick = 0; tick < 40_000 && law(first.host).phase !== 'bonded'; tick++) {
      const taming = law(first.host), commands = pilot(first.host, actor.id);
      prompt ||= taming.interactable.radius > 0;
      if (taming.phase === 'breaking') breakingTicks++;
      first.step(commands); restored?.step(commands);
      if (replay && restored === undefined && taming.phase === 'breaking' && breakingTicks === 250) {
        const snapshot = snapshotSimHostBytes(first.host), wire = serializeSimSnapshot(snapshot); checkpointTick = first.host.state.tick;
        restored = await createNativeProofResident(preparation, entry, wire);
        assert.equal(canonicalSimDigest(snapshotSimHostBytes(restored.host)), canonicalSimDigest(snapshot), 'Mid-round reinstall must be quiet and exact');
      }
      assert.deepEqual(first.effects, [], 'Taming must not invent quest facts');
    }
    const taming = law(first.host), mounted = mountedPlayerOf(first.host);
    assert.equal(prompt, true); assert.ok(breakingTicks > 0);
    assert.equal(taming.phase, 'bonded', JSON.stringify({ breakingTicks, checkpointTick, law: taming.snapshot() }));
    assert.equal(taming.companion?.variant, 'tulpar'); assert.equal(mounted?.horse, taming.companion);
    assert.equal(original.alive, true); assert.equal(first.host.entities.get(original.entityId), original);
    assert.equal(original.position.y, -1e4); assert.equal(original.motor, null);
    if (replay) {
      assert.ok(restored !== undefined);
      assert.equal(canonicalSimDigest(snapshotSimHostBytes(restored.host)), canonicalSimDigest(snapshotSimHostBytes(first.host)), 'The whole remaining bucking suffix must stay exact through adoption');
    }
    return { status: 'partial', fixture: 'one spawn beside the authored living stallion; no later placement or trust writes',
      livePrompt: prompt, rounds: 5, ticksExecuted: first.host.state.tick, originalHiddenAlive: true, tulparAdopted: true,
      ...(replay ? { checkpointTick, suffixExact: true } : {}),
      open: ['actual Argymaq breaking encounter', 'companion whistle/resting and global quest prompt ownership', 'taming quest/ledger facts'] };
  } finally { restored?.dispose(); first.dispose(); }
}
