// oxlint-disable-next-line import/no-nodejs-modules -- The native proof reads the official immutable product.
import { readFileSync } from 'node:fs';
import * as v from 'valibot';
import { expect, test } from 'vitest';
import { builtFolder } from '../src/test/game/builtFolder';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { createNativeHeadlessResident } from '../src/server/host/headlessRuntime';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

// Since Sky r7 (OF20c) the Roc is a declared boss encounter (`far.roc.fight`) whose decision row (`far.roc.decision`) moves
// and strikes its body; the fight's phase and the decision's binding are the two saved slots that drive it.
const encounterSchema = v.object({ boss: v.object({ state: v.string(), phase: v.number() }) });
const decisionSchema = v.object({ decision: v.object({ tick: v.number(), bindings: v.array(v.object({ script: v.string(), slots: v.record(v.string(), v.union([v.number(), v.boolean()])), failures: v.number() })) }), phases: v.array(v.tuple([v.string(), v.number()])) });
test('the published Roc decision drives the declared native body through phases and logical restore', async () => {
  const directory = builtFolder('far-reach'), product = await loadHeadlessFolder(directory);
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const descriptor = outputDescriptor(product.shardfile); if (descriptor === undefined) throw new Error('Missing admitted output');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash,
    Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const preparation = { product, shard: product.shardfile, assets, rapier };
  const resident = await createNativeHeadlessResident(preparation);
  let resumed: Awaited<ReturnType<typeof createNativeHeadlessResident>> | undefined;
  const slot = (owner: typeof resident, id: string): unknown => {
    const state = snapshotSimHost(owner.host).adapters.find(row => row.id === id)?.state;
    if (state === undefined) throw new Error(`Roc must keep its ${id} save slot`);
    return typeof state === 'string' ? JSON.parse(state) as unknown : state;
  };
  const policy = (owner: typeof resident) => {
    const fight = v.parse(encounterSchema, slot(owner, 'encounter.far.roc.fight')).boss, decision = v.parse(decisionSchema, slot(owner, 'decision.declared'));
    const binding = decision.decision.bindings.find(row => row.script === 'far.roc.decision');
    if (binding === undefined) throw new Error('Roc must keep its decision binding');
    return { phase: fight.phase, fighting: fight.state === 'fight', failures: binding.failures, slots: binding.slots, phases: decision.phases };
  };
  try {
    const host = resident.host, body = host.entities.get('far.roc');
    if (body === undefined) throw new Error('Roc must use its admitted native body');
    host.events.answer('damage.modify', request => request?.target === leadPlayer(host).health ? null : request, host.scope);
    leadPlayer(host).position.set(0, 44.3, -184);
    for (let i = 0; i < 500; i++) resident.step([]);
    expect(host.entities.get('far.roc')).toBe(body); expect(policy(resident)).toMatchObject({ phase: 0, fighting: true, failures: 0 });
    for (const [hp, phase] of [[0.6, 1], [0.3, 2]] as const) {
      body.hp = body.maxHp * hp;
      for (let i = 0; i < 360; i++) resident.step([]);
      expect(host.entities.get('far.roc')).toBe(body);
      expect(policy(resident)).toMatchObject({ phase, fighting: true, failures: 0, phases: [['far.roc.fight', phase]] });
    }
    const saved = snapshotSimHost(host), before = policy(resident);
    resumed = await createNativeHeadlessResident(preparation, saved);
    expect(policy(resumed)).toEqual(before);
    expect(resumed.host.entities.size).toBe(host.entities.size);
    for (let i = 0; i < 30; i++) { resident.step([]); resumed.step([]); }
    expect(policy(resumed)).toEqual(policy(resident));
  } finally { resumed?.dispose(); resident.dispose(); }
}, 120_000);
