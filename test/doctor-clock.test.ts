import { expect, test } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import { checkLatency, type Learned } from '../src/client/host/online/doctor';

// FM4b mode 42 (meta MMO-FAILURE-MODES-PLAN, `clock-skew`): the Doctor's latency row warns when the device clock is measured more than
// 30 s off, says by how much and how to fix it, and claims no secure-connection cause. An unmeasured clock is never a warning.
const learned = (over: Partial<Learned>): Learned => ({ scope: new Scope('doctor clock'), rtt: [40, 42, 41], joined: true, ...over });

test('a clock 45 s behind the server: a clock-skew warning with the measured offset and the automatic-clock fix', () => {
  const row = checkLatency(learned({ serverOffset: 45_000 }));
  expect(row).toMatchObject({ state: 'warn', failmode: 'clock-skew', value: '41 ms (min 40) · clock +45.0 s' });
  expect(row.hint).toContain('Check automatic date and time');
  expect(row.hint).toContain('45 s behind the server');
  expect(row.hint, 'no claimed TLS diagnosis').not.toMatch(/TLS|secure|certificate/iu);
});

test('ahead of the page host, with no socket to time: still the warning, never a skip', () => {
  const row = checkLatency(learned({ pageOffset: -120_000, rtt: [], joined: false }));
  expect(row).toMatchObject({ state: 'warn', failmode: 'clock-skew', value: 'needs the socket · clock −120.0 s vs page' });
  expect(row.hint).toContain('120 s ahead of the page\'s host');
});

test('negative controls: an unknown clock and a clock within 30 s are no clock-skew', () => {
  expect(checkLatency(learned({}))).toEqual({ state: 'pass', value: '41 ms (min 40) · clock unknown' });
  expect(checkLatency(learned({ serverOffset: 29_000 }))).toEqual({ state: 'pass', value: '41 ms (min 40) · clock +29.0 s' });
  expect(checkLatency(learned({ rtt: [], joined: false }))).toEqual({ state: 'skip', value: 'needs the socket · clock unknown' });
});
