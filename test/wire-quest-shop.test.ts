// @vitest-environment happy-dom
// A shop's page half on the wire: it checks a press, says it to the server, and keeps its feedback and modal hooks. What's paid is the
// server's (`net-exchange`). The flip's page `Exchange.use` goes, and the tests that drove it.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Vector3 } from 'three';
import { App } from '../src/client/engine/app/app';
import { Scope } from '../src/shared/engine/app/scope';
import { createLevelInstallation } from '../src/client/engine/level/installation';
import { WorldRegistry } from '../src/client/engine/world/registry';
import { shardContext, sourceManifest } from '../src/client/game/plugin/context';
import { QuestViews } from '../src/client/game/plugin/ui';
import { createShardProduct } from '../src/shared/game/shardfile/shardProduct';
import { Owned } from '../src/shared/game/loot/Owned';
import { OWNED_ROW } from '../src/shared/game/loot/ownedRows';
import { Purse, publishPurse, enteredPurse } from '../src/shared/game/loot/Purse';
import { installQuestTrader, installQuestShop } from '../src/client/game/quest/trader';
import { wirePage } from '../src/client/game/shardfile/wirePage';
import { NetClient } from '../src/client/engine/net/client';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { builtProduct } from './fixtures/builtProduct';
import { declaredLootEconomy } from '../src/shared/game/shard/declaredRows';
import type { Transport } from '../src/shared/engine/net/transport';

const { shardfile: source } = await loadHeadlessProduct(builtProduct('driftwood-isle'));
const TEMPLATE = sourceManifest({ identity: source.identity, accent: source.accent, spawn: source.spawn, look: source.look });
const coinRows = { name: 'Maren', reopen: false, shop: {
  place: 'Driftwood Isle', barter: false, lifetime: 'resident', modal: { restartOnClose: true, stow: true, resumeSwimming: true },
  after: Object.fromEntries(declaredLootEconomy(source.rows.loot).goods.map(good => [good.id, [
    { kind: 'chime', at: 'counter', gain: .8 }, { kind: 'offer' },
    { kind: 'toast', text: `Bought · ${good.name} — ${good.id === 'cape' ? 'wear it from GEAR' : good.does.toLowerCase()}` },
  ]])),
} };

function page(loot: unknown = source.rows.loot) {
  const scope = new Scope('shop-entry'), host = new App(), events: string[] = [], owned = new Owned('shop-entry');
  for (const id of owned.all) owned.revoke(id);
  const product = createShardProduct({ slug: source.identity.slug, revision: source.identity.revision, shardfile: source,
    sections: new Map([['economy/loot', { rows: { loot } }]]), files: new Map(), read: () => Promise.reject(new Error('No shop file read')) });
  const level = createLevelInstallation(host, scope, {}, () => ({ set: () => undefined, detail: () => undefined }));
  const ctx = shardContext(level.context, TEMPLATE, { shard: TEMPLATE, rows: new Map(), bag: { tab: () => () => undefined, fragment: () => () => undefined } }, product);
  const pack = new Map<string, number>(), inventory = {
    count: (id: string) => pack.get(id) ?? 0,
    take: (id: string, n: number) => { if ((pack.get(id) ?? 0) < n) return false; pack.set(id, (pack.get(id) ?? 0) - n); events.push(`take:${id}:${n}`); return true; },
    add: (id: string, n: number) => { pack.set(id, (pack.get(id) ?? 0) + n); events.push(`add:${id}:${n}`); },
  };
  const hud = { holdPause: false, entered: true, toast: (text: string) => { events.push(text); }, setPaused: () => undefined };
  const weapons = { stowed: false, setEnabled: (on: boolean) => { events.push(`weapons:${on}`); } };
  Object.defineProperty(ctx.game, 'runtime', { value: {
    world: { registry: new WorldRegistry(), player: { position: new Vector3(), yaw: 0, pitch: 0, swimming: false } },
    play: { owned, inventory, hud, weapons, menu: { isOpen: false, close: () => undefined }, nolock: true, touchUi: () => true,
      audio: { voices: { play: (id: string) => { events.push(id); } } } }, interactables: [],
  } });
  return { ctx, scope, events, owned, pack, hud, weapons };
}

const silent: Transport = { send: () => undefined, close: () => undefined, onMessage: () => () => undefined, onClose: () => () => undefined, stats: { rttMs: 0, lossPct: 0, sentBytes: 0, recvBytes: 0 } };
let said: unknown[], client: NetClient, version = 0;
/** The server's grant: the good's bought line rises, and a frame reads it. `wirePage` outlives a test and reads a version once. */
function granted(good: number): void {
  client.owned.set(`${OWNED_ROW.purchase}${String(good)}`, 1); client.ownedVersion = ++version;
  client.latest = { tick: 2, baselineTick: -1, cell: 1, lastSeq: 0, owner: new Float64Array(0), rows: new Map(), ride: null, fresh: new Set() };
  wirePage.frame(null, true);
}
beforeEach(() => {
  Object.defineProperty(wirePage, 'on', { get: () => true, configurable: true }); // the flip makes this the only page
  said = []; client = new NetClient(silent); wirePage.bind(client, () => undefined, () => undefined, () => false, act => { said.push(act); });
});
afterEach(() => { wirePage.unbind(); Reflect.deleteProperty(wirePage, 'on'); });

test('a coin card says the purchase to the server, spends nothing itself, and keeps its feedback and modal hooks', () => {
  vi.useFakeTimers();
  const { ctx, scope, events, owned, hud, weapons } = page();
  const rows = coinRows;
  const purse = new Purse('shop-entry', { read: () => 12, write: n => { events.push(`saved:${n}`); return true; } });
  publishPurse(scope, purse);
  try {
    const stall = installQuestTrader(ctx, rows), panel = installQuestShop(ctx, rows)();
    expect(() => installQuestShop(ctx, rows)).toThrow('already installed');
    expect(stall.shop).toBe(panel); expect(enteredPurse(scope)).toBe(purse);
    panel.open(); expect(hud.holdPause).toBe(true); expect(weapons.stowed).toBe(true);
    events.length = 0;
    panel.root.querySelector<HTMLButtonElement>('.ws-shop-bigbuy')?.click();
    expect(said).toEqual([{ kind: 'buy', seq: 0, good: 0 }]);
    expect(events, 'nothing chimes before the server grants').toEqual([]);
    expect(purse.coins).toBe(12); expect(owned.has('whetstone-1')).toBe(false);
    granted(0);
    expect(events, 'the page keeps its chime and its word; the price is the server\'s').toEqual(['ui-chime', 'Bought · Whetstone I — sword damage +25 %']);
    panel.close(); expect(weapons.stowed).toBe(false); vi.advanceTimersByTime(450); expect(hud.holdPause).toBe(false);
    said.length = 0; expect(panel.onBuy?.({ id: 'heart-1', name: '', does: '', icon: 'heart', price: 14 }), 'a shut panel buys nothing').toBe(false); expect(said).toEqual([]);
    panel.dispose(); expect(stall.shop).toBeNull(); scope.dispose(); expect(() => enteredPurse(scope)).toThrow('Missing entered purse');
  } finally { scope.dispose(); vi.useRealTimers(); }
});

test('a barter counter checks its costs before it says a thing, and keeps its callers\' modal hold', () => {
  const goods = [{ id: 'bundle', name: 'Apple bundle', does: 'A bundled snack', icon: 'bolt', price: 0, tile: 'Apples' }] as const;
  const economy = { kind: 'barter', goods, tables: [], exchange: {
    count: { owner: 'pack', path: ['count'] }, owns: { owner: 'skins', path: ['owns'] },
    goods: [{ id: 'bundle', costs: [{ item: 'seed', n: 2, text: '2 seeds' }], payments: [{ owner: 'pack', path: ['take'], args: ['seed', 2], required: true }], grants: [{ owner: 'pack', path: ['add'], args: ['apple', 3] }] }],
  } };
  const { ctx, scope, events, pack } = page([{ economy }]);
  const rows = { name: 'Orchard keeper', reopen: true, shop: { place: 'Orchard', barter: true, lifetime: 'entered', after: { bundle: [{ kind: 'toast', text: 'Traded · Apple bundle' }] } } };
  try {
    installQuestTrader(ctx, rows); const get = installQuestShop(ctx, rows), panel = get();
    const views = new QuestViews(ctx), hud = { holdPause: false, entered: true, setPaused: () => undefined };
    views.panelHold({ hud, weapons: { setEnabled: () => undefined }, menu: { isOpen: false, close: () => undefined }, nolock: true, touchUi: () => true, panels: [get] });
    panel.open(); expect(hud.holdPause).toBe(true);
    expect(panel.onBuy?.(goods[0])).toBe(false); expect(events).toEqual([]); expect(said, 'short: nothing to say').toEqual([]);
    pack.set('seed', 2); panel.render(); panel.root.querySelector<HTMLButtonElement>('.ws-shop-bigbuy')?.click();
    expect(said).toEqual([{ kind: 'buy', seq: 0, good: 0 }]);
    expect(events, 'no word before the server grants').toEqual([]);
    granted(0);
    expect(events, 'the page takes nothing from the pack').toEqual(['Traded · Apple bundle']); expect(pack.get('seed')).toBe(2);
    panel.dispose();
  } finally { scope.dispose(); }
});
