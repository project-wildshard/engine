// oxlint-disable-next-line import/no-nodejs-modules -- An explicit outside-hook admission proof.
import assert from 'node:assert/strict';
// oxlint-disable-next-line import/no-nodejs-modules -- Run through real tar admission in plain Node.
import {test} from 'node:test';
import {readTar,writeTar} from '@wildshard/format/tar';
import {productTarball} from '../src/cook/game/productTarball.ts';
import {openShardfile} from '../src/cook/game/shardCook.ts';
import {builtProduct} from './fixtures/engine-lift/product.ts';

const valid = productTarball(builtProduct('_template'));
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
