// @vitest-environment happy-dom
// LS4 (J188): a failed boot keeps the real failure on screen and one tappable Copy diagnostics on top of it.
import { afterEach, expect, it, vi } from 'vitest';
import { showLoadFailure } from './errorScreen';
import { setDiagnosticsSource } from './diagnosticsCopy';
import type { LoadFailure } from '../core/errorReport';

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });

const failure: LoadFailure = { kind: 'load', context: {}, tags: {} as LoadFailure['tags'], name: 'Error', build: 'abc1234-test',
  stage: 'server', message: 'Standalone server worker failed to load', stack: 'Error: Standalone server worker failed to load\n  at boot' };

it('moves Copy diagnostics onto the fatal screen beside Reload and copies the card report', async () => {
  const card = document.createElement('div'); card.className = 'ws-load';
  const covered = document.createElement('button'); covered.className = 'ws-load-copy'; card.append(covered);
  document.body.append(card);
  setDiagnosticsSource(() => 'Wildshard boot diagnostics\ntimeline (LS1):\n{"entries":[]}');
  let copied = '';
  vi.stubGlobal('navigator', { clipboard: { writeText: (text: string): Promise<void> => { copied = text; return Promise.resolve(); } } });
  const root = showLoadFailure(failure);
  const copies = document.querySelectorAll<HTMLButtonElement>('.ws-load-copy');
  expect(copies).toHaveLength(1);
  const copy = copies[0];
  if (copy === undefined) throw new Error('Missing Copy diagnostics');
  expect(root.contains(copy)).toBe(true);
  expect(root.querySelector('pre')?.textContent).toContain('failed to load');
  expect(copy.parentElement?.querySelector('button')?.textContent).not.toBe(copy.textContent);
  copy.click(); await Promise.resolve(); await Promise.resolve();
  expect(copied).toContain('timeline (LS1):');
  expect(copy.textContent).toBe('Copied');
});
