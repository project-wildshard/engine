import { expect, test, vi } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { CellMinimaps } from './minimapBlend';
import { ApproachInputsDeferredError } from './productInputs';

test('optional map headroom retries only after cost changes and stops at disposal', async () => {
  const previous = globalThis.document; vi.stubGlobal('document', {});
  const scope = new Scope('deferred-map'); let revision = 0;
  const url = vi.fn(() => Promise.reject(new ApproachInputsDeferredError()));
  const maps = new CellMinimaps(scope, url, () => false, { revision: () => revision, deferred: error => error instanceof ApproachInputsDeferredError });
  try {
    maps.image('cell'); await Promise.resolve(); await Promise.resolve();
    maps.image('cell'); maps.image('cell'); expect(url).toHaveBeenCalledOnce();
    revision++; maps.image('cell'); await Promise.resolve(); await Promise.resolve();
    expect(url).toHaveBeenCalledTimes(2);
    scope.dispose(); revision++; maps.image('cell'); expect(url).toHaveBeenCalledTimes(2);
  } finally { scope.dispose(); vi.stubGlobal('document', previous); }
});

test('real map failures keep the original refusal instead of retrying as headroom', async () => {
  const previous = globalThis.document; vi.stubGlobal('document', {});
  const scope = new Scope('invalid-map'), failure = new Error('Image hash mismatch'); let revision = 0;
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined), url = vi.fn(() => Promise.reject(failure));
  const maps = new CellMinimaps(scope, url, () => false, { revision: () => revision, deferred: error => error instanceof ApproachInputsDeferredError });
  try {
    maps.image('cell'); await Promise.resolve(); await Promise.resolve(); revision++; maps.image('cell');
    expect(url).toHaveBeenCalledOnce(); expect(warn).toHaveBeenCalledOnce();
  } finally { scope.dispose(); warn.mockRestore(); vi.stubGlobal('document', previous); }
});
