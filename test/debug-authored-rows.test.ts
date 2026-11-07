// oxlint-disable-next-line import/no-nodejs-modules -- Tiny source fixtures exercise the real static census and verified cache.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The fixture owns only its exact ignored scratch directory.
import { resolve } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { debugFlags } from '../lint/debug-flags.mjs';

const owned: string[] = [];
afterEach(() => { for (const root of owned.splice(0)) rmSync(root, { recursive: true }); });
function fixture(source: string): { root: string; file: string } {
  mkdirSync('tmp', { recursive: true });
  const root = resolve(mkdtempSync('tmp/debug-authored-rows-')); owned.push(root);
  mkdirSync(resolve(root, 'src'));
  const file = resolve(root, 'src/rows.ts'); writeFileSync(file, source);
  return { root, file };
}
const fields = "ask: 'E435', reviewBy: '2026-12-30'";

test('authored direct, imported alias, namespace and local alias rows join the ordinary census', () => {
  const f = fixture(`
    import { authoredRows as rows } from '@wildshard/engine/ui/authoredDebugRows';
    import * as registry from '../engine/ui/authoredDebugRows';
    const alias = rows;
    alias.add(later);
    registry.authoredRows['add']({ id: 'namespace', ${fields} });
    rows.add({ id: 'inline', ${fields} });
    const later = { id: 'later', ${fields} };
    const DEBUG_ROWS = [{ id: 'ordinary', ${fields} }];
  `);
  expect(debugFlags(f.root).map(({ id }) => id).sort()).toEqual(['inline', 'later', 'namespace', 'ordinary']);
  expect(debugFlags(f.root).every(row => row.ask === 'E435' && row.reviewBy === '2026-12-30' && row.file === f.file)).toBe(true);
});

test('unrelated sets and adapter forwarding do not invent authored rows; existing purpose is retained', () => {
  const f = fixture(`
    import { authoredRows } from '@wildshard/engine/ui/authoredDebugRows';
    const unrelated = new Set();
    unrelated.add({ id: 'not-a-row', ${fields} });
    adapters.debugRow(forwarded);
    authoredRows.add({ id: 'tool', purpose: 'developer', ${fields} });
  `);
  expect(debugFlags(f.root)).toEqual([{ id: 'tool', purpose: 'developer', ask: 'E435', reviewBy: '2026-12-30', file: f.file }]);
});

test('an unresolvable authored row refuses instead of disappearing from the cap', () => {
  const f = fixture(`import { authoredRows } from '@wildshard/engine/ui/authoredDebugRows'; authoredRows.add(missing);`);
  expect(() => debugFlags(f.root)).toThrow('Unresolvable Debug row');
});

test('generic adapter forwarding is counted at its caller; extra literal registrations still count', () => {
  const f = fixture(`
    import { authoredRows } from '@wildshard/engine/ui/authoredDebugRows';
    function forward(spec) {
      const row = { ...(spec.purpose ? {purpose: spec.purpose} : {}),
        id: spec.id, ask: spec.ask, reviewBy: spec.reviewBy };
      authoredRows.add(row);
      authoredRows.add({ id: 'extra', ${fields} });
    }
    const rows = { debugRow: forward };
    rows.debugRow({ id: 'caller', ${fields} });
  `);
  expect(debugFlags(f.root).map(row => row.id).sort()).toEqual(['caller', 'extra']);
});

test('verified file facts cannot hide a newly registered comparison row', () => {
  const source = `import { authoredRows } from '@wildshard/engine/ui/authoredDebugRows'; authoredRows.add({id:'first', ${fields}});`;
  const f = fixture(source), cache = resolve(f.root, 'cache');
  expect(debugFlags(f.root, cache).map(row => row.id)).toEqual(['first']);
  expect(debugFlags(f.root, cache).map(row => row.id)).toEqual(['first']);
  writeFileSync(f.file, `${source}\nauthoredRows.add({id:'second', ${fields}});`);
  const comparisonRows = debugFlags(f.root, cache).filter(row => row.purpose !== 'developer');
  expect(comparisonRows.map(row => row.id)).toEqual(['first', 'second']);
  expect(comparisonRows.length).toBeGreaterThan(1);
});
