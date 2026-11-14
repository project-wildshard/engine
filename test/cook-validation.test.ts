// oxlint-disable-next-line import/no-nodejs-modules -- The proof reads the shipped product, not an injected world.
import {readFile} from 'node:fs/promises';
import {expect, test} from 'vitest';
import {loadHeadlessFolder} from '../src/server/host/headlessFolder';
import {HeadlessSimulation} from '../src/server/host/headless';
import {outputDescriptor} from '../src/shared/game/shardfile/outputDescriptor';
import {folderHeadlessSections} from '../src/shared/host/headlessSections';
import {OBSERVATION_TICKS} from '../src/shared/host/headlessObservation';
import {builtFolder} from './fixtures/engine-lift/folder';

// Ring 2: independently publishing all 240 complete reference checkpoints can
// exceed ten seconds under load. Keep every tick, metadata check and entry walk.
test('cook validation retains every tick and the same real entry proof', {timeout: 30_000}, async () => {
  const product = await loadHeadlessFolder(builtFolder('sunscar-dunes')), shard = product.shardfile;
  const descriptor = outputDescriptor(shard);
  if (descriptor === undefined) throw new Error('Missing admitted cook proof product');
  const directory = builtFolder('sunscar-dunes');
  const assets = new Map(await Promise.all(descriptor.index.files.map(async file =>
    [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(await readFile(`${directory}/${file.path}`))] as const)));
  const options = {deadline: 'advisory' as const, sections: folderHeadlessSections(product)};
  const control = await HeadlessSimulation.create(shard, assets, undefined, options);
  let candidate: HeadlessSimulation | undefined;
  try {
    candidate = await HeadlessSimulation.create(shard, assets, undefined, options);
    expect(candidate.checkpoint).toEqual(control.checkpoint);
    const {observation, proof} = await candidate.validate();
    expect(observation.samples).toHaveLength(OBSERVATION_TICKS);
    for (let tick = 0; tick < OBSERVATION_TICKS; tick++) {
      const commit = await control.step(), sample = observation.samples[tick];
      expect(sample?.tick).toBe(commit.tick);
      expect(sample?.fuelUsed).toBe(commit.fuelUsed ?? 0);
      expect(sample?.scriptMicros).toBe(commit.scriptMicros ?? 0);
    }
    expect(observation.commit).toEqual(control.checkpoint);
    expect(proof).toEqual(await control.finish());
    await expect(candidate.step()).rejects.toThrow('finished');
    await expect(candidate.finish()).rejects.toThrow('finished');
    await expect(candidate.observe()).rejects.toThrow('finished');
    await expect(candidate.validate()).rejects.toThrow('finished');
  } finally { await candidate?.dispose(); await control.dispose(); }
});
