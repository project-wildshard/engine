// @vitest-environment happy-dom
// QA-FEEDBACK-2026-11-24 row 20 (Sentry WILDSHARD-GAME-BX and BP): a page older than its zone's world, caught while loading, threw a
// plain "the world runs a newer revision" Error ("the game failed to start", a fatal report). It now reloads once onto the rooms'
// revision (REV-RELOAD), then goes to the title's modal with REV-BEHIND and Retry, and the boot's catch shows nothing of its own.
import { afterEach, expect, test, vi } from 'vitest';
import { isLeavingPlay, type EndReason } from '@wildshard/engine/boot/endPlay';
import { leaveForRoomsRevision, resetRoomsAheadForTest, type RoomsAheadExits } from './roomsAhead';

const HASH = 'c0a5acd3fb81'.padEnd(64, '0');
afterEach(() => { resetRoomsAheadForTest(); });

/** the tab's rooms hints, as sessionHints keeps them */
function hints(durable = true) {
  let held = { revisions: {} as Record<string, string>, reloaded: {} as Record<string, string> };
  return { durable, read: () => held, write: (next: typeof held) => { held = next; } };
}
const funnel = () => ({ reloadPlay: vi.fn<(reason: EndReason) => void>(), endPlay: vi.fn<(reason: EndReason, to: string) => void>() }) satisfies RoomsAheadExits;

test('the first catch reloads once onto the rooms\' revision (REV-RELOAD); the next page still behind goes to the modal (REV-BEHIND, Retry)', () => {
  const tab = hints(), first = funnel();
  const reloaded = leaveForRoomsRevision('_brasscap-mesa', HASH, tab, first);
  expect(reloaded.exit).toBe('reload');
  expect(first.reloadPlay).toHaveBeenCalledOnce();
  expect(first.reloadPlay.mock.calls[0]?.[0]).toMatchObject({ code: 'REV-RELOAD', retry: true, zone: 'brasscap-mesa', revision: HASH });
  expect(first.endPlay).not.toHaveBeenCalled();
  expect(tab.read().reloaded).toEqual({ 'brasscap-mesa': HASH });
  // the boot's catch reads the thrown error as a page already leaving: no "failed to start" card, no fatal report
  expect(isLeavingPlay(reloaded.error)).toBe(true);
  expect(isLeavingPlay(new Error('The game failed to start', { cause: reloaded.error }))).toBe(true);
  expect(isLeavingPlay(new Error('brasscap-mesa: the world runs a newer revision'))).toBe(false);

  // a second read on the same page (spawnSelection runs more than once) never navigates twice
  expect(leaveForRoomsRevision('brasscap-mesa', HASH, tab, first).exit).toBe('gone');
  expect(first.reloadPlay).toHaveBeenCalledOnce();

  resetRoomsAheadForTest(); // the reloaded page, the same tab
  const second = funnel(), behind = leaveForRoomsRevision('brasscap-mesa', HASH, tab, second);
  expect(behind.exit).toBe('behind');
  expect(second.reloadPlay).not.toHaveBeenCalled();
  expect(second.endPlay).toHaveBeenCalledOnce();
  expect(second.endPlay.mock.calls[0]).toMatchObject([{ code: 'REV-BEHIND', retry: true, zone: 'brasscap-mesa', revision: HASH }, '/']);
});

test('a newer hash gets its own reload; a tab that keeps nothing never reloads (it cannot remember the one it gave)', () => {
  const tab = hints();
  tab.write({ revisions: {}, reloaded: { 'brasscap-mesa': 'a'.repeat(64) } });
  expect(leaveForRoomsRevision('brasscap-mesa', HASH, tab, funnel()).exit).toBe('reload');
  resetRoomsAheadForTest();
  const forgetful = funnel();
  expect(leaveForRoomsRevision('brasscap-mesa', HASH, hints(false), forgetful).exit).toBe('behind');
  expect(forgetful.reloadPlay).not.toHaveBeenCalled();
});
