// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';
import { installWorldFixture } from './fixtures/worldSetup';
import { Scope } from '../src/shared/engine/app/scope';
import { activeLevel, bindLevelSelection } from '../src/shared/engine/level/selection';
import { openBootSettings } from '../src/client/engine/ui/BootSettings';
import { savedSetting, saveSetting, setting } from '../src/client/engine/ui/Settings';
import { authoredRows } from '../src/client/engine/ui/authoredDebugRows';
import { buildDebugMenu } from '../src/client/engine/ui/DebugMenu';
import { DEBUG_ROWS, type DebugRow } from '../src/client/engine/ui/debugOptions';

await installWorldFixture();

const owners: Scope[] = [], rows: DebugRow[] = [];
afterEach(() => { for (const scope of owners.splice(0)) scope.dispose(); for (const row of rows.splice(0)) authoredRows.delete(row); document.body.replaceChildren(); vi.unstubAllGlobals(); });
function fixture() {
  let value = 'old';
  const changed = vi.fn<(next: string) => void>((next) => { value = next; });
  const row: DebugRow = { id: 'fixture.settings.reload', group: 'perf', label: 'Fixture reload setting',
    choices: () => [{ v: 'old', text: 'Old' }, { v: 'new', text: 'New' }], get: () => value,
    set: changed, on: () => undefined, reload: true, when: () => true, note: 'Staged fixture', ask: 'E435', reviewBy: '2026-12-30' };
  rows.push(row); authoredRows.add(row);
  const scope = new Scope('settings.fixture'); owners.push(scope);
  const card = document.createElement('div'); document.body.append(card);
  const menu = buildDebugMenu(card, { scope });
  const element = menu.row(row.id);
  if (element === undefined) throw new Error('missing fixture row');
  const button = (next: string): HTMLButtonElement => {
    const found = element.querySelector<HTMLButtonElement>(`button[data-v="${next}"]`);
    if (found === null) throw new Error('missing fixture choice'); return found;
  };
  return { menu, scope, changed, element, button, value: () => value };
}
const tap = (button: HTMLButtonElement): void => {
  button.dispatchEvent(new PointerEvent('pointerup', { button: 0, bubbles: true }));
  button.dispatchEvent(new MouseEvent('click', { detail: 1, bubbles: true }));
};

test('a reload choice answers pointerup without applying or navigating until the explicit button', () => {
  const replace = vi.fn<() => void>(); vi.stubGlobal('location', { href: 'https://example.invalid/', replace });
  const f = fixture(), originalButtons = [...f.element.querySelectorAll('button')];
  tap(f.button('new'));
  expect(f.button('new').classList.contains('active')).toBe(true);
  expect(f.value()).toBe('old'); expect(f.changed).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled();
  expect(f.menu.pendingReload()).toBe(1);
  expect([...f.element.querySelectorAll('button')]).toEqual(originalButtons);
  f.menu.applyPending();
  expect(f.value()).toBe('new'); expect(f.changed).toHaveBeenCalledExactlyOnceWith('new');
  expect(f.menu.pendingReload()).toBe(0);
});

test('undoing a staged choice clears it and keyboard clicks remain available', () => {
  const f = fixture();
  f.button('new').click(); expect(f.menu.pendingReload()).toBe(1);
  f.button('old').click(); expect(f.menu.pendingReload()).toBe(0);
  f.menu.applyPending(); expect(f.changed).not.toHaveBeenCalled();
  f.scope.dispose(); tap(f.button('new')); expect(f.menu.pendingReload()).toBe(0);
});


test('SR11: the title panel is the in-game tabs, and a quality pick reloads once from Graphics ▸ Reload now', async () => {
  const replace = vi.fn<() => void>();
  vi.stubGlobal('location', { href: 'https://example.invalid/', reload: replace, replace });
  const unbind = bindLevelSelection({ ...activeLevel(), mechanisms: [] }), original = savedSetting('tier'), running = setting('tier');
  try {
    openBootSettings();
    const root = document.querySelector('.ws-gmenu');
    if (root === null) throw new Error('missing title Settings');
    const tabs = [...root.querySelectorAll<HTMLElement>('.ws-gmenu-svtab')].filter(b => !b.hidden).map(b => b.dataset['svTab']);
    expect(tabs).toEqual(['graphics', 'sound', 'controls', 'saves', 'system']);
    expect(root.querySelector('[data-setting="volume"]')).not.toBeNull(); // Sound is the in-game Sound
    expect(root.querySelector('[data-setting="musicStyle"]')).toBeNull(); // AUDIO AU16 (J304): one music style, no choice
    expect(root.querySelector('.ws-gmenu-review')).toBeNull(); // Review is in-game only
    const pane = root.querySelector<HTMLElement>('.ws-gmenu-svpane[data-sv-pane="graphics"]');
    const tier = pane?.querySelector<HTMLElement>('[data-gfx="tier"]');
    const next = tier?.querySelector<HTMLButtonElement>(`button[data-v="${original === 'phone' ? 'desktop' : 'phone'}"]`);
    if (next === null || next === undefined) throw new Error('missing quality choice');
    tap(next);
    expect(setting('tier')).toBe(running); expect(savedSetting('tier')).not.toBe(original);
    expect(replace).not.toHaveBeenCalled(); expect(document.querySelector('.ws-reload')).toBeNull();
    openBootSettings(); // the tab re-reads its pending count on open (and every 2 s)
    const row = pane?.querySelector<HTMLElement>('[data-gfx="reload"]');
    const now = row?.querySelector<HTMLButtonElement>('button');
    if (row === null || row === undefined || now === null || now === undefined) throw new Error('missing Reload now');
    expect(row.hidden).toBe(false);
    tap(now); await new Promise(resolve => { setTimeout(resolve, 50); });
    expect(replace).toHaveBeenCalledTimes(1);
    root.querySelector<HTMLButtonElement>('.ws-gmenu-close')?.click();
  } finally { saveSetting('tier', original); unbind(); }
});

test('retired diagnostics are absent while Clear downloads remains in Developer', () => {
  expect(DEBUG_ROWS.some(row => row.id === 'time' || row.id === 'weather' || row.id === 'game.template')).toBe(false);
  expect(DEBUG_ROWS.find(row => row.id === 'clearDownloads')).toMatchObject({ purpose: 'developer', group: 'tools' });
});


test('storage lives under Clear downloads rather than a diagnostic row', () => {
  expect(DEBUG_ROWS.some(row => ['fps', 'budgetReadout', 'storage'].includes(row.id))).toBe(false);
  const scope = new Scope('storage.action'); owners.push(scope);
  const card = document.createElement('div'); document.body.append(card);
  const menu = buildDebugMenu(card, { scope, purpose: 'developer' }), row = menu.row('clearDownloads');
  if (row === undefined) throw new Error('missing Clear downloads');
  const geometry = Object.assign([new DOMRect(0, 0, 100, 44)], { item: (index: number) => index === 0 ? new DOMRect(0, 0, 100, 44) : null });
  const visible = vi.spyOn(row, 'getClientRects').mockReturnValue(geometry);
  try {
    menu.paint();
    const readout = row.parentElement?.querySelector<HTMLElement>('.ws-gmenu-mem');
    expect(readout?.textContent).toContain('usage / quota'); expect(readout?.hidden).toBe(false);
  } finally { visible.mockRestore(); }
});
