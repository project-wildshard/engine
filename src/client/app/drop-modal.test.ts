// @vitest-environment happy-dom
// The drop modal (Jake, 2026-11-12: "I try and play the level and like pop, go straight to main menu … where's my error modal at?").
// Each case runs two simulated pages in one tab: the world page that drops, then the title page that boots after it. Every drop
// the player didn't ask for ends on the title with the modal and its reason; the player's own exit ends on a quiet title.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Json } from '@wildshard/engine/saves/slots';
import { DropNotes, type Drop, type DropStore } from '@wildshard/engine/boot/dropNotice';
import { PageLife, type LastEnd } from '@wildshard/engine/boot/lastEnd';
import { Scope } from '@wildshard/engine/app/scope';
import { dropDetails, showDropModal } from './dropModal';

const scopes: Scope[] = [];
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000); document.body.replaceChildren(); });
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
  /** a new page in this tab: how the last one ended, and its drop notes */
  const page = (): { life: PageLife; notes: DropNotes } => ({ life: new PageLife(scope(), life), notes: new DropNotes(dropStore) });
  return { session, local, page };
}

/** the world page boots Blender Template and reaches LOAD step 19 (Worker boot), as on Jake's iPhone */
function enterWorld(t: ReturnType<typeof tab>): { life: PageLife; notes: DropNotes } {
  const world = t.page();
  world.life.setAliveSource(() => ({ slug: 'blender-template', resident: '', mode: 'shard' }));
  world.notes.markStep({ world: 'blender-template', name: 'Blender Template', step: 'Start' });
  world.notes.markStep({ step: 'Application modules' });
  world.notes.markStep({ step: 'Worker boot' });
  return world;
}
/** the title page that boots next: the drop it shows (once), rendered */
function title(t: ReturnType<typeof tab>, dev: boolean): { drop: Drop | null; end: LastEnd; again: Drop | null } {
  const next = t.page(), end = next.life.lastEnd(), drop = next.notes.take(end);
  if (drop !== null) showDropModal(drop, scope(), { dev, parent: document.body });
  return { drop, end, again: next.notes.take(end) };
}
const modal = (): HTMLElement | null => document.getElementById('wsdrop');

test('a forced load failure ends on the title with the modal and its reason', () => {
  const t = tab(), world = enterWorld(t);
  const failure = Object.assign(new Error('world.bin: 404 Not Found'), { name: 'ShardLoadError', code: 'E_FETCH' });
  world.notes.record({ reason: 'The world failed to load.', error: failure });
  world.life.markReload('stuck boot recovery (ShardLoadError: world.bin: 404 Not Found)');
  const { drop, again } = title(t, true);
  expect(drop).toMatchObject({ kind: 'error', what: "Couldn't enter Blender Template", reason: 'The world failed to load.', step: 'Worker boot', code: 'E_FETCH' });
  expect(modal()?.querySelector('h1')?.textContent).toBe("Couldn't enter Blender Template");
  expect(modal()?.querySelector('.reason')?.textContent).toBe('The world failed to load.');
  expect(again).toBeNull(); // shown once
});

test('a forced server close during enter ends on the title with the close reason and code', () => {
  const t = tab(), world = enterWorld(t);
  const close = { code: 1006, reason: 'the server closed the connection', wasClean: false };
  world.notes.noteError(close);
  world.notes.record({ reason: 'The server closed the connection.', error: close });
  const { drop } = title(t, true);
  expect(drop).toMatchObject({ what: "Couldn't enter Blender Template", reason: 'The server closed the connection.', code: '1006', message: 'the server closed the connection' });
  const dev = modal()?.querySelector('.dev')?.textContent ?? '';
  expect(dev).toContain('1006');
  expect(dev).toContain('Worker boot');
});

test('a thrown error during boot ends on the title with the error, its stack and its step', () => {
  const t = tab(), world = enterWorld(t);
  const thrown = new TypeError("undefined is not an object (evaluating 'worker.port')");
  world.notes.noteError(thrown);
  world.notes.record({ reason: 'The game hit an error while starting, so it reloaded to recover.', error: thrown });
  world.life.markReload('stuck boot recovery (TypeError)');
  const { drop } = title(t, true);
  expect(drop?.message).toBe("TypeError: undefined is not an object (evaluating 'worker.port')");
  expect(modal()?.querySelector('.stack')?.textContent).toContain('TypeError');
  expect(modal()?.querySelector('.dev')?.textContent).toContain('Worker boot');
});

test('a crash with no word from the game (iOS kills the page) restarts onto the modal with the last step', () => {
  const t = tab(), world = enterWorld(t);
  world.notes.noteError(new Error('WebGL context lost'));
  // the process died: no pagehide ran; a killed WebContent process can lose sessionStorage too
  t.session.clear();
  const { drop } = title(t, true);
  expect(drop).toMatchObject({ kind: 'restart', what: 'The game restarted unexpectedly', step: 'Worker boot', message: 'Error: WebGL context lost' });
  expect(drop?.reason).toContain('Blender Template');
  expect(modal()).not.toBeNull();
});

test('a silent replace to the title (no reason, a normal pagehide) still says so', () => {
  const t = tab(), world = enterWorld(t);
  // a location.replace('/') with no markUnload: the page ends normally, so its device copies go and the tab's copy stays
  window.dispatchEvent(new Event('pagehide')); world.notes.pageHidden();
  const { drop } = title(t, false);
  expect(drop).toMatchObject({ kind: 'restart', what: 'Unexpectedly back at the title', reason: 'The page reloaded without saying why.' });
});

test('players see plain words only; developer mode adds the real error', () => {
  const t = tab(), world = enterWorld(t);
  world.notes.record({ reason: 'The server closed the connection.', error: { code: 1006, reason: 'going away' } });
  title(t, false);
  expect(modal()?.querySelector('.dev')).toBeNull();
  expect(modal()?.querySelector('.reason')?.textContent).toBe('The server closed the connection.');
  expect(modal()?.querySelector<HTMLButtonElement>('.copy')?.textContent).toBe('Copy details');
});

test('copy details holds every fact, and dismiss closes the modal', async () => {
  const t = tab(), world = enterWorld(t);
  world.notes.record({ reason: 'The server closed the connection.', error: { code: 1006, reason: 'going away' } });
  const { drop } = title(t, true);
  const written: string[] = [];
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (text: string) => { written.push(text); return Promise.resolve(); } } });
  modal()?.querySelector<HTMLButtonElement>('.copy')?.click();
  await vi.waitFor(() => { expect(written).toHaveLength(1); });
  expect(written[0]).toBe(dropDetails(drop as Drop));
  expect(written[0]).toContain('Step: Worker boot');
  expect(written[0]).toContain('Code: 1006');
  modal()?.querySelector<HTMLButtonElement>('.dismiss')?.click();
  expect(modal()).toBeNull();
});

test("the player's own exit shows no modal", () => {
  const exit = tab(), playing = enterWorld(exit);
  playing.notes.markStep({ step: 'Playing' });
  playing.notes.leftByPlayer(); // exitSessionToTitle: the pause menu's EXIT TO MAIN MENU
  playing.life.markUnload('exit to main menu (fresh page)');
  expect(title(exit, true).drop).toBeNull();
  // the loading card's EXIT TO TITLE marks its reason only (src/client/engine/ui/Loading.ts): still the player's choice
  const card = tab(), loading = enterWorld(card);
  loading.life.markUnload('exit to title from the loading card');
  expect(title(card, true).drop).toBeNull();
  expect(modal()).toBeNull();
});

test('a cold launch later never shows an old breadcrumb', () => {
  const t = tab(); enterWorld(t);
  t.session.clear(); // the tab closed
  vi.advanceTimersByTime(11 * 60_000);
  t.local.delete('life.alive.once');
  expect(title(t, true).drop).toBeNull();
});
