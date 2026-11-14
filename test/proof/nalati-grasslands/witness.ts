import { originalNalatiPhysics } from '../../fixtures/nalati-physics-original';
import { loadHeadlessFolder } from '../../../src/server/host/headlessFolder';
// oxlint-disable-next-line import/no-nodejs-modules -- The renderer-denying native witness asserts the actual captured world.
import assert from 'node:assert/strict';
// oxlint-disable-next-line import/no-nodejs-modules -- Read the admitted in-repository native terrain and navmesh.
import { readFileSync } from 'node:fs';
import source from '../../fixtures/nalati-product-source';
import { nalatiNativeAssets } from './nativeAssets';
import { createSimHost, type SimHost } from '../../../src/server/engine/sim';
import { decodeSimSnapshot, serializeSimSnapshot, snapshotSimHostBytes, type SimSnapshot } from '../../../src/shared/engine/sim/snapshot';
import { restoreSimHost } from '../../../src/server/engine/sim/restore';
import { loadRapier } from '../../../src/shared/engine/physics/rapier';
import { createNativeBakeReader } from '@wildshard/engine/game/population/nativeBake';
import { prepareFolderPlan as prepareHeadlessRuntime } from '../../fixtures/headless-native';
import { nalatiTamingWitness } from './taming';
import { canonicalSimDigest, sameBytes } from '../../fake/simState';
import { leadCommands, leadPlayer } from '@wildshard/engine/sim/leadPlayer';

const physics:unknown=originalNalatiPhysics();
const nalatiBake=()=>createNativeBakeReader(physics,{label:'Nalati',resolution:256,size:500,parked:false,rig:'segments',provenance:'piece',shapes:[1,2,6,9]},{file:'data/physics-ground.bin',bytes:readFileSync('src/shards/nalati-grasslands/data/physics-ground.bin')},[0,1].map(index=>({file:`data/physics-colliders-${index}.bin`,bytes:readFileSync(`src/shards/nalati-grasslands/data/physics-colliders-${index}.bin`)}))).read();

/** Gaps are gameplay requirements, not exemptions; a boot/replay proof cannot certify the whole shard. */
export const NALATI_WITNESS_GAPS = ['qyran', 'qara-and-night-roster', 'golden-king', 'storm-titan', 'taming', 'sabre-and-held-heavy', 'quests-and-gameplay-ledger'] as const;

/** Execute the shipping native installer and restore its complete codec continuation without a browser shim. */
export async function nalatiNativeWitness(replay: boolean, gameplay = true): Promise<object> {
  assert.equal(typeof window, 'undefined'); assert.equal(typeof document, 'undefined');
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const assets = nalatiNativeAssets(source);
  const plan = await prepareHeadlessRuntime({ shard: source, assets, rapier, product: await loadHeadlessFolder('out/nalati-grasslands') });
  const ports = { ...plan.ports, rapier };
  const effects = { commands: () => [], emit: (): never => { throw new Error('Partial native witness must not fabricate ledger ingress'); } };
  const first = createSimHost(plan.level, ports); let restored: SimHost | undefined;
  const step = (host: SimHost): void => { host.step(leadCommands(host, { moveX: 0.3 * Math.sin(host.state.tick / 90), moveZ: -1, yaw: 0 })); };
  try {
    plan.install(first, { restoring: false, ...effects });
    assert.deepEqual([...first.entities.keys()], nalatiBake().actors.map(actor => actor.id));
    const colliders = first.physics.world.colliders.len(), basis = first.physics.snapshot(), startZ = leadPlayer(first).position.z;
    assert.ok(colliders >= nalatiBake().solids.length);
    for (let tick = 0; tick < 120; tick++) step(first);
    assert.ok(leadPlayer(first).position.z < startZ);
    assert.ok([...first.entities.values()].every(actor => [actor.position.x, actor.position.y, actor.position.z].every(Number.isFinite)));
    const checkpoint = snapshotSimHostBytes(first), checkpointHash = canonicalSimDigest(checkpoint);
    let suffixHash: string | undefined;
    if (replay) {
      const saved: SimSnapshot = decodeSimSnapshot(serializeSimSnapshot(checkpoint, basis), basis);
      const { physics: actualPhysics, ...actualState } = saved, { physics: expectedPhysics, ...expectedState } = checkpoint;
      assert.equal(sameBytes(actualPhysics, expectedPhysics), true, 'Codec must preserve every native byte');
      assert.deepEqual(actualState, expectedState, 'Codec must preserve every adapter');
      restored = restoreSimHost(plan.level, ports, saved, fresh => {
        if (ports.heightAt !== undefined) fresh.setHeightQuery(ports.heightAt);
        plan.install(fresh, { restoring: true, snapshot: saved, ...effects });
      });
      assert.equal(canonicalSimDigest(snapshotSimHostBytes(restored)), checkpointHash);
      for (let tick = 0; tick < 60; tick++) { step(first); step(restored); }
      suffixHash = canonicalSimDigest(snapshotSimHostBytes(first));
      assert.equal(canonicalSimDigest(snapshotSimHostBytes(restored)), suffixHash, 'Complete native suffix must match exactly');
    }
    const ticksExecuted = first.state.tick;
    if (!gameplay) return { scope: 'native-boot-codec-suffix', entry: 'data/headlessAssembly.json', compatible: false, missing: NALATI_WITNESS_GAPS,
      headless: { status: 'partial', stage: 'gameplay-coverage', nativeBoot: true, actors: 35, colliders, ticksExecuted, checkpointHash },
      replay: { status: 'partial', checkpointCaptured: true, codecByteExact: true, suffixTicksExecuted: 60, suffixHash, wholeShard: false } };
    if (plan.proveEntries === undefined) throw new Error('Native entry proof must be hosted');
    const entries = plan.proveEntries(first);
    assert.equal(entries.lanes, 92, 'Every native opening needs all 23 capsule lanes');
    assert.ok(entries.steps > 0);
    const taming = await nalatiTamingWitness(rapier, assets, replay);
    return { taming, entries, entry: 'data/headlessAssembly.json', compatible: false, missing: NALATI_WITNESS_GAPS,
      headless: { status: 'partial', stage: 'gameplay-coverage', nativeBoot: true, actors: 35, colliders, ticksExecuted, checkpointHash },
      ...(replay ? { replay: { status: 'partial', checkpointCaptured: true, codecByteExact: true, suffixTicksExecuted: 60, suffixHash, wholeShard: false } } : {}) };
  } finally {
    restored?.dispose(); first.dispose();
    assert.ok(Object.values(first.scope.census).every(count => count === 0));
    if (restored !== undefined) assert.ok(Object.values(restored.scope.census).every(count => count === 0));
  }
}

/** Execute the actual long taming replay independently of the boot, codec and 92 entry lanes. */
export async function nalatiTamingNativeWitness(): Promise<object> {
  assert.equal(typeof window, 'undefined'); assert.equal(typeof document, 'undefined');
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const assets = nalatiNativeAssets(source);
  return { compatible: false, taming: await nalatiTamingWitness(rapier, assets, true) };
}
