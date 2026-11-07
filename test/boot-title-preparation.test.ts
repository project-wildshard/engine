import { expect, test } from 'vitest';
import { titleCaptureReady } from '../scripts/parity/boot-smoke.mjs';

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
