#!/usr/bin/env node
// MMO-PLAN MP2.2a's staging proof: a real mailed sign-in link, read from a real inbox, redeemed on staging in headless Chromium
// and WebKit. The inbox is api-server's `wildshard-proof-inbox` Worker (api-server `src/workers/proof-inbox/`): Cloudflare Email
// Routing hands `signin@proof.wildshard.io` to it, and it keeps sign-in mail in KV for an hour, read here with wrangler. Per engine:
//   - a phone-sized page (402×874) opens staging, taps SIGN IN, mails itself a link;
//   - the newest mail for the address after the tap is read from KV and its link opened in the same page;
//   - PASS when the card says "Signed in as signin@proof.wildshard.io" and the API knows the session (`/api/players/me`);
//   - then the proof deletes its own account through the API (`/api/players/me/delete`), so every run starts from no player.
// The link and session are never printed. Prod is never touched.
//   node scripts/staging-sign-in-proof.mjs <work dir> [--engines=chromium,webkit] [--page=https://staging.wildshard.io]
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve as absolute } from 'node:path';
import { chromium, webkit } from 'playwright';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';

const work = process.argv.slice(2).find(value => !value.startsWith('--')) ?? '';
/** @param {string} name @param {string} fallback */
const flag = (name, fallback) => process.argv.slice(2).find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
if (work === '') throw new Error('usage: staging-sign-in-proof.mjs <work dir> [--engines=] [--page=]');
const PAGE = flag('page', 'https://staging.wildshard.io'), engines = flag('engines', 'chromium,webkit').split(',');
if (!/^https:\/\/(?:staging|preview)\.wildshard\.io$|^http:\/\/127\.0\.0\.1:\d+$/u.test(PAGE)) throw new Error('staging, preview or local only');
const API = 'https://api.wildshard.io', EMAIL = 'signin@proof.wildshard.io', INBOX = '2137237371274897bbecc22d20b67991';
const ROOT = absolute(import.meta.dirname, '..'), shots = join(absolute(work), 'shots');
mkdirSync(shots, { recursive: true });

let failed = false;
/** @param {string} step @param {boolean} ok @param {unknown} [detail] */
const note = (step, ok, detail) => { failed ||= !ok; console.log(`${ok ? 'ok  ' : 'FAIL'} ${step}${detail === undefined ? '' : ` ${JSON.stringify(detail).slice(0, 300)}`}`); };
/** @param {string[]} args */
const kv = args => execFileSync(join(ROOT, 'node_modules/.bin/wrangler'), ['kv', 'key', ...args, '--namespace-id', INBOX, '--remote'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

/** Quoted-printable, as the mail's text part is sent. @param {string} text */
const unquote = text => text.replaceAll(/[=]\r?\n/gu, '').replaceAll(/[=](?<hex>[0-9A-F]{2})/gu, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)));

/** The mail keys for the address now. */
const mailKeys = () => new Set(/** @type {{ name: string }[]} */ (JSON.parse(kv(['list', '--prefix', `mail/${EMAIL}/`]))).map(key => key.name));
/** The link in the newest mail for the address not in `before`, waiting up to two minutes. @param {Set<string>} before */
async function linkAfter(before) {
  for (let tries = 0; tries < 24; tries++) {
    const newest = [...mailKeys()].filter(name => !before.has(name)).sort().at(-1);
    if (newest !== undefined) {
      const link = /(?<link>https:\/\/\S+?#login=wsl_[\w-]+)/u.exec(unquote(kv(['get', newest])))?.groups?.link;
      if (link !== undefined) return link;
    }
    await new Promise(resolve => { setTimeout(resolve, 5000); });
  }
  throw new Error('no sign-in mail reached the proof inbox');
}

for (const engine of engines) {
  const browser = await (engine === 'webkit' ? webkit : chromium).launch({ headless: true, args: engine === 'webkit' ? [] : [...KEYCHAIN_ARGS] });
  try {
    const context = await browser.newContext({ viewport: { width: 402, height: 874 }, isMobile: engine !== 'webkit', hasTouch: true }), page = await context.newPage();
    await page.goto(`${PAGE}/?mute=1&nolock=1`, { waitUntil: 'load' });
    await page.locator('.ws-main-signin').waitFor({ timeout: 150_000 });
    const version = await page.evaluate(async () => (await (await fetch('/version.json', { cache: 'no-store' })).json()).clientVersion);
    note(`${engine}: staging page up`, true, { version });
    await page.locator('.ws-main-signin').click();
    const before = mailKeys();
    await page.locator('#ws-signin .ws-signin-email').fill(EMAIL);
    await page.locator('#ws-signin .ws-signin-send').click();
    await page.locator('#ws-signin .ws-signin-note', { hasText: 'Check your email' }).waitFor({ timeout: 15_000 });
    note(`${engine}: the card mailed a link`, true);
    const link = await linkAfter(before);
    // a link for any other page (prod) is never opened
    if (!link.startsWith(`${PAGE}/`)) throw new Error('the mailed link is not for the page under test');
    note(`${engine}: the link arrived in the real inbox`, true);
    await page.goto(link, { waitUntil: 'load' });
    const who = page.locator('#ws-signin .ws-signin-who');
    await who.waitFor({ timeout: 150_000 });
    const said = await who.textContent();
    await page.screenshot({ path: join(shots, `${engine}-signed-in.png`) });
    note(`${engine}: the link signs the page in`, said === `Signed in as ${EMAIL}`, { said });
    note(`${engine}: the address bar keeps no token`, !page.url().includes('wsl_'));
    // the session lives in the save service's storage; it is read and used here, never printed
    const answers = await page.evaluate(async ({ api }) => {
      const key = Object.keys(localStorage).find(name => name.endsWith('wildshard.player.session'));
      const session = key === undefined ? undefined : /** @type {{ session?: string }} */ (JSON.parse(localStorage.getItem(key) ?? '{}')).session;
      if (session === undefined) return { me: 0, deleted: 0 };
      const ask = (/** @type {string} */ route, /** @type {string} */ method) => fetch(`${api}${route}`, { method, headers: { authorization: `Bearer ${session}`, 'content-type': 'application/json' }, ...(method === 'POST' ? { body: '{}' } : {}) });
      const me = (await ask('/api/players/me', 'GET')).status;
      return { me, deleted: (await ask('/api/players/me/delete', 'POST')).status };
    }, { api: API });
    note(`${engine}: the API knows the session`, answers.me === 200, { me: answers.me });
    note(`${engine}: the proof's account is deleted again`, answers.deleted === 200, { deleted: answers.deleted });
    await context.close();
  } catch (error) {
    note(`${engine}: ran`, false, { error: error instanceof Error ? error.message.replaceAll(/wsl_[\w-]+|wss_[\w-]+/gu, '<redacted>') : String(error) });
  } finally {
    await browser.close();
  }
}
console.log(failed ? 'FAIL staging sign-in proof' : 'PASS staging sign-in proof');
process.exitCode = failed ? 1 : 0;
