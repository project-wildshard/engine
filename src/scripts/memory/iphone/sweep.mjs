// The first device sweep used meta tmp/mini-coord/phone_nine.py and the
// driver on port 4444. Keep the public deck as the inventory for this mode.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { coldOrigin, findButton, pageState, waitForControl, watchPageErrors } from './safari.mjs';
import { readFrames } from './frames.mjs';

/** @typedef {{ index: number, name: string, enters: boolean }} DeckCard */
/** @param {import('./safari.mjs').Safari} driver @param {string} base */
async function openDeck(driver, base) {
  await driver.navigate(new URL('/', base).href);
  const limit = Date.now() + 30_000;
  while (Date.now() < limit) {
    const cards = /** @type {DeckCard[]} */ (await driver.evaluate(`
      return [...document.querySelectorAll('.ws-menu-card[data-i]')].map(el => ({
        index: Number(el.dataset.i), name: el.querySelector('b')?.textContent?.trim(),
        enters: el.dataset.enters === '1',
      }));
    `));
    if (cards.length > 0) return cards;
    const button = await findButton(driver, ['zone select', 'shard select', 'select zone']);
    if (button) await driver.click(button.el);
    await delay(350);
  }
  throw new Error('ZONE SELECT did not appear');
}

/** @param {import('./safari.mjs').Safari} driver @param {string} base @param {DeckCard} card @param {string} out
 * @param {(path: string) => Promise<void>} capture */
async function visitCard(driver, base, card, out, capture) {
  /** @type {{seconds:number,phases:import('./safari.mjs').PageState['phases']}[]} */
  const observations = [];
  /** @type {import('./safari.mjs').PageState | undefined} */
  let state;
  let lastPhases = '';
  let startedAt = Date.now();
  const baseName = `${card.index}-${card.name.toLowerCase().replaceAll(/[^a-z0-9]+/gu, '-')}`;
  try {
    await coldOrigin(driver, base);
    const inventory = await openDeck(driver, base);
    if (!inventory.some((candidate) => candidate.index === card.index && candidate.name === card.name)) {
      throw new Error('ZONE SELECT changed during this sweep');
    }
    await watchPageErrors(driver);
    await driver.evaluate(`document.querySelector('.ws-menu-card[data-i="' + arguments[0] + '"]')?.click();`, [card.index]);
    state = await driver.evaluate(pageState);
    if (!state?.visible) throw new Error('PHONE LOCKED: Safari page is not visible');
    const selected = await driver.evaluate(`return document.querySelector('.ws-menu-card.selected b')?.textContent?.trim();`);
    if (selected !== card.name) throw new Error(`deck selected ${selected} instead of ${card.name}`);
    const entry = await findButton(driver, ['enter zone', 'enter world', 'play']);
    if (!entry) return { card, outcome: 'unavailable', state, observations };
    startedAt = Date.now();
    await driver.click(entry.el);
    const boot = await waitForControl(driver, startedAt, 150_000, (sample) => {
      state = sample;
      const phase = JSON.stringify(sample.phases);
      if (phase !== lastPhases) observations.push({ seconds: (Date.now() - startedAt) / 1000, phases: sample.phases });
      lastPhases = phase;
    });
    if (boot.outcome !== 'control') return { card, ...boot, error: state?.error ?? 'sweep deadline', observations };
    const screenshot = `${baseName}.png`;
    let screenshotError = null;
    try { await capture(join(out, screenshot)); }
    catch (error) { screenshotError = String(error); }
    const fps = [];
    for (let sample = 0; sample < 3; sample++) {
      const frames = await readFrames(driver, { slug: '', seconds: 5 });
      fps.push(frames.summary.fps);
    }
    return { card, ...boot, observations, screenshot: screenshotError === null ? screenshot : null, screenshotError, fps };
  } catch (error) {
    return { card, outcome: 'driver-error', state, observations,
      error: error instanceof Error ? error.message : String(error) };
  }
}

/** @param {{driver: import('./safari.mjs').Safari, base:string, out:string,
 * recover: () => Promise<import('./safari.mjs').Safari>, capture: (path: string) => Promise<void>}} options */
export async function sweep({ driver, base, out, recover, capture }) {
  mkdirSync(out, { recursive: true });
  await coldOrigin(driver, base);
  const cards = await openDeck(driver, base);
  writeFileSync(join(out, 'deck.json'), JSON.stringify(cards, null, 2));
  const results = join(out, 'sweep.jsonl');
  let current = driver;
  for (const [index, card] of cards.entries()) {
    const result = await visitCard(current, base, card, out, capture);
    appendFileSync(results, `${JSON.stringify(result)}\n`);
    console.log(`${card.name}: ${result.outcome}${result.error ? ` · ${result.error}` : ''}`);
    if (result.error?.startsWith('PHONE LOCKED:')) throw new Error(result.error);
    if (result.outcome === 'driver-error' && index + 1 < cards.length) current = await recover();
  }
}
