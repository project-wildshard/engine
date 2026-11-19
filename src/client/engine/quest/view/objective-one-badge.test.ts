// @vitest-environment happy-dom
// QA-FEEDBACK 11-19 row 28 (Jake, Mossgate and Brasscap): the quest tracker drew two badges over each other ('LIGHT BRAZIER'
// over a fading 'COMPLETE'; 'QUEST COMPLETE' over 'REPORT | SHERIFF 114 M'). Every quest on a page has its own chip in the same
// spot under the minimap. "We shouldn't even be having overlapping badges like that." One tracker badge at a time: a completion
// shows briefly, then gives way to the next objective; it never stacks.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { installBrowserScopeEnvironment } from '../../app/view/scopeEnvironment';
import { engineString } from '../../../../shared/engine/strings';
import { ObjectiveLine } from './ui';

const COMPLETE = engineString('s_f316ae64883e');
let lines: ObjectiveLine[] = [];
const line = (): ObjectiveLine => { const made = new ObjectiveLine(); lines.push(made); return made; };
/** what the player sees: the badges drawn, by label */
const drawn = (): string[] => lines.filter(l => l.root.classList.contains('show') && !l.root.classList.contains('ws-quest-yield'))
  .map(l => l.root.querySelector('.ws-quest-obj-label')?.textContent ?? '');
let clock = 0;
/** one game frame `ms` later: every chip updates with the frame time, as QuestChip.update does */
const frame = (ms: number): void => { clock += ms; vi.advanceTimersByTime(ms); for (const l of lines) l.update(clock / 1000); };

beforeEach(() => { vi.useFakeTimers(); clock += 60_000; frame(0); installBrowserScopeEnvironment(); document.body.innerHTML = '<div id="hud"></div>'; });
afterEach(() => { for (const l of lines) l.scope.dispose(); lines = []; vi.useRealTimers(); });

test('two quest updates in the same frame draw one badge: the later one', () => {
  const a = line(), b = line();
  a.set('Light brazier', ''); b.set('Report', '');
  expect(drawn()).toEqual(['Report']);
  frame(16);
  expect(drawn()).toEqual(['Report']);
});

test('a completion shows briefly, then gives way to the next objective, never stacked', () => {
  const sheriff = line(), dunes = line();
  sheriff.set('Report', ''); frame(5000);
  dunes.set('Find the well', ''); frame(5000);
  expect(drawn()).toEqual(['Find the well']);
  // the dunes quest completes, and in the same frame the sheriff quest moves on
  dunes.set(COMPLETE, ''); sheriff.set('Ride to the mesa', '');
  expect(drawn()).toEqual([COMPLETE]);
  for (let ms = 0; ms < 2000; ms += 250) { frame(250); expect(drawn()).toHaveLength(1); }
  frame(2000);
  expect(drawn()).toEqual(['Ride to the mesa']);
  frame(10_000);
  expect(drawn()).toEqual(['Ride to the mesa']);
});

test('complete, then a new objective a moment later: still one badge at every frame', () => {
  const a = line(), b = line();
  a.set('Light brazier', ''); frame(1000);
  a.set(COMPLETE, '');
  frame(300);
  b.set('Report', '');
  for (let ms = 0; ms < 5000; ms += 100) { frame(100); expect(drawn()).toHaveLength(1); }
  expect(drawn()).toEqual(['Report']);
});

test('a lone finished quest keeps its badge; a chip with no goal draws nothing', () => {
  const a = line(), b = line();
  a.set(COMPLETE, ''); b.set('', '');
  frame(10_000);
  expect(drawn()).toEqual([COMPLETE]);
});

test('a disposed quest\'s chip leaves the slot to the others', () => {
  const a = line(), b = line();
  a.set('Report', ''); frame(100); b.set('Light brazier', '');
  expect(drawn()).toEqual(['Light brazier']);
  b.scope.dispose(); lines = lines.filter(l => l !== b);
  frame(16);
  expect(drawn()).toEqual(['Report']);
});

test('a frame clock that restarts keeps the completion hold to its length', () => {
  const a = line(), b = line();
  a.set('Report', ''); frame(1000);
  b.set(COMPLETE, ''); a.set('Ride to the mesa', '');
  clock = 0; frame(16); // a new level's frame time starts again
  expect(drawn()).toEqual([COMPLETE]);
  frame(3000);
  expect(drawn()).toEqual(['Ride to the mesa']);
});
