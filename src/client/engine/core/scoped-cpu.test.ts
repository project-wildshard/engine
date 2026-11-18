import { expect, test } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { ScopedCpuMeter } from './scopedCpu';

test('a tiered owner meters its fixed and rendered work without Developer sampling', () => {
  const meter = new ScopedCpuMeter();
  const page = new Scope('page');
  const resident = page.child('resident');
  const stage = resident.child('stage');
  meter.bind(page, 'page');
  meter.bind(resident, 'resident');
  meter.setLimit(stage, 2_000);
  const ticket = meter.ticket(stage);
  expect(meter.shouldMeasure(ticket)).toBe(true);
  expect(meter.shouldMeasure(meter.ticket(page))).toBe(false);

  meter.begin();
  meter.record(ticket, 1.25);
  meter.record(ticket, 1);
  meter.end();
  expect(meter.snapshot().owners).toEqual([
    { id: 'page', ms: 0, calls: 0 },
    { id: 'resident', ms: 2.25, calls: 2, limitMicros: 2_000, overMicros: 250 },
  ]);

  meter.begin();
  meter.record(ticket, 0.5);
  meter.end();
  expect(meter.snapshot().owners[1]).toMatchObject({ calls: 1, overMicros: 0 });
  resident.dispose();
  expect(meter.shouldMeasure(meter.ticket(page))).toBe(false);
  expect(meter.snapshot().owners).toHaveLength(1);
  page.dispose();
});
