import { saveFixture } from './debug-settings.mjs';
import { FLOOR_GRID_ENTER } from './frame-floor-navigation.mjs';
/** SR11: by Template's hidden URL, real melee kills a blob and the lantern lights and burns (C8, C9), then Big Blob's bar
 * shows and retries (C10). Each in its own fresh page.
 * @param {import('playwright').Browser} browser @param {import('playwright').BrowserContextOptions} phone @param {string} base */
export async function run(browser, phone, base) {
  const items = await kit(browser, phone, base), panel = await bossPanel(browser, phone, base);
  return { ok: items.ok && panel.ok, items, panel };
}

/** @param {import('playwright').Browser} browser @param {import('playwright').BrowserContextOptions} phone @param {string} base */
async function open(browser, phone, base) {
  const context = await browser.newContext(phone), page = await context.newPage(), errors = /** @type {string[]} */ ([]);
  page.on('pageerror', error => { errors.push(error.message.slice(0, 300)); });
  await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
  await page.goto(new URL('/?chunk=_template&mute=1&nolock=1&sw=0', base).href);
  await page.waitForFunction(() => Reflect.get(window, '__wildshard')?.world?.player !== undefined, undefined, { timeout: 150_000 });
  await page.evaluate(FLOOR_GRID_ENTER);
  await page.waitForFunction(() => (Reflect.get(window, '__workerClient')?.().frames ?? 0) > 30, undefined, { timeout: 90_000 });
  return { context, page, errors };
}

/** C8 and C9: the whip's real presses kill the small blob through the server's item runtime, and the lantern's real key lights
 * it and its oil drains on the server, read back as the HUD's counter and the held lantern's light.
 * @param {import('playwright').Browser} browser @param {import('playwright').BrowserContextOptions} phone @param {string} base */
async function kit(browser, phone, base) {
  const { context, page, errors } = await open(browser, phone, base);
  try {
    const report = () => page.evaluate(() => { const r = Reflect.get(window, '__workerClient')?.(); return { hits: r?.hits ?? 0, kills: r?.kills ?? 0 }; });
    const before = await report();
    let presses = 0, after = before;
    for (; presses < 40 && after.kills === before.kills; presses++) {
      // Stand three metres off the blob and look at its body, as a player walking up would; the press is the page's own input.
      const aimed = await page.evaluate(() => {
        const { player, animals, game } = Reflect.get(window, '__wildshard').requireWorld();
        const body = animals.animals.filter(row => row.alive && row.scale < 1.5).sort((a, b) => Math.hypot(a.position.x, a.position.z + 19) - Math.hypot(b.position.x, b.position.z + 19))[0];
        if (body === undefined) return false;
        if (Math.hypot(player.position.x - body.position.x, player.position.z - body.position.z) > 3.5) player.link?.place?.(body.position.x, body.position.y + 0.5, body.position.z + 3, 0);
        const dx = body.position.x - player.position.x, dz = body.position.z - player.position.z;
        player.yaw = Math.atan2(-dx, -dz); player.pitch = Math.atan2(body.position.y + 0.65 - player.position.y - 1.68, Math.hypot(dx, dz));
        game.app.input.press('attack'); return true;
      });
      if (!aimed) break;
      await page.waitForTimeout(550);
      after = await report();
    }
    const melee = { ok: after.kills > before.kills && after.hits > before.hits, presses, before, after };
    const lantern = () => page.evaluate(() => {
      const world = Reflect.get(window, '__wildshard').requireWorld(), link = world.player.link, owned = link === null ? undefined : /** @type {Map<string, number> | undefined} */ (Reflect.get(link, 'client')?.owned);
      const tool = world.game.app.equipment?.tools.find(row => 'light' in row && row.id === 'tool.template-lantern');
      const meter = document.querySelector('meter[aria-label="LANTERN OIL"]'), counter = meter instanceof HTMLMeterElement ? meter.value : null;
      return { oil: owned?.get('template.lantern.oil') ?? null, lit: owned?.get('template.lantern.lit') ?? null, light: tool === undefined ? null : Reflect.get(Reflect.get(tool, 'light'), 'intensity'), counter };
    });
    const dark = await lantern();
    await page.evaluate(() => { Reflect.get(window, '__wildshard').requireWorld().game.app.input.press('template.lantern.toggle'); });
    await page.waitForTimeout(1500);
    const lit = await lantern();
    await page.waitForTimeout(4000);
    const burnt = await lantern();
    const lamp = { ok: dark.lit !== 1 && dark.light === 0 && lit.lit === 1 && (lit.light ?? 0) > 0 && lit.oil !== null && burnt.oil !== null && burnt.oil < lit.oil && lit.oil < 1
      && burnt.counter !== null && Math.abs(burnt.counter - burnt.oil) < 0.01, dark, lit, burnt };
    return { ok: melee.ok && lamp.ok && errors.length === 0, melee, lamp, errors };
  } finally { await context.close(); }
}

/** C10: walking into Big Blob's arena shows its declared panel's name card and bar off the encounter row, and falling to its
 * blows shows the retry card. Real input only: the proof stands the player where a walk would and reads the HUD.
 * @param {import('playwright').Browser} browser @param {import('playwright').BrowserContextOptions} phone @param {string} base */
async function bossPanel(browser, phone, base) {
  const { context, page, errors } = await open(browser, phone, base);
  try {
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
