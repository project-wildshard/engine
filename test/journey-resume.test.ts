// STAGING-BUGBASH SB44: an old WebKit shell left in Driftwood (its browser killed mid-play) resumes into Driftwood on the next visit
// (SR4, `consumeGridRecovery`: `?chunk=driftwood-isle&glreload=1`), with the Name prompt over the loading card. The journey proof
// waited 60 s for a main screen that never came and failed; it now follows the resume as a player would and judges it to play.
import { expect, test } from 'vitest';
import { judge, tapJourney } from '../scripts/journey-proof.mjs';

function resumingPage() {
  let nameOpen = true, reads = 0;
  const taps: string[] = [];
  const locator = (selector: string) => ({
    first() { return this; },
    isVisible: () => Promise.resolve(selector === '#ws-name-box [data-name=skip]' ? nameOpen : false),
    tap: () => { taps.push(selector); if (selector === '#ws-name-box [data-name=skip]') nameOpen = false; return Promise.resolve(); },
    waitFor: () => Promise.reject(new Error(`${selector} never showed`)),
    textContent: () => Promise.resolve(''),
    allTextContents: () => Promise.resolve([]),
  });
  // the loading card while the Name is open, then play
  const evaluate = () => Promise.resolve(nameOpen || reads++ < 3 ? { doc: 1, loading: true, detailed: true } : { doc: 1, hud: true });
  const page = { url: () => 'https://staging.wildshard.io/?chunk=driftwood-isle&glreload=1', locator, evaluate,
    waitForTimeout: (ms: number) => new Promise(resolve => { setTimeout(resolve, Math.min(ms, 20)); }) };
  return { page, taps };
}

test('an old shell that resumes into its world is followed to play, its Name skipped, with no menu tapped', { timeout: 15_000 }, async () => {
  for (const path of ['select', 'mmo']) {
    const { page, taps } = resumingPage();
    const samples = await tapJourney(page, { card: 'driftwood-isle', path, budgetMs: 10_000, sampleMs: 10 }) as unknown as { resumed?: boolean; at: (i: number) => unknown };
    expect(samples.resumed).toBe(true);
    expect(judge(samples as never)).toEqual([]);
    expect(taps).toEqual(['#ws-name-box [data-name=skip]']);
  }
});
