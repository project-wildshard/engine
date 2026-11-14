// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the product reader on an owned output directory.
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve only paths under the owned fixture.
import { resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Compare immutable payload bytes without giant assertion diffs.
import { Buffer } from 'node:buffer';
import { expect, test } from 'vitest';
import { writeOutputProduct, validateOutputProduct } from '../src/sharddev/outputProduct';
import { hashImmutableBytes } from '../src/shared/host/immutable';
import { readProductDescriptor } from '../src/client/game/shardfile/product';
import { outputBlobUrl } from '../src/shared/game/shardfile/outputDescriptor';
import { TEMPLATE_SOURCE, templateAssets } from './fixtures/templateSource';

test('Template browser tools reconstruct the real product and resolve every immutable asset', async () => {
  mkdirSync('tmp', { recursive: true }); const directory = mkdtempSync(resolve('tmp', 'template-reader-'));
  try {
    const assets = templateAssets();
    writeOutputProduct(structuredClone(TEMPLATE_SOURCE), assets, directory);
    const admitted = validateOutputProduct(directory), base = 'https://template.test/shard.json';
    const source = await readProductDescriptor({ base, offline: false, firstParty: true,
      fetch: url => {
        const path = new URL(url).pathname.slice(1);
        return Promise.resolve(new Response(new Uint8Array(readFileSync(resolve(directory, path)))));
      }, hash: bytes => Promise.resolve(hashImmutableBytes(bytes)) });
    expect(source).toEqual(admitted.shard);
    for (const file of source.files) {
      const expected = assets.get(file.hash); if (expected === undefined) throw new Error('Missing original asset');
      const path = new URL(outputBlobUrl(source, file.hash, base)).pathname.slice(1);
      expect(Buffer.compare(readFileSync(resolve(directory, path)), expected), file.hash).toBe(0);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
