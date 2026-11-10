// oxlint-disable-next-line import/no-nodejs-modules -- It serves a built page and keeps its screenshots.
import { mkdirSync, readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- As above.
import { createServer } from 'node:http';
// oxlint-disable-next-line import/no-nodejs-modules -- As above.
import type { AddressInfo } from 'node:net';
// oxlint-disable-next-line import/no-nodejs-modules -- As above.
import { extname, join, resolve } from 'node:path';
import { chromium, devices } from 'playwright';
import { build } from 'vite';
import { expect, test } from 'vitest';
import type { NetCommand } from '@wildshard/format/netCommand';
import { NetRoom } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { createSimHost } from '../src/server/engine/sim';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { socketBench } from './fixtures/socketBench';
import { tcpPuller } from './fixtures/tcpPuller';
import { SIM_LEVEL } from './fixtures/sim-level/level';
import { KEYCHAIN_ARGS } from '../scripts/chromium-keychain.mjs';

// E7.1b: a real browser sees the strip appear and clear. It needs a browser, so it runs only by name, in the browser lane:
//   WS_STRIP_PROOF=<folder> scripts/browser-lane.sh --max 5 pnpm exec vitest run test/net-strip-browser.test.ts
const FOLDER = process.env['WS_STRIP_PROOF'], OUT = resolve('tmp/online-strip');
const TYPES: Readonly<Record<string, string>> = { '.html': 'text/html', '.js': 'text/javascript' };
const STRIP = '#ws-reconnect-strip';

test.skipIf(FOLDER === undefined)('a browser sees the strip appear when the link is pulled, and clear when it comes back', async () => {
  if (FOLDER === undefined) return;
  mkdirSync(FOLDER, { recursive: true });
  await build({ configFile: false, root: resolve('test/online-strip'), logLevel: 'warn', publicDir: false, define: { __TITLE_ASSET_URLS__: '{}', __BUILD_ID__: '"proof"' }, build: { outDir: OUT, emptyOutDir: true, target: 'es2022', minify: false } });
  const pageServer = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname, file = join(OUT, path === '/' ? 'index.html' : path);
    try { const bytes = readFileSync(file); response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(bytes); } catch { response.writeHead(404).end(); }
  });
  await new Promise<void>(ready => { pageServer.listen(0, '127.0.0.1', ready); });
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')), bench = await socketBench(), puller = await tcpPuller(bench.url), host = createSimHost(SIM_LEVEL, { rapier }), world = new SimNetWorld(host);
  const room = new NetRoom({ world, step: inputs => { const commands = new Map<string, NetCommand>(); for (const row of inputs) if (row.command !== null) commands.set(row.player, row.command); host.step(commands); } });
  room.open();
  let open = true;
  void (async () => { while (open) { const end = await bench.accepted(); if (open) room.join(end, world.playerOf(leadPlayer(host).id)); } })();
  const clock = setInterval(() => { for (let tick = 0; tick < 2; tick++) room.tick(); }, 33);
  const browser = await chromium.launch({ args: [...KEYCHAIN_ARGS] }), page = await browser.newPage({ ...devices['iPhone 15'] }), { port } = pageServer.address() as AddressInfo;
  try {
    await page.goto(`http://127.0.0.1:${String(port)}/?ws=${encodeURIComponent(puller.url)}`);
    await page.waitForFunction(() => (window as unknown as { proof: { frames: number } }).proof.frames > 10);
    expect(await page.locator(STRIP).isHidden()).toBe(true);
    await page.screenshot({ path: join(FOLDER, '1-live.png') });
    const pulled = performance.now();
    puller.pull();
    await page.locator(STRIP).waitFor({ state: 'visible', timeout: 3000 });
    const shownAfter = performance.now() - pulled;
    expect((await page.locator(STRIP).innerText()).toLowerCase()).toContain('reconnecting');
    await page.screenshot({ path: join(FOLDER, '2-reconnecting.png') });
    // FM4: a tap the world must hear opens the banner's hold card and isn't sent; a chat line is held for the way back
    await page.evaluate(() => { (window as unknown as { tap: () => void }).tap(); });
    const hold = page.locator('[data-failmode$="-blocked"]');
    await hold.waitFor({ state: 'visible', timeout: 2000 });
    expect(await hold.innerText()).toContain('Interact');
    await new Promise(wait => { setTimeout(wait, 400); });
    await page.screenshot({ path: join(FOLDER, '2b-hold-card.png') });
    await page.evaluate(() => { (window as unknown as { say: (text: string) => void }).say('held line'); });
    // the link stays pulled 1.5 s in all, as before the hold card: one dial brings it back
    await new Promise(wait => { setTimeout(wait, 1100); });
    puller.restore();
    await page.locator(STRIP).waitFor({ state: 'hidden', timeout: 10_000 });
    await hold.waitFor({ state: 'detached', timeout: 2000 });
    await page.locator('[data-failmode="reconnected"]').waitFor({ state: 'visible', timeout: 2000 });
    const clearedAfter = performance.now() - pulled;
    await page.screenshot({ path: join(FOLDER, '3-clear.png') });
    const report = await page.evaluate(() => (window as unknown as { proof: { states: string[]; frames: number; rejoins: number; welcome: string | null; said: string[] } }).proof);
    expect(report.said).toEqual(['held line']);
    await page.waitForFunction(() => (window as unknown as { proof: { heard: string[] } }).proof.heard.includes('held line'), undefined, { timeout: 5000 });
    // a late duplicate would land within a second or two of the first: count after that window
    await new Promise(wait => { setTimeout(wait, 1500); });
    expect(await page.evaluate(() => (window as unknown as { proof: { heard: string[] } }).proof.heard.filter(text => text === 'held line').length)).toBe(1);
    console.info(`browser strip: shown ${shownAfter.toFixed(0)} ms after the pull, cleared at ${clearedAfter.toFixed(0)} ms, ${JSON.stringify(report)}`);
    expect(report.states).toEqual(['reconnecting', 'live']);
    expect(report.rejoins).toBe(1);
    expect(shownAfter).toBeLessThan(1600);
    expect(clearedAfter).toBeLessThan(6000);
  } finally {
    open = false; clearInterval(clock);
    await browser.close(); room.dispose(); host.dispose(); await puller.close(); await bench.close();
    await new Promise(done => { pageServer.close(done); });
  }
}, 60_000);
