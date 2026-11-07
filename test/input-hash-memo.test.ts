// oxlint-disable-next-line import/no-nodejs-modules -- Owned local generator fixtures.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths only.
import { resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { bakeInputHashes, InputHashMemo } from '../scripts/bake-input-hashes.mjs';
import { recorderKey, runNativeRecorder } from '../scripts/native-recorder-cache.mjs';

const owned: string[] = [];
afterEach(() => { for (const root of owned.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(): string {
  mkdirSync(resolve('tmp'), { recursive: true });
  const root = mkdtempSync(resolve('tmp/generation-input-memo-')); owned.push(root);
  writeFileSync(resolve(root, 'input.txt'), 'first'); return root;
}
function job(root: string, inputHashes: InputHashMemo) {
  return { id: 'memo-test', inputs: bakeInputHashes(root, ['input.txt'], inputHashes), outputs: ['output.txt'], command: ['fixture'], platform: 'portable' as const };
}

it('shares a content read across collection, key validation and later jobs, including a new process memo', () => {
  const root = fixture(), file = resolve(root, '.cache/hashes.json'), memo = new InputHashMemo(root, file), descriptor = job(root, memo);
  const key = recorderKey(root, descriptor, { inputHashes: memo });
  expect(recorderKey(root, job(root, memo), { inputHashes: memo })).toBe(key);
  expect(memo.reads).toBe(1); memo.flush();
  const warm = new InputHashMemo(root, file);
  expect(recorderKey(root, descriptor, { inputHashes: warm })).toBe(key); expect(warm.reads).toBe(0);
  writeFileSync(file, '{broken');
  const corrupt = new InputHashMemo(root, file);
  expect(recorderKey(root, descriptor, { inputHashes: corrupt })).toBe(key); expect(corrupt.reads).toBe(1);
});

it('rejects same-size edits even after restoring mtime, and rejects links, missing files and crossed roots', () => {
  const root = fixture(), memo = new InputHashMemo(root), descriptor = job(root, memo), old = statSync(resolve(root, 'input.txt'));
  writeFileSync(resolve(root, 'input.txt'), 'other'); utimesSync(resolve(root, 'input.txt'), old.atime, old.mtime);
  expect(() => recorderKey(root, descriptor, { inputHashes: memo })).toThrow('Generation input changed');
  expect(() => bakeInputHashes(root, ['missing'], memo)).toThrow();
  symlinkSync('input.txt', resolve(root, 'link'));
  expect(() => bakeInputHashes(root, ['link'], memo)).toThrow('Invalid bake input');
  const other=fixture();symlinkSync(other,resolve(root,'outside'),'dir');
  expect(() => bakeInputHashes(root,['outside/input.txt'],memo)).toThrow('Invalid bake input');
  expect(() => bakeInputHashes(root, ['../input.txt'], memo)).toThrow('Invalid bake input path');
  expect(() => bakeInputHashes(fixture(), ['input.txt'], memo)).toThrow('Crossed input hash memo root');
});

it('still refuses a producer that changes its source after the initial memo hit', async () => {
  const root = fixture(), memo = new InputHashMemo(root), descriptor = job(root, memo);
  memo.enableSnapshot(()=>false);
  job(root,memo);
  await expect(runNativeRecorder(root, descriptor, { inputHashes: memo, cacheDir: resolve(root, 'cache'), generate: stage => {
    writeFileSync(resolve(stage, 'output.txt'), readFileSync(resolve(root, 'input.txt')));
    writeFileSync(resolve(root, 'input.txt'), 'other');
    return Promise.resolve();
  } })).rejects.toThrow('Generation input changed');
});

it('verifies frozen authored bytes and inventories while allowing generated restoration', () => {
  const root=fixture(), memo=new InputHashMemo(root);
  mkdirSync(resolve(root,'source')); writeFileSync(resolve(root,'source/authored.txt'),'source');
  memo.enableSnapshot(file=>file==='source/generated.json');
  const inputs=bakeInputHashes(root,memo.paths('source'),memo), reads=memo.reads;
  writeFileSync(resolve(root,'source/generated.json'),'generated');
  expect(bakeInputHashes(root,memo.paths('source'),memo)).toEqual(inputs); expect(memo.reads).toBe(reads); memo.verifySnapshot();
  writeFileSync(resolve(root,'source/new.txt'),'new');
  expect(()=>memo.verifySnapshot()).toThrow('source inventory changed');
  rmSync(resolve(root,'source/new.txt')); writeFileSync(resolve(root,'source/authored.txt'),'edited');
  expect(()=>memo.verifySnapshot()).toThrow('Generation input changed');
});
