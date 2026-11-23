// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { holdTitleEntry, type WorldHeard } from '../src/client/host/online/titleHold';
import { clearRestart, noteRestart } from '../src/client/game/grid/worldRestart';

// FM4 (meta MMO-FAILURE-MODES-PLAN, 9b and 10b): Enter world on the title while the world is restarting or about to move holds the
// tap on a card that joins by itself; Cancel stays on the title. Only what the page observed: a restart this tab heard and a world
// that isn't answering yet, or the world's own word that a move is due. Anything else enters at once, with no guessed cause.
const world = { release: 'http://127.0.0.1/release.json', key: 'ab' };
const shown = (ids: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-failmode~="${ids}"]:not([hidden])`);
const click = (root: HTMLElement | null, label: string): void => { [...root?.querySelectorAll('button') ?? []].find(button => (button.textContent ?? '').includes(label))?.click(); };
const flush = async (): Promise<void> => { for (let at = 0; at < 6; at++) await Promise.resolve(); };
/** A world whose answers are scripted, one per ask (the last repeats). */
const answers = (...heard: WorldHeard[]): { ask: (asked: typeof world) => Promise<WorldHeard>; asked: () => number } => {
  let count = 0;
  return { ask: () => Promise.resolve(heard[Math.min(count++, heard.length - 1)] ?? { heard: false }), asked: () => count };
};
beforeEach(() => { vi.useFakeTimers(); clearRestart(); });
afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); document.head.replaceChildren(); clearRestart(); });

test('a world that answers with no move due enters at once', async () => {
  const go = vi.fn<() => void>();
  await holdTitleEntry(world, go, answers({ heard: true, movingInS: null }).ask);
  expect(go).toHaveBeenCalledOnce();
  expect(document.querySelector('[data-failmode]')).toBeNull();
});

test('a world that isn\'t answering, with no restart heard, enters at once: the in-world screens say why, no cause is guessed', async () => {
  const go = vi.fn<() => void>();
  await holdTitleEntry(world, go, answers({ heard: false }).ask);
  expect(go).toHaveBeenCalledOnce();
});

test('9b: after a restart this tab heard, a quiet world holds Enter world on restart-blocked, which joins by itself when it answers', async () => {
  noteRestart();
  const go = vi.fn<() => void>(), world2 = answers({ heard: false }, { heard: false }, { heard: true, movingInS: null });
  void holdTitleEntry(world, go, world2.ask);
  await flush();
  const card = shown('restart-blocked');
  expect(card?.textContent).toContain('You tapped Enter world');
  expect(card?.textContent).toContain('The world is restarting');
  expect(go).not.toHaveBeenCalled();
  // a second tap while held adds no card and no entry
  await holdTitleEntry(world, go, world2.ask);
  expect(document.querySelectorAll('[data-failmode~="restart-blocked"]')).toHaveLength(1);
  // each ask is a socket against the door's 10 a minute: one every 8 s
  await vi.advanceTimersByTimeAsync(8000);
  expect(go).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(8000);
  expect(go).toHaveBeenCalledOnce();
  expect(shown('restart-blocked')).toBeNull();
  // seated again: the restart is over, so the next tap enters at once
  expect(world2.asked()).toBe(3);
});

test('Cancel stays on the title: the card goes and nothing enters later', async () => {
  noteRestart();
  const go = vi.fn<() => void>(), world2 = answers({ heard: false });
  void holdTitleEntry(world, go, world2.ask);
  await flush();
  click(shown('restart-blocked'), 'Cancel');
  expect(shown('restart-blocked')).toBeNull();
  const asked = world2.asked();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(go).not.toHaveBeenCalled();
  expect(world2.asked()).toBe(asked);
});

test('10b: in a deploy\'s last 15 s Enter world holds on deploy-blocked with the world\'s own countdown, and joins after the move', async () => {
  const go = vi.fn<() => void>(), world2 = answers({ heard: true, movingInS: 8 }, { heard: false }, { heard: true, movingInS: null });
  void holdTitleEntry(world, go, world2.ask);
  await flush();
  const card = shown('deploy-blocked');
  expect(card?.textContent).toContain('in 8 s');
  await vi.advanceTimersByTimeAsync(5000);
  expect(shown('deploy-blocked')?.textContent).toContain('in 3 s');
  // no ask before the move: the countdown is the world's word
  expect(world2.asked()).toBe(1);
  // at the move the world goes quiet (a restart), and then answers with no move due
  await vi.advanceTimersByTimeAsync(3000);
  expect(go).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(8000);
  expect(go).toHaveBeenCalledOnce();
  expect(shown('deploy-blocked')).toBeNull();
});

test('a move further off than 15 s enters at once (everything works during the countdown)', async () => {
  const go = vi.fn<() => void>();
  await holdTitleEntry(world, go, answers({ heard: true, movingInS: 40 }).ask);
  expect(go).toHaveBeenCalledOnce();
});
