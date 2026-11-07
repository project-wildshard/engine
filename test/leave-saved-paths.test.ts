// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Run each file's own navigation with explicit document ports.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Erase only types from the defining functions, never copy them.
import { stripTypeScriptTypes } from 'node:module';
// oxlint-disable-next-line import/no-nodejs-modules -- A real document can't be navigated from a test.
import { runInNewContext } from 'node:vm';
import { holdLeaving, leaveSaved } from '../src/client/engine/boot/lastEnd';

// N3: a world in a worker saves across a port, so nothing written at pagehide reaches a page that's going. Every way out a player
// can take with a world up asks first, and only leaves once the save lands.
let release = (): void => undefined;
afterEach(() => { release(); release = () => undefined; vi.useRealTimers(); });

/** A held session whose save lands when told. */
function held(): { readonly land: () => void; readonly asked: () => number } {
  let land = (): void => { throw new Error('Missing save'); }, asked = 0;
  const landed = new Promise<void>(resolve => { land = resolve; });
  release = holdLeaving(() => { asked++; return landed; });
  return { land: () => { land(); }, asked: () => asked };
}
const settle = async (): Promise<void> => { for (let at = 0; at < 6; at++) await Promise.resolve(); };

/** `name` from a file's source, run with `ports` as its only world. */
function slice(file: string, from: string, to: string, name: string, ports: object, prefix = ''): (...args: readonly unknown[]) => unknown {
  const source = readFileSync(file, 'utf8'), start = source.indexOf(from), end = to === '' ? source.length : source.indexOf(to, start);
  if (start === -1 || end < start) throw new Error(`Missing ${from} in ${file}`);
  const made: unknown = runInNewContext(stripTypeScriptTypes(`${prefix}${source.slice(start, end).replace('export function', 'function')}\n${name}`), { URL, leaveSaved, ...ports });
  if (typeof made !== 'function') throw new Error(`${name} is not callable`);
  return (...args) => Reflect.apply(made, undefined, args) as unknown;
}
function page(): { readonly went: string[]; readonly location: object } {
  const went: string[] = [];
  return { went, location: { href: 'https://example.test/?chunk=fixture&v=old', origin: 'https://example.test', replace: (url: string) => { went.push(url); }, reload: () => { went.push('reload'); } } };
}
const marks = { markReload: (): void => undefined, markUnload: (): void => undefined };

const paths: readonly (readonly [string, (at: ReturnType<typeof page>) => () => void])[] = [
  ['the update pill', at => {
    const reload = slice('src/client/engine/ui/Update.ts', 'function reload(): void {', '\n// pointerup as well', 'reload', { ...marks, location: at.location, titleBoundary: () => false, window: {} }, 'let busy = false;\n');
    return () => { reload(); };
  }],
  ['the update pill through a waiting worker', at => {
    const adopt = (): Promise<boolean> => { at.went.push('adopted'); return Promise.resolve(true); };
    const reload = slice('src/client/engine/ui/Update.ts', 'function reload(): void {', '\n// pointerup as well', 'reload', { ...marks, location: at.location, titleBoundary: () => false, window: { __ws_sw: { adopt } } }, 'let busy = false;\n');
    return () => { reload(); };
  }],
  ['the reload prompt', at => {
    const reload = slice('src/client/engine/ui/ReloadPrompt.ts', 'export function reloadWithPicks', '', 'reloadWithPicks', { ...marks, location: at.location, settingsReloadUrl: (href: string) => href, TITLE_SKIPPERS: [] });
    return () => { reload(); };
  }],
  ['the error modal\'s reload here', at => {
    const here = slice('src/client/engine/ui/ErrorModal.ts', 'function reloadHere(', '\nfunction build(', 'reloadHere', { ...marks, location: at.location, countReload: () => undefined, cleanHref: () => new URL('https://example.test/'), currentPose: () => null, terrainDatum: () => 0, RELOAD_PARAM: 'glreload', firstText: 'fault' });
    return () => { here(true); };
  }],
  ['the error modal\'s title screen', at => {
    const title = slice('src/client/engine/ui/ErrorModal.ts', 'function reloadHere(', '\nfunction build(', 'toTitle', { ...marks, location: at.location, countReload: () => undefined, cleanHref: () => new URL('https://example.test/'), currentPose: () => null, terrainDatum: () => 0, RELOAD_PARAM: 'glreload', firstText: 'fault' });
    return () => { title(); };
  }],
  ['a shard switch', at => {
    const go = slice('src/client/game/travel/travel.ts', 'function navigateNow(', '\nexport function travel(', 'navigateNow', { ...marks, location: at.location, setTitleArrival: () => undefined, findTitleManifest: () => ({ name: 'Fixture' }), arrivalTier: { current: 'phone' } });
    return () => { go({ to: 'other', mode: 'enter' }); };
  }],
];

test.each(paths)('%s leaves only once the save lands', async (_name, make) => {
  const at = page(), session = held(), go = make(at);
  go(); await settle();
  expect(session.asked()).toBe(1); expect(at.went).toEqual([]);
  session.land(); await settle();
  expect(at.went).not.toEqual([]);
});

test('the menu\'s apply and reload leaves only once the save lands', async () => {
  const source = readFileSync('src/client/engine/ui/BootSettings.ts', 'utf8'), start = source.indexOf('listenTap(scope, apply, () => {'), end = source.indexOf('\n  const closeBtn', start);
  if (start === -1 || end < start) throw new Error('Missing the apply tap');
  const at = page(), session = held();
  const ports = { ...marks, leaveSaved, location: at.location, settingsReloadUrl: (href: string) => href, TITLE_SKIPPERS: [], scope: null, apply: null, debug: null, developerTools: null, listenTap: (_scope: unknown, _button: unknown, run: () => void) => { run(); } };
  runInNewContext(stripTypeScriptTypes(source.slice(start, end)), ports);
  await settle();
  expect(session.asked()).toBe(1); expect(at.went).toEqual([]);
  session.land(); await settle();
  expect(at.went).toEqual(['reload']);
});

test('a second way out goes the same way, and a save that never lands holds nobody past the wait', async () => {
  vi.useFakeTimers();
  const session = held(), went: string[] = [];
  leaveSaved(() => { went.push('first'); }); leaveSaved(() => { went.push('second'); });
  expect(session.asked()).toBe(1); expect(went).toEqual(['second']);
  await vi.advanceTimersByTimeAsync(3999); expect(went).toEqual(['second']);
  await vi.advanceTimersByTimeAsync(1); expect(went).toEqual(['second', 'first']);
});

test('a save that fails still leaves, and nothing held leaves now', async () => {
  const went: string[] = [];
  release = holdLeaving(() => Promise.reject(new Error('No save')));
  leaveSaved(() => { went.push('failed'); }); await settle();
  expect(went).toEqual(['failed']);
  leaveSaved(() => { went.push('free'); });
  expect(went).toEqual(['failed', 'free']);
});
