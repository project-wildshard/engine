#!/usr/bin/env node
// MMO-PLAN MP2.2e4 (MP2.2, J213: "phone and desktop reach one player"): on the online rig (online-rig.mjs) with api-server's own
// local `serve` beside it, in headless Chromium and WebKit, a phone-sized context and a desktop context sign in to one account by
// an email link and reach the same player and bag. Per engine:
//   - the desktop first joins as a guest, and its player is noted;
//   - the phone (402×874) taps SIGN IN, mails itself a link (api-server's LOGIN_MAIL_DIR, MP2.2e3), opens it, and joins;
//   - the desktop (1440×900) signs in with the same address and joins again;
//   - PASS when the door's saves hold one new account row and one new device row (the guest) per engine, so the phone and the
//     signed-in desktop were saved as one player and neither as its device, the two pages' seats match, and both read one bag.
// The page's own `welcome.player` is a room-local body name (the first seat in an empty room takes the lead's), so the saves, on
// this proof's PGlite, are what says who the door seated.
// The door checks tickets against this run's own key (PLAYER_TICKET_PUBLIC_KEY), which api-server signs with; neither key is
// written anywhere but the two child processes' environments. Everything binds to 127.0.0.1 and stops before the proof ends.
//   src/scripts/browser-lane.sh node src/scripts/sign-in-proof.mjs <work dir> --api-server=<api-server checkout> [--engines=chromium,webkit]
//     [--board=<png>]   (default ~/.cache/wildshard/plan-artifacts/mmo-login/board.png)
import { spawn, spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve as absolute } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { chromium, devices, webkit } from './browser-playwright.mjs';
import sharp from 'sharp';
import { KEYCHAIN_ARGS } from './.kit/chromium-keychain.mjs';
import { saveFixture } from './debug-settings.mjs';
import { intoWorld, openRig, PAGE_PORT, PG_PORT, RELEASE_PORT } from './online-rig.mjs';
import { enterZone } from './zone-entry.mjs';

const work = process.argv.slice(2).find(value => !value.startsWith('--')) ?? '';
/** @param {string} name @param {string} fallback */
const flag = (name, fallback) => process.argv.slice(2).find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const apiServer = flag('api-server', ''), engines = flag('engines', 'chromium,webkit').split(',');
const boardFile = flag('board', join(homedir(), '.cache/wildshard/plan-artifacts/mmo-login/board.png'));
if (work === '' || apiServer === '') throw new Error('usage: sign-in-proof.mjs <work dir> --api-server=<checkout> [--engines=] [--board=]');
const ROOT = absolute(import.meta.dirname, '..', '..'), WORK = absolute(work), API_PORT = PAGE_PORT - 4, API = `http://127.0.0.1:${String(API_PORT)}`;
const PAGE = `http://127.0.0.1:${String(PAGE_PORT)}`, mailDir = join(WORK, 'mail'), shots = join(WORK, 'shots');
mkdirSync(shots, { recursive: true }); rmSync(mailDir, { recursive: true, force: true }); mkdirSync(mailDir, { recursive: true });

/** @type {{ step: string, ok: boolean, detail?: unknown }[]} */
const steps = [];
/** @param {string} step @param {boolean} ok @param {unknown} [detail] */
const note = (step, ok, detail) => { steps.push({ step, ok, ...detail === undefined ? {} : { detail } }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${step}${detail === undefined ? '' : ` ${JSON.stringify(detail).slice(0, 300)}`}`); };

// ── keys: the rig's release key (kept with the dist it stamps) and this run's ticket pair (env only) ──
const keyFile = join(WORK, 'rig-key.json');
if (!existsSync(keyFile)) {
  const pair = generateKeyPairSync('ed25519');
  writeFileSync(keyFile, JSON.stringify({ private: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), public: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('hex') }), { mode: 0o600 });
}
const rigKey = /** @type {{ public: string }} */ (JSON.parse(readFileSync(keyFile, 'utf8')));
const ticketPair = generateKeyPairSync('ed25519');
process.env.PLAYER_TICKET_PUBLIC_KEY = ticketPair.publicKey.export({ type: 'spki', format: 'der' }).toString('hex');

// ── the page: built once per work dir, its API on this run's api-server, its world on the rig's release file ──
const dist = join(WORK, 'dist');
if (!existsSync(join(dist, 'version.json'))) {
  // as `pnpm build:game` builds: the pinned shards first (their validation receipts), then the app
  const built = spawnSync('python3', ['src/scripts/heavy-lane.py', 'build', '--', 'bash', '-c', `node src/scripts/pins.ts install && node src/scripts/gen.mjs --inputs-only && WILDSHARD_CATALOGUE=test/pins/catalogue.json node src/scripts/build-app.mjs --outDir '${dist}'`], { cwd: ROOT, stdio: 'inherit',
    env: { ...process.env, VITE_API_ORIGIN: API, WILDSHARD_RELEASE_URL: `http://127.0.0.1:${String(RELEASE_PORT)}/release.json`, WILDSHARD_RELEASE_KEY: rigKey.public } });
  if (built.status !== 0) throw new Error('the page build failed');
}

/** @type {(() => unknown)[]} */
const stops = [];
/** @type {PGlite | undefined} */
let pglite;
/** The players the door has saved, by kind. */
const saved = async () => {
  // before the door's first save the tables may not be there yet: nothing saved
  const read = await pglite?.query('select distinct player_id from player_save union select distinct player_id from player_place').catch(() => undefined);
  const rows = /** @type {{ player_id: string }[]} */ (read?.rows ?? []);
  const ids = rows.map(row => row.player_id);
  return { accounts: ids.filter(id => id.startsWith('account:')), guests: ids.filter(id => id.startsWith('device:')) };
};
/** Wait for the saves to show `accounts` and `guests` rows (a leaving seat saves after the rig's 6 s grace). @param {number} accounts @param {number} guests */
const savedAs = async (accounts, guests) => {
  let last = await saved();
  for (let tries = 0; tries < 80 && (last.accounts.length < accounts || last.guests.length < guests); tries++) { await new Promise(resolve => { setTimeout(resolve, 500); }); last = await saved(); }
  return last;
};
let code = 1;
try {
  // ── api-server's own local serve: PGlite, sign-in mail into a folder, this run's ticket key ──
  const api = spawn(process.execPath, ['src/cli/main.ts', 'serve', '--port', String(API_PORT), '--data', join(WORK, 'api')], { cwd: apiServer, stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, LOGIN_MAIL_DIR: mailDir, GAME_ORIGINS: PAGE, PLAYER_TICKET_SIGNING_KEY: String(ticketPair.privateKey.export({ type: 'pkcs8', format: 'pem' })) } });
  stops.push(() => { api.kill(); });
  await new Promise((resolve, reject) => { api.stdout.on('data', chunk => { if (String(chunk).includes('serving on')) resolve(undefined); }); api.on('exit', status => { reject(new Error(`api-server exited ${String(status)}`)); }); });
  note('api-server serves on loopback with a mail folder', true, { api: API });

  // ── the door's Postgres: PGlite behind the wire protocol, and a pg_ctl with nothing to start (name-prompt-proof.mjs) ──
  const db = new PGlite(), socket = new PGLiteSocketServer({ db, port: PG_PORT, host: '127.0.0.1' });
  pglite = db;
  await socket.start(); stops.push(async () => { await socket.stop(); await db.close(); });
  const pgBin = join(WORK, 'pg-bin'); mkdirSync(pgBin, { recursive: true });
  writeFileSync(join(pgBin, 'pg_ctl'), '#!/bin/sh\nexit 0\n'); chmodSync(join(pgBin, 'pg_ctl'), 0o755);
  const rig = await openRig({ dist, work: join(WORK, 'rig'), keyFile, pgBin, pgData: join(WORK, 'pg-data'), shard: 'driftwood-isle' });
  stops.push(() => rig.close());

  const { defaultBrowserType: _phoneEngine, ...iphone } = devices['iPhone 15 Pro'];
  const phoneDevice = { ...iphone, viewport: { width: 402, height: 874 }, screen: { width: 402, height: 874 } };
  /** @param {import('./browser-playwright.mjs').Browser} browser @param {Record<string, unknown>} device */
  const open = async (browser, device) => {
    const context = await browser.newContext(device), page = await context.newPage();
    await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
    await saveFixture(context, { scope: 'device', key: 'nameAsked', data: true });
    return { context, page };
  };
  /** The address's newest sign-in link. @param {string} to */
  const linkFor = async to => {
    for (let tries = 0; tries < 40; tries++) {
      const mails = readdirSync(mailDir).sort().map(file => /** @type {{ to: string, text: string }} */ (JSON.parse(readFileSync(join(mailDir, file), 'utf8')))).filter(mail => mail.to === to);
      const link = /(?<link>http\S+#login=wsl_[\w-]+)/u.exec(mails.at(-1)?.text ?? '')?.groups?.link;
      if (link !== undefined) return link;
      await new Promise(resolve => { setTimeout(resolve, 250); });
    }
    throw new Error('no sign-in mail');
  };
  /** SIGN IN on the title, mail a link, open it. @param {import('./browser-playwright.mjs').Page} page @param {string} email @param {string} shot */
  const signIn = async (page, email, shot) => {
    const before = readdirSync(mailDir).length;
    await page.goto(`${rig.base}/?mute=1&nolock=1`, { waitUntil: 'load' });
    await page.locator('.ws-main-signin').waitFor({ timeout: 150_000 });
    await page.locator('.ws-main-signin').click();
    await page.locator('#ws-signin .ws-signin-email').fill(email);
    await page.locator('#ws-signin .ws-signin-send').click();
    await page.locator('#ws-signin .ws-signin-note', { hasText: 'Check your email' }).waitFor({ timeout: 15_000 });
    for (let tries = 0; tries < 40 && readdirSync(mailDir).length === before; tries++) await page.waitForTimeout(250);
    await page.goto(await linkFor(email), { waitUntil: 'load' });
    const who = page.locator('#ws-signin .ws-signin-who');
    await who.waitFor({ timeout: 30_000 });
    await page.screenshot({ path: join(shots, `${shot}.png`) });
    return who.textContent();
  };
  /** Into Driftwood, then who the door seated and what the bag holds. @param {import('./browser-playwright.mjs').Page} page @param {string} shot */
  const join_ = async (page, shot) => {
    await enterZone(page, { zone: 'driftwood-isle', base: rig.base, flags: 'mute=1&nolock=1&skipintro=1' });
    await intoWorld(page);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(shots, `${shot}.png`) });
    return page.evaluate(() => {
      const w = /** @type {any} */ (window), net = w.__workerClientNet?.(), report = w.__workerClient?.();
      return { player: net?.client?.welcome?.player ?? null, coins: w.__wildshard?.shard?.['driftwood.loot']?.purse?.coins ?? null, owned: report?.owned ?? null };
    });
  };

  /** @type {{ engine: string, shots: string[] }[]} */
  const boards = [];
  for (const engine of engines) {
    const browser = await (engine === 'webkit' ? webkit : chromium).launch({ headless: true, args: engine === 'webkit' ? [] : [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
    stops.push(() => browser.close());
    const email = `ann-${engine}@example.test`, before = await saved();
    const desk = await open(browser, { viewport: { width: 1440, height: 900 } });
    const guest = await join_(desk.page, `${engine}-1-desktop-guest`);
    note(`${engine}: the desktop joins as a guest`, typeof guest.player === 'string', guest);
    await desk.page.goto('about:blank');
    const phone = await open(browser, phoneDevice);
    note(`${engine}: the phone signs in by an email link`, (await signIn(phone.page, email, `${engine}-2-phone-signed-in`)) === `Signed in as ${email}`);
    const phoneSeat = await join_(phone.page, `${engine}-3-phone-in-world`);
    note(`${engine}: the phone joins`, typeof phoneSeat.player === 'string', phoneSeat);
    await phone.context.close();
    note(`${engine}: the desktop signs in with the same address`, (await signIn(desk.page, email, `${engine}-4-desktop-signed-in`)) === `Signed in as ${email}`);
    const deskSeat = await join_(desk.page, `${engine}-5-desktop-in-world`);
    note(`${engine}: phone and desktop reach the same player`, deskSeat.player === phoneSeat.player, { phone: phoneSeat.player, desktop: deskSeat.player });
    note(`${engine}: not the desktop's guest`, deskSeat.player !== guest.player, { guest: guest.player });
    note(`${engine}: and read the same bag`, JSON.stringify([deskSeat.coins, deskSeat.owned]) === JSON.stringify([phoneSeat.coins, phoneSeat.owned]), { phone: [phoneSeat.coins, phoneSeat.owned], desktop: [deskSeat.coins, deskSeat.owned] });
    await desk.context.close(); await browser.close();
    const after = await savedAs(before.accounts.length + 1, before.guests.length + 1);
    note(`${engine}: the door saved one account and one guest device, nothing for the signed-in devices`,
      after.accounts.length === before.accounts.length + 1 && after.guests.length === before.guests.length + 1,
      { accounts: after.accounts.length - before.accounts.length, devices: after.guests.length - before.guests.length });
    boards.push({ engine, shots: ['1-desktop-guest', '2-phone-signed-in', '3-phone-in-world', '4-desktop-signed-in', '5-desktop-in-world'].map(name => join(shots, `${engine}-${name}.png`)) });
  }

  // ── one board: a row per engine, each shot 360 px tall, labelled ──
  const HEIGHT = 360, rows = [];
  for (const { engine, shots: row } of boards) {
    const tiles = await Promise.all(row.map(file => sharp(file).resize({ height: HEIGHT }).png().toBuffer({ resolveWithObject: true })));
    rows.push({ engine, tiles, width: tiles.reduce((sum, tile) => sum + tile.info.width + 12, 12) });
  }
  const width = Math.max(...rows.map(row => row.width)), height = rows.length * (HEIGHT + 44) + 12, composites = [];
  for (const [index, row] of rows.entries()) {
    const top = 12 + index * (HEIGHT + 44);
    composites.push({ input: Buffer.from(`<svg width="${String(width)}" height="32"><text x="12" y="24" font-family="Menlo" font-size="20" fill="#bdeeff">${row.engine}: desktop guest · phone signed in · phone in world · desktop signed in · desktop in world (same player, same bag)</text></svg>`), left: 0, top });
    let left = 12;
    for (const tile of row.tiles) { composites.push({ input: tile.data, left, top: top + 32 }); left += tile.info.width + 12; }
  }
  mkdirSync(dirname(boardFile), { recursive: true });
  await sharp({ create: { width, height, channels: 3, background: '#0b1622' } }).composite(composites).png().toFile(boardFile);
  note('the board', true, { board: boardFile });
  code = steps.every(step => step.ok) ? 0 : 1;
} catch (error) {
  note('the proof ran', false, String(error).slice(0, 400));
} finally {
  for (const stop of stops.reverse()) { try { await stop(); } catch { /* the next stop still runs */ } }
}
console.log(code === 0 ? 'PASS sign-in-proof' : 'FAIL sign-in-proof');
process.exit(code);
