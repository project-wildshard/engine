// oxlint-disable-next-line import/no-nodejs-modules -- Read the same exact prepared files as the native witness.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve only admitted format-2 product paths.
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { readBuiltShardfile } from '../scripts/built-product.mjs';
import { parseOutputIndex } from '@wildshard/format/outputIndex';
import { readInkProofProduct } from './proof/ink-cel-valley/product';
import { nativeProof } from './proof/ink-cel-valley/native';

for (const mode of ['boot', 'headless', 'replay', 'ledger'] as const) test(`Ink prepared product retains its native ${mode} proof`, () => {
  expect(nativeProof(mode)).toContain(`"${mode}":`);
});

for (const kind of ['section', 'asset'] as const) for (const damage of ['truncated', 'changed'] as const) test(`Ink native intake refuses a ${damage} ${kind} before proof execution`, () => {
  const folder = readBuiltShardfile(resolve('.'), 'ink-cel-valley');
  const index = parseOutputIndex(JSON.parse(readFileSync(resolve(folder, 'shard.json'), 'utf8')));
  const target = kind === 'section' ? index.sections[0] : index.files[0];
  if (target === undefined) throw new Error(`Missing original Ink ${kind} control`);
  let poisoned = false;
  expect(() => readInkProofProduct(path => {
    const bytes = readFileSync(resolve(folder, path));
    if (path !== target.path) return bytes;
    poisoned = true;
    if (damage === 'truncated') return bytes.subarray(0, -1);
    const copy = Uint8Array.from(bytes), first = copy[0];
    if (first === undefined) throw new Error('Empty original Ink control');
    copy[0] = first ^ 1;
    return copy;
  })).toThrow(`Ink proof product bytes differ: ${target.path}`);
  expect(poisoned).toBe(true);
});
