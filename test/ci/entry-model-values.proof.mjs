import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { BoxGeometry, BufferGeometry, Mesh } from 'three';
import { Scope } from '../../src/shared/engine/app/scope.ts';
import { loadItemModels } from '../../src/client/game/shardfile/itemModels.ts';
import { parseItems } from '@wildshard/format/items';

const limit = 9500;
const itemSource = JSON.parse(readFileSync(new URL('../fixtures/shardfile/items/template.json', import.meta.url), 'utf8'));
function inventory(bytes) {
  const items = parseItems(itemSource), [row] = items.rows;
  assert.ok(row !== undefined);
  const hash = createHash('sha256').update(bytes).digest('hex');
  return { hash, items: { ...items, rows: [{ ...row, view: { ...row.view, asset: hash } }] }, assets: new Map([[hash, bytes]]) };
}
function compressedFixture() {
  const bytes = Uint8Array.from(readFileSync(new URL('../fixtures/entry-model/box.glb', import.meta.url)));
  assert.equal(bytes.length, 3124);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '40314bf53c6a13bf412baefc996d00e8e69fd26bae4c6f2092f82d26d75d17b0');
  const header = new DataView(bytes.buffer), length = header.getUint32(12, true);
  const document = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)));
  assert.ok(document.bufferViews.some(view => view.extensions?.EXT_meshopt_compression !== undefined), 'Fixture must exercise real meshopt decoding');
  return bytes;
}
function geometry(root) {
  let found;
  root?.traverse(node => { if (node instanceof Mesh && node.geometry instanceof BufferGeometry) found = node.geometry; });
  assert.ok(found !== undefined, 'Actual model has no decoded geometry');
  return found;
}
function sameValues(decoded, original) {
  for (const name of ['position', 'normal', 'uv']) {
    const actual = decoded.getAttribute(name), expected = original.getAttribute(name);
    assert.ok(actual !== undefined && actual.array.length > 0);
    assert.deepEqual(actual.array, expected.array);
  }
  assert.ok(decoded.index !== null && original.index !== null);
  assert.deepEqual(decoded.index.array, original.index.array);
}

test('real compressed item geometry remains shared until its last scope retires', { timeout: limit }, async () => {
  const started = performance.now(), original = new BoxGeometry(1, 2, 3, 3, 3, 3);
  const a = new Scope('model-owner-a'), b = new Scope('model-owner-b'), c = new Scope('model-owner-late');
  try {
    const f = inventory(compressedFixture());
    const first = await loadItemModels(f.items, f.assets, a), second = await loadItemModels(f.items, f.assets, b);
    assert.equal(first.size, 1); assert.equal(second.get(f.hash), first.get(f.hash));
    const decoded = geometry(first.get(f.hash)); sameValues(decoded, original);
    let disposed = 0; decoded.addEventListener('dispose', () => { disposed++; });
    a.dispose(); await Promise.resolve(); assert.equal(disposed, 0);
    sameValues(geometry(second.get(f.hash)), original);
    b.dispose(); await Promise.resolve(); assert.equal(disposed, 1);
    const late = await loadItemModels(f.items, f.assets, c);
    assert.notEqual(late.get(f.hash), first.get(f.hash));
    const revived = geometry(late.get(f.hash)); assert.notEqual(revived, decoded); sameValues(revived, original);
    let retired = 0; revived.addEventListener('dispose', () => { retired++; });
    c.dispose(); await Promise.resolve(); assert.equal(retired, 1); assert.equal(disposed, 1);
  } finally { a.dispose(); b.dispose(); c.dispose(); original.dispose(); }
  assert.ok(performance.now() - started < limit, 'Complete model lifetime contract exceeded 9500 ms');
});

test('a hash-valid malformed model refuses before publishing an entry', { timeout: limit }, async () => {
  const started = performance.now(), owner = new Scope('invalid-model-owner');
  try {
    const f = inventory(new Uint8Array([103, 108, 84, 70]));
    await assert.rejects(loadItemModels(f.items, f.assets, owner), /truncated/u);
  } finally { owner.dispose(); }
  assert.ok(performance.now() - started < limit, 'Malformed model admission exceeded 9500 ms');
});

// Buffer is a legal Uint8Array, but its slice keeps the backing allocation.
test('model hashing reads only the declared Buffer view span', { timeout: limit }, async () => {
  const started = performance.now(), owner = new Scope('buffer-view-model');
  const bytes = readFileSync(new URL('../fixtures/entry-model/box.glb', import.meta.url));
  const backing = Buffer.alloc(bytes.length + 31, 165); backing.set(bytes, 13);
  const view = backing.subarray(13, 13 + bytes.length), f = inventory(view);
  const original = new BoxGeometry(1, 2, 3, 3, 3, 3);
  try {
    const models = await loadItemModels(f.items, f.assets, owner);
    assert.equal(models.size, 1); sameValues(geometry(models.get(f.hash)), original);
  } finally { owner.dispose(); original.dispose(); }
  assert.ok(performance.now() - started < limit, 'Buffer-view model admission exceeded 9500 ms');
});
