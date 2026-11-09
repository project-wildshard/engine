import { saveFixture } from './debug-settings.mjs';
import { FLOOR_GRID_ENTER } from './frame-floor-navigation.mjs';
/** SR9 (C13, C14): a real canoe ride on Pine and a real winch raise on Sky Reach, through the page's own presses. The proof
 * watches what the page already draws (its weapons, the rest stand-in, its sound log and toasts); it never emits or sets a flag.
 * @param {import('playwright').Browser} browser @param {import('playwright').BrowserContextOptions} phone @param {string} base */
export async function run(browser, phone, base) {
  const canoe = await ride(browser, phone, base), bridge = await raise(browser, phone, base);
  return { ok: canoe.ok && bridge.ok, canoe, bridge };
}
/** @param {import('playwright').Page} page */
const watchToasts = page => page.evaluate(() => {
  const seen = /** @type {string[]} */ ([]), nodes = new WeakMap();
  Reflect.set(window, '__moverToasts', seen);
  // Every toast a player sees, once per showing: a node, or new words in one.
  new MutationObserver(() => { for (const node of document.querySelectorAll('.ws-game-toast')) { const text = node.textContent ?? ''; if (text !== '' && nodes.get(node) !== text) { nodes.set(node, text); seen.push(text); } } })
    .observe(document.body, { childList: true, subtree: true, characterData: true });
});
/** @param {import('playwright').Page} page @returns {Promise<string[]>} */
const toasts = page => page.evaluate(() => Reflect.get(window, '__moverToasts'));
/** Board Pine's canoe at the shore, ride it to the islet, and paddle back. @param {import('playwright').Browser} browser @param {import('playwright').BrowserContextOptions} phone @param {string} base */
async function ride(browser, phone, base) {
  const context = await browser.newContext(phone), page = await context.newPage(), errors = /** @type {string[]} */ ([]);
  page.on('pageerror', error => { errors.push(error.message.slice(0, 300)); });
  try {
    await context.addInitScript(() => { Reflect.set(window, '__wildshardHarness', { seed: 18970, capture: null }); }); // the sound log
    await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
    await page.goto(new URL('/?chunk=pine-hollow&mute=1&nolock=1&sw=0', base).href);
    await page.waitForFunction(() => Reflect.get(window, '__wildshard')?.world?.player !== undefined, undefined, { timeout: 150_000 });
    await page.evaluate(FLOOR_GRID_ENTER);
    await page.waitForFunction(() => (Reflect.get(window, '__workerClient')?.().frames ?? 0) > 30, undefined, { timeout: 90_000 });
    await page.mouse.click(5, 5); // a real gesture unlocks WebAudio; the URL keeps its master muted
    await watchToasts(page);
    /** @returns {Promise<{ led: boolean; weapons: boolean; enabled: boolean; rest: boolean; stowed: boolean; at: number[] }>} */
    const sample = () => page.evaluate(() => {
      const w = Reflect.get(window, '__wildshard'), world = w.requireWorld(), link = world.player.link;
      const view = /** @type {{ rest: () => boolean; stowed: () => boolean }} */ (w.shard['pine.canoe.ride']);
      const predictor = /** @type {{ leading: boolean } | undefined} */ (link === null ? undefined : Reflect.get(link, 'predictor'));
      return { led: predictor?.leading === true, weapons: world.weapons.visible, enabled: world.weapons.enabled, rest: view.rest(), stowed: view.stowed(), at: [world.player.position.x, world.player.position.z].map(Math.round) };
    });
    /** Stand at a carry prompt and press it as a player's E does, until the server leads the body. @param {string} id */
    const board = async id => {
      const at = await page.evaluate(want => { const prompt = Reflect.get(window, '__wildshard').requireWorld().interactables.find(row => row.wireId === want); return prompt === undefined ? null : { x: prompt.position.x, y: prompt.position.y, z: prompt.position.z }; }, id);
      if (at === null) return false;
      await page.evaluate(({ x, y, z }) => { Reflect.get(window, '__wildshard').requireWorld().player.link?.place?.(x, y + 0.2, z, 0); }, at);
      await page.waitForTimeout(1200);
      await page.evaluate(() => Reflect.get(window, '__wildshard').sounds()); // what played before the press is not the boarding's
      for (let i = 0; i < 8; i++) { await page.keyboard.press('KeyE'); await page.waitForTimeout(500); if ((await sample()).led) return true; }
      return false;
    };
    /** The ride until the lead lets go: whether the page stowed, hid and heard, and where it landed. */
    const journey = async () => {
      let stowed = false, hidden = false, refused = false, steps = 0;
      for (; steps < 160; steps++) {
        const now = await sample();
        if (!now.led) break;
        if (!now.weapons && !now.enabled && now.stowed) stowed = true; else if (now.stowed) refused = true;
        if (!now.rest) hidden = true;
        await page.waitForTimeout(250);
      }
      await page.waitForTimeout(1200);
      const end = await sample(), heard = /** @type {{ event: Record<string, number> }} */ (await page.evaluate(() => Reflect.get(window, '__wildshard').sounds()));
      return { stowed: stowed && !refused, hidden, steps, end, sounds: Object.keys(heard.event) };
    };
    const out = await board('pine.canoe.ride.0'), away = out ? await journey() : null, landed = await toasts(page);
    const back = away === null ? false : await board('pine.canoe.ride.1'), home = back ? await journey() : null;
    const hint = landed.find(text => /nobody has stood here/iu.test(text)) ?? null;
    const ok = away !== null && home !== null && away.stowed && away.hidden && away.sounds.some(id => /door/iu.test(id)) && hint !== null
      && away.end.weapons && away.end.enabled && !away.end.rest && home.stowed && home.end.rest && home.end.weapons && home.end.enabled && errors.length === 0;
    return { ok, out, away, back, home, hint, toasts: await toasts(page), errors };
  } finally { await context.close(); }
}
/** Play Sky Reach's quest to the winch as a player does, and read the endpoint's toast. @param {import('playwright').Browser} browser @param {import('playwright').BrowserContextOptions} phone @param {string} base */
async function raise(browser, phone, base) {
  // The whole-shard journeys stay outside the typed scripts (scripts/tsconfig.json excludes them); this only drives one.
  const journeys = './worker-client-fights.mjs', { farJourney } = /** @type {{ farJourney: (browser: import('playwright').Browser, phone: import('playwright').BrowserContextOptions, base: string,
    step: (name: string, play: () => Promise<unknown>) => Promise<void>, prepare: (page: import('playwright').Page) => Promise<void>, winched: (page: import('playwright').Page) => Promise<boolean>) => Promise<void> }} */ (await import(journeys));
  const steps = /** @type {{ name: string; ok: boolean }[]} */ ([]);
  /** @type {string[] | null} */
  let seen = null;
  const raised = 'The crown bridge is up'; // Sky Reach's `strings.raised`, the endpoint's toast
  await farJourney(browser, phone, base, async (name, play) => {
    let ok = false;
    try { const out = await play(); ok = out === true || (typeof out === 'object' && out !== null && Reflect.get(out, 'ok') === true); } catch { ok = false; }
    steps.push({ name, ok });
  }, watchToasts, async page => {
    await page.waitForTimeout(6000); // the winch turns on: its rows reach the end a few seconds after the press
    seen = await toasts(page);
    return true;
  });
  const shown = /** @type {string[] | null} */ (seen) ?? [], once = shown.filter(text => text === raised).length;
  return { ok: steps.every(row => row.ok) && once === 1, steps, toasts: shown, once };
}
