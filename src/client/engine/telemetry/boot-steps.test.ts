import { expect, test } from 'vitest';
import type { BootTimingEntry } from '../../../shared/engine/boot/timing';
import { SaveStore, type SaveStorage } from '../../../shared/engine/saves/store';
import { MAX_BOOT_STEPS, bootKind, bootStepTimes } from './bootSteps';
import { SessionHealth, type HealthReport } from './health';
import { SessionVitals } from './sessionVitals';

const entry = (operation: string, start: number, end: number | null): BootTimingEntry =>
  ({ id: start, build: 'b', attempt: 'a', realm: 'page', operation, start, end, result: 'complete', detail: {} });

function storage(): SaveStorage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    key: index => [...data.keys()][index] ?? null,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: key => { data.delete(key); },
  };
}

test('QA 2026-11-23 row 10: a boot after another build reached control is an update; the same build is normal', () => {
  expect(bootKind(null, 'b2')).toBe('first');
  expect(bootKind('b1', 'b2')).toBe('update');
  expect(bootKind('b2', 'b2')).toBe('normal');
});

test('the steps are the splash, first control and each loading stage at its longest span', () => {
  const steps = bootStepTimes({ serviceWorker: { controller: 'https://staging.wildshard.io/sw.js' }, entries: [
    entry('app:document-and-module-graph', 3, 812.4), entry('wait:Spawn download', 165, 2400), entry('stage:home', 3000, 8600), entry('stage:shaders', 9000, 15100),
    entry('stage:shaders', 9001, 15000), entry('stage:finish', 2900, null), entry('stage:bad key!', 1, 2),
    entry('app:control-ready', 16000.6, 16000.6), entry('app:control-ready', 20000, 20000)] });
  expect(steps).toEqual({ document: 809, download: 2235, control: 16001, serviceWorker: 1, home: 5600, shaders: 6100 });
});

test('the step count is bounded', () => {
  const entries = Array.from({ length: MAX_BOOT_STEPS + 10 }, (_, index) => entry(`stage:s${String(index)}`, 0, 1));
  expect(Object.keys(bootStepTimes({ entries }))).toHaveLength(MAX_BOOT_STEPS);
});

test('the boot rides the session summary to the next launch, and the first boot is kept', () => {
  const local = storage(), session = storage(), save = (): SaveStore => new SaveStore({ local, session });
  const reports: HealthReport[] = [], send = (report: HealthReport): void => { reports.push(report); };
  const health = new SessionHealth(save(), 'b2', send, 100, () => 'first-session');
  const vitals = new SessionVitals('phone');
  vitals.begin(10, 'phone', 'driftwood-isle'); vitals.joined(5000);
  vitals.booted('update', { home: 5600, shaders: 6100 });
  vitals.booted('normal', { home: 1 });
  health.exit(vitals.reading());
  new SessionHealth(save(), 'b2', send, 500, () => 'second-session');
  expect(reports[0]?.heartbeat.summary).toMatchObject({ device: 'phone', boot: 'update', bootSteps: { home: 5600, shaders: 6100 } });
});
