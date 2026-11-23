// QA-FEEDBACK-2026-11-23 row 10: the boot read prints each device's boots with their named steps, times in Cancún.
import { expect, test } from 'vitest';
import { bootTable, cancun } from '../../scripts/boot-steps.mjs';

test('a phone update boot prints its steps in seconds', () => {
  const table = bootTable({ phone: [{ receivedAt: '2026-11-23T21:00:00.000Z', build: 'abc123-mwtsex80', shard: 'driftwood-isle', boot: 'update',
    joinedMs: 18000, steps: { page: 900, home: 5600, shaders: 6100, control: 17000 } }] });
  expect(table).toBe(['phone (1 newest; seconds)', 'when\tbuild\tkind\tpage\thome\thomePrograms\tshaders\tfinish\tcontrol\tjoined',
    '11-23 16:00 Cancún\tabc123-mwtsex80\tupdate\t0.9\t5.6\t-\t6.1\t-\t17.0\t18.0'].join('\n'));
  expect(bootTable({})).toBe('no boots with step times that day');
  expect(cancun('bad')).toBe('bad');
});
