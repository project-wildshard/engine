// FM10c2: the real game presenter/outbox through the real owned API app and filesystem records port.
// Run through browser-lane.sh: <preview URL> <API failure-telemetry-fixture.ts> <fresh work> [chromium|webkit].
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve as absolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, devices, webkit } from "./browser-playwright.mjs";
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';
import { claimFixture } from './online-rig-owned.mjs';

const [preview, helper, namedWork, engine = 'chromium'] = process.argv.slice(2);
if (!preview || !helper || !namedWork || !['chromium', 'webkit'].includes(engine)) throw new Error('failmode-telemetry-proof <owned preview URL> <API fixture module> <fresh work> [chromium|webkit]');
const target = new URL(preview);
if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || target.port === '') throw new Error('Owned loopback preview required');
const work = claimFixture(namedWork);
const { openFailureTelemetryFixture } = await import(pathToFileURL(absolute(helper)).href);
const api = await openFailureTelemetryFixture(preview, join(work, 'api'));
let browser = /** @type {import('playwright').Browser | undefined} */ (undefined);
let context = /** @type {import('playwright').BrowserContext | undefined} */ (undefined);
let page = /** @type {import('playwright').Page | undefined} */ (undefined);
const errors = /** @type {string[]} */ ([]), foreign = /** @type {string[]} */ ([]);
/** Read only this proof's registered outbox, without changing the page's saves.
 * @returns {{data:{id:string}}[]} */
const pending = () => {
  for (const key of Object.keys(localStorage)) {
    try {
      const entry = JSON.parse(localStorage.getItem(key) ?? 'null')?.keys?.['telemetry.failureOutcomes'];
      if (typeof entry?.data === 'string') return JSON.parse(entry.data);
    } catch { /* Another registered key is not the outbox. */ }
  }
  return [];
};
/** @param {import('playwright').Page} targetPage */
async function enter(targetPage) {
  targetPage.on('pageerror', error => { errors.push(error.name); });
  await targetPage.goto(api.origin, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await targetPage.waitForFunction(() => document.querySelector('#hud.intro') !== null && document.querySelector('[data-title-shell]') === null, undefined, { timeout: 120_000 });
}
try {
browser = await (engine === 'chromium' ? chromium.launch({ headless: true, args: [...KEYCHAIN_ARGS] }) : webkit.launch({ headless: true }));
context = await browser.newContext({ ...devices['iPhone 17 Pro'], viewport: { width: 402, height: 874 } });
await context.addInitScript(() => {
  const documentId = crypto.randomUUID(), native = globalThis.fetch.bind(globalThis);
  Reflect.set(globalThis, '__fmTelemetryDocument', documentId);
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
    if (url.origin !== location.origin || url.pathname !== '/api/telemetry') return native(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set('x-fm-proof-document', documentId);
    return native(input, { ...init, headers });
  };
});
await context.routeWebSocket('**/*', async socket => { foreign.push(new URL(socket.url()).origin); await socket.close({ code: 1008, reason: 'HTTP-only owned proof' }); });
await context.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.origin === api.origin) await route.continue();
  else { foreign.push(url.origin); await route.abort('blockedbyclient'); }
});
  page = await context.newPage();
  api.arm('refuse');
  await enter(page);
  const firstDocument = await page.evaluate(() => Reflect.get(globalThis, '__fmTelemetryDocument'));
  const build = await page.evaluate(() => Reflect.get(globalThis, '__WS_BUILD_ID__'));
  const previewVersion = await (await fetch(new URL('/version.json', preview))).json();
  assert.equal(build, previewVersion.build);
  // Use the real Settings control and the real failed HTTP preflight, never the Developer gallery.
  await page.locator('button:visible:not([inert] *)').filter({ hasText: /^settings$/iu }).first().click();
  await page.getByRole('tab', { name: /^system$/iu }).click();
  await page.locator('.ws-gmenu-doctor').click({ timeout: 60_000 });
  const card = page.locator('[data-failmode="doctor-http"]');
  await card.waitFor({ state: 'visible', timeout: 30_000 });
  await page.evaluate(() => new Promise(resolve => { requestAnimationFrame(() => { requestAnimationFrame(resolve); }); }));
  const copy = await card.textContent();
  await page.screenshot({ path: join(work, 'visible.jpg'), type: 'jpeg', quality: 70 });
  const refusal = page.waitForResponse(response => response.url().endsWith('/api/telemetry') && response.status() >= 500, { timeout: 30_000 });
  await card.getByRole('button', { name: 'Back to the game', exact: true }).click();
  await refusal;
  await api.waitForAttempts(1); await api.waitForStored(0);
  assert.equal(api.attempts[0].document, firstDocument);
  const first = api.attempts[0].payload.events[0].data;
  assert.equal(first.screen, 'doctor-http'); assert.equal(first.clear, 'dismissed'); assert.ok(first.durationMs > 0);
  assert.equal(api.attempts[0].status, 500);
  assert.equal((await page.evaluate(pending)).filter(item => item.data.id === first.id).length, 1);
  const before = await api.digest();
  assert.equal(before.failureScreens?.['doctor-http'], undefined);

  api.arm('hold');
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
  const secondDocument = await page.evaluate(() => Reflect.get(globalThis, '__fmTelemetryDocument'));
  assert.notEqual(secondDocument, firstDocument);
  await api.waitForDocument(secondDocument);
  const heldAttempt = api.attempts.find((/** @type {{document?:string}} */ attempt) => attempt.document === secondDocument);
  assert.ok(heldAttempt);
  assert.deepEqual(heldAttempt.payload.events[0].data, first);
  assert.equal(heldAttempt.status, undefined, 'a held PUT has no API acknowledgement');
  assert.equal((await page.evaluate(pending)).filter(item => item.data.id === first.id).length, 1);
  assert.equal((await api.digest()).failureScreens?.['doctor-http'], undefined);
  api.releasePut(); await api.waitForDocument(secondDocument, 200);
  assert.equal(heldAttempt.status, 200, 'real records PUT completed before the API answered');
  assert.equal((await page.evaluate(pending)).filter(item => item.data.id === first.id).length, 1, 'network-held acknowledgement keeps the outcome');
  // Close the actual document before its successful acknowledgement arrives; its device outbox must replay unchanged.
  await page.close(); api.release();
  page = await context.newPage();
  await enter(page);
  const thirdDocument = await page.evaluate(() => Reflect.get(globalThis, '__fmTelemetryDocument'));
  assert.notEqual(thirdDocument, firstDocument); assert.notEqual(thirdDocument, secondDocument);
  await api.waitForDocument(thirdDocument, 200);
  for (const attempt of api.attempts) assert.deepEqual(attempt.payload.events[0].data, first);
  await page.waitForFunction(id => {
    for (const key of Object.keys(localStorage)) {
      try { const entry = JSON.parse(localStorage.getItem(key) ?? 'null')?.keys?.['telemetry.failureOutcomes']; if (typeof entry?.data === 'string' && JSON.parse(entry.data).some((/** @type {{data:{id:string}}} */ item) => item.data.id === id)) return false; } catch { /* Other save. */ }
    }
    return true;
  }, first.id);
  const digest = await api.digest();
  assert.deepEqual(digest.failureScreens?.['doctor-http'], { episodes: 1, durationMs: first.durationMs, clears: { dismissed: 1 } });
  assert.deepEqual(errors, []); assert.deepEqual(foreign, []);
  const source = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const receiver = execFileSync('git', ['-C', dirname(absolute(helper)), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  writeFileSync(join(work, 'receipt.json'), `${JSON.stringify({ schema: 'failure-producer-proof/1', at: new Date().toISOString(), source, receiver, build, engine, browser: browser.version(), viewport: '402x874', documents: [firstDocument, secondDocument, thirdDocument], copy, outcome: first, attempts: api.attempts, digest: digest.failureScreens, refusedWrite: true, heldPutUnacknowledged: true, lostAcknowledgementReplayed: true, sameIdAcrossDocuments: true, acknowledgedOutcomeRemoved: true, errors, foreign, pass: true }, null, 2)}\n`);
  console.log(`PASS FM10c2 ${engine}: native presenter, registered outbox, real refused/held PUT, lost-ack document replay; one digest episode`);
} catch (error) {
  if (page !== undefined && !page.isClosed()) writeFileSync(join(work, 'failed-ui.txt'), (await page.locator('body').textContent() ?? '').slice(-12000));
  writeFileSync(join(work, 'failed-observations.json'), JSON.stringify({ errors, foreign }, null, 2));
  throw error;
} finally {
  try { await context?.close(); } finally { try { await browser?.close(); } finally { await api.close(); } }
}
