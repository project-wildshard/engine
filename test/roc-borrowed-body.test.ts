// oxlint-disable-next-line import/no-nodejs-modules -- The native proof reads the official immutable product.
import { readFileSync } from 'node:fs';
import * as v from 'valibot';
import { expect, test } from 'vitest';
import { builtFolder } from './fixtures/builtFolder';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { createTrustedHeadlessResident } from '../src/server/host/headlessRuntime';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

const policySchema = v.object({ phase: v.number(), fighting: v.boolean(), decision: v.string(), strike: v.object({ clock: v.number(), currentId: v.nullable(v.string()) }) });
const logicalSchema = v.object({ decision: v.object({ tick: v.number(), bindings: v.array(v.object({ slots: v.record(v.string(), v.union([v.number(), v.boolean()])), failures: v.number() })) }) });
test('the published Roc guest drives the retained native body through phases and logical restore', async () => {
  const directory = builtFolder('far-reach'), product = await loadHeadlessFolder(directory);
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const descriptor = outputDescriptor(product.shardfile); if (descriptor === undefined) throw new Error('Missing admitted output');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash,
    Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const preparation = { product, shard: product.shardfile, assets, rapier };
  const resident = await createTrustedHeadlessResident(preparation);
  let resumed: Awaited<ReturnType<typeof createTrustedHeadlessResident>> | undefined;
  const policy = (owner: typeof resident) => {
    const slot = snapshotSimHost(owner.host).adapters.find(row => row.id === 'far.flock');
    const keeper = v.parse(v.object({ homes: v.array(v.object({ id: v.string(), policy: v.nullable(v.string()) })) }), slot?.state);
    const saved = keeper.homes.find(row => row.id === 'far.roc')?.policy;
    if (saved === undefined || saved === null) throw new Error('Roc must retain its original policy save slot');
    const wire: unknown = JSON.parse(saved); if (typeof wire !== 'string') throw new Error('Roc logical policy must be a string');
    return v.parse(policySchema, JSON.parse(wire));
  };
  try {
    const host = resident.host, body = host.entities.get('far.roc');
    if (body === undefined) throw new Error('Roc must use its admitted native body');
    host.events.answer('damage.modify', request => request?.target === leadPlayer(host).health ? null : request, host.scope);
    leadPlayer(host).position.set(0, 44.3, -184);
    for (let i = 0; i < 500; i++) resident.step([]);
    expect(host.entities.get('far.roc')).toBe(body); expect(policy(resident)).toMatchObject({ phase: 0, fighting: true });
    expect(body.mem['rocLean']).toBe(0);
    expect(v.parse(logicalSchema, JSON.parse(policy(resident).decision)).decision.bindings[0]?.failures).toBe(0);
    for (const [hp, phase] of [[0.6, 1], [0.3, 2]] as const) {
      body.hp = body.maxHp * hp;
      for (let i = 0; i < 360; i++) resident.step([]);
      expect(host.entities.get('far.roc')).toBe(body); expect(policy(resident)).toMatchObject({ phase, fighting: true });
      const logical = v.parse(logicalSchema, JSON.parse(policy(resident).decision));
      expect(logical.decision.bindings[0]?.failures).toBe(0);
      expect(logical.decision.bindings[0]?.slots['step']).toBeGreaterThanOrEqual(phase * 10);
    }
    const saved = snapshotSimHost(host), before = policy(resident);
    resumed = await createTrustedHeadlessResident(preparation, saved);
    expect(policy(resumed)).toEqual(before);
    expect(resumed.host.entities.size).toBe(host.entities.size);
    for (let i = 0; i < 30; i++) { resident.step([]); resumed.step([]); }
    expect(policy(resumed)).toEqual(policy(resident));
  } finally { resumed?.dispose(); resident.dispose(); }
}, 120_000);
