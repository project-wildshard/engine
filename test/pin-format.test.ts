// J233 / BM-2: the format dependency ships Brasscap Mesa's export (J434 retired the handwritten Template 2 product);
// `pins.ts install --from-format <slug>` admits it from the installed package alone.
import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { prepareAssetDecoders } from '@wildshard/format/shardfileAssets';
import { validateShardfileFolder } from '@wildshard/format/shardfileValidation';
import { readTar } from '@wildshard/format/tar';
import { FORMAT_PRODUCTS, formatTemplate, wholeBrasscapProduct } from '../src/scripts/pin-format.ts';

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

test.each(Object.entries(FORMAT_PRODUCTS))('%s is admitted from the format dependency\'s %s', async (slug, folder) => {
  const product = formatTemplate(slug), files = readTar(product.bytes);
  expect(product.pin.slug).toBe(slug);
  expect(product.pin.hash).toBe(sha256(product.bytes));
  expect(product.source).toMatchObject({ kind: 'format-dependency', path: `@wildshard/format/${folder}` });
  await prepareAssetDecoders();
  expect(() => validateShardfileFolder({
    read: path => { const body = files.get(path); if (body === undefined) throw new Error(`no ${path}`); return body; },
    paths: () => files.keys(),
  }, { hash: sha256 })).not.toThrow();
});

// QA 11-24 row 70: from format 0.79 the dependency ships no whole Brasscap (its export omits the world GLBs and the
// legacy copy is gone), so `--from-format` has nothing to admit and tests take the tracked pin from the pins cache.
test('Brasscap is the one format product while the format ships it whole', () => {
  expect(Object.keys(FORMAT_PRODUCTS).filter(slug => slug !== 'brasscap-mesa')).toEqual([]);
});

test('a whole Brasscap is its tracked pin when the format ships none', () => {
  const product = wholeBrasscapProduct(), files = readTar(product.bytes);
  expect(product.pin.slug).toBe('brasscap-mesa');
  expect(product.pin.hash).toBe(sha256(product.bytes));
  expect(files.has('shard.json')).toBe(true);
  if (!Object.hasOwn(FORMAT_PRODUCTS, 'brasscap-mesa')) expect(() => formatTemplate('brasscap-mesa')).toThrow('No format dependency product: brasscap-mesa');
});

test('any other slug is refused, an inherited key included', () => {
  for (const slug of ['template', 'brasscap', 'constructor', '__proto__']) expect(() => formatTemplate(slug)).toThrow(`No format dependency product: ${slug}`);
});
