// oxlint-disable-next-line import/no-nodejs-modules -- Pin the original case and workflow at its quarantine boundary.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

test('the blocking grid case keeps every original clock, pixel and road assertion', () => {
  const source = readFileSync('scripts/parity/boot-smoke.mjs', 'utf8');
  expect(source).not.toContain('quarantinedGrid');
  expect(source).not.toContain('gridReporting');
  expect(source).toContain('deadline = Date.now() + 150000;');
  expect(source).toContain('deadline = Date.now() + 90000;');
  expect(source).toContain("'grid preparation', deadline, observeGridWait");
  expect(source).toContain('await until(page, faults, () => gameplay(true)');
  expect(source).toContain("'ten live gameplay frames', deadline");
  expect(source).toContain("await captureBootFrame(page, mode === 'grid' ? 'grid HOME'");
  expect(source).toContain('await bootTemplateRoad(page, faults, frames, roadDeadline)');
  expect(source).toContain('await bootSignalRoad(page, faults, frames, roadDeadline)');
  expect(source).toContain('elapsedMs: Date.now() - started');
});
