// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { followsTap, listenTap } from './dom';

// QA 28 (Jake, 2026-11-10: "pressing shard select loads me instantly into driftwood"): SHARD SELECT answers its tap on
// pointerup and swaps in the deck, whose ENTER WORLD lies under the card's lower quarter at 402 px. iOS then sends that
// tap's click to ENTER WORLD, and on a busy page it came later than the old 500 ms window. A click at the tap's spot with
// no press since is the same tap, however late; a new press, or a keyboard click, acts.
const scopes: Scope[] = [];
afterEach(() => { for (const scope of scopes.splice(0)) scope.dispose(); vi.restoreAllMocks(); document.body.replaceChildren(); });

function screens(): { readonly select: HTMLButtonElement; readonly play: HTMLButtonElement; readonly entered: string[] } {
  const scope = new Scope('tap-follow'); scopes.push(scope);
  const select = document.createElement('button'), play = document.createElement('button'), entered: string[] = [];
  document.body.append(select, play);
  listenTap(scope, select, () => { entered.push('deck'); });
  listenTap(scope, play, () => { entered.push('world'); });
  return { select, play, entered };
}
const pointer = (type: string, x = 100, y = 700): PointerEvent => new PointerEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
const click = (detail: number, x = 100, y = 700): MouseEvent => new MouseEvent('click', { bubbles: true, detail, clientX: x, clientY: y });

it('the tap that opened the deck does not click ENTER WORLD under it, even late', () => {
  const { select, play, entered } = screens();
  select.dispatchEvent(pointer('pointerdown'));
  select.dispatchEvent(pointer('pointerup'));
  const at = performance.now();
  vi.spyOn(performance, 'now').mockReturnValue(at + 1800); // a busy page: the click arrives 1.8 s later
  const late = click(1);
  expect(followsTap(late)).toBe(true);
  play.dispatchEvent(late);
  expect(entered).toEqual(['deck']);
});

it('a new press is a new gesture: its click acts at the same spot', () => {
  const { select, play, entered } = screens();
  select.dispatchEvent(pointer('pointerdown'));
  select.dispatchEvent(pointer('pointerup'));
  play.dispatchEvent(pointer('pointerdown')); // the next tap (its pointerup missed, as iOS can), then its click
  play.dispatchEvent(click(1));
  expect(entered).toEqual(['deck', 'world']);
});

it('a keyboard click and a click elsewhere act', () => {
  const { select, play, entered } = screens();
  select.dispatchEvent(pointer('pointerdown'));
  select.dispatchEvent(pointer('pointerup'));
  play.dispatchEvent(click(0));
  play.dispatchEvent(click(1, 300, 300));
  expect(entered).toEqual(['deck', 'world', 'world']);
});
