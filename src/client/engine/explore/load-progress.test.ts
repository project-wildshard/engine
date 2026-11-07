// @vitest-environment happy-dom
import { expect, test } from 'vitest';
import { LoadProgress } from '../ui/loadProgress';

function gate() { let done = (): void => { throw new Error('Missing preparation'); }; const pending = new Promise<void>(resolve => { done = resolve; }); return { pending, done }; }

test('counts actual completed preparations and stays busy until the final one', async () => {
  const host = document.createElement('div'), progress = new LoadProgress(host), first = gate(), second = gate();
  const pending = progress.watch('Pictures', [first.pending, second.pending]);
  expect(progress.element.hidden).toBe(false); expect(progress.element.textContent).toBe('Pictures · 0 / 2');
  first.done(); await first.pending;
  expect(progress.element.textContent).toBe('Pictures · 1 / 2'); expect(progress.element.getAttribute('aria-busy')).toBe('true');
  expect(progress.element.querySelector('progress')?.value).toBe(1);
  second.done(); await pending;
  expect(progress.element.hidden).toBe(true); expect(progress.element.getAttribute('aria-busy')).toBe('false');
  progress.dispose(); expect(host.childElementCount).toBe(0);
});

test('a replaced or closed view ignores old decoders, including their failures', async () => {
  const progress = new LoadProgress(document.createElement('div')), old = gate(), current = gate();
  const before = progress.watch('Old', [old.pending]);
  const now = progress.watch('Current', [current.pending]);
  old.done(); await before;
  expect(progress.element.textContent).toBe('Current · 0 / 1'); expect(progress.element.hidden).toBe(false);
  progress.clear(); current.done(); await now;
  expect(progress.element.hidden).toBe(true);
  const failed = progress.watch('Closed', [Promise.reject(new Error('closed decoder'))]);
  progress.dispose(); await expect(failed).rejects.toThrow('closed decoder');
  expect(progress.element.hidden).toBe(true); expect(progress.element.classList.contains('failed')).toBe(false);
});

test('failed preparation stays visible, never credits completion, and a new choice resets it', async () => {
  const progress = new LoadProgress(document.createElement('div')), later = gate();
  await expect(progress.watch('Model', [Promise.reject(new Error('bad bytes')), later.pending])).rejects.toThrow('bad bytes');
  later.done(); await later.pending;
  expect(progress.element.hidden).toBe(false); expect(progress.element.textContent).toBe('Model · 0 / 2 · Could not load');
  expect(progress.element.getAttribute('aria-busy')).toBe('false'); expect(progress.element.classList.contains('failed')).toBe(true);
  await progress.watch('Ready', [Promise.resolve()]);
  expect(progress.element.hidden).toBe(true); expect(progress.element.classList.contains('failed')).toBe(false);
  progress.dispose();
});
