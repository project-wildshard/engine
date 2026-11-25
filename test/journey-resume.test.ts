// STAGING-BUGBASH SB44: an old WebKit shell left in Driftwood (its browser killed mid-play) resumes into Driftwood on the next visit
// (SR4, `consumeGridRecovery`: a bare address, `<html data-resume>`), with the Name prompt over the loading card. The journey proof
// waited 60 s for a main screen that never came and failed; it now follows the resume as a player would and judges it to play.
import { expect, test } from 'vitest';
import { judge, tapJourney } from '../scripts/journey-proof.mjs';

function resumingPage(menuAfter = Infinity, address = '') {
  let nameOpen = true, reads = 0, polls = 0;
  const taps: string[] = [];
  const locator = (selector: string) => ({
    first() { return this; },
    isVisible: () => Promise.resolve(selector === '#ws-name-box [data-name=skip]' ? nameOpen : ['.ws-main-mmo', '.ws-main-select'].includes(selector) ? ++polls > menuAfter : false),
    tap: () => { taps.push(selector); if (selector === '#ws-name-box [data-name=skip]') nameOpen = false; return Promise.resolve(); },
    waitFor: () => Promise.reject(new Error(`${selector} never showed`)),
    textContent: () => Promise.resolve(''),
    allTextContents: () => Promise.resolve([]),
  });
  // the loading card while the Name is open, then play
  // CHUNK-PARAM CP4 (J522): the resume names no zone in the address; the page marks itself (`<html data-resume>`)
  const evaluate = (read: () => unknown) => String(read).includes('resume') ? Promise.resolve(address === '')
    : Promise.resolve(nameOpen || reads++ < 3 ? { doc: 1, loading: true, detailed: true } : { doc: 1, hud: true });
  const page = { url: () => `https://staging.wildshard.io/${address}`, locator, evaluate,
    waitForTimeout: (ms: number) => new Promise(resolve => { setTimeout(resolve, Math.min(ms, 20)); }) };
  return { page, taps };
}

test('an old shell that resumes into its world is followed to play, its Name skipped, with no menu tapped', { timeout: 15_000 }, async () => {
  for (const path of ['select', 'mmo'] as const) {
    const { page, taps } = resumingPage();
    const samples = await tapJourney(page as never, { card: 'driftwood-isle', path, budgetMs: 10_000, sampleMs: 10 }) as unknown as { resumed?: boolean; at: (i: number) => unknown };
    expect(samples.resumed).toBe(true);
    expect(judge(samples as never)).toEqual([]);
    expect(taps).toEqual(['#ws-name-box [data-name=skip]']);
  }
});

test('a shell from before CP4 that names its world in the address is followed the same way', { timeout: 15_000 }, async () => {
  const { page, taps } = resumingPage(Infinity, '?chunk=driftwood-isle&glreload=1');
  const samples = await tapJourney(page as never, { card: 'driftwood-isle', path: 'select', budgetMs: 10_000, sampleMs: 10 }) as unknown as { resumed?: boolean };
  expect(samples.resumed).toBe(true);
  expect(taps).toEqual(['#ws-name-box [data-name=skip]']);
});

test('an old shell that updates into this build\'s main screen after its resume is tapped through as ever', { timeout: 15_000 }, async () => {
  const { page, taps } = resumingPage(3);
  const samples = await tapJourney(page as never, { card: 'driftwood-isle', path: 'mmo', budgetMs: 10_000, sampleMs: 10 }) as unknown as { resumed?: boolean };
  expect(samples.resumed).toBeUndefined();
  expect(taps).toContain('.ws-main-mmo');
});

// SB44 (sonnet-v38proofs, staging v0.1.38): a v0.1.36 shell reloaded itself out of play during the move check, and `stickMoves`
// died on "Execution context was destroyed", taking the whole run (and its report) with it. A page that leaves play is a problem
// the run reports, never a crash.
function navigatingPage() {
  const box = { x: 10, y: 600, width: 80, height: 80 };
  return {
    url: () => 'https://staging.wildshard.io/',
    locator: () => ({ boundingBox: () => Promise.resolve(box) }),
    screenshot: () => Promise.resolve(Buffer.from('frame')),
    evaluate: () => Promise.reject(new Error('page.evaluate: Execution context was destroyed, most likely because of a navigation')),
  };
}

test('a page that reloads during the move check is reported, not thrown', async () => {
  const { stickMoves, stickProblem } = await import('../scripts/journey-proof.mjs');
  expect(await stickMoves(navigatingPage() as never)).toBe(false);
  expect(await stickProblem(navigatingPage() as never)).toMatch(/left play.*navigat.*https:\/\/staging\.wildshard\.io\//u);
});

test('any other move-check failure still throws', async () => {
  const { stickProblem } = await import('../scripts/journey-proof.mjs');
  const page = { ...navigatingPage(), evaluate: () => Promise.reject(new TypeError('boom')) };
  await expect(stickProblem(page as never)).rejects.toThrow('boom');
});
