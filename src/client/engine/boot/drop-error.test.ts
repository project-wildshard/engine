// Meta MMO-OBSERVABILITY OB10 (friction F33): the drop card names an AggregateError's inner errors, as the error card does.
import { expect, test } from 'vitest';
import { describeError } from '../../../shared/engine/core/faults';
import { describeDropError } from './dropNotice';

test('the drop card names the inner errors of a load that failed and whose cleanup failed', () => {
  const load = new Error('Discovery of driftwood-isle answered 404'), cleanup = new TypeError('terrain tile mask is gone');
  const aggregate = new AggregateError([load, cleanup], 'Level load and cleanup failed', { cause: load });
  const drop = describeDropError(aggregate);
  expect(drop.message).toBe('AggregateError: Level load and cleanup failed [1/2 Error: Discovery of driftwood-isle answered 404 | 2/2 TypeError: terrain tile mask is gone]');
  expect(drop.message).toBe(describeError(aggregate).message);
  expect(drop.stack).toContain('Caused by: TypeError: terrain tile mask is gone');
  expect(describeDropError(load).message).toBe('Error: Discovery of driftwood-isle answered 404');
});
