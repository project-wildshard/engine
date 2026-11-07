import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Execute the actual regional construction hook as a controlled source fixture.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Remove types without importing the browser-only regional factory dependencies.
import { stripTypeScriptTypes } from 'node:module';
// oxlint-disable-next-line import/no-nodejs-modules -- The fixture runs the tracked hook, never a copied ownership implementation.
import { runInNewContext } from 'node:vm';
import { Scope } from '@wildshard/engine/app/scope';
import { bindConstructionEnvironment, constructionOwner, ownedFacade, withOwner } from '@wildshard/engine/app/ownership';

function fixture(failView = false) {
  const source = readFileSync(new URL('regionalRuntime.ts', import.meta.url), 'utf8');
  const marker = 'prepareConstruction: ', start = source.indexOf(marker), end = source.indexOf('\n            } }),', start);
  if (start === -1 || end === -1) throw new Error('Regional construction hook missing');
  const hook = source.slice(start + marker.length, end + '\n            }'.length);
  const factory: unknown = runInNewContext(stripTypeScriptTypes(`(function(ports) {
    const {scope, owner, pageScope, request, prepareFrame, app, view, bindConstructionEnvironment} = ports;
    let preparing = false, preparedModels = null;
    return {start: ${hook}, preparing: () => preparing};
  })`), {});
  if (typeof factory !== 'function') throw new Error('Regional construction factory missing');
  const page = new Scope('page'), resident = page.child('resident'), runtime = resident.child('runtime'), peer = page.child('peer');
  const state = { scene: 'page', player: 'page', registry: 'page' }, frames: Scope[] = [];
  const ports = { scope: resident, owner: runtime, pageScope: page, bindConstructionEnvironment,
    request: { page: { world: { game: { stageViewmodels: (owner: Scope): null => { expect(owner).toBe(runtime); return null; } } } } },
    prepareFrame: (scope: Scope): void => {
      if (resident.disposed || scope.disposed) throw new Error('Regional construction requires a live resident and owner');
      frames.push(scope); scope.expose(state, 'scene', 'destination'); },
    app: { bindPlayerServices: (from: Scope, scope: Scope): void => { expect(from).toBe(page); scope.expose(state, 'player', 'destination'); } },
    view: { prepare: (scope: Scope): void => { scope.expose(state, 'registry', 'destination'); if (failView) throw new Error('Frame refused'); } },
  };
  const instance: unknown = Reflect.apply(factory, undefined, [ports]);
  if (instance === null || typeof instance !== 'object') throw new Error('Regional construction hook missing');
  const invoke = (key: string): unknown => {
    const fn: unknown = Reflect.get(instance, key);
    if (typeof fn !== 'function') throw new Error('Regional construction operation missing');
    return Reflect.apply(fn, instance, []);
  };
  const events: { readonly id: string; readonly scene: string; readonly player: string; readonly registry: string }[] = [];
  const service = { add: (id: string): void => { events.push({ id, ...state }); } };
  return { page, resident, runtime, peer, state, frames, events,
    world: ownedFacade(resident, service), play: ownedFacade(runtime, service), road: ownedFacade(page, service), other: ownedFacade(peer, service),
    preparing: () => invoke('preparing'), start: (): (() => void) => {
      const leave = invoke('start'); if (typeof leave !== 'function') throw new Error('Construction cleanup missing');
      return () => { Reflect.apply(leave, undefined, []); };
    } };
}

test('resident placement slices retain destination services without reinstalling their frame', async () => {
  const f = fixture(), leave = f.start();
  try {
    await Promise.resolve();
    for (let i = 0; i < 64; i++) f.world.add(`piece-${i}`);
    f.play.add('runtime-piece');
    expect(f.events).toHaveLength(65);
    expect(f.events.every(event => event.scene === 'destination' && event.player === 'destination' && event.registry === 'destination')).toBe(true);
    expect(f.frames).toHaveLength(1); expect(constructionOwner()).toBe(f.resident); expect(f.preparing()).toBe(true);
  } finally { leave(); f.page.dispose(); }
  expect(f.state).toEqual({ scene: 'page', player: 'page', registry: 'page' });
});

test('page and unrelated resident callbacks still see the page, including a throwing callback', () => {
  const f = fixture(), leave = f.start();
  try {
    f.road.add('road'); f.other.add('peer');
    expect(f.events).toEqual(['road', 'peer'].map(id => ({ id, scene: 'page', player: 'page', registry: 'page' })));
    expect(() => withOwner(f.page, () => {
      expect(f.state.scene).toBe('page'); expect(constructionOwner()).toBeNull(); throw new Error('Page refused');
    })).toThrow('Page refused');
    f.world.add('next'); expect(f.events.at(-1)).toEqual({ id: 'next', scene: 'destination', player: 'destination', registry: 'destination' });
  } finally { leave(); f.page.dispose(); }
});

test('runtime cancellation closes construction even while its resident remains retained', () => {
  const f = fixture(), leave = f.start();
  try {
    f.runtime.dispose(); expect(f.resident.disposed).toBe(false); expect(constructionOwner()).toBeNull();
    expect(f.frames.every(scope => scope.disposed)).toBe(true);
    f.world.add('retained'); expect(f.events.at(-1)?.scene).toBe('page');
    leave(); expect(f.preparing()).toBe(false);
  } finally { leave(); f.page.dispose(); }
});

test.each(['runtime', 'resident'] as const)('sliced %s retirement removes bindings before an unrelated callback', kind => {
  const f = fixture(), leave = f.start(), target = kind === 'runtime' ? f.runtime : f.resident;
  const steps = target.disposeSteps(); steps.next();
  try {
    expect(constructionOwner()).toBeNull();
    expect(f.state).toEqual({ scene: 'page', player: 'page', registry: 'page' });
    const count = f.frames.length; f.road.add('teardown'); expect(f.frames).toHaveLength(count);
    expect(f.events.at(-1)?.scene).toBe('page');
  } finally { for (const _step of steps) { /* Drain only the original teardown. */ } leave(); f.page.dispose(); }
});

test('a failed frame setup restores every alias and releases the runtime construction child', () => {
  const f = fixture(true), before = f.runtime.census;
  try {
    expect(() => f.start()).toThrow('Frame refused'); expect(constructionOwner()).toBeNull();
    expect(f.state).toEqual({ scene: 'page', player: 'page', registry: 'page' });
    expect(f.frames).toHaveLength(1); expect(f.frames[0]?.disposed).toBe(true);
    expect(f.runtime.census).toEqual(before);
  } finally { f.page.dispose(); }
});


test.each(['whole', 'sliced'] as const)('a %s runtime teardown cannot restore its frame through a page callback', kind => {
  const f = fixture(), leave = f.start();
  let callbacks = 0;
  f.runtime.onDispose(() => { f.road.add('cleanup'); callbacks++; });
  try {
    if (kind === 'whole') f.runtime.dispose();
    else for (const _step of f.runtime.disposeSteps()) { /* Drain the actual child teardown. */ }
    expect(callbacks).toBe(1); expect(f.resident.disposed).toBe(false);
    expect(f.frames).toHaveLength(1); expect(f.frames[0]?.disposed).toBe(true);
    expect(constructionOwner()).toBeNull();
    expect(f.events).toEqual([{ id: 'cleanup', scene: 'page', player: 'page', registry: 'page' }]);
    f.world.add('retained'); expect(f.events.at(-1)?.scene).toBe('page');
  } finally { leave(); f.page.dispose(); }
});
