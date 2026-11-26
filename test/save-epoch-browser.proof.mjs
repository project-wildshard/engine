// Run explicitly through src/scripts/browser-lane.sh; never a commit or push hook.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { rolldown } from 'rolldown';
import { resolve as resolvePath } from 'node:path';
import { chromium, webkit, devices } from "../src/scripts/browser-playwright.mjs";
// e5ac68ca put this import inside the bundled page entry, where the Chromium launch never saw it (WR8b).
import { KEYCHAIN_ARGS } from '../src/scripts/.kit/chromium-keychain.mjs';

const entry = resolvePath('epoch-proof-entry.ts');
const compiler = await rolldown({ input: entry, platform: 'browser', transform: { define: { 'import.meta.env': '{"DEV":false,"PROD":true,"MODE":"production"}' } }, plugins: [{ name: 'epoch-proof-entry', resolveId(id) { if (id === entry) return entry; return null; }, load(id) { if (id === entry) return `
import { installAppIdentity } from './src/shared/engine/app/identity';
import { WILDSHARD_IDENTITY } from './src/client/game/identity';
import { SaveStore } from './src/shared/engine/saves/store';
import { openIndexedSaves, serverSaveDatabase, importServerSaves, serverStopsForImport } from './src/client/engine/saves/indexed';
import { deviceIdentity } from './src/shared/engine/net/identity';
import { Scope } from './src/shared/engine/app/scope';
import { installForceUpdate } from './src/client/engine/boot/forceUpdate';
import * as v from 'valibot';
installAppIdentity(WILDSHARD_IDENTITY);
window.epochProof = { SaveStore, openIndexedSaves, serverSaveDatabase, importServerSaves, serverStopsForImport, deviceIdentity, installAppIdentity, WILDSHARD_IDENTITY, v };
const client = document.documentElement.dataset.client;
if (client) await installForceUpdate(client, new Scope('proof.wire-floor'));
`; return null; } }] });
const bundled = (await compiler.generate({ format: 'esm', codeSplitting: false })).output.find(file => file.type === 'chunk');
await compiler.close();
if (bundled === undefined) throw new Error('Missing epoch proof bundle');
let wireVersion = '0.1.67';
const server = createServer((request, response) => {
  const path = request.url;
  response.setHeader('cache-control', 'no-store');
  if (path === '/entry.js') {
    response.setHeader('content-type', 'application/javascript'); response.end(bundled.code);
  } else if (path === '/version.json' || path === '/clear-cache.json') {
    response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ minClient: wireVersion }));
  } else {
    response.setHeader('content-type', 'text/html');
    response.end(`${path === '/wire-rollout' ? `<html data-client="${wireVersion}">` : '<html>'}<script type="module" src="/entry.js"></script>`);
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (address === null || typeof address === 'string') throw new Error('No proof server');
try {
  for (const [name, type] of [['Chromium', chromium], ['WebKit', webkit]]) {
    await test(`${name}: a stale page shows Update required before one forced reload`, async () => {
      wireVersion = '0.1.67';
      const browser = await type.launch({ headless: true, ...(type === chromium ? { args: [...KEYCHAIN_ARGS] } : {}) });
      try {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${address.port}/wire-rollout`);
        try { await page.waitForFunction(() => window.epochProof !== undefined, undefined, { timeout: 8000 }); }
        catch (error) { throw new Error(`Wire proof module failed to start: ${errors.join(', ')}`, { cause: error }); }
        await page.evaluate(() => localStorage.setItem('wire-proof-identity', 'kept'));
        wireVersion = '0.1.73';
        let reloads = 0;
        page.on('framenavigated', frame => { if (frame === page.mainFrame()) reloads++; });
        await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
        await page.locator('#ws-force-update strong', { hasText: 'Update required' }).waitFor({ state: 'visible' });
        await page.waitForFunction(() => document.documentElement.dataset.client === '0.1.73');
        assert.equal(reloads, 1);
        assert.equal(await page.evaluate(() => localStorage.getItem('wire-proof-identity')), 'kept');
        assert.equal(await page.locator('#ws-force-update').count(), 0);
      } finally { await browser.close(); }
    });
    await test(`${name}: later epoch boots carry the previous database identity durably without its progress`, { timeout: 10_000 }, async () => {
      const browser = await type.launch({ headless: true, ...(type === chromium ? { args: [...KEYCHAIN_ARGS] } : {}) });
      try {
        const page = await browser.newPage();
        await page.goto(`http://127.0.0.1:${address.port}`);
        await page.waitForFunction(() => window.epochProof !== undefined);
        const carried = await page.evaluate(async () => {
          const api = window.epochProof, stable = 'wildshard.save.v2.', key = `device:${stable}identity`;
          const zero = await api.openIndexedSaves('wildshard-saves');
          await zero.write(key, JSON.stringify({ player: 'device:stale-epoch-zero', name: 'Old' })); zero.close();
          const previous = await api.openIndexedSaves('wildshard-saves@1');
          await previous.write(key, JSON.stringify({ player: 'device:epoch-one', name: 'Jake' }));
          await previous.write('wildshard.save.v2@1.standalone-lone-driftwood-isle', '{"tick":900}'); previous.close();
          const boot = async epoch => {
            const prefix = `wildshard.save.v2@${epoch}.`;
            api.installAppIdentity({ ...api.WILDSHARD_IDENTITY, saveEpoch: epoch, savePrefix: prefix,
              previousSavePrefix: `wildshard.save.v2@${epoch - 1}.`, identityPrefix: stable });
            return { prefix, saves: await api.openIndexedSaves(api.serverSaveDatabase()) };
          };
          const second = await boot(2), identity = api.deviceIdentity(second.saves.storage, second.prefix);
          const keys = Array.from({ length: second.saves.storage.length }, (_, index) => second.saves.storage.key(index));
          const renamed = api.deviceIdentity(second.saves.storage, second.prefix, 'Alex');
          await second.saves.write(key, JSON.stringify(renamed)); second.saves.close();
          const reopened = await boot(2), durable = api.deviceIdentity(reopened.saves.storage, reopened.prefix); reopened.saves.close();
          const third = await boot(3), next = api.deviceIdentity(third.saves.storage, third.prefix); third.saves.close();
          return { identity, durable, next, keys };
        });
        assert.deepEqual(carried.identity, { player: 'device:epoch-one', name: 'Jake' });
        assert.deepEqual(carried.durable, { player: 'device:epoch-one', name: 'Alex' });
        assert.deepEqual(carried.next, carried.durable);
        assert.deepEqual(carried.keys, ['device:wildshard.save.v2.identity']);
      } finally { await browser.close(); }
    });
    await test(`${name}: epoch isolates real IDB, carries identity, rejects old files, and wipes once`, async () => {
      const browser = await type.launch({ headless: true, ...(type === chromium ? { args: [...KEYCHAIN_ARGS] } : {}) });
      try {
        const page = await browser.newPage({ ...devices['iPhone 16 Pro'] });
        await page.addInitScript(() => { HTMLMediaElement.prototype.play = async () => undefined; });
        await page.goto(`http://127.0.0.1:${address.port}`);
        await page.waitForFunction(() => window.epochProof !== undefined);
        const first = await page.evaluate(async () => {
          // WR8b: the shipped identity is epoch 2; its previous epoch is 1, whose database holds the stable identity key.
          const api = window.epochProof, stable = 'wildshard.save.v2.', old = 'wildshard.save.v2@1.', prefix = 'wildshard.save.v2@2.';
          const legacy = await api.openIndexedSaves('wildshard-saves@1');
          await legacy.write(`device:${stable}identity`, JSON.stringify({ player: 'device:kept', name: 'Jake' }));
          await legacy.write(`${old}standalone-lone-driftwood-isle`, '{"tick":900}'); legacy.close();
          localStorage.setItem(`${old}global`, JSON.stringify({ keys: { settings: { v: 1, data: false }, gfx: { v: 1, data: 'low' }, hints: { v: 1, data: true } } }));
          const store = new api.SaveStore({ local: localStorage, session: sessionStorage });
          const settings = store.define({ key: 'settings', scope: 'global', version: 1, schema: api.v.boolean(), initial: () => true });
          const before = settings.read(); settings.write(true);
          const purse = store.define({ key: 'purse', scope: 'shard', version: 1, schema: api.v.number(), initial: () => 0 }); purse.write(8, 'driftwood-isle');
          const current = await api.openIndexedSaves(api.serverSaveDatabase());
          const identity = api.deviceIdentity(current.storage, prefix);
          let stopped = false; api.serverStopsForImport(() => { stopped = true; });
          const result = await api.importServerSaves(JSON.stringify({ format: 'wildshard.save', version: 2, server: true, docs: { 'standalone-lone-driftwood-isle': { tick: 999 } } }), prefix, 'wildshard.save', { storage: localStorage, importAll: () => { throw new Error('Old file reached page import'); } });
          const keys = Array.from({ length: current.storage.length }, (_, index) => current.storage.key(index)); current.close();
          return { before, identity, keys, stopped, result, global: JSON.parse(localStorage.getItem(`${prefix}global`)), oldCanSeeNew: Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter(key => key.startsWith(old)).some(key => key.startsWith(prefix)) };
        });
        assert.equal(first.before, false); assert.equal(first.identity.player, 'device:kept'); assert.deepEqual(first.keys, ['device:wildshard.save.v2.identity']);
        assert.equal(first.stopped, false); assert.equal(first.result.imported.length, 0); assert.equal(first.oldCanSeeNew, false); assert.equal(first.global.keys.hints, undefined); assert.equal(first.global.keys.gfx.data, 'low');
        await page.reload(); await page.waitForFunction(() => window.epochProof !== undefined);
        const second = await page.evaluate(() => {
          const api = window.epochProof, store = new api.SaveStore({ local: localStorage, session: sessionStorage });
          return { settings: store.define({ key: 'settings', scope: 'global', version: 1, schema: api.v.boolean(), initial: () => false }).read(), purse: store.define({ key: 'purse', scope: 'shard', version: 1, schema: api.v.number(), initial: () => 0 }).read('driftwood-isle') };
        });
        assert.deepEqual(second, { settings: true, purse: 8 });
      } finally { await browser.close(); }
    });
  }
} finally { await new Promise(resolve => server.close(resolve)); }
