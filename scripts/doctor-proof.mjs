#!/usr/bin/env node
// E7.5 prep: the Connection doctor in a real browser, against a real local world, healthy and then broken four real ways: the server
// stopped, the release file signed by the wrong key, and a socket a proxy refuses while it passes HTTPS. Each run must show the right
// failing step and its hint. It also walks the doors in: `/?doctor`, the title's Check connection, the Name box, and a failed boot.
// It starts nothing it does not stop and opens no port past loopback. Its key is made for the build, and signs files on 127.0.0.1 only.
//   scripts/browser-lane.sh node scripts/doctor-proof.mjs <app dist stamped with http://127.0.0.1:18899/release.json> <work dir> <key.json> [--engine=chromium|webkit]
import { spawn, spawnSync } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { join, normalize, resolve as absolute } from 'node:path';
import { chromium, devices, webkit } from 'playwright';

const ROOT = absolute(import.meta.dirname, '..');
const RELEASE_PORT = 18899, WORLD_PORT = 18897, PAGE_PORT = 18898, BLOCK_PORT = 18896, SHARD = 'driftwood-isle';
const [dist = '', work = '', keyFile = ''] = process.argv.slice(2).filter(value => !value.startsWith('--'));
const engine = process.argv.find(value => value.startsWith('--engine='))?.slice(9) ?? 'chromium';
if (dist === '' || work === '' || keyFile === '') throw new Error('usage: doctor-proof.mjs <dist> <work> <key.json> [--engine=chromium|webkit]');
const key = JSON.parse(readFileSync(keyFile, 'utf8')), wrongKey = generateKeyPairSync('ed25519').privateKey;
const build = JSON.parse(readFileSync(join(dist, 'version.json'), 'utf8')).build;
const shots = join(work, `shots-${engine}`);
mkdirSync(shots, { recursive: true });
/** @param {number} ms */
const sleep = ms => new Promise(resolve => { setTimeout(resolve, ms); });
/** @param {string[]} args @param {string} what */
const run = (args, what) => { const done = spawnSync(process.execPath, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' }); if (done.status !== 0) throw new Error(`${what} stopped: ${String(done.status)}`); return done.stdout; };

// The world: this build's server, its book and parts, a release file the test can re-sign, and the page.
const folder = run(['--input-type=module', '-e', `console.log((await import('./scripts/built-folder.mjs')).readBuiltShardfile(process.cwd(), '${SHARD}'))`], 'the product read').trim();
const origin = join(work, 'origin'), server = join(work, 'server');
run(['scripts/server-origin.mjs', origin, build, `${SHARD}=${folder}`], 'the server book');
run(['scripts/build-server.mjs', '--build', build, '--out', server], 'the server build');
/** What the release server says: a good file naming the world, the same file under another key, or one naming the refusing proxy. */
let mode = /** @type {'good' | 'wrong-key' | 'blocked'} */ ('good');
const releaseText = () => {
  const body = JSON.stringify({ channel: 'production', serial: 1, engineBuild: build, saveEpoch: 1, shards: [{ slug: SHARD, revision: 1 }], socket: `ws://127.0.0.1:${String(mode === 'blocked' ? BLOCK_PORT : WORLD_PORT)}/` });
  return JSON.stringify({ body, signature: sign(null, Buffer.from(body), mode === 'wrong-key' ? wrongKey : key.private).toString('hex') });
};
// The release server is the packs origin too, as the packs Worker is: the release file, and the book and parts under /assets/spawn/.
const packs = createServer((request, response) => {
  const path = new URL(request.url ?? '/', 'http://x').pathname, headers = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
  if (path === '/release.json') { response.writeHead(200, { ...headers, 'content-type': 'application/json' }).end(releaseText()); return; }
  const file = normalize(join(origin, path));
  if (!file.startsWith(origin) || !existsSync(file) || !statSync(file).isFile()) { response.writeHead(404, headers).end(); return; }
  response.writeHead(200, headers); createReadStream(file).pipe(response);
});
await new Promise(resolve => { packs.listen(RELEASE_PORT, '127.0.0.1', () => { resolve(null); }); });
// A network that passes HTTPS and refuses WebSockets: /health goes through to the world, an upgrade gets 403.
const proxy = createServer((request, response) => {
  const ahead = httpRequest({ host: '127.0.0.1', port: WORLD_PORT, path: request.url, method: request.method, headers: request.headers }, answer => { response.writeHead(answer.statusCode ?? 502, answer.headers); answer.pipe(response); });
  ahead.on('error', () => { response.writeHead(502).end(); });
  request.pipe(ahead);
});
proxy.on('upgrade', (_request, socket) => { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); });
await new Promise(resolve => { proxy.listen(BLOCK_PORT, '127.0.0.1', () => { resolve(null); }); });
const startWorld = () => spawn(process.execPath, [join(server, 'main.mjs')], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'],
  env: { ...process.env, RELEASE_URL: `http://127.0.0.1:${String(RELEASE_PORT)}/release.json`, RELEASE_PUBLIC_KEY: key.public, PACK_ORIGIN: `file://${origin}/`, PACK_CACHE: join(work, 'packs'),
    DATABASE_URL: 'memory:', SEAT_SECRET: 'doctor-proof', HOST: '127.0.0.1', PORT: String(WORLD_PORT), WILDSHARD_BUILD: build, WORLD_CELLS: SHARD, RELEASE_POLL_MS: '60000' } });
let world = startWorld();
for (let tries = 0; tries < 300 && !(await fetch(`http://127.0.0.1:${String(WORLD_PORT)}/health`).then(found => found.ok).catch(() => false)); tries++) await sleep(100);
const pages = spawn(process.execPath, ['scripts/preview-server.mjs', '--outDir', absolute(dist), '--port', String(PAGE_PORT)], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
for (let tries = 0; tries < 100 && !(await fetch(`http://127.0.0.1:${String(PAGE_PORT)}/version.json`).then(found => found.ok).catch(() => false)); tries++) await sleep(100);
const base = `http://127.0.0.1:${String(PAGE_PORT)}`;

const browser = await (engine === 'webkit' ? webkit : chromium).launch(engine === 'webkit' ? {} : { args: ['--use-mock-keychain', '--password-store=basic', '--mute-audio'] });
const device = engine === 'webkit' ? devices['iPhone 13'] : devices['Pixel 7'];
const failures = /** @type {string[]} */ ([]), results = /** @type {Record<string, unknown>} */ ({});
/** @param {boolean} ok @param {string} what */
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${engine} ${what}`); if (!ok) failures.push(what); };
const context = async () => {
  const opened = await browser.newContext({ ...device, ...engine === 'chromium' ? { permissions: ['clipboard-read', 'clipboard-write'] } : {} });
  return { opened, page: await opened.newPage() };
};
/** The doctor's rows once its run ends. @param {import('playwright').Page} page */
const rowsOf = async page => {
  await page.waitForSelector('#ws-doctor[data-verdict]', { timeout: 90_000 });
  return page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#ws-doctor [data-check]')].map(row => [/** @type {HTMLElement} */ (row).dataset.check,
    { state: /** @type {HTMLElement} */ (row).dataset.state, value: row.querySelector('.ws-doc-value')?.textContent ?? '', hint: row.querySelector('.ws-doc-hint')?.textContent ?? '' }])));
};
/** @param {string} name @param {string} url @param {(rows: Record<string, {state: string, value: string, hint: string}>) => void} expect */
async function scenario(name, url, expect) {
  const { opened, page } = await context();
  await page.goto(url, { waitUntil: 'load' });
  const rows = await rowsOf(page);
  results[name] = { url: page.url(), rows };
  await page.screenshot({ path: join(shots, `${name}.png`), fullPage: true });
  expect(rows);
  await opened.close();
}

try {
  // 1. Healthy, from the direct link: `/?doctor` must land on the doctor's own page past the worker.
  await scenario('healthy', `${base}/?doctor`, rows => {
    for (const id of ['page', 'release', 'packs', 'server', 'join', 'latency']) check(rows[id]?.state === 'pass', `healthy ${id} passes (${rows[id]?.value ?? ''}${rows[id]?.hint ? ` · ${rows[id]?.hint}` : ''})`);
    check(/^\d+(?:\.\d)? ms \(min \d+(?:\.\d)?\)/u.test(rows.latency?.value ?? ''), `latency is measured (${rows.latency?.value ?? ''})`);
    check(rows.release?.value.includes(`build ${build.slice(0, 7)}`) ?? false, 'the release names this build');
    check(rows.browser?.state !== 'fail', `browser check (${rows.browser?.value ?? ''})`);
  });
  const landed = /** @type {{url: string}} */ (results.healthy).url;
  check(/\/doctor\/\?/u.test(landed), `/?doctor redirects to the doctor page (${landed})`);

  // 2. The title's Check connection on a world build opens the doctor.
  {
    const { opened, page } = await context();
    await page.goto(`${base}/`, { waitUntil: 'load' });
    await page.locator('.ws-main-doctor').waitFor({ timeout: 60_000 });
    await page.screenshot({ path: join(shots, 'title.png') });
    await page.locator('.ws-main-doctor').click();
    await page.waitForURL(/\/doctor\/\?.*from=title/u, { timeout: 30_000 });
    const rows = await rowsOf(page);
    check(rows.join?.state === 'pass', 'title → doctor runs and joins');
    await page.locator('[data-doctor=back]').click();
    await page.waitForURL(`${base}/`, { timeout: 30_000 });
    check(true, 'doctor → back to game returns to the title');
    await opened.close();
  }

  // 3. The join screen's Check connection carries the cell it was loading.
  {
    const { opened, page } = await context();
    await page.goto(`${base}/?chunk=${SHARD}&skipintro=1`, { waitUntil: 'load' }); // QA row 16: a bare link lands on the title
    await page.locator('#ws-name-box [data-doctor=open]').waitFor({ timeout: 150_000 });
    await page.screenshot({ path: join(shots, 'name-box.png') });
    await page.locator('#ws-name-box [data-doctor=open]').click();
    await page.waitForURL(/\/doctor\/\?.*from=join/u, { timeout: 30_000 });
    const rows = await rowsOf(page);
    check(page.url().includes(`chunk=${SHARD}`) && (rows.join?.value.includes(SHARD) ?? false), `name box → doctor for ${SHARD}`);
    await opened.close();
  }

  // 4. The server stopped: health and the socket fail, with the tunnel hint.
  await new Promise(resolve => { world.once('exit', resolve); world.kill('SIGTERM'); setTimeout(resolve, 10_000); });
  await scenario('server-down', `${base}/doctor/?sw=0`, rows => {
    check(rows.release?.state === 'pass', 'server down: release still passes');
    check(rows.server?.state === 'fail' && rows.server.hint.includes('Server unreachable: the VPS tunnel'), `server down: server fails with the tunnel hint (${rows.server?.hint ?? ''})`);
    check(rows.join?.state === 'fail', 'server down: join fails');
  });
  world = startWorld();
  for (let tries = 0; tries < 300 && !(await fetch(`http://127.0.0.1:${String(WORLD_PORT)}/health`).then(found => found.ok).catch(() => false)); tries++) await sleep(100);

  // 5. The release file signed by another key: the release step fails, and the rest wait for it.
  mode = 'wrong-key';
  await scenario('bad-signature', `${base}/doctor/?sw=0`, rows => {
    check(rows.release?.state === 'fail' && rows.release.value === 'bad signature' && rows.release.hint.includes('pinned key'), `bad signature: release fails with the key hint (${rows.release?.hint ?? ''})`);
    check(rows.join?.state === 'skip', 'bad signature: join waits for the release');
  });
  // The game itself on that file fails to boot; its failure screen offers the doctor, which carries the screen's report.
  {
    const { opened, page } = await context();
    await page.goto(`${base}/?chunk=${SHARD}&skipintro=1`, { waitUntil: 'load' }); // QA row 16: a bare link lands on the title
    const door = page.locator('.ws-load-doctor, #wserr .doctor').first();
    await door.waitFor({ timeout: 150_000 });
    const screen = await page.evaluate(() => document.querySelector('.ws-load-error') === null ? 'error modal' : 'LS4 failure screen');
    await page.screenshot({ path: join(shots, 'failed-boot.png') });
    await door.click();
    await page.waitForURL(/\/doctor\/\?.*from=(?:ls4|failed-join)/u, { timeout: 30_000 });
    const rows = await rowsOf(page);
    check(rows.release?.state === 'fail', `${screen} → doctor shows the release failing`);
    if (engine === 'chromium') {
      await page.locator('.ws-doc-btn.primary').click();
      await page.waitForFunction(() => document.querySelector('.ws-doc-btn.primary')?.textContent === 'Copied', undefined, { timeout: 5000 });
      const report = await page.evaluate(() => navigator.clipboard.readText());
      writeFileSync(join(shots, 'failed-boot-report.txt'), report);
      check(report.includes('Wildshard connection doctor') && report.includes('2. release · fail'), 'Copy report has the doctor lines');
      check(screen !== 'LS4 failure screen' || report.includes('boot diagnostics (LS4):\nWildshard boot diagnostics'), `Copy report carries the ${screen}'s report`);
    }
    await opened.close();
  }
  mode = 'good';

  // 6. A network that passes HTTPS and refuses the WebSocket upgrade.
  mode = 'blocked';
  await scenario('blocked-socket', `${base}/doctor/?sw=0`, rows => {
    check(rows.server?.state === 'pass', `blocked socket: health still passes (${rows.server?.value ?? ''})`);
    check(rows.join?.state === 'fail' && rows.join.hint.startsWith('Socket blocked'), `blocked socket: join fails with the socket hint (${rows.join?.value ?? ''} · ${rows.join?.hint ?? ''})`);
    check(rows.latency?.state === 'skip', 'blocked socket: latency waits for the socket');
  });
  mode = 'good';
} finally {
  writeFileSync(join(work, `doctor-proof-${engine}.json`), `${JSON.stringify({ engine, build, failures, results }, null, 1)}\n`);
  await browser.close();
  pages.kill('SIGTERM'); world.kill('SIGTERM');
  packs.close(); proxy.close();
}
console.log(failures.length === 0 ? `doctor proof ${engine}: all checks pass` : `doctor proof ${engine}: ${String(failures.length)} failing`);
process.exit(failures.length === 0 ? 0 : 1);
