#!/usr/bin/env node
// E5.2b: the crossroads proof in a real module worker on this Mac: a client walks off the road into a cell, a save made there survives
// a real reload, and it walks back out. Then the page's own run prints what the worker held at each stop. `--read=<file>` keeps that.
//
//   scripts/browser-lane.sh node scripts/crossroads-smoke.mjs [--browser=chromium|webkit] [--site=tmp/crossroads/site]
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { devices, chromium, webkit } from 'playwright';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';

const option = (name, fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const engine = option('browser', 'chromium'), site = resolve(option('site', 'tmp/crossroads/site')), keep = option('read', '');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm' };
// Isolated only so Chromium will measure a worker's heap; the phone's page needs no COOP or COEP (J59 Q8).
const server = createServer((request, response) => {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname, file = resolve(site, `.${path === '/' ? '/index.html' : path}`);
  if (!file.startsWith(site + sep) || !existsSync(file) || !statSync(file).isFile()) { response.writeHead(404).end(); return; }
  response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' });
  createReadStream(file).pipe(response);
});
await new Promise(_resolve => { server.listen(0, '127.0.0.1', _resolve); });
const address = server.address(), origin = `http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}/`;
const browser = await (engine === 'webkit' ? webkit : chromium).launch({ headless: true, args: engine === 'webkit' ? [] : [...KEYCHAIN_ARGS, '--mute-audio', '--enable-experimental-web-platform-features', '--enable-blink-features=ForceEagerMeasureMemory'] });
const failures = [];
/** Physical footprint in MB of the one process that runs the tab: this Mac's stand-in for a phone's, since neither browser gives a worker's heap to a page. */
const tabFootprint = () => {
  const rows = execFileSync('ps', ['-axo', 'pid=,rss=,command='], { encoding: 'utf8' }).split('\n').map(row => /^\s*(\d+)\s+(\d+)\s+(.*)$/u.exec(row)).filter(row => row !== null);
  const tabs = rows.filter(row => engine === 'webkit' ? /WebContent|WebKitWebProcess/u.test(row[3]) && /ms-playwright|playwright/iu.test(row[3]) : /--type=renderer/u.test(row[3]) && /ms-playwright|playwright/iu.test(row[3]));
  const tab = tabs.sort((a, b) => Number(b[1]) - Number(a[1]))[0];
  if (tab === undefined) return null;
  const text = execFileSync('footprint', [tab[1]], { encoding: 'utf8' }), found = /Footprint:\s+([\d.]+)\s+(KB|MB|GB)/u.exec(text);
  return found === null ? null : Number(found[1]) * { KB: 1 / 1024, MB: 1, GB: 1024 }[found[2]];
};
try {
  const context = await browser.newContext({ ...devices['iPhone 16 Pro'], ...(engine === 'webkit' ? {} : { isMobile: false, defaultBrowserType: 'chromium' }) });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => { errors.push(String(error)); });
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(origin);
  // Through localStorage, as the shipped page keeps saves: the first boot crosses and saves, the reload resumes.
  const crossed = await page.evaluate(async () => {
    const { crossroads } = window, { corner } = crossroads, session = await crossroads.open({ arrival: { x: corner.x, y: 0, z: corner.z } }, localStorage), travels = [];
    session.client.onTravel(event => { travels.push(event); });
    await crossroads.visit(session, 2);
    const at = crossroads.worldAt(session), saved = await session.shell.save();
    await session.shell.save();
    session.stop();
    return { travels, at, saved, stored: Object.keys(localStorage).filter(key => key.startsWith('wildshard.')).map(key => [key, localStorage.getItem(key).length]) };
  });
  await page.reload();
  const resumed = await page.evaluate(async () => {
    const { crossroads } = window, session = await crossroads.open({}, localStorage), at = crossroads.worldAt(session), travels = [];
    session.client.onTravel(event => { travels.push(event); });
    await crossroads.home(session);
    session.stop();
    return { at, travels };
  });
  if (crossed.travels.length !== 1 || crossed.travels[0].from !== 0) failures.push(`crossing: ${JSON.stringify(crossed)}`);
  if (!crossed.saved.ok) failures.push(`save: ${JSON.stringify(crossed.saved)}`);
  if (resumed.at.cell !== crossed.at.cell) failures.push(`resume: ${JSON.stringify({ crossed, resumed })}`);
  if (Math.hypot(resumed.at.x - crossed.at.x, resumed.at.z - crossed.at.z) > 3) failures.push(`resumed elsewhere: ${JSON.stringify({ crossed, resumed })}`);
  if (resumed.travels.length !== 1 || resumed.travels[0].to !== 0) failures.push(`walked out: ${JSON.stringify(resumed)}`);
  console.info(JSON.stringify({ crossed: { ...crossed, stored: crossed.stored.map(([key, chars]) => `${key}:${String(chars)}`) }, resumed }));
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload();
  await page.waitForTimeout(3000);
  const footprints = { before: tabFootprint() };
  await page.exposeFunction('crossroadsPause', async name => { await page.waitForTimeout(5000); footprints[name] = tabFootprint(); });
  const lines = await page.evaluate(() => window.crossroads.run('smoke', name => window.crossroadsPause(name)));
  lines.push(`Tab footprint MB: ${JSON.stringify(footprints)}`);
  console.info(lines.join('\n'));
  if (keep !== '') writeFileSync(keep, `${lines.join('\n')}\n`);
  // The balloon's last step: a page that comes back after its second kill says what the two fills came to.
  await page.evaluate(() => { localStorage.setItem('crossroads.balloon', JSON.stringify({ phase: 'alone', blocks: 100, worker: 90 })); });
  await page.reload();
  const balloon = await page.textContent('#out');
  if (!(balloon ?? '').includes('800 MB alone, 720 MB with the worker') || !(balloon ?? '').includes('costs 80 MB')) failures.push(`balloon: ${String(balloon)}`);
  if (errors.length > 0) failures.push(`page: ${errors.slice(0, 5).join(' | ')}`);
} finally { await browser.close(); server.close(); }
if (failures.length > 0) { console.error(failures.join('\n')); process.exit(1); }
console.info(`crossroads smoke passed on ${engine}`);
