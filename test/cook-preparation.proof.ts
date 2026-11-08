// oxlint-disable-next-line import/no-nodejs-modules -- An explicit outside-hook admission proof.
import assert from 'node:assert/strict';
// oxlint-disable-next-line import/no-nodejs-modules -- Run through real tar admission in plain Node.
import {after,test} from 'node:test';
// oxlint-disable-next-line import/no-nodejs-modules -- Real cook input and output integrity checks.
import {createHash} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- The proof owns its temporary output directory.
import {existsSync,mkdtempSync,rmSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The caller sets TMPDIR to this lane's scratch.
import {tmpdir} from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- The proof owns its temporary output directory.
import {join} from 'node:path';
import {readTar,writeTar} from '@wildshard/format/tar';
import {readCookData} from '@wildshard/format/cookData';
import {cookPreparationBytes} from '@wildshard/format/cookPreparation';
import {parseOutputIndex} from '@wildshard/format/outputIndex';
import {validationSourceBytes} from '@wildshard/format/validationReceipt';
import {productTarball} from '../src/cook/game/productTarball.ts';
import {cookShard,openShardfile,shardHalf} from '../src/cook/game/shardCook.ts';
import {builtProduct} from './fixtures/engine-lift/product.ts';
import {rendererRevision} from '../scripts/renderer-revision.mjs';

const valid = productTarball(builtProduct('_template'));
const root = mkdtempSync(join(tmpdir(), 'cook-preparation-'));
after(() => rmSync(root, {recursive: true, force: true}));
const renderer = rendererRevision();
const digest = (bytes: Readonly<Uint8Array>): string => createHash('sha256').update(bytes).digest('hex');
const json = (bytes: Uint8Array | undefined): unknown => JSON.parse(new TextDecoder().decode(bytes));

function modern(targetRenderer: string = renderer): Map<string, Uint8Array> {
  const files = new Map(readTar(valid)), held = parseOutputIndex(json(files.get('shard.json')));
  const legacy = readCookData(json(files.get('cook.json'))), program = validationSourceBytes({version: 2, build: 'wire-fixture', lines: ['void main() {}'], shaders: [[0]], programs: [[0, 0]]});
  const programPath = `mounts/programs/${held.identity.slug}.json`, assetPath = 'mounts/assets/prep-proof.bin', asset = new TextEncoder().encode('real mounted bytes');
  files.set(programPath, program); files.set(assetPath, asset);
  const mounts = [...legacy.mounts.filter(row => row.url !== `/programs/${held.identity.slug}.json`),
    {url: `/programs/${held.identity.slug}.json`, path: programPath, hash: digest(program), bytes: program.length},
    {url: '/assets/prep-proof.bin', path: assetPath, hash: digest(asset), bytes: asset.length}];
  const index = parseOutputIndex({...held, sdk: '0.3'}), cook = {version: 3, renderer: targetRenderer, mounts, packs: 'fence', fence: [digest(asset)], programs: json(program), inputHash: digest(cookPreparationBytes(index, mounts, targetRenderer))};
  const bytes = validationSourceBytes(cook); files.set('cook.json', bytes);
  files.set('shard.json', validationSourceBytes({...index, cook: {path: 'cook.json', hash: digest(bytes), bytes: bytes.length}}));
  return files;
}
void test('a real pinned legacy product still opens', (): void => {
  assert.equal(openShardfile(valid).slug, 'template');
});
void test('changed preparation bytes refuse before a row can be cooked', (): void => {
  const files = new Map(readTar(valid)), held = files.get('cook.json');
  assert.ok(held !== undefined);
  // Whitespace remains valid JSON and leaves every parsed field unchanged.
  files.set('cook.json', new TextEncoder().encode(`${new TextDecoder().decode(held)} `));
  assert.throws(() => openShardfile(writeTar(files)), /cook preparation.*wildshard prepare/iu);
});
void test('changed mounted bytes refuse before a row can be cooked', (): void => {
  const mount = openShardfile(valid).cook?.mounts[0];
  assert.ok(mount !== undefined);
  const files = new Map(readTar(valid)), held = files.get(mount.path);
  assert.ok(held !== undefined && held.length > 0);
  const changed = held.slice(); changed[0] = (changed[0] ?? 0) ^ 1;
  files.set(mount.path, changed);
  assert.throws(() => openShardfile(writeTar(files)), /cook preparation.*wildshard prepare/iu);
});
void test('a prepared SDK-shaped product consumes hash-valued mounted fence rows', (): void => {
  const opened = openShardfile(writeTar(modern()), {renderer});
  assert.equal(opened.cook?.version, 3);
  const half = shardHalf(opened, (_url, bytes) => bytes.length);
  assert.ok(half.mountRows('phone', 'entry').some(row => row.url.startsWith('/assets/prep-proof.bin')));
});
void test('a coherent recording for a different renderer refuses before any part is written', async (): Promise<void> => {
  const out = join(root, 'foreign-renderer');
  await assert.rejects(cookShard(writeTar(modern('0'.repeat(64))), out, {wireBytes: (_url, bytes) => bytes.length, now: () => performance.now()}), /Stale renderer preparation.*wildshard prepare/u);
  assert.equal(existsSync(out), false);
});
void test('a changed bound product refuses before any part is written', async (): Promise<void> => {
  const files = modern(), index = parseOutputIndex(json(files.get('shard.json'))), out = join(root, 'changed');
  files.set('shard.json', validationSourceBytes({...index, build: {...index.build, validator: 'changed'}}));
  await assert.rejects(cookShard(writeTar(files), out, {wireBytes: (_url, bytes) => bytes.length, now: () => performance.now()}), /stale cook preparation.*wildshard prepare/u);
  assert.equal(existsSync(out), false);
});
void test('capture-only opening ignores stored lists without relaxing the final cook', (): void => {
  const opened = openShardfile(writeTar(modern('0'.repeat(64))), {preparationOnly: true});
  assert.equal(opened.preparationOnly, true);
  const half = shardHalf(opened, (_url, bytes) => bytes.length);
  assert.ok(half.mountRows('phone', 'whole').some(row => row.url.startsWith('/assets/prep-proof.bin')));
});
void test('missing preparation bytes name the regeneration command', (): void => {
  const files = modern(); files.delete('cook.json');
  assert.throws(() => openShardfile(writeTar(files)), /cook preparation.*wildshard prepare/iu);
});
