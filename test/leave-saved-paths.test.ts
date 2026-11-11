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
// RL3/RL4 (reloadCover.ts): the cover's own calls, as ports. The cover and the one-frame paint wait are not what this file
// proves; whether the navigation waits for the save is, so the frame wait runs its leave at once.
const cover = { showReloading: (): void => undefined, reloadingLine: (): void => undefined, leaveAfterPaint: (go: () => void): void => { go(); }, RELOAD_FALLBACK_MS: 3000 };
// the pill and Settings ▸ Build share one reload (src/client/engine/ui/playerReload.ts)
const pill = { ...cover, reloadingShown: () => false, engineString: (key: string) => key, diagnosticNow: () => 0 };

const paths: readonly (readonly [string, (at: ReturnType<typeof page>) => () => void])[] = [
  ['the update pill (and Settings ▸ Build)', at => {
    const reload = slice('src/client/engine/ui/playerReload.ts', 'export function reloadForPlayer', '', 'reloadForPlayer', { ...marks, ...pill, location: at.location, titleShowing: () => false, window: {} });
    return () => { reload(null); };
  }],
  ['the update pill through a waiting worker', at => {
    const adopt = (): Promise<boolean> => { at.went.push('adopted'); return Promise.resolve(true); };
    const reload = slice('src/client/engine/ui/playerReload.ts', 'export function reloadForPlayer', '', 'reloadForPlayer', { ...marks, ...pill, location: at.location, titleShowing: () => false, window: { __ws_sw: { adopt } } });
    return () => { reload(null); };
  }],
  ['the reload prompt', at => {
    const reload = slice('src/client/engine/ui/ReloadPrompt.ts', 'export function reloadWithPicks', '', 'reloadWithPicks', { ...marks, ...cover, location: at.location, settingsReloadUrl: (href: string) => href, TITLE_SKIPPERS: [], currentPose: () => null, terrainDatum: () => 0, RELOAD_PARAM: 'glreload', setTitleArrival: () => undefined });
    return () => { reload(); };
  }],
  ['the error modal\'s reload here', at => {
    const here = slice('src/client/engine/ui/ErrorModal.ts', 'function reloadHere(', '\nfunction build(', 'reloadHere', { ...marks, ...cover, location: at.location, countReload: () => undefined, cleanHref: () => new URL('https://example.test/'), currentPose: () => null, terrainDatum: () => 0, RELOAD_PARAM: 'glreload', firstText: 'fault' });
    return () => { here(true); };
  }],
  ['the error modal\'s title screen', at => {
    const title = slice('src/client/engine/ui/ErrorModal.ts', 'function reloadHere(', '\nfunction build(', 'toTitle', { ...marks, ...cover, location: at.location, countReload: () => undefined, cleanHref: () => new URL('https://example.test/'), currentPose: () => null, terrainDatum: () => 0, RELOAD_PARAM: 'glreload', firstText: 'fault' });
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

test('SR12: Settings ▸ Reload now from a world comes back in the same shard where the player stands', async () => {
  const at = page(), session = held(), arrivals: unknown[] = [], reasons: string[] = [];
  const reload = slice('src/client/engine/ui/ReloadPrompt.ts', 'export function reloadWithPicks', '', 'reloadWithPicks', { ...marks, ...cover, location: at.location, settingsReloadUrl: (href: string) => href,
    TITLE_SKIPPERS: [], currentPose: () => ({ x: 12.345, y: 7, z: -3, yaw: 1.5, pitch: 0.25 }), terrainDatum: () => 2, RELOAD_PARAM: 'glreload',
    setTitleArrival: (arrival: unknown, options: unknown) => { arrivals.push([arrival, options]); }, __WS_WORLD__: { release: 'proof' }, markReload: (_: string, reason: string) => { reasons.push(reason); } });
  reload(); await settle(); session.land(); await settle();
  expect(at.went).toHaveLength(1);
  const went = new URL(at.went[0] ?? '');
  expect(went.searchParams.get('chunk')).toBe('fixture');
  expect(went.searchParams.get('at')).toBe('12.35,5,-3,1.5,0.25'); // y in the level's authored frame (less the datum)
  expect(went.searchParams.get('glreload')).toBe('1'); expect(went.searchParams.has('v')).toBe(false);
  expect(reasons, 'a settings reload, not an explicit RELOAD (which returns to the title)').toEqual(['settings']);
  expect(arrivals, 'an online build carries the tap that seated it (QA row 16)').toEqual([[{ slug: 'fixture', mode: 'enter' }, { tab: true }]]);
});

test('SR12: a grid page (no ?chunk=) reloads on its bare address and resumes from its planned-reload record', async () => {
  const at = page(), session = held(), reasons: string[] = [];
  const location = { ...at.location, href: 'https://example.test/' };
  const reload = slice('src/client/engine/ui/ReloadPrompt.ts', 'export function reloadWithPicks', '', 'reloadWithPicks', { ...marks, ...cover, location, settingsReloadUrl: (href: string) => href,
    TITLE_SKIPPERS: [], currentPose: () => ({ x: 1, y: 2, z: 3, yaw: 0, pitch: 0 }), terrainDatum: () => 0, RELOAD_PARAM: 'glreload',
    setTitleArrival: () => { throw new Error('a grid page hands no shard tap'); }, __WS_WORLD__: { release: 'proof' }, markReload: (_: string, reason: string) => { reasons.push(reason); } });
  reload(); await settle(); session.land(); await settle();
  expect(at.went).toEqual(['https://example.test/']); expect(reasons).toEqual(['settings']);
});

test('a reload from the title (no world, no pose) lands on the title', async () => {
  const at = page(), session = held(), reasons: string[] = [];
  const reload = slice('src/client/engine/ui/ReloadPrompt.ts', 'export function reloadWithPicks', '', 'reloadWithPicks', { ...marks, ...cover, location: at.location, settingsReloadUrl: (href: string) => href,
    TITLE_SKIPPERS: [], currentPose: () => null, terrainDatum: () => 0, RELOAD_PARAM: 'glreload', setTitleArrival: () => undefined,
    markReload: (_: string, reason: string) => { reasons.push(reason); } });
  reload(); await settle(); session.land(); await settle();
  expect(reasons).toEqual(['reload']);
  const went = new URL(at.went[0] ?? '');
  expect(went.searchParams.has('at')).toBe(false); expect(went.searchParams.has('glreload')).toBe(false);
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
