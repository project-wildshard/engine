// @vitest-environment happy-dom
// QA-FEEDBACK-2026-11-25 row 35 (the OB10 class; QA 11-24 row 20 before it): staging v0.1.89's Mossgate rooms ran r25 before the cook
// wrote its packs for the build (the cook index answered 404), and the REV-BEHIND exit looped through the title, 76 loads in 90 s,
// ending black. A page that can't load its zone's revision now stays on one steady "this zone is updating" card: it asks the cook again
// on a ladder (10, 20, 40, then every 60 s), reloads only once the index is there, and never sooner than a minute after it loaded.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { isLeavingPlay, type EndReason } from '@wildshard/engine/boot/endPlay';
import { leaveForRoomsRevision, resetRoomsAheadForTest, RECHECK_LADDER_MS, RELOAD_GAP_MS, type RoomsWaitPorts } from './roomsAhead';
import { placedContent } from '../grid/placedContent';
import { behindRooms, clearPlacedSpawns, markBehindRooms } from './placedSpawn';
import { prefetchSpawnDownload } from './spawnDownload';

const HASH = 'f0e3a7601391'.padEnd(64, '0');
const BUILD = '47f94df1e63764f7b3e94bc4b7dab7976b0c151e';
let clock = 0;
beforeEach(() => { vi.useFakeTimers(); clock = 0; });
afterEach(() => { vi.useRealTimers(); resetRoomsAheadForTest(); clearPlacedSpawns(); document.getElementById('wszoneupdating')?.remove(); document.getElementById('boot-module-files')?.remove(); });

/** A page loaded at `loadedAt` on the test clock, its reloads and its one card. */
function page(recheck: () => Promise<boolean>, loadedAt = clock) {
  const reloads: { at: number; reason: EndReason }[] = [], back = vi.fn<() => void>();
  const scope = new Scope('rooms-ahead-test');
  const ports: RoomsWaitPorts = { scope, now: () => clock - loadedAt, recheck, back,
    reloadPlay: reason => { reloads.push({ at: clock, reason }); scope.dispose(); },
    mount: card => { document.documentElement.append(card); } };
  return { ports, reloads, back, scope };
}
/** Step the clock a second at a time, as the page lives it; `each` runs after every second. */
async function live(ms: number, each: () => void = () => undefined): Promise<void> {
  for (let t = 0; t < ms; t += 1000) { clock += 1000; await vi.advanceTimersByTimeAsync(1000); each(); }
}
/** The cook's index read as the page reads it (`placedContent`), from a store that answers 404 until `ready`. */
function cookIndex(state: { ready: boolean }): () => Promise<boolean> {
  const fetch404 = (): Promise<Response> => Promise.resolve(new Response('', { status: 404 }));
  return async () => state.ready || await placedContent('mossgate', HASH, { fetch: fetch404, signal: new AbortController().signal,
    packs: 'https://packs.example/', build: BUILD, validator: null }) !== undefined;
}

test('a 404 cook index gives one steady updating card, checked on the ladder, and no reload while it lasts', async () => {
  const { ports, reloads } = page(cookIndex({ ready: false }));
  const first = leaveForRoomsRevision('_mossgate', HASH, ports);
  expect(first.exit).toBe('waiting');
  // the boot's catch reads the thrown error as a page already leaving: no "failed to start" card, no fatal report
  expect(isLeavingPlay(first.error)).toBe(true);
  const card = document.getElementById('wszoneupdating');
  expect(card?.dataset['zone']).toBe('mossgate');
  expect(card?.textContent).toContain('is updating');
  expect(card?.querySelector('.status')?.textContent).toBe('Trying again in 10 s.');
  const tries: number[] = [];
  // ten minutes of a recook that hasn't finished: the same card the whole time, never a reload, never a second card
  await live(10 * 60_000, () => {
    expect(document.getElementById('wszoneupdating')).toBe(card);
    expect(document.querySelectorAll('#wszoneupdating')).toHaveLength(1);
    const tried = Number(card?.dataset['tries']);
    if (tried > (tries.at(-1) ?? 0)) tries.push(tried);
  });
  expect(reloads).toEqual([]);
  // checks at 10, 30 and 70 s, then every minute (130 s to 550 s): 11 in 10 min, each a 404
  expect(RECHECK_LADDER_MS).toEqual([10_000, 20_000, 40_000, 60_000]);
  expect(tries).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  // a second read on the same page (spawnSelection runs more than once) adds nothing
  expect(leaveForRoomsRevision('mossgate', HASH, ports).exit).toBe('gone');
  expect(document.querySelectorAll('#wszoneupdating')).toHaveLength(1);
});

test('the index arriving reloads once, never sooner than a minute after the page loaded', async () => {
  const cook = { ready: false }, { ports, reloads } = page(cookIndex(cook));
  leaveForRoomsRevision('mossgate', HASH, ports);
  await live(15_000);
  cook.ready = true; // the recook lands between the first and second checks
  await live(20_000);
  // the 30 s check saw it, but the page loaded 35 s ago: the card says so and waits out the minute
  expect(document.getElementById('wszoneupdating')?.dataset['state']).toBe('ready');
  expect(document.querySelector('#wszoneupdating .status')?.textContent).toMatch(/^Ready\. Joining in \d+ s\.$/u);
  expect(reloads).toEqual([]);
  await live(5 * 60_000);
  expect(reloads).toHaveLength(1);
  expect(reloads[0]?.at).toBe(RELOAD_GAP_MS);
  expect(reloads[0]?.reason).toMatchObject({ code: 'REV-RELOAD', zone: 'mossgate', revision: HASH, retry: true });
});

test('page after page, reloads stay at most one a minute', async () => {
  // the worst case: every check says ready and every reloaded page still can't load it
  const at: number[] = [];
  for (let n = 0; n < 5; n++) {
    resetRoomsAheadForTest(); document.getElementById('wszoneupdating')?.remove();
    const { ports, reloads } = page(() => Promise.resolve(true));
    leaveForRoomsRevision('mossgate', HASH, ports);
    while (reloads.length === 0) await live(1000);
    at.push(reloads[0]?.at ?? 0);
  }
  for (let n = 1; n < at.length; n++) expect((at[n] ?? 0) - (at[n - 1] ?? 0)).toBeGreaterThanOrEqual(60_000);
});

test('Back to title is the player\'s own exit: the card goes and nothing reloads', async () => {
  const { ports, reloads, back } = page(() => Promise.resolve(false));
  leaveForRoomsRevision('mossgate', HASH, ports);
  document.querySelector<HTMLButtonElement>('#wszoneupdating button.back')?.click();
  expect(back).toHaveBeenCalledOnce();
  expect(document.getElementById('wszoneupdating')).toBeNull();
  await live(3 * 60_000);
  expect(reloads).toEqual([]);
});

test('the title\'s read-ahead of a zone the page can\'t load only asks: no card, no navigation (the 76-load loop)', () => {
  const bank = document.createElement('script'); bank.id = 'boot-module-files'; bank.type = 'application/json';
  bank.textContent = JSON.stringify({ spawnManifests: {} });
  document.head.append(bank);
  markBehindRooms('mossgate', HASH);
  expect(behindRooms('mossgate')).toBe(HASH);
  expect(prefetchSpawnDownload('mossgate', 'phone')).toBeNull();
  expect(document.getElementById('wszoneupdating')).toBeNull();
});
