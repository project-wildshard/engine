// @vitest-environment node
// oxlint-disable-next-line import/no-nodejs-modules -- Read the same admitted product bytes for independent native workers.
import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { builtProduct } from './fixtures/builtProduct';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { productHeadlessSections } from '../src/shared/host/headlessSections';
import { HeadlessSimulation } from '../src/server/host/headless';
import { OBSERVATION_TICKS } from '../src/shared/host/headlessObservation';

it.each(['far-reach', 'sunscar-dunes'])('%s offline observation retains all ticks and the complete restored continuation', async slug => {
  const started = performance.now();
  const stage = (name: string): void => { console.info('native-observation-stage', JSON.stringify({ slug, name, milliseconds: performance.now() - started })); };
  const directory = builtProduct(slug), product = await loadHeadlessProduct(directory), shard = product.shardfile;
  const descriptor = outputDescriptor(shard);
  if (descriptor === undefined) throw new Error('Missing native product descriptor');
  const assets = new Map(await Promise.all(descriptor.index.files.map(async file =>
    [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(await readFile(`${directory}/${file.path}`))] as const)));
  const options = { deadline: 'advisory' as const, sections: productHeadlessSections(product) };
  stage('product-ready');
  const observed = await HeadlessSimulation.create(shard, assets, undefined, options);
  stage('observed-ready');
  const control = await HeadlessSimulation.create(shard, assets, undefined, options);
  stage('control-ready');
  try {
    const initial = observed.checkpoint;
    expect(initial?.snapshot).toBe(control.checkpoint?.snapshot);
    const report = await observed.observe();
    stage('observed-complete');
    let last = control.checkpoint;
    for (let tick = 0; tick < OBSERVATION_TICKS; tick++) {
      last = await control.step();
      const sample = report.samples[tick];
      expect(sample?.tick).toBe(last.tick);
      expect(sample?.scriptMicros).toBe(last.scriptMicros ?? 0);
      expect(sample?.fuelUsed).toBe(last.fuelUsed ?? 0);
      if ((tick + 1) % 60 === 0) stage(`reference-${tick + 1}`);
    }
    expect(report.commit).toEqual(last);
    expect(observed.checkpoint).toEqual(last);
    const restored = await HeadlessSimulation.create(shard, assets, report.commit.snapshot, options);
    stage('restored-ready');
    try {
      for (let tick = 0; tick < 10; tick++) expect(await restored.step()).toEqual(await control.step());
      stage('suffix-complete');
    } finally { await restored.dispose(); }
    await expect(observed.step()).rejects.toThrow('finished');
  } finally { await observed.dispose(); await control.dispose(); stage('disposed'); }
});
