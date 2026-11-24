import { PackBrain, type PackPrey } from '@wildshard/engine/ai/pack';
import { Rng } from '@wildshard/format/seededRng';
import { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import type { SimHost } from '@wildshard/engine/sim';
import { nativeGroupBrain } from '@wildshard/format/groupBrains';
import { NativeGroupCollection } from '@wildshard/engine/game/shardfile/groupRuntime';
import {parse,object,record,string,unknown} from 'valibot';
import {liveJson} from './livePin';
// ZONE-SNAPSHOTS ZS9 (J507): Nalati r8's live wolf pack group (actors/wildlife.json); the fixture names its own home and members.
const brains=parse(object({groups:object({pack:record(string(),unknown())})}),liveJson('nalati-grasslands','actors/wildlife.json')).groups;
import { SIM_LEVEL } from './sim-level/level';

/** A real group owner that never acts, for a riding fixture: no host entity, random stream or step participant. */
export function dormantHerd(host: SimHost, id: string): NativeGroupCollection {
  const spec = nativeGroupBrain({ ...brains.pack, id: 'fixture.pack', home: [0, 0], members: ['fixture.actor'] });
  if (spec.kind !== 'pack') throw new Error('Missing dormant fixture pack');
  const sample = SIM_LEVEL.entities[0];
  if (sample === undefined) throw new Error('Missing dormant group member');
  const actor = new AnimalSim(sample.spec, sample.seed, sample.scale, 'fixture.group.actor', { heightAt: () => 0, random: () => .5, now: () => 0 });
  const random = new Rng(17), pack = new PackBrain<AnimalSim>([actor], 0, 0, spec, {
    sharedRng: () => random, environment: () => ({ playerFwdX: 0, playerFwdZ: -1, playerMounted: false, playerHealth01: 1, grassHeightAt: () => 0 }),
    visibility: () => 1, hearing: () => 10, downwind: () => false, inBounds: () => true, normalY: () => 1, register: () => undefined, bite: () => undefined,
  });
  return new NativeGroupCollection(host, [pack], [], new Map<string, AnimalSim>(), new Map<string, PackPrey>(), new WeakMap<PackPrey, string>(), [],
    new WeakMap<AnimalSim, PackBrain<AnimalSim>>(), { id: `fixture:${id}`, herds: id, firstRaid: 0 });
}
