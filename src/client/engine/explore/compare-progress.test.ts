// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { app } from '../app/runtime';
import { legacyDouble } from '../../../test/engine/FakeGame';
import type { World } from '../core/bootstrap';
import type { Explore } from './Explore';
import { Compare } from './Compare';

function gate() {
  let done = (): void => { throw new Error('Missing decode'); };
  let fail = (_error: Error): void => { throw new Error('Missing decoder'); };
  const pending = new Promise<void>((resolve, reject) => { done = resolve; fail = reject; });
  return { pending, done, fail };
}
const decodes: (ReturnType<typeof gate> & { image: HTMLImageElement })[] = [];
let previous: Scope | null, owner: Scope;
beforeEach(() => {
  previous = app.levelScope; owner = new Scope('compare-progress'); app.levelScope = owner;
  vi.spyOn(HTMLImageElement.prototype, 'decode').mockImplementation(function decodeImage(this: HTMLImageElement) {
    const decode = { ...gate(), image: this }; decodes.push(decode); return decode.pending;
  });
});
afterEach(async () => {
  owner.dispose(); app.levelScope = previous;
  for (const decode of decodes) decode.done();
  await Promise.allSettled(decodes.map(decode => decode.pending));
  decodes.length = 0; document.body.replaceChildren(); vi.restoreAllMocks();
});

function fixture() {
  const root = document.createElement('div'); document.body.append(root);
  const view = legacyDouble<Explore>({ root, setCompareOpen: vi.fn<Explore['setCompareOpen']>() });
  const world = legacyDouble<World>({ game: legacyDouble<World['game']>({
    level: legacyDouble<World['game']['level']>({ explore: { art: { world: '/world.jpg', models: '/models.jpg', sets: '/sets.jpg', practice: '/practice.jpg' }, compare: [
      { id: 'first', model: 'first', label: 'First', live: '/first-live.jpg', image: '/first-target.jpg', target: 'first.jpg' },
      { id: 'second', model: 'second', label: 'Second', live: '/second-live.jpg', image: '/second-target.jpg', target: 'second.jpg' },
    ] } }),
  }) });
  const compare = new Compare(view, world);
  const picker = root.querySelector<HTMLElement>('.ws-x-picker'), overlay = root.querySelector<HTMLElement>('.ws-x-compare');
  if (picker === null || overlay === null) throw new Error('Missing comparison UI');
  return { root, compare, picker, overlay };
}

test('picker and comparison images stay lazy and report only completed decodes', async () => {
  const { root, compare, picker, overlay } = fixture();
  expect(decodes).toHaveLength(0); expect(root.querySelectorAll('.ws-x-target-img img')).toHaveLength(0);
  compare.button.click(); expect(decodes).toHaveLength(2);
  expect(picker.querySelector('.ws-progress')?.textContent).toBe('Compare · 0 / 2');
  decodes[0]?.done();
  await vi.waitFor(() => { expect(picker.querySelector('.ws-progress')?.textContent).toBe('Compare · 1 / 2'); });
  picker.querySelector<HTMLButtonElement>('.ws-x-target')?.click();
  expect(compare.isOpen).toBe(true); expect(decodes).toHaveLength(4);
  expect(overlay.querySelector('.ws-progress')?.textContent).toBe('First · 0 / 2');
  decodes[2]?.done();
  await vi.waitFor(() => { expect(overlay.querySelector('.ws-progress')?.textContent).toBe('First · 1 / 2'); });
  decodes[3]?.done();
  await vi.waitFor(() => { expect(overlay.querySelector<HTMLElement>('.ws-progress')?.hidden).toBe(true); });
  expect(root.querySelector<HTMLImageElement>('.ws-x-compare-live')?.getAttribute('src')).toBe('/first-live.jpg');
});

test('image failure is visible; closing prevents late decoders from reopening progress', async () => {
  const { compare, picker, overlay } = fixture();
  compare.button.click(); picker.querySelector<HTMLButtonElement>('.ws-x-target')?.click();
  decodes[2]?.fail(new Error('Invalid image bytes'));
  await vi.waitFor(() => { expect(overlay.querySelector('.ws-progress')?.textContent).toContain('Could not load'); });
  expect(overlay.querySelector<HTMLElement>('.ws-progress')?.hidden).toBe(false);
  compare.close(); decodes[3]?.done();
  expect(compare.isOpen).toBe(false); expect(overlay.querySelector<HTMLElement>('.ws-progress')?.hidden).toBe(true);
  expect(overlay.querySelector('img')?.hasAttribute('src')).toBe(false);
});
