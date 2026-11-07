import {expect, test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Execute the actual scoped loading continuations.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Erase types without copying a production implementation.
import {stripTypeScriptTypes} from 'node:module';
// oxlint-disable-next-line import/no-nodejs-modules -- Explicit native ports retain the production continuation's ordering.
import {runInNewContext} from 'node:vm';
import {Scope} from '@wildshard/engine/app/scope';
import {observeTitlePreparation} from './titlePreparation';

function deferred(): {promise: Promise<boolean>; resolve: (live: boolean) => void} {
  let finish: (live: boolean) => void = () => undefined;
  const promise = new Promise<boolean>(resolve => {finish = resolve;});
  return {promise, resolve: finish};
}

test('title shaders settle while control and live game draws have never been offered', async () => {
  const source = readFileSync(new URL('finish.ts', import.meta.url), 'utf8');
  const start = source.indexOf('  const warmRest ='), end = source.indexOf('\n  const titleShaders =', start);
  if (start === -1 || end < start) throw new Error('Title shader continuation missing');
  const owner = new Scope('title-before-control'), calls: string[] = [];
  const method: unknown = runInNewContext(stripTypeScriptTypes(`${source.slice(start, end)}\nwarmRest`), {
    levelScope: owner, afterExplorer: (): Promise<void> => Promise.resolve(),
    controlIdle: (): never => {throw new Error('Title must not await control');},
    idleTurn: (): never => {throw new Error('Title must not await speculative idle');},
    game: {frameCount: 0, warmDeferredEntryRoots: (current: () => boolean, idle?: unknown): Promise<void> => {
      expect(current()).toBe(true); expect(idle).toBeUndefined(); calls.push('deferred-roots'); return Promise.resolve();
    }},
    waitForDrawnFrame: (): never => {throw new Error('Title must not await a live game draw');}, liveWarmPacing: () => ({}),
    precompileLevel: (_game: unknown, _progress: unknown, options: {current: () => boolean; pause?: () => Promise<void>}): Promise<void> => {
      expect(options.current()).toBe(true); expect(options.pause).toBeUndefined(); calls.push('shaders'); return Promise.resolve();
    },
  });
  if (typeof method !== 'function') throw new Error('Title shader continuation is not callable');
  const work: Promise<void> = Promise.resolve(Reflect.apply(method, undefined, []));
  const title = observeTitlePreparation(work, Promise.resolve());
  try {
    await work; await Promise.resolve();
    expect(calls).toEqual(['shaders', 'deferred-roots']);
    expect(title.state()).toEqual({pending: [], issue: null});
  } finally {owner.dispose();}
});

test('offline copies and ring speculation wait for separate idle opportunities', async () => {
  const source = readFileSync(new URL('finish.ts', import.meta.url), 'utf8');
  const start = source.indexOf('  const backgroundDownloads ='), end = source.indexOf('\n  afterControl(', start);
  if (start === -1 || end < start) throw new Error('Background downloads missing');
  const first = deferred(), second = deferred(), copied = deferred(), calls: string[] = [];
  const owner = new Scope('background-downloads'), opportunities = [first, second];
  const run: unknown = runInNewContext(stripTypeScriptTypes(`${source.slice(start, end)}\nbackgroundDownloads`), {
    levelScope: owner, idleTurn: (scope: Scope): Promise<boolean> => {
      expect(scope).toBe(owner); const next = opportunities.shift(); if (next === undefined) throw new Error('Unexpected idle wait'); return next.promise;
    },
    completeOfflineCopy: (): Promise<void> => {calls.push('offline'); copied.resolve(true); return Promise.resolve();},
    currentSpawnDownload: () => undefined,
    ctx: {grid: {assembly: {}}}, player: {position: {}},
    gridPrefetchOrder: (_assembly: unknown, _position: unknown, tier?: string): string => tier ?? 'native',
    startGridPrefetch: (native: string, phone: string): void => {expect([native, phone]).toEqual(['native', 'phone']); calls.push('ring');},
  });
  if (typeof run !== 'function') throw new Error('Background continuation is not callable');
  const task: Promise<unknown> = Promise.resolve(Reflect.apply(run, undefined, []));
  try {
    expect(calls).toEqual([]); first.resolve(true); await copied.promise;
    expect(calls).toEqual(['offline']); second.resolve(true); await task;
    expect(calls).toEqual(['offline', 'ring']);
  } finally {first.resolve(false); second.resolve(false); owner.dispose(); await task;}
});

test('a manifest entry starts no automatic offline copy or ring while playing', async () => {
  const source = readFileSync(new URL('finish.ts', import.meta.url), 'utf8');
  const start = source.indexOf('  const backgroundDownloads ='), end = source.indexOf('\n  afterControl(', start);
  if (start === -1 || end < start) throw new Error('Background downloads missing');
  const unexpected = (): never => {throw new Error('Manifest entry started speculative work');};
  const run: unknown = runInNewContext(stripTypeScriptTypes(`${source.slice(start, end)}\nbackgroundDownloads`), {
    currentSpawnDownload: () => ({}), idleTurn: unexpected, completeOfflineCopy: unexpected,
    startGridPrefetch: unexpected, startShardPrefetch: unexpected,
  });
  if (typeof run !== 'function') throw new Error('Background continuation is not callable');
  await Reflect.apply(run, undefined, []);
});

test('native control and first-use audio remain immediate while speculative downloads yield', () => {
  const source = readFileSync(new URL('finish.ts', import.meta.url), 'utf8');
  const start = source.indexOf('  afterControl(game.levelScope,'), end = source.indexOf('\n\n', start);
  if (start === -1 || end < start) throw new Error('Control publication missing');
  const owner = new Scope('native-control'), calls: string[] = [];
  let publish: () => void = () => {throw new Error('Control observer missing');};
  try {
    runInNewContext(stripTypeScriptTypes(source.slice(start, end)), {
      game: {levelScope: owner}, hud: {}, app: {}, Event,
      afterControl: (scope: Scope, _frame: unknown, _ready: unknown, run: () => void): void => {expect(scope).toBe(owner); publish = run;},
      document: {dispatchEvent: (event: Event): void => {calls.push(event.type);}},
      reachControl: (scope: Scope): void => {expect(scope).toBe(owner); calls.push('refinements');},
      deferredAudio: {}, decodeAfterBoot: (): Promise<void> => {calls.push('audio'); return Promise.resolve();},
      backgroundDownloads: (): Promise<void> => {calls.push('idle-downloads'); return Promise.resolve();},
    });
    publish(); expect(calls).toEqual(['ws:control-ready', 'refinements', 'audio', 'idle-downloads']);
  } finally {owner.dispose();}
});
