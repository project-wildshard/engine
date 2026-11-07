// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the actual native product, save wire and physics binary.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import * as v from 'valibot';
import { createSimHost, type SimHost, type SimValue } from '../src/server/engine/sim';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { restoreSimHost } from '../src/server/engine/sim/restore';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { builtProduct } from './fixtures/builtProduct';
import { installCableModes } from '../src/shared/engine/player/modes';
import { createNativeCombatFrame } from '../src/server/game/plugin/nativeItems';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { prepareProductPlan } from './fixtures/headless-native';
import { canonicalSimDigest } from './fake/simState';
import { leadCommands, leadPlayer } from '@wildshard/engine/sim/leadPlayer';

const Value: v.GenericSchema<SimValue> = v.lazy(() => v.union([v.null(), v.boolean(), v.number(), v.string(), v.array(Value), v.record(v.string(), Value)]));
const object = v.record(v.string(), v.unknown());
for (const [slug, prepare, step] of [['pine-hollow', prepareProductPlan, 'pine.elites'], ['nalati-grasslands', prepareProductPlan, 'nalati.elites']] as const) {
  test(`${slug}: encounter wire resumes fights and refuses malformed bindings quietly`, async () => {
    const directory = builtProduct(slug), product = await loadHeadlessProduct(directory), descriptor = outputDescriptor(product.shardfile);
    if (descriptor === undefined) throw new Error('Missing product inventory');
    const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
    const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
    const plan = await prepare({ shard: product.shardfile, assets, rapier, product }), ports = { ...plan.ports, rapier };
    const context = { combat: createNativeCombatFrame(), commands: () => [], emit: () => undefined }, host = createSimHost(plan.level, ports);
    let replay: SimHost | undefined;
    const advance = (h: SimHost): void => { h.step(leadCommands(h, { moveX: 0, moveZ: 0, yaw: 0 })); };
    try {
      installCableModes(host.scope, product.shardfile.modes?.traverse ?? [], host.flags).bindNative(host);
      plan.install(host, { restoring: false, ...context });
      // Exercise a real dusk pack and its six consecutive native identities.
      if (host.dayClock !== undefined) await host.dayClock.set(slug === 'pine-hollow' ? 0.9 : 20);
      const opponent = [...host.entities.values()].find(a => a.variant === (slug === 'pine-hollow' ? 'ghost' : 'aqbars'));
      if (opponent === undefined) throw new Error('Missing live elite');
      leadPlayer(host).position.copy(opponent.position); leadPlayer(host).position.x += 8;
      leadPlayer(host).motor.resetAt(leadPlayer(host).position); opponent.hp = opponent.maxHp * 0.4;
      for (let tick = 0; tick < 4; tick++) advance(host);
      const adapter = host.adapters.get(step); if (adapter === undefined) throw new Error('Missing encounter owner');
      const state = adapter.snapshot(), saved = v.parse(object, state);
      const restore = (value: unknown): void => { adapter.restore(v.parse(Value, value)); };
      const entries = v.parse(v.array(object), saved['entries']);
      expect(entries).toHaveLength(slug === 'pine-hollow' ? 4 : 3);
      expect(entries.some(row => row['state'] === 'engaged' && row['phase2'] === true)).toBe(true);
      if (slug === 'nalati-grasslands') expect(v.parse(object, saved['kokbori'])['pack']).not.toBeNull();
      const before = canonicalSimDigest(snapshotSimHost(host));
      const malformed = { ...v.parse(v.record(v.string(), v.unknown()), state), entries: [] };
      expect(() => { restore(malformed); }).toThrow();
      expect(canonicalSimDigest(snapshotSimHost(host))).toBe(before);
      if (slug === 'nalati-grasslands') {
        const keeper = v.parse(object, saved['argymaq']);
        expect(() => { restore({ ...saved, argymaq: { ...keeper, keeper: { invalid: true } } }); }).toThrow();
        expect(canonicalSimDigest(snapshotSimHost(host))).toBe(before);
        const pack = v.parse(object, saved['kokbori']);
        expect(() => { restore({ ...saved, kokbori: { ...pack, pack: 999 } }); }).toThrow();
      } else {
        const scripts = v.parse(v.array(object), saved['scripts']);
        const first = scripts[0]; if (first === undefined) throw new Error('Missing elite script');
        expect(() => { restore({ ...saved, scripts: [{ ...first, program: '{}' }, ...scripts.slice(1)] }); }).toThrow();
        expect(() => { restore({ ...saved, scripts: [{ ...first, phase2: true }, ...scripts.slice(1)] }); }).toThrow();
      }
      expect(canonicalSimDigest(snapshotSimHost(host))).toBe(before);
      const checkpoint = snapshotSimHost(host);
      replay = restoreSimHost(plan.level, ports, checkpoint, fresh => { installCableModes(fresh.scope, product.shardfile.modes?.traverse ?? [], fresh.flags).bindNative(fresh); if (ports.heightAt !== undefined) fresh.setHeightQuery(ports.heightAt); plan.install(fresh, { restoring: true, snapshot: checkpoint, ...context, combat: createNativeCombatFrame() }); });
      expect(canonicalSimDigest(snapshotSimHost(replay))).toBe(before);
      for (let tick = 0; tick < 90; tick++) { advance(host); advance(replay); }
      expect(canonicalSimDigest(snapshotSimHost(replay))).toBe(canonicalSimDigest(snapshotSimHost(host)));
    } finally { replay?.dispose(); host.dispose(); }
  }, 120_000);
}
