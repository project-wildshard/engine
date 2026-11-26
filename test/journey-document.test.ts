// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';
import { screenNow } from '../src/scripts/journey-proof.mjs';

afterEach(() => { vi.unstubAllGlobals(); });

test('one document keeps its identity when the browser rounds its clock differently', () => {
  let origin = 1000.4;
  vi.stubGlobal('performance', { get timeOrigin() { return origin; } });
  const first = screenNow(); origin = 1000.6;
  expect(screenNow().doc).toBe(first.doc);
});

test('a replacement document has a different identity even at the same rounded origin', () => {
  vi.stubGlobal('performance', { timeOrigin: 1000.4 });
  const first = screenNow();
  vi.stubGlobal('document', document.implementation.createHTMLDocument('replacement'));
  expect(screenNow().doc).not.toBe(first.doc);
});
