// @vitest-environment happy-dom
// QA-FEEDBACK 2026-11-12 row 35 (Jake, 20:04, iPhone 17 Pro, v0.1.13): "when you press reload, like actually reloads the current thing
// you're on. I expected reload to go back to main menu." A reload the PLAYER makes (the browser's reload button, pull-to-refresh)
// lands on the title, quietly; a reload the engine makes (it marks itself first) resumes; a fresh open of a shard URL opens the
// shard; and every other title nobody asked for still shows the drop modal (Jake, 17:52).
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Json } from '@wildshard/engine/saves/slots';
import { DropNotes, type DropStore } from '@wildshard/engine/boot/dropNotice';
import { PageLife, type LastEnd } from '@wildshard/engine/boot/lastEnd';
import { Scope } from '@wildshard/engine/app/scope';
import { bootRoute } from './bootRoute';

const scopes: Scope[] = [];
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000); });
afterEach(() => { for (const scope of scopes.splice(0)) scope.dispose(); vi.useRealTimers(); });
const scope = (): Scope => { const s = new Scope('test'); scopes.push(s); return s; };

/** one tab: sessionStorage and localStorage as Maps, shared by the pages it loads */
function tab() {
  const session = new Map<string, string>(), local = new Map<string, string>();
  const life = (kind: 'local' | 'session') => {
    const values = kind === 'local' ? local : session;
    return { getItem: (key: string): string | null => values.get(key) ?? null, setItem: (key: string, value: string): void => { values.set(key, value); },
      removeItem: (key: string): void => { values.delete(key); } };
  };
  const dropStore: DropStore = {
    read: (key) => { const map = key.endsWith('Once') ? local : session; const raw = map.get(`drop.${key}`); return raw === undefined ? null : JSON.parse(raw) as Json; },
    write: (key, value) => { (key.endsWith('Once') ? local : session).set(`drop.${key}`, JSON.stringify(value)); },
    clear: (key) => { (key.endsWith('Once') ? local : session).delete(`drop.${key}`); },
  };
  /** a new page in this tab, loaded the way `nav` says (PerformanceNavigationTiming.type), at `href`, its document started at `startedAt` */
  const page = (nav = 'navigate', { href = location.href, startedAt = Date.now() }: { href?: string; startedAt?: number } = {}): { life: PageLife; notes: DropNotes } =>
    ({ life: new PageLife(scope(), life, () => nav, () => ({ href, startedAt })), notes: new DropNotes(dropStore) });
  return { session, page };
}

/** Nalati's page, loading (Jake's recording: the reload came during Nalati's load) */
function loadNalati(t: ReturnType<typeof tab>): { life: PageLife; notes: DropNotes } {
  const world = t.page();
  world.life.setAliveSource(() => ({ slug: 'nalati-grasslands', resident: '', mode: 'shard' }));
  world.notes.markStep({ world: 'nalati-grasslands', name: 'Nalati Grasslands', step: 'Start' });
  world.notes.markStep({ step: 'Worker boot' });
  return world;
}
const shardUrl = new URLSearchParams('chunk=nalati-grasslands');
/** where the next page goes: the title (true) or the shard its URL names (false) */
const toTitle = (end: LastEnd): boolean => bootRoute(shardUrl, { line: '', level: '', reload: end.reload === true }).titleOnly;

test("the player's reload (browser button, pull-to-refresh) lands on the title with no drop modal", () => {
  const t = tab(), world = loadNalati(t);
  world.life.markUnload('shard switch to nalati-grasslands (fresh page)'); vi.advanceTimersByTime(30_000); // the title tap, long consumed
  t.page(); // Nalati's page booted from that tap and read it
  window.dispatchEvent(new Event('pagehide')); // a browser reload ends the page normally
  const next = t.page('reload'), end = next.life.lastEnd();
  expect(end).toMatchObject({ kind: 'intentional', player: true, reload: true });
  expect(toTitle(end)).toBe(true);
  expect(next.notes.take(end)).toBeNull();
});

test('a reload the engine makes (chunk recovery marks itself) resumes the shard', () => {
  const t = tab(), world = loadNalati(t);
  world.life.markReload('stale deployment code', 'background'); // browserChunkRecovery's boot recovery
  const end = t.page('reload').life.lastEnd();
  expect(end.kind).toBe('intentional');
  expect(end.player).toBeUndefined();
  expect(toTitle(end)).toBe(false);
});

test("index.html's 12 s self-reload of a hung fresh open (its claim, just before this document) resumes the shard", () => {
  const t = tab(); loadNalati(t);
  window.dispatchEvent(new Event('pagehide')); // the player left Nalati for a deep link, whose boot hung
  vi.advanceTimersByTime(12_000);
  t.session.set('boot.selfReload', String(Date.now() - 20));
  const end = t.page('reload', { href: 'http://localhost:3000/?chunk=pine-hollow' }).life.lastEnd();
  expect(end.player).toBeUndefined();
  expect(toTitle(end)).toBe(false);
});

test("a player reload whose boot hung, then index.html's self-reload, still lands on the title (review MUST 1)", () => {
  const t = tab(); loadNalati(t);
  window.dispatchEvent(new Event('pagehide')); // the player's reload; that page's modules never arrived
  vi.advanceTimersByTime(12_000);
  t.session.set('boot.selfReload', String(Date.now() - 20));
  const end = t.page('reload').life.lastEnd();
  expect(end).toMatchObject({ player: true, reload: true });
});

test("an old self-reload claim doesn't hide a later player reload", () => {
  const t = tab(); loadNalati(t);
  t.session.set('boot.selfReload', String(Date.now() - 5 * 60_000));
  window.dispatchEvent(new Event('pagehide'));
  expect(t.page('reload').life.lastEnd().player).toBe(true);
});

test('a system reload is no player reload: a discarded tab, or an iOS tab killed in the background (review MUST 2)', () => {
  const t = tab(); loadNalati(t);
  window.dispatchEvent(new Event('pagehide'));
  Object.defineProperty(document, 'wasDiscarded', { value: true, configurable: true });
  try { expect(t.page('reload').life.lastEnd()).toMatchObject({ kind: 'fresh', discarded: true }); }
  finally { Reflect.deleteProperty(document, 'wasDiscarded'); }
  const u = tab(); loadNalati(u);
  window.dispatchEvent(new Event('pagehide'));
  u.session.set('life.hid', JSON.stringify({ t: Date.now(), vis: 'hidden', href: location.href })); // iOS: hidden first, then pagehide
  const next = u.page('reload'), end = next.life.lastEnd();
  expect(end.player).toBeUndefined();
  expect(next.notes.take(end)).toMatchObject({ kind: 'restart' });
});

test('a fresh open of a shard URL (deep link, bookmark, typed) opens the shard', () => {
  const t = tab(); loadNalati(t);
  window.dispatchEvent(new Event('pagehide'));
  const end = t.page('navigate').life.lastEnd();
  expect(end).toMatchObject({ kind: 'fresh' });
  expect(end.player).toBeUndefined();
  expect(toTitle(end)).toBe(false);
});

test('an unmarked title arrival with no token still shows the drop modal', () => {
  for (const nav of ['navigate', 'back_forward', '']) {
    const t = tab(); loadNalati(t);
    window.dispatchEvent(new Event('pagehide'));
    const next = t.page(nav);
    expect(next.notes.take(next.life.lastEnd())).toMatchObject({ kind: 'restart', what: 'Unexpectedly back at the title', step: 'Worker boot' });
  }
});

test('a crash that Safari reloads by itself is no player reload: the modal stays', () => {
  const t = tab(); loadNalati(t);
  scopes[0]?.dispose(); // WebContent died: no pagehide ran, the alive beat stays
  const next = t.page('reload'), end = next.life.lastEnd();
  expect(end.kind).toBe('unexpected');
  expect(end.player).toBeUndefined();
  expect(next.notes.take(end)).toMatchObject({ kind: 'restart', what: 'The game restarted unexpectedly' });
});
