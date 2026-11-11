// oxlint-disable-next-line import/no-nodejs-modules -- Read isolated build receipts without invoking a product builder.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Every fixture stays under its owned repository scratch directory.
import { join, resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Verify the exact index bytes with the production receipt hash.
import { createHash } from 'node:crypto';
import { afterEach, expect, test } from 'vitest';
import { buildValidationReceipts } from '../scripts/app-build/validationReceipts.mjs';
import { readValidationReceipt } from '@wildshard/format/validationReceipt';

const owned: string[] = [];
afterEach(() => { for (const root of owned.splice(0)) rmSync(root, { recursive: true }); });
function fixture() {
  mkdirSync('tmp', { recursive: true });
  const root = resolve(mkdtempSync('tmp/client-receipt-')); owned.push(root);
  const directory = join(root, 'check'); mkdirSync(directory);
  const sourceHash = 'a'.repeat(64), index = JSON.stringify({ format: 'wildshard.shardfile', formatVersion: 2, build: { sourceHash } });
  const worst = { playing: 7, loading: 11, accounted: 5, location: [2, 3] };
  const receipt = { revision: 'receipt-test', sourceHash, indexHash: createHash('sha256').update(index).digest('hex'), worst,residentBytes:16384,postCost:{passes:1,instructions:7,inputs:{colour:true,depth:false,normal:false}},
    discovery: { hash: 'b'.repeat(64), values: { poses: { marker: 'build-only-discovery'.repeat(10000) } } }, buildKey: 'c'.repeat(64) };
  writeFileSync(join(directory, 'shard.json'), index); writeFileSync(join(directory, 'validation.json'), JSON.stringify(receipt));
  return { root, directory, receipt };
}

test('client receipts preserve every runtime trust field and omit build-only discovery', () => {
  const f = fixture(), rows = buildValidationReceipts('receipt-test', f.root);
  const expected = { revision: f.receipt.revision, sourceHash: f.receipt.sourceHash, indexHash: f.receipt.indexHash, worst: f.receipt.worst,residentBytes:f.receipt.residentBytes };
  expect(rows).toEqual([{ ...expected,postCost:f.receipt.postCost, path: '/shardfiles/check/shard.json' }]); expect(JSON.stringify(rows).length).toBeLessThan(1000);
  expect(JSON.parse(readFileSync(join(f.directory, 'validation.json'), 'utf8'))).toEqual(f.receipt);
  const previous = Object.getOwnPropertyDescriptor(globalThis, '__SHARDFILE_VALIDATOR__');
  Object.defineProperty(globalThis, '__SHARDFILE_VALIDATOR__', { configurable: true, value: 'receipt-test' });
  try { expect(readValidationReceipt(rows[0], f.receipt.sourceHash)).toEqual(expected); }
  finally {
    if (previous === undefined) Reflect.deleteProperty(globalThis, '__SHARDFILE_VALIDATOR__');
    else Object.defineProperty(globalThis, '__SHARDFILE_VALIDATOR__', previous);
  }
});

test.each(['revision', 'sourceHash', 'indexHash'])('stale %s still refuses before client projection', field => {
  const f = fixture(); writeFileSync(join(f.directory, 'validation.json'), JSON.stringify({ ...f.receipt, [field]: 'stale' }));
  expect(() => buildValidationReceipts('receipt-test', f.root)).toThrow('Stale output validation receipt');
});

test('a missing index retains its build refusal', () => {
  const f = fixture(); rmSync(join(f.directory, 'shard.json'));
  expect(() => buildValidationReceipts('receipt-test', f.root)).toThrow('Missing output validation receipt');
});

test.each([undefined,0,-1,1.5,Infinity])('a missing or invalid published residency fails the app build (%s)',residentBytes=>{
  const f=fixture();writeFileSync(join(f.directory,'validation.json'),JSON.stringify({...f.receipt,residentBytes}));
  expect(()=>buildValidationReceipts('receipt-test',f.root)).toThrow('Missing build-owned source residency');
});

test.each([undefined,{passes:-1,instructions:0,inputs:{colour:false,depth:false,normal:false}},{passes:0,instructions:Number.NaN,inputs:{}},{passes:0,instructions:0,inputs:{colour:'no',depth:false,normal:false}}])('missing or invalid published post cost fails the app build (%j)',postCost=>{
  const f=fixture();writeFileSync(join(f.directory,'validation.json'),JSON.stringify({...f.receipt,postCost}));
  expect(()=>buildValidationReceipts('receipt-test',f.root)).toThrow('Missing build-owned post cost');
});
