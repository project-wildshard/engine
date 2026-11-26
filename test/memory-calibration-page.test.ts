// ENGINE-MEMORY EM9 (a): the calibration page's staircase, the phone anchor that needs no cable. Every step is written to
// localStorage and a beacon; a reload reads the last step back; the tour moves to the next kind on each reload. It runs in
// Playwright WebKit where it is installed (the Mac lanes) and in Chromium otherwise (CI installs only Chromium).
// oxlint-disable-next-line import/no-nodejs-modules -- It serves the page.
import { existsSync, readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- As above.
import { createServer } from 'node:http';
// oxlint-disable-next-line import/no-nodejs-modules -- As above.
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { chromium, webkit } from '../src/scripts/browser-playwright.mjs';
import { KEYCHAIN_ARGS } from '../src/scripts/.kit/chromium-keychain.mjs';

const MB = 1e6;
const PAGE = readFileSync(new URL('../public/memory-calibration.html', import.meta.url));
const beacons: { kind: string; got: number; tour: number | null }[] = [];
const server = createServer((request, response) => {
  if (request.method === 'POST' && request.url === '/beacon') {
    let body = '';
    request.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    request.on('end', () => { beacons.push(JSON.parse(body) as (typeof beacons)[number]); response.end(); });
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html' }).end(PAGE);
});
const useWebkit = process.env['WS_CALIB_CHROMIUM'] !== '1' && existsSync(webkit.executablePath());
// Hosted shares can cache full Chromium without Playwright's separate headless shell.
const chromiumExecutable = chromium.executablePath();
const noBrowser = !useWebkit && !existsSync(chromiumExecutable);
type Browser = Awaited<ReturnType<typeof chromium.launch>>;
let browser: Browser | undefined;
let base = '';

beforeAll(async () => {
  if (noBrowser) return;
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/memory-calibration.html`;
  browser = useWebkit
    ? await webkit.launch({ headless: true })
    : await chromium.launch({ executablePath: chromiumExecutable, headless: true, args: [...KEYCHAIN_ARGS] });
  // A browser launch under a loaded land gate takes more than vitest's 10 s default (full Chromium ~7 s idle).
}, 60_000);
afterAll(async () => {
  try {
    await browser?.close();
  } finally {
    if (server.listening) server.close();
  }
});

interface Calib { done: boolean; got: number; tour: { at: number; kind: string | null; got: number; results: Record<string, { got: number; ended: string }> } | null }
const calib = async (page: Awaited<ReturnType<Browser['newPage']>>): Promise<Calib | null> => {
  try { return await page.evaluate(() => (Reflect.get(globalThis, '__calib') as Calib | undefined) ?? null); } catch { return null; } // mid-reload
};
const until = async (page: Awaited<ReturnType<Browser['newPage']>>, done: (c: Calib) => boolean, ms = 60_000): Promise<Calib> => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => { setTimeout(r, 50); })) {
    const c = await calib(page); if (c && done(c)) return c;
  }
  throw new Error('the calibration page did not get there');
};

test.skipIf(noBrowser)(`the staircase writes every step and a reload reads the last one back (${useWebkit ? 'WebKit' : 'Chromium'})`, async () => {
  const page = await browser!.newPage();
  await page.goto(`${base}?kind=arraybuffer&stair=1&stepmb=8&every=10&max=32&beacon=/beacon`);
  await until(page, (c) => c.done);
  // The browser queues each beacon independently, so the server can receive steps out of order.
  await expect.poll(() => beacons
    .filter((beacon) => beacon.kind === 'arraybuffer')
    .map((beacon) => beacon.got / MB)
    .sort((a, b) => a - b)).toEqual([8, 16, 24, 32]);
  expect(await page.evaluate(() => localStorage.getItem('calib:arraybuffer'))).toBe(String(32 * MB));
  await page.goto(`${base}?kind=arraybuffer`);
  await until(page, (c) => c.done);
  expect(await page.textContent('#log')).toContain('previous run of arraybuffer reached 32 MB before the page went away');
  await page.close();
}, 120_000);

test.skipIf(noBrowser)('the tour records where a kind died and moves on, and shows the table at the end', async () => {
  const page = await browser!.newPage();
  await page.goto(`${base}?tour=1&reset=1&stepmb=8&every=5000&max=1000`);
  await until(page, (c) => c.tour?.kind === 'arraybuffer' && c.tour.got >= 8 * MB);
  await page.reload(); // the page "dies" after its first step
  const second = await until(page, (c) => c.tour?.kind === 'jsheap');
  expect(second.tour?.results['arraybuffer']).toEqual({ got: 8 * MB, ended: 'page went away' });
  expect(await page.textContent('#log')).toContain('previous kind arraybuffer reached 8 MB before the page went away');
  expect(page.url()).not.toContain('reset');
  // the rest of the kinds reach a small max and reload by themselves
  await page.goto(`${base}?tour=1&stepmb=8&every=5&max=8`);
  const done = await until(page, (c) => c.done && c.tour?.kind === null, 90_000);
  expect(Object.keys(done.tour?.results ?? {})).toEqual(['arraybuffer', 'jsheap', 'wasm', 'worker', 'texrgba', 'texcomp', 'glbuffer', 'msaa', 'canvas2d', 'imagebitmap', 'audio']);
  expect(done.tour?.results['wasm']?.ended).toBe('reached max');
  // a kind the browser cannot make (no compressed texture format in SwiftShader) is recorded as an error and skipped
  expect(done.tour?.results['texcomp']?.ended).toMatch(/^(?:reached max|error: )/u);
  expect(await page.textContent('#log')).toContain('tour done');
  await page.close();
}, 180_000);
