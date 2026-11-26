import { expect, test } from 'vitest';
import { bootSlowDiagnostic, titleCaptureReady } from '../src/scripts/parity/boot-smoke.mjs';

test('title pixels and a frame cannot bypass either real pending warm owner', () => {
  for (const pending of [['shaders', 'first-world-frame'], ['shaders'], ['first-world-frame']]) {
    expect(titleCaptureReady({ appState: 'title', titlePreparation: { pending, issue: null } })).toBe(false);
  }
  expect(titleCaptureReady({ appState: 'title', titlePreparation: { pending: [], issue: null } })).toBe(true);
});

test('missing or malformed owner evidence and real warm-up errors refuse', () => {
  for (const state of [null, {}, { pending: [], issue: 0 }, { pending: ['unknown'], issue: null }]) {
    expect(() => titleCaptureReady({ appState: 'title', titlePreparation: state })).toThrow('Missing title preparation owners');
  }
  expect(() => titleCaptureReady({ appState: 'title', titlePreparation: { pending: [], issue: 'Original GPU failure' } })).toThrow('Original GPU failure');
});

test('only the explicitly catalogue-only grid title can have no world owner', () => {
  const absent = { appState: 'unavailable', titlePreparation: null };
  expect(titleCaptureReady(absent)).toBe(false);
  expect(titleCaptureReady(absent, true)).toBe(true);
  expect(() => titleCaptureReady({ appState: 'title', titlePreparation: null }, true)).toThrow();
});

test('the exact slow-progress notice differs from a failed boot report', () => {
    const report = { system: 'boot.slow', fatal: false, disabled: false,
        message: 'Error: Loading slow at step "modules" (no progress for 21 s)' };
    expect(bootSlowDiagnostic(report)).toBe(true);
    expect(bootSlowDiagnostic({ ...report, fatal: true })).toBe(false);
    expect(bootSlowDiagnostic({ ...report, disabled: true })).toBe(false);
    expect(bootSlowDiagnostic({ ...report, system: 'boot' })).toBe(false);
    expect(bootSlowDiagnostic({ ...report, message: 'Error: Failed to load modules' })).toBe(false);
    expect(bootSlowDiagnostic(null)).toBe(false);
});
