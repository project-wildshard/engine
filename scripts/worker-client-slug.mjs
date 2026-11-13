// SA37 (meta SHARD-AUTHORING-PLAN): the `/slug/<slug>` link an author shares, on a world build. The page is the shard's one card;
// its PLAY leaves for `/?chunk=<slug>`, and that page enters the world's grid at the shard's cell, as a Shard select tap does.
// Passes when the server seats the body in that cell, the page stands inside it and plays, with no page error.
//   scripts/browser-lane.sh node scripts/worker-client-proof.mjs --base=<a world build> --play --only=slug [--slug=driftwood-isle]
/** @typedef {import('./types/worker-page').WorkerWindow} WorkerWindow */
import { saveFixture } from './debug-settings.mjs';
import { entered, settled } from './worker-client-grid-entry.mjs';

/** @param {import('playwright').Browser} browser @param {import('playwright').BrowserContextOptions} phone @param {string} base
 *  @param {import('./types/worker-page').ProofStep} step @param {string} [slug] */
export async function slugEntry(browser, phone, base, step, slug = 'driftwood-isle') {
  const context = await browser.newContext(phone), page = await context.newPage(), errors = /** @type {string[]} */ ([]);
  page.on('pageerror', error => { errors.push(error.message.slice(0, 300)); });
  await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
  try {
    await step(`slug: /slug/${slug} shows the shard's one card with PLAY`, async () => {
      await page.goto(new URL(`/slug/${slug}?mute=1&nolock=1`, base).href, { waitUntil: 'load' });
      const play = page.locator('.ws-slug .ws-menu-play');
      await play.waitFor({ timeout: 60_000 });
      const card = await page.evaluate(() => {
        const root = /** @type {HTMLElement | null} */ (document.querySelector('.ws-slug'));
        return { slug: root?.dataset.slug, placed: root?.dataset.placed,
        name: document.querySelector('.ws-slug .ws-menu-card b')?.textContent, play: document.querySelector('.ws-slug .ws-menu-play b')?.textContent, path: location.pathname };
      });
      return { ok: card.slug === slug && card.placed === 'true' && card.play === 'Play', ...card };
    });
    await step(`slug: PLAY enters the world's grid at ${slug}'s cell`, async () => {
      await Promise.all([page.waitForEvent('domcontentloaded', { timeout: 60_000 }).catch(() => undefined), (async () => {
        await page.locator('.ws-slug .ws-menu-play').click();
        // a device's first PLAY asks for the Name once (MP2.4)
        const name = page.locator('#ws-name-box input');
        if (await name.waitFor({ timeout: 5000 }).then(() => true, () => false)) {
          await name.fill('Slug');
          await page.locator('#ws-name-box button[type=submit]').click();
        }
      })()]);
      await entered(page);
      const out = await settled(page, slug);
      const url = new URL(page.url());
      // the grid page keeps `/` once it is in (its address is the grid, not the shard), so the cell is read from the server's seat
      return { ok: out.server === slug && out.current === slug && out.inside === slug && out.ready === true && !url.pathname.startsWith('/slug/') && errors.length === 0, path: url.pathname, server: out.server, inside: out.inside, home: out.home, ready: out.ready, frames: out.frames, closed: out.closed, errors: errors.slice(0, 4) };
    });
  } finally { await context.close(); }
}
