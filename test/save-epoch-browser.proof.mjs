// Run explicitly through scripts/browser-lane.sh; never a commit or push hook.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { rolldown } from 'rolldown';
import { resolve as resolvePath } from 'node:path';
import { chromium, webkit, devices } from 'playwright';

const entry = resolvePath('epoch-proof-entry.ts');
const compiler = await rolldown({ input: entry, platform: 'browser', plugins: [{ name: 'epoch-proof-entry', resolveId(id) { if (id === entry) return entry; return null; }, load(id) { if (id === entry) return `
import { installAppIdentity } from './src/shared/engine/app/identity';
import { WILDSHARD_IDENTITY } from './src/client/game/identity';
import { SaveStore } from './src/shared/engine/saves/store';
import { openIndexedSaves, serverSaveDatabase, importServerSaves, serverStopsForImport } from './src/client/engine/saves/indexed';
import { deviceIdentity } from './src/shared/engine/net/identity';
import * as v from 'valibot';
import { KEYCHAIN_ARGS } from '../scripts/chromium-keychain.mjs';
installAppIdentity(WILDSHARD_IDENTITY);
window.epochProof = { SaveStore, openIndexedSaves, serverSaveDatabase, importServerSaves, serverStopsForImport, deviceIdentity, installAppIdentity, WILDSHARD_IDENTITY, v };
`; return null; } }] });
const bundled = (await compiler.generate({ format: 'esm' })).output.find(file => file.type === 'chunk');
await compiler.close();
if (bundled === undefined) throw new Error('Missing epoch proof bundle');
const server = createServer((request, response) => { response.setHeader('content-type', request.url === '/entry.js' ? 'application/javascript' : 'text/html'); response.end(request.url === '/entry.js' ? bundled.code : '<script type="module" src="/entry.js"></script>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (address === null || typeof address === 'string') throw new Error('No proof server');
try {
  for (const [name, type] of [['Chromium', chromium], ['WebKit', webkit]]) {
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
          const api = window.epochProof, old = 'wildshard.save.v2.', prefix = 'wildshard.save.v2@1.';
          const legacy = await api.openIndexedSaves('wildshard-saves');
          await legacy.write(`device:${old}identity`, JSON.stringify({ player: 'device:kept', name: 'Jake' }));
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
