// J233 / BM-2: the format dependency ships Brasscap Mesa's export (J434 retired the handwritten Template 2 product);
// `pins.ts install --from-format <slug>` admits it from the installed package alone.
import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { prepareAssetDecoders } from '@wildshard/format/shardfileAssets';
import { validateShardfileFolder } from '@wildshard/format/shardfileValidation';
import { readTar } from '@wildshard/format/tar';
import { FORMAT_PRODUCTS, formatTemplate } from '../scripts/pin-format.ts';

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

test('Brasscap is the one format product', () => {
  expect(Object.keys(FORMAT_PRODUCTS)).toEqual(['brasscap-mesa']);
});

test('any other slug is refused, an inherited key included', () => {
  for (const slug of ['template', 'brasscap', 'constructor', '__proto__']) expect(() => formatTemplate(slug)).toThrow(`No format dependency product: ${slug}`);
});
