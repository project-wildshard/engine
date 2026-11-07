// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';
import { isDev, setDev } from '../core/devMode';

const previousDeveloper = isDev();
afterEach(() => { setDev(previousDeveloper); vi.unstubAllGlobals(); });

test('G901: with Developer off a recoverable error shows the quiet chip and a fatal one the modal', async () => {
  setDev(false);
  vi.stubGlobal('__BUILD_ID__', 'fixture');
  vi.stubGlobal('fetch', () => Promise.resolve(Response.json({ id: 'report-1' })));
  const { emitFault, setLoopState } = await import('../../../shared/engine/core/faults');
  const { installErrorModal } = await import('./ErrorModal');
  installErrorModal(); setLoopState('running');
  emitFault({ system: 'crossbow', error: new Error('a recoverable error in play'), verdict: 'uncaught' });
  await Promise.resolve();
  expect(document.querySelector('#wserr')).toBeNull();
  expect(document.querySelector('#wserr-chip')).not.toBeNull();
  // a play-breaking error opens the modal with Developer off too
  emitFault({ system: 'render', error: new Error('the render stopped'), verdict: 'fatal' });
  await Promise.resolve();
  expect(document.querySelector('#wserr')).not.toBeNull();
  expect(document.querySelector('#wserr .what')?.textContent).toContain('render');
});
