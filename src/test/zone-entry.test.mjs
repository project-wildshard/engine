// CHUNK-PARAM-REMOVAL CP12 (J522): tools enter a zone with the title's own tap bytes and a bare `/`, never a zone in the query.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { test } from 'vitest';
import { SAVE_PREFIX, initScript, oneCellCatalogue, oneCellPage, tapDocument, zoneHome } from '../scripts/zone-entry.mjs';
import { tapRecord, tapSessionDocument } from '../client/engine/boot/tapRecord.ts';
import { WILDSHARD_IDENTITY } from '../client/game/identity.ts';

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
  const printed = execFileSync(process.execPath, ['src/scripts/zone-entry.mjs', '--init', 'pine-hollow'], { encoding: 'utf8' });
  assert.match(printed, /"pine-hollow"/u);
  assert.doesNotMatch(printed, /chunk/u);
});

test('alone cuts the inline catalogue to the zone\'s one cell, at the origin as CP10 boots it', () => {
  const catalogue = { placements: [{ slug: 'pine-hollow' }, { slug: 'driftwood-isle' }],
    grid: { version: 0, cells: [{ instance: 'a', slug: 'pine-hollow', cell: [0, 0] }, { instance: 'b', slug: 'driftwood-isle', cell: [1, 0], note: '</script>' }] } };
  const one = oneCellCatalogue(catalogue, 'driftwood-isle');
  assert.deepEqual(one.grid.cells, [{ instance: 'b', slug: 'driftwood-isle', cell: [0, 0], note: '</script>' }]);
  assert.deepEqual(one.placements, catalogue.placements, 'the title rows stay; only the world is one cell');
  assert.throws(() => oneCellCatalogue(catalogue, 'nine-dragon-stack'), /0 cells for nine-dragon-stack/u);
  // main red 45750864926: cook-to-play's world shows its cooked zone in many cells; its own instance's cell wins, else the first
  const filled = { grid: { cells: [{ instance: 'x', slug: 'brasscap-mesa', cell: [0, 1] }, { instance: 'brasscap-mesa', slug: 'brasscap-mesa', cell: [2, 2] }, { instance: 'y', slug: 'brasscap-mesa', cell: [1, 1] }] } };
  assert.deepEqual(oneCellCatalogue(filled, 'brasscap-mesa').grid.cells, [{ instance: 'brasscap-mesa', slug: 'brasscap-mesa', cell: [0, 0] }]);
  assert.deepEqual(oneCellCatalogue({ grid: { cells: [filled.grid.cells[0], filled.grid.cells[2]] } }, 'brasscap-mesa').grid.cells, [{ instance: 'x', slug: 'brasscap-mesa', cell: [0, 0] }]);
  const html = `<html><script type="application/json" id="ws-catalogue">${JSON.stringify(catalogue).replaceAll('<', `${'\\'}u003c`)}</script></html>`;
  const page = oneCellPage(html, 'driftwood-isle');
  const inline = /id="ws-catalogue">(.*?)<\/script>/su.exec(page)?.[1] ?? '';
  assert.deepEqual(JSON.parse(inline).grid.cells.map(row => row.slug), ['driftwood-isle']);
  assert.doesNotMatch(inline, /</u, 'a < in the catalogue never closes the inline script');
  assert.throws(() => oneCellPage('<html></html>', 'pine-hollow'), /inlines no ws-catalogue/u);
});

// QA 11-25 row 99 (meta MZ26): budgets' phone frames measure every pinned zone, and a staging-only shard's first pin has no cell
test('unplaced seats a built zone the grid doesn\'t place at the origin; without it, no cell still refuses', () => {
  const catalogue = { placements: [{ slug: 'pine-hollow' }], grid: { cells: [{ instance: 'a', slug: 'pine-hollow', cell: [2, 0] }] } };
  assert.deepEqual(oneCellCatalogue(catalogue, 'glowfen', { unplaced: true }).grid.cells, [{ instance: 'glowfen', slug: 'glowfen', cell: [0, 0] }]);
  assert.deepEqual(oneCellCatalogue(catalogue, 'pine-hollow', { unplaced: true }).grid.cells, [{ instance: 'a', slug: 'pine-hollow', cell: [0, 0] }]);
  assert.throws(() => oneCellCatalogue(catalogue, 'glowfen'), /0 cells for glowfen/u);
  const html = `<script type="application/json" id="ws-catalogue">${JSON.stringify(catalogue)}</script>`;
  assert.match(oneCellPage(html, 'glowfen', { unplaced: true }), /"cells":\[\{"instance":"glowfen","slug":"glowfen","cell":\[0,0\]\}\]/u);
});

test('the address enterZone opens carries the run\'s flags and never a zone (CP16)', () => {
  assert.equal(zoneHome('http://127.0.0.1:4401'), 'http://127.0.0.1:4401/');
  assert.equal(zoneHome('http://127.0.0.1:4401', 'mute=1&nolock=1&skipintro=1'), 'http://127.0.0.1:4401/?mute=1&nolock=1&skipintro=1');
  assert.equal(zoneHome('https://staging.wildshard.io', { sw: '0' }), 'https://staging.wildshard.io/?sw=0');
  assert.throws(() => zoneHome('http://127.0.0.1:4401', 'chunk=pine-hollow&mute=1'), /no zone in the address/u); // chunk-param-guard: old link
});
