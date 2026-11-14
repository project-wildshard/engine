// J233 / BM-2: the format dependency ships two Template products, Template 1's `blender-template` and Template 2's
// `brasscap-mesa`; `pins.ts install --from-format <slug>` admits either from the installed package alone.
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

test('the two Templates are two products, sharing no baked file', () => {
  const blobs = (slug: string): Set<string> => new Set([...readTar(formatTemplate(slug).bytes).keys()].filter(path => path.startsWith('blobs/')));
  const first = blobs('blender-template'), second = blobs('brasscap-mesa');
  expect(second.size).toBeGreaterThan(0);
  expect([...second].filter(path => first.has(path))).toEqual([]);
});

test('any other slug is refused, an inherited key included', () => {
  for (const slug of ['template', 'brasscap', 'constructor', '__proto__']) expect(() => formatTemplate(slug)).toThrow(`No format dependency product: ${slug}`);
});
