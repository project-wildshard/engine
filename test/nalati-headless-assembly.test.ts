// oxlint-disable-next-line import/no-nodejs-modules -- Native regression reads the shipped physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import * as v from 'valibot';
import { nalatiNativeWitness, nalatiTamingNativeWitness } from './proof/nalati-grasslands/witness';
import source from './fixtures/nalati-product-source';
import { createSimHost, type SimHost } from '../src/server/engine/sim';
import { snapshotSimHostBytes, serializeSimSnapshot, decodeSimSnapshot } from '../src/shared/engine/sim/snapshot';
import { restoreSimHost } from '../src/server/engine/sim/restore';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { builtFolder } from './fixtures/builtFolder';
import { prepareFolderPlan as prepareHeadlessRuntime } from './fixtures/headless-native';
import { nalatiNativeAssets } from './proof/nalati-grasslands/nativeAssets';
import { canonicalSimDigest } from './fake/simState';
import { leadCommands } from '@wildshard/engine/sim/leadPlayer';

test('Nalati declared assembly retains its native 100 + 30 tick continuation', async () => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const plan = await prepareHeadlessRuntime({ shard: source, assets: nalatiNativeAssets(source), rapier, product: await loadHeadlessFolder(builtFolder('nalati-grasslands')) });
  const ports = { ...plan.ports, rapier }, effects = { commands: () => [], emit: () => undefined };
  const host = createSimHost(plan.level, ports);
  let restored: SimHost | undefined;
  const step = (value: SimHost): void => { value.step(leadCommands(value, { moveX: 0.3 * Math.sin(value.state.tick / 90), moveZ: -1, yaw: 0 })); };
  try {
    plan.install(host, { restoring: false, ...effects });
    for (let tick = 0; tick < 100; tick++) step(host);
    const saved = snapshotSimHostBytes(host);
    const decoded = decodeSimSnapshot(serializeSimSnapshot(saved));
    restored = restoreSimHost(plan.level, ports, decoded, fresh => { plan.install(fresh, { restoring: true, snapshot: decoded, ...effects }); });
    expect(canonicalSimDigest(snapshotSimHostBytes(restored))).toBe(canonicalSimDigest(saved));
    for (let tick = 0; tick < 30; tick++) { step(host); step(restored); }
    const continued = canonicalSimDigest(snapshotSimHostBytes(restored));
    expect(continued).toBe(canonicalSimDigest(snapshotSimHostBytes(host)));
  } finally {
    restored?.dispose(); host.dispose();
    expect(Object.values(host.scope.census).every(count => count === 0)).toBe(true);
    if (restored !== undefined) expect(Object.values(restored.scope.census).every(count => count === 0)).toBe(true);
  }
}, 120_000);


test('Nalati chapter landing retains native actor order, codec and strict suffix', async () => {
  const proof = v.parse(v.object({ replay: v.object({ codecByteExact: v.literal(true), suffixTicksExecuted: v.literal(60),
    checkpointCaptured: v.literal(true), suffixHash: v.string() }) }), await nalatiNativeWitness(true, false));
  expect(proof.replay.suffixHash).toMatch(/^[0-9a-f]{64}$/u);
}, 120_000);

test('Nalati chapter landing retains the native taming adoption suffix', async () => {
  const proof = v.parse(v.object({ taming: v.object({ suffixExact: v.literal(true), tulparAdopted: v.literal(true),
    originalHiddenAlive: v.literal(true), rounds: v.literal(5), ticksExecuted: v.number() }) }), await nalatiTamingNativeWitness());
  expect(proof.taming.ticksExecuted).toBeGreaterThan(0);
}, 450_000); // J112's walk and a second try take a slow CI runner past 300 s; the bound stops a hang and claims no speed
