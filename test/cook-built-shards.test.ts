// oxlint-disable-next-line import/no-nodejs-modules -- Read the six actual pinned products by their folder.
import {join} from 'node:path';
import {beforeAll, describe, expect, it} from 'vitest';
import {productTarball} from '../src/cook/game/productTarball';
import {validateShardfileFolder} from '@wildshard/format/shardfileValidation';
import {prepareAssetDecoders} from '@wildshard/format/shardfileAssets';
import {readTar} from '@wildshard/format/tar';
import {checkShardfile} from '../src/server/host/checkShardfile';
import {hashOf} from './fixtures/cookWorkerHarness';

beforeAll(prepareAssetDecoders);

/** SP19b: actual pinned bytes and the shared full check used by the cook. */
describe('the six built shards through the full check gate', () => {
  it.each(['sunscar-dunes', 'driftwood-isle', 'pine-hollow', 'nalati-grasslands', 'nine-dragon-stack', 'far-reach'])('checks %s with its complete measured or unmeasured report', async slug => {
    const files = readTar(productTarball(join('out', slug)));
    const product = validateShardfileFolder({read: path => {const bytes = files.get(path); if (bytes === undefined) throw new Error(path); return bytes;}, paths: () => files.keys()}, {hash: hashOf});
    const report = await checkShardfile(product.shard, product.assets, {sections: product.sections});
    expect(report, JSON.stringify(report.failures)).toMatchObject({slug, pass: true});
    if (product.shard.runtime !== null) {
      expect(report.proof).toBe('unmeasured');
      expect(report.performance.scripts.scripts.samples).toBe(0);
    } else expect(report.performance.scripts.scripts.samples).toBe(180);
  }, 120_000);
});
