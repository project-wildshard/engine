// @vitest-environment happy-dom
// The drop notice's real recorder on the boot's safety net (Jake, 2026-11-12: "where's my error modal at?"): a boot that throws
// records why before its recovery reload sends the page to the title, so the title that follows has the reason to show.
import { afterEach, expect, test, vi } from 'vitest';
import { guardBoot } from './stuck';
import { markDropStep, takeDrop } from './dropNotice';
import type { LastEnd } from './lastEnd';

afterEach(() => { vi.unstubAllGlobals(); });
const reloaded: LastEnd = { kind: 'intentional', reason: 'stuck boot recovery (TypeError: boot exploded)', at: 0, resident: '', slug: '', mode: '', build: '', bootedAt: 0,
  discarded: false, nav: 'reload', reload: true };

test('a thrown error during boot records the drop before the recovery reload', async () => {
  const reload = vi.fn();
  let recordedAtReload: ReturnType<typeof takeDrop> = null;
  // the reload is the moment the page goes: the drop must be written by then (taken here as the next title would)
  reload.mockImplementation(() => { recordedAtReload = takeDrop(reloaded); });
  vi.stubGlobal('location', { href: 'https://play.example/?chunk=blender-template', origin: 'https://play.example', search: '?chunk=blender-template', reload });
  vi.stubGlobal('fetch', () => Promise.resolve(new Response('{}')));
  markDropStep({ world: 'blender-template', name: 'Blender Template', step: 'Worker boot' });
  guardBoot(Promise.reject(new TypeError('boot exploded')));
  await vi.waitFor(() => { expect(reload).toHaveBeenCalled(); });
  expect(recordedAtReload).toMatchObject({ kind: 'error', what: "Couldn't enter Blender Template", step: 'Worker boot', message: 'TypeError: boot exploded',
    reason: 'The game hit an error while starting, so it reloaded to recover.' });
});
