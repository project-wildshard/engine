import { saveFixture } from './debug-settings.mjs';
import { FLOOR_GRID_ENTER } from './frame-floor-navigation.mjs';
/** SR11 (C10): by Template's hidden URL, walking into Big Blob's arena shows its declared panel's name card and bar off the
 * encounter row, and falling to its blows shows the retry card. Real input only: the proof stands the player where a walk would and reads the HUD.
 * @param {import('playwright').Browser} browser @param {import('playwright').BrowserContextOptions} phone @param {string} base */
export async function run(browser, phone, base) {
  const context = await browser.newContext(phone), page = await context.newPage(), errors = /** @type {string[]} */ ([]);
  page.on('pageerror', error => { errors.push(error.message.slice(0, 300)); });
  try {
    await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
    await page.goto(new URL('/?chunk=_template&mute=1&nolock=1&sw=0', base).href);
    await page.waitForFunction(() => Reflect.get(window, '__wildshard')?.world?.player !== undefined, undefined, { timeout: 150_000 });
    await page.evaluate(FLOOR_GRID_ENTER);
    await page.waitForFunction(() => (Reflect.get(window, '__workerClient')?.().frames ?? 0) > 30, undefined, { timeout: 90_000 });
    /** The boss HUD as a player reads it, and the encounter's row. */
    const read = () => page.evaluate(() => {
      const shown = [...document.querySelectorAll('[class*="ws-boss"]')].filter(node => node.classList.contains('show')).map(node => (node.textContent ?? '').trim().replaceAll(/\s+/gu, ' ').slice(0, 80));
      const fights = /** @type {(() => { id: string; state: string }[]) | undefined} */ (Reflect.get(window, '__workerClientFights'));
      return { shown, state: fights?.().find(row => row.id === 'template.boss')?.state ?? null };
    });
    /** @param {number} x @param {number} z */
    const stand = (x, z) => page.evaluate(([px, pz]) => { Reflect.get(window, '__wildshard').requireWorld().player.link?.place?.(px, 0.5, pz, 0); }, [x, z]);
    const before = await read();
    await stand(-15, -14); // inside Big Blob's arena: its centre (-15, -20), radius 8
    const states = /** @type {string[]} */ ([]);
    let fight = before, bar = false;
    for (let i = 0; i < 40 && !bar; i++) {
      await page.waitForTimeout(500); fight = await read();
      if (fight.state !== null && states.at(-1) !== fight.state) states.push(fight.state);
      bar = fight.shown.some(text => /big blob/iu.test(text)) && (fight.state === 'fight' || fight.state === 'beat');
    }
    // The blob's real blows bring the player down where they stand: the fight arms again and its retry card shows.
    let retry = false, after = fight;
    for (let i = 0; i < 120 && !retry; i++) {
      await page.waitForTimeout(500); after = await read();
      if (after.state !== null && states.at(-1) !== after.state) states.push(after.state);
      retry = after.shown.some(text => /try the big blob again/iu.test(text));
    }
    return { ok: before.shown.length === 0 && bar && retry && errors.length === 0, before, fight, after, states, errors };
  } finally { await context.close(); }
}
