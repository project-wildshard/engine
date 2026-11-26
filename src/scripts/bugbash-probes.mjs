// STAGING-BUGBASH SB10 and SB14 (meta docs/plans/STAGING-BUGBASH-PLAN.md): in-page probes the T1 phone specs run with
// page.evaluate. Plain DOM reads only, like journey-proof.mjs's screenNow.

/** @typedef {{ i: number, left: number, right: number, opacity: number }} DeckCard */
/** @typedef {{ t: number, lit: number, cards: DeckCard[] }} DeckFrame */

/** Runs in the page: record Shard Select's cards every frame for `count` frames into `globalThis.__deckFrames`.
 * @param {number} count */
export function recordDeck(count) {
  /** @type {DeckFrame[]} */
  const frames = [];
  Reflect.set(globalThis, '__deckFrames', frames);
  const tick = () => {
    const cards = [...document.querySelectorAll('.ws-menu-card')];
    frames.push({
      t: performance.now(),
      lit: cards.filter((card) => card.classList.contains('selected')).length,
      cards: cards.flatMap((card, i) => {
        const rect = card.getBoundingClientRect();
        const opacity = Math.min(Number(getComputedStyle(card).opacity), ...[...card.children].map((child) => Number(getComputedStyle(child).opacity)));
        return rect.right <= 0 || rect.left >= innerWidth ? [] : [{ i, left: rect.left, right: rect.right, opacity }];
      }),
    });
    if (frames.length < count) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Runs in the page: the frames `recordDeck` kept.
 * @returns {DeckFrame[]} */
export function deckFrames() {
  return /** @type {DeckFrame[]} */ (Reflect.get(globalThis, '__deckFrames') ?? []);
}

/** Node side: a real touch swipe from x 330 to x 70 along `y`, through CDP Input.dispatchTouchEvent (Chromium), ten moves a
 * frame apart. Returns the page's clock at the release.
 * @param {import('playwright').Page} page @param {number} y @returns {Promise<number>} */
export async function touchSwipe(page, y) {
  const cdp = await page.context().newCDPSession(page);
  try {
    /** @param {'touchStart' | 'touchMove' | 'touchEnd'} type @param {number} x */
    const touch = (type, x) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
    await touch('touchStart', 330);
    for (let step = 1; step <= 10; step += 1) {
      await touch('touchMove', 330 - 26 * step);
      await new Promise((resolve) => { setTimeout(resolve, 16); });
    }
    await touch('touchEnd', 70);
    return await page.evaluate(() => performance.now());
  } finally {
    await cdp.detach();
  }
}

/** Node side: what a recorded swipe shows wrong (SB14): a see-through card, a frame without exactly one lit card, or two cards
 * overlapping more than 150 ms after the release.
 * @param {readonly DeckFrame[]} frames @param {number} released @returns {string[]} */
export function swipeProblems(frames, released) {
  /** @param {DeckFrame} frame */
  const at = (frame) => `${String(Math.round(frame.t - released))} ms`;
  return frames.flatMap((frame) => [
    ...frame.cards.filter((card) => card.opacity < 0.999).map((card) => `${at(frame)} card ${String(card.i)} opacity ${String(card.opacity)}`),
    ...(frame.lit === 1 ? [] : [`${at(frame)} ${String(frame.lit)} lit cards`]),
    ...(frame.t - released <= 150 ? [] : frame.cards.slice(1).filter((card, n) => card.left < (frame.cards[n]?.right ?? -Infinity) - 0.5)
      .map((card) => `${at(frame)} card ${String(card.i)} overlaps the one before`)),
  ]);
}
