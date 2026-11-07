// oxlint-disable-next-line import/no-nodejs-modules -- Native proofs verify the prepared product's exact on-disk bytes.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Product paths are admitted by the format-2 index.
import { resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Locate the repository independently of the caller's directory.
import { fileURLToPath } from 'node:url';
// oxlint-disable-next-line import/no-nodejs-modules -- Every section and asset must match its committed product hash.
import { createHash } from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- The witness must bind to the exact prepared shard identity.
import assert from 'node:assert/strict';
import { readBuiltShardfile } from '../../../scripts/built-product.mjs';
import { assembleOutputShardfile, parseOutputIndex } from '@wildshard/format/outputIndex';
import type { Shardfile } from '@wildshard/format/shardSchema';

/** Read only an exact-SHA/current-input prepared product. Never invokes its
 * renderer-bearing producer, builds bytes, or falls back to loose assets. */
export function inkProofProduct(): { readonly source: Shardfile; readonly assets: ReadonlyMap<string, Uint8Array> } {
  const root = fileURLToPath(new URL('../../../', import.meta.url)), folder = readBuiltShardfile(root, 'ink-cel-valley');
  return readInkProofProduct(path => readFileSync(resolve(folder, path)));
}

/** Verify bytes supplied by the exact prepared-product reader. Tests can poison
 * one read without mutating shared product files or weakening native admission. */
export function readInkProofProduct(read: (path: string) => Uint8Array): { readonly source: Shardfile; readonly assets: ReadonlyMap<string, Uint8Array> } {
  const decode = (bytes: Uint8Array): unknown => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const index = parseOutputIndex(decode(read('shard.json')));
  assert.equal(index.identity.slug, 'ink-cel-valley', 'Ink proof product identity differs');
  const checked = (row: { readonly path: string; readonly hash: string }, bytes: number): Uint8Array => {
    const wire = read(row.path);
    if (wire.length !== bytes || createHash('sha256').update(wire).digest('hex') !== row.hash) throw new Error(`Ink proof product bytes differ: ${row.path}`);
    return wire;
  };
  const sections = new Map<string, unknown>(index.sections.map(row => [row.name, decode(checked(row, row.bytes))]));
  const source = assembleOutputShardfile(index, sections), files = new Map(index.files.map(row => [row.hash, row]));
  const assets = new Map<string, Uint8Array>();
  for (const file of source.files) {
    const row = files.get(file.hash); if (row === undefined) throw new Error(`Missing Ink proof product file: ${file.hash}`);
    assets.set(file.hash, checked(row, file.compressed));
  }
  return { source, assets };
}
