import { expect, test } from 'vitest';
import { checkShardSizes } from '../src/scripts/shard-size-gate.mjs';
import { failed, judgeAll } from '../src/scripts/budgets/cli.mjs';
import { fileErrors } from '../src/scripts/budgets/files.mjs';

// J381's escape hatch for a hard cap: a hold in budgets/baselines.json lets one budget past its cap on the content key
// it was set on, while its plan row waits on Jake (a hard cap moves only on his word) or on a fix row. New content is
// judged again.
const caps = { schema: 1, about: '', caps: { 'download/phone/*': { hard: 100_000_000, unit: 'bytes', kind: 'exact' as const, decision: 'J338', why: 'w' } } };
const hold = { contentKey: 'pine-hollow@19', row: 'meta standalone SF27, waiting on Jake', why: 'measured phone fetch' };
const budgets = { caps, baselines: { schema: 1, about: '', baselines: {}, holds: { 'download/phone/pine-hollow': hold } } };

test('a held zone past the hard cap passes the gate with a note naming its row', () => {
  const result = checkShardSizes(budgets, { 'pine-hollow': 124_000_000 }, { contentKeys: { 'pine-hollow': 'pine-hollow@19' }, hardOnly: true });
  expect(result.errors).toEqual([]);
  expect(result.notes.join('\n')).toContain('held (J381): meta standalone SF27, waiting on Jake');
  expect(failed(result.rows, { hardOnly: true })).toBe(false);
});

test('the hold covers only its own zone and content key', () => {
  expect(checkShardSizes(budgets, { 'pine-hollow': 124_000_000 }, { contentKeys: { 'pine-hollow': 'pine-hollow@20' } }).errors[0]).toContain('hard cap');
  expect(checkShardSizes(budgets, { 'nalati-grasslands': 104_000_000 }, { contentKeys: { 'nalati-grasslands': 'nalati-grasslands@12' } }).errors[0]).toContain('hard cap');
  const rows = judgeAll(caps, budgets.baselines, { measures: { 'download/phone/pine-hollow': { value: 124_000_000, contentKey: 'pine-hollow@20' } } });
  expect(failed(rows, { hardOnly: true })).toBe(true);
});

test('a hold names the plan row it waits on, its content key and why', () => {
  expect(fileErrors(caps, budgets.baselines)).toEqual([]);
  expect(fileErrors(caps, { baselines: {}, holds: { 'download/phone/pine-hollow': { ...hold, row: 'Jake will look' } } })[0]).toContain('plan row it waits on');
  expect(fileErrors(caps, { baselines: {}, holds: { 'download/phone/pine-hollow': { ...hold, contentKey: '' } } })[0]).toContain('content key');
  expect(fileErrors(caps, { baselines: {}, holds: { 'other/thing': hold } })[0]).toContain('hard cap entry');
});
