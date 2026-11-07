// oxlint-disable-next-line import/no-nodejs-modules -- Read the same admitted products and native physics as the grid.
import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { snapshotSimHost, serializeSimSnapshot, decodeSimSnapshot } from '../src/shared/engine/sim/snapshot';
import { restoreSimHost } from '../src/server/engine/sim/restore';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { builtProduct } from './fixtures/builtProduct';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { createShardfileSim, bindShardfileSim, prepareShardfileSimRestore } from '../src/server/game/plugin/simulation';
import { createTrustedHeadlessResident, type PrepareHeadlessRuntime } from '../src/server/host/headlessRuntime';
import { hasDeclaredClientPage } from '@wildshard/format/runtimeBinds';
import { ScriptHost } from '../src/shared/engine/script/host';
import { productHeadlessSections } from '../src/shared/host/headlessSections';
import { createNativeProofResident, prepareProductPlan } from './fixtures/headless-native';
import { prepareHeadlessRuntime as ninePlan } from './fixtures/nine-headless';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

const shards = ['_template', 'blender-template', 'ink-cel-valley', 'pastel-plain', 'driftwood-isle', 'pine-hollow', 'nalati-grasslands',
  'nine-dragon-stack', 'sunscar-dunes', 'far-reach'] as const;
const directPlans = new Map<string, PrepareHeadlessRuntime>([['driftwood-isle', prepareProductPlan], ['pine-hollow', prepareProductPlan], ['nine-dragon-stack', ninePlan]]);

// G498: eviction, then return through the actual native installer/restore path.
// All ten live products are tested; sealed legacy products are never grid destinations.
// Renderer-owned kit parts have a separate mandatory quick check (Pine King).
for (const slug of shards) test(`${slug}: evict and re-enter with kit, held items and quest progress`, async () => {
  const directory = builtProduct(slug), product = await loadHeadlessProduct(directory), shard = product.shardfile;
  const descriptor = outputDescriptor(shard);
  if (descriptor === undefined) throw new Error('Missing admitted product inventory');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash,
    Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const trusted = product.has('sim/runtime-plan');
  const preparation = { shard, assets, rapier, product };
  const direct = trusted ? undefined : directPlans.get(slug);
  const sections = productHeadlessSections(product);
  const questPorts = { fact: () => undefined, coins: () => undefined };
  const first = direct !== undefined ? await createNativeProofResident(preparation, direct) : trusted ? await createTrustedHeadlessResident(preparation)
    : createShardfileSim(shard, assets, { rapier, sections, quest: questPorts });
  let saved;
  try {
    // Exercise actual authored progress and equipment ownership, not an empty save.
    for (const quest of first.host.quests) {
      for (const flag of quest.def.startWhen?.all ?? []) first.host.flags.set(flag);
      const start = quest.def.startWhen?.any?.[0]; if (start !== undefined) first.host.flags.set(start);
      const step = quest.def.steps[0];
      for (const flag of step?.done.none ?? []) first.host.flags.clear(flag);
      for (const flag of step?.done.all ?? []) first.host.flags.set(flag);
      const done = step?.done.any?.[0]; if (done !== undefined) first.host.flags.set(done);
    }
    for (const flag of shard.items.loadout.native?.ownership ?? []) if (flag !== null) first.host.flags.set(flag);
    // Select a non-default held slot through its actual registered continuation.
    for (const adapter of first.host.adapters.values()) {
      const state = adapter.snapshot();
      if (state !== null && typeof state === 'object' && !Array.isArray(state) && 'held' in state && 'swap' in state) {
        const slots = shard.items.loadout.native?.slots;
        const held = slots?.at(-1); if (held !== undefined) adapter.restore({ ...state, held, swap: null });
      }
    }
    saved = decodeSimSnapshot(serializeSimSnapshot(snapshotSimHost(first.host)));
  } finally { first.dispose(); }
  // Nothing from the old native world survives; a fresh installer must recreate
  // its full adapter kit before strict restore accepts the held/quest state.
  const again = direct !== undefined ? await createNativeProofResident(preparation, direct, saved) : trusted ? await createTrustedHeadlessResident(preparation, saved)
    : { host: restoreSimHost(first.host.level, { rapier }, saved,
      host => { bindShardfileSim(host, shard, assets, { rapier, sections, quest: questPorts, restoring: true }); }), dispose() { this.host.dispose(); } };
  try {
    const restored = snapshotSimHost(again.host);
    expect(restored.flags).toEqual(saved.flags);
    expect(restored.quests).toEqual(saved.quests);
    expect(restored.slots).toEqual(saved.slots);
    expect(restored.adapters).toEqual(saved.adapters);
    again.host.step();
    expect(again.host.state.tick).toBe(saved.state.tick + 1);
    for (const flag of saved.flags) expect(again.host.flags.has(flag)).toBe(true);
  } finally { again.dispose(); }
}, 30_000);


// DB1 exercises the actual generic grid data owner even when a product also has a headless-only plan.
test('generic grid data destinations restore exact modules with one installation',async()=>{
  const rapier=await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));let dataCells=0;
  const questPorts={fact:()=>undefined,coins:()=>undefined};
  for(const slug of shards){
    const directory=builtProduct(slug),product=await loadHeadlessProduct(directory),shard=product.shardfile;
    if(shard.runtime!==null||hasDeclaredClientPage(shard))continue;
    const descriptor=outputDescriptor(shard);if(descriptor===undefined)throw new Error('Missing admitted product inventory');
    const assets=new Map(descriptor.index.files.map(file=>[file.commons===true?`commons:${file.hash}`:file.hash,Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
    const sections=productHeadlessSections(product),install=vi.spyOn(ScriptHost.prototype,'install');
    const first=createShardfileSim(shard,assets,{rapier,sections,quest:questPorts});
    const installs=install.mock.calls.length;first.host.step();const saved=snapshotSimHost(first.host);first.dispose();install.mockClear();
    const prepared=prepareShardfileSimRestore(shard,assets,{rapier,sections,quest:questPorts,playerBody:false});
    try{
      expect(install).toHaveBeenCalledTimes(installs);prepared.restore(saved);expect(install).toHaveBeenCalledTimes(installs);
      expect(snapshotSimHost(prepared.host)).toEqual(saved);prepared.host.step();expect(prepared.host.state.tick).toBe(saved.state.tick+1);
      leadPlayer(prepared.host).detachMotor();expect(leadPlayer(prepared.host).hasMotor).toBe(false);dataCells++;
    }finally{prepared.host.dispose();install.mockRestore();}
  }
  expect(dataCells).toBeGreaterThan(0);
},30000);
