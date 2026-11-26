import {expect,test} from 'vitest';
import {parseTileBakePolicy,tileBakeApprovalFailures} from '../src/scripts/tile-bake-policy.mjs';

// The SDK keeps all seven real product/writer cases. Private approval grammar
// stays with the defining engine policy, without exporting an internal API.
test('policy rows are strict and increases/identity swaps require exact approval trailers', () => {
  const before = { version: 1, products: { check: { 'missing/0/0/0': 1, 'tile/0/1/1/compressed': 400000 } } };
  expect(() => parseTileBakePolicy({ ...before, skip: true })).toThrow();
  expect(() => parseTileBakePolicy({ version: 1, products: { check: { 'missing/0/0/0': 2 } } })).toThrow('one exact coordinate');
  expect(() => parseTileBakePolicy({ version: 1, products: { check: { 'tile/*/compressed': 500000 } } })).toThrow();
  expect(tileBakeApprovalFailures(before, { version: 1, products: {} }, '')).toEqual([]);
  const after = { version: 1, products: { check: { 'missing/0/1/0': 1, 'tile/0/1/1/compressed': 400001 } } };
  expect(tileBakeApprovalFailures(before, after, '')).toHaveLength(2);
  expect(tileBakeApprovalFailures(before, after, 'test: reviewed\n\nRatchet-Approved: wildshard-new wildshard/tile-bake check/missing/0/1/0 +1\nRatchet-Approved: wildshard-new wildshard/tile-bake check/tile/0/1/1/compressed +1')).toEqual([]);
  expect(tileBakeApprovalFailures(undefined, before, '')).toEqual(['Missing ratchet approval: Ratchet-Approved: wildshard-new wildshard/tile-bake bootstrap +1']);
  expect(tileBakeApprovalFailures(undefined, before, 'test: bootstrap\n\nRatchet-Approved: wildshard-new wildshard/tile-bake bootstrap +1')).toEqual([]);
  expect(tileBakeApprovalFailures(before, before, 'test: unused\n\nRatchet-Approved: wildshard-new wildshard/tile-bake bootstrap +1')).toEqual([]);
});
