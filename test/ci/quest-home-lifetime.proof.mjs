// oxlint-disable-next-line import/no-nodejs-modules -- CI-only real page boundary uses Node assertions.
import assert from 'node:assert/strict';
// oxlint-disable-next-line import/no-nodejs-modules -- Explicit CI cases stay outside hook and Vitest discovery.
import { test } from 'node:test';
// oxlint-disable-next-line import/no-nodejs-modules -- Observe real page timer cancellation without a fake clock.
import { setTimeout as delay } from 'node:timers/promises';
import { Window } from 'happy-dom';
import { Vector3 } from 'three';

const page = new Window({ url: 'http://127.0.0.1/quest-lifetime' });
const borrowed = new Map();
for (const name of ['window', 'document', 'location', 'localStorage', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent', 'PointerEvent', 'HTMLCanvasElement', 'ResizeObserver', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  borrowed.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  const value = name === 'window' ? page : page[name];
  Object.defineProperty(globalThis, name, { configurable: true, value: typeof value === 'function' && /^[a-z]/u.test(name) ? value.bind(page) : value });
}
const { Scope } = await import('../../src/shared/engine/app/scope.ts');
const { app } = await import('../../src/client/engine/app/runtime.ts');
const { createLevelInstallation } = await import('../../src/client/engine/level/installation.ts');
const { shardContext, sourceManifest, ShardPlugin } = await import('../../src/client/game/plugin/context.ts');
const { QuestViews } = await import('../../src/client/game/plugin/ui.ts');
const { installQuestInteractables } = await import('../../src/client/game/quest/chapter.ts');
const { DialogueBox } = await import('../../src/client/engine/quest/view/ui.ts');
const { GridCellEvents } = await import('../../src/shared/game/grid/cellEvents.ts');
const { HybridShardPlugin } = await import('../../src/client/game/shardfile/hybrid.ts');
const { emptyShardfile } = await import('../../src/shared/host/author.ts');
const { createShardFolder } = await import('../../src/shared/game/shardfile/shardFolder.ts');
const limit = 9500;

function context(scope) {
  const source = emptyShardfile({ slug: 'dialogue-home', name: 'Dialogue home', author: 'Lifecycle proof', revision: 1, seed: 1 });
  const manifest = sourceManifest(source);
  const product = createShardFolder({ slug: source.identity.slug, revision: 1, shardfile: source, sections: new Map(), files: new Map(), read: () => Promise.reject(new Error('Dialogue lifecycle has no external file input')) });
  const unused = () => { throw new Error('Dialogue lifecycle must not request an unrelated game service'); };
  const progress = { set: unused, detail: unused };
  const installation = createLevelInstallation(app, scope, {}, () => progress);
  return shardContext(installation.context, manifest, {
    shard: manifest, rows: new Map(), bag: { tab: unused, fragment: unused },
    runtime: { world: null, step: null, play: null, hooks: {}, objects: {}, interactables: [], overhead: [], viewer: () => new Vector3(), horizonVeil: null },
  }, product);
}

void test('actual grid home leave and reentry retire dialogue input and timers while retaining its authored owner', { timeout: limit }, async () => {
  const started = performance.now(), scope = new Scope('grid-dialogue-home'), ctx = context(scope), cells = new GridCellEvents();
  const home = { instance: 'dialogue-home-0-0', slug: ctx.manifest.slug }, neighbor = { instance: 'another-home-0-1', slug: 'another-home' };
  const events = [], faults = [];
  let views, dialogue, constructions = 0, ready;
  app.events.on('fault', fault => { faults.push(fault); }, scope);
  class DialogueHome extends ShardPlugin {
    play(entered) {
      constructions++;
      views = new QuestViews(entered);
      dialogue = views.view('dialogue', owner => { events.push('dialogue'); return new DialogueBox(owner); });
      views.enter(() => { events.push('wire'); });
      views.leave(() => { events.push('leave'); });
    }
  }
  const plugin = new HybridShardPlugin(new ShardPlugin(), DialogueHome, {
    instance: home.instance, cells, retainHomeRuntime: true,
    readiness(value) { if (value) ready?.resolve(); },
  });
  try {
    cells.enter(home);
    await plugin.world(ctx); await plugin.kit(ctx); await plugin.play(ctx);
    assert.equal(constructions, 1); assert.ok(views !== undefined && dialogue !== undefined);
    const first = dialogue(), oldClock = first.readingClock;
    let completed = 0, fired = 0;
    first.open('Friend', ['Still reading.'], () => { completed++; });
    assert.equal(first.isOpen, true); assert.equal(first.root.isConnected, true);
    assert.throws(() => views.view('dialogue', () => { throw new Error('Duplicate constructor reached'); }), /Invalid or duplicate/);
    assert.throws(() => views.view('../escape', () => { throw new Error('Invalid constructor reached'); }), /Invalid or duplicate/);
    views.timeout(60000, () => { fired++; });
    views.timeout(0, () => { fired++; });
    cells.leave();
    assert.throws(() => dialogue(), /left its home/);
    assert.throws(() => views.timeout(0, () => { fired++; }), /left its home/);
    assert.equal(first.isOpen, false); assert.equal(first.root.isConnected, false);
    assert.equal(completed, 0); assert.equal(events.at(-1), 'leave');
    await delay(20); assert.equal(fired, 0, 'A due timer must really be cancelled after leaving');
    cells.enter(neighbor); await delay(0);
    assert.throws(() => dialogue(), /left its home/); assert.equal(constructions, 1);
    ready = Promise.withResolvers(); cells.enter(home); await ready.promise;
    assert.equal(constructions, 1, 'Reentry retains the authored runtime rather than rebuilding it');
    const second = dialogue(); assert.notEqual(second, first); assert.notEqual(second.readingClock, oldClock);
    assert.equal(second.isOpen, false); assert.deepEqual(events, ['dialogue', 'wire', 'leave', 'dialogue', 'wire']);
    second.open('Friend', ['Fresh reading.'], () => { completed++; });
    first.root.dispatchEvent(new page.PointerEvent('pointerdown', { bubbles: true }));
    assert.equal(second.readingClock.text, '', 'Retired input cannot advance a fresh modal');
    second.root.dispatchEvent(new page.PointerEvent('pointerdown', { bubbles: true }));
    assert.equal(second.readingClock.text, 'Fresh reading.');
    second.root.dispatchEvent(new page.PointerEvent('pointerdown', { bubbles: true }));
    assert.equal(completed, 1); assert.equal(second.isOpen, false);
    const timer = Promise.withResolvers(); views.timeout(0, () => { fired++; timer.resolve(); }); await timer.promise;
    assert.equal(fired, 1, 'The newly entered timer owner must work');
    scope.dispose();
    assert.throws(() => new QuestViews(ctx), /live scope/);
    cells.leave(); cells.enter(home); await delay(0);
    assert.equal(constructions, 1); assert.equal(second.root.isConnected, false); assert.deepEqual(faults, []);
  } finally { try { cells.leave(); } finally { scope.dispose(); } }
  assert.ok(performance.now() - started < limit, 'Complete grid lifetime case exceeds 9.5 s');
});

void test('ordinary dialogue teardown and real quest placement intake preserve the remaining lifetime laws', { timeout: limit }, async () => {
  const started = performance.now(), scope = new Scope('ordinary-dialogue'), ctx = context(scope);
  try {
    const views = new QuestViews(ctx), resident = views.view('dialogue', owner => new DialogueBox(owner));
    views.enter(() => { resident().open('Friend', ['Same clock.'], () => { throw new Error('Teardown must not complete dialogue'); }); });
    assert.equal(resident().isOpen, true);
    views.disposeLegacy(() => { resident().dispose(); }); assert.equal(resident().isOpen, false);
    const table = { rows: [], external: [] };
    await assert.rejects(installQuestInteractables(ctx, 'quest', { table, placements: () => undefined }), /plain JSON/);
    await assert.rejects(installQuestInteractables(ctx, 'quest', { table, placements: [{}] }), /Invalid interactable placement$/);
    await assert.rejects(installQuestInteractables(ctx, 'quest', { table: { rows: [{ kind: 'lever', id: 'lever', at: { poi: 'hut', x: 0, z: 0 } }], external: [] } }), /world placements/);
    await assert.rejects(installQuestInteractables(ctx, 'quest', { table }), /entered world services/);
  } finally { scope.dispose(); }
  assert.ok(performance.now() - started < limit, 'Complete ordinary lifetime case exceeds 9.5 s');
});

test.after(async () => {
  try {
    try { app.engineScope.dispose(); } finally { await page.happyDOM.close(); }
  } finally {
    for (const [name, descriptor] of borrowed) {
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, name);
      else Object.defineProperty(globalThis, name, descriptor);
    }
  }
});
