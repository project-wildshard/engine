import { afterEach, expect, test, vi } from 'vitest';

// meta QA-FEEDBACK-2026-11-16-mini row 86: `online.js` is a bundle (a module realm) of its own, loaded without `identity.js`, so
// its scope environment stayed the bare host's. v0.1.32's FailureTelemetry measures a shown link chip with `scope.raf` there,
// and the bare frame threw "Frame scheduling is unavailable in this host" onto the error card. The shell installs its own.
afterEach(() => { vi.unstubAllGlobals(); });
test('online.js schedules frames in its own realm', async () => {
  const pending: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => pending.push(callback));
  vi.stubGlobal('cancelAnimationFrame', () => { /* nothing to cancel */ });
  vi.resetModules();
  await import('../src/client/host/online/shell');
  const { framesAvailable, scopeEnvironment } = await import('../src/shared/engine/app/scopeEnvironment');
  expect(framesAvailable()).toBe(true);
  let ran = false;
  scopeEnvironment().frame(() => { ran = true; });
  for (const callback of pending.splice(0)) callback(16);
  expect(ran).toBe(true);
});
