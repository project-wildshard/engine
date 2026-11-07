// @vitest-environment happy-dom
import { afterEach, expect, test } from 'vitest';
import { app } from '../app/runtime';
import { Scope } from '../../../shared/engine/app/scope';
import { loadModuleWithProgress } from './loadProgress';

const previous = app.levelScope;
afterEach(() => { app.levelScope?.dispose(); app.levelScope = previous; document.body.replaceChildren(); });

test('first-use code preparation is visible until the real module resolves', async () => {
  app.levelScope = new Scope('module-progress');
  let finish = (_module: { ready: true }): void => { throw new Error('Missing loader'); };
  const module = new Promise<{ ready: true }>(resolve => { finish = resolve; });
  const loading = loadModuleWithProgress('Explore', () => module);
  const status = document.querySelector<HTMLElement>('.ws-progress');
  expect(status?.hidden).toBe(false); expect(status?.textContent).toBe('Explore · 0 / 1');
  expect(status?.querySelector('span')?.classList.contains('ws-mono')).toBe(true);
  expect(status?.style.zIndex).toBe('calc(var(--ws-layer-modal) + 0)');
  finish({ ready: true }); expect(await loading).toEqual({ ready: true });
  expect(document.querySelector('.ws-progress')).toBeNull();
});
test('failed module preparation keeps its exact rejection and removes the transient UI', async () => {
  app.levelScope = new Scope('failed-module-progress');
  const error = new Error('Missing code chunk');
  await expect(loadModuleWithProgress('Feedback', () => Promise.reject(error))).rejects.toBe(error);
  expect(document.querySelector('.ws-progress')).toBeNull();
});
test('retiring the requesting level removes progress before a late import completes', async () => {
  const owner = new Scope('retired-module-progress'); app.levelScope = owner;
  let finish = (): void => { throw new Error('Missing loader'); };
  const module = new Promise<void>(resolve => { finish = resolve; });
  const loading = loadModuleWithProgress('Explore', () => module);
  owner.dispose(); expect(document.querySelector('.ws-progress')).toBeNull();
  finish(); await loading; expect(document.querySelector('.ws-progress')).toBeNull();
});
