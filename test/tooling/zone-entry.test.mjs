// CHUNK-PARAM-REMOVAL CP12 (J522): tools enter a zone with the title's own tap bytes and a bare `/`, never `?chunk=`.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { test } from 'vitest';
import { SAVE_PREFIX, initScript, oneCellCatalogue, oneCellPage, tapDocument } from '../../scripts/zone-entry.mjs';
import { tapRecord, tapSessionDocument } from '../../src/client/engine/boot/tapRecord.ts';
import { WILDSHARD_IDENTITY } from '../../src/client/game/identity.ts';

/** A sessionStorage stand-in. */
function store(initial = {}) {
  const items = new Map(Object.entries(initial));
  return { getItem: key => items.get(key) ?? null, setItem: (key, value) => { items.set(key, String(value)); }, items };
}

test('the harness writes under the game\'s own save prefix', () => {
  assert.equal(SAVE_PREFIX, WILDSHARD_IDENTITY.savePrefix);
});

test('the encoder keeps the tap\'s facts and time, and the session document keeps its other keys', () => {
  const raw = tapRecord({ slug: 'pine-hollow', mode: 'enter', name: 'Pine Hollow' }, 1000, { from: 7 });
  assert.deepEqual(JSON.parse(raw), { slug: 'pine-hollow', mode: 'enter', name: 'Pine Hollow', at: 1000, from: 7 });
  const doc = JSON.parse(tapSessionDocument(JSON.stringify({ keys: { loadAttempt: { v: 1, data: 2 } } }), raw));
  assert.deepEqual(doc.keys.loadAttempt, { v: 1, data: 2 });
  assert.deepEqual(doc.keys.titleArrival, { v: 1, data: JSON.parse(raw) });
  assert.deepEqual(JSON.parse(tapSessionDocument('not json', raw)).keys, { titleArrival: { v: 1, data: JSON.parse(raw) } });
});

test('tapDocument is the title\'s record for the zone, and refuses what is not a zone or a mode', () => {
  const doc = JSON.parse(tapDocument({ zone: 'driftwood-isle', at: 5 }));
  assert.deepEqual(doc.keys.titleArrival.data, { slug: 'driftwood-isle', mode: 'enter', at: 5 });
  assert.throws(() => tapDocument({ zone: 'Pine Hollow' }), /not a zone slug/u);
  assert.throws(() => tapDocument({ zone: 'pine-hollow', mode: 'walk' }), /not enter, explore or arena/u);
});

test('the init script writes the same tap into the tab, keeping its other keys', () => {
  const sessionStorage = store({ [`${SAVE_PREFIX}session`]: JSON.stringify({ keys: { loadAttempt: { v: 1, data: 1 } } }) });
  runInNewContext(initScript('nalati-grasslands', 'explore'), { sessionStorage, Date: { now: () => 42 }, JSON });
  const doc = JSON.parse(sessionStorage.items.get(`${SAVE_PREFIX}session`));
  assert.deepEqual(doc.keys.loadAttempt, { v: 1, data: 1 });
  assert.deepEqual(doc.keys.titleArrival.data, { slug: 'nalati-grasslands', mode: 'explore', at: 42 });
  const printed = execFileSync(process.execPath, ['scripts/zone-entry.mjs', '--init', 'pine-hollow'], { encoding: 'utf8' });
  assert.match(printed, /"pine-hollow"/u);
  assert.doesNotMatch(printed, /chunk/u);
});

test('alone cuts the inline catalogue to the zone\'s one cell', () => {
  const catalogue = { placements: [{ slug: 'pine-hollow' }, { slug: 'driftwood-isle' }],
    grid: { version: 0, cells: [{ instance: 'a', slug: 'pine-hollow', cell: [0, 0] }, { instance: 'b', slug: 'driftwood-isle', cell: [1, 0] }] } };
  const one = oneCellCatalogue(catalogue, 'pine-hollow');
  assert.deepEqual(one.grid.cells, [{ instance: 'a', slug: 'pine-hollow', cell: [0, 0] }]);
  assert.deepEqual(one.placements, [{ slug: 'pine-hollow' }]);
  assert.throws(() => oneCellCatalogue(catalogue, 'nine-dragon-stack'), /0 cells for nine-dragon-stack/u);
  const html = `<html><script type="application/json" id="ws-catalogue">${JSON.stringify(catalogue)}</script></html>`;
  const page = oneCellPage(html, 'driftwood-isle');
  assert.match(page, /"driftwood-isle"/u);
  assert.doesNotMatch(page, /"pine-hollow"/u);
  assert.throws(() => oneCellPage('<html></html>', 'pine-hollow'), /inlines no ws-catalogue/u);
});
