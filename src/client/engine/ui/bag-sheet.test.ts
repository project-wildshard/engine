// @vitest-environment happy-dom
// MAP-NEXT MN15 (QA 11-19 row 59, Jake ~17:22: "update all the other in game bag menus and stuff with the new layout"; ~17:24:
// "You touched the layout for everything lol"): the Bag's A sheet is its own class on every Bag tab, never on PAUSE, and the
// sheet CSS keys its A rules on that class, so the title's Settings (BootSettings, the same .ws-gmenu sheet) is untouched.
// oxlint-disable-next-line import/no-nodejs-modules -- the real stylesheet, not a copy of it
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { withOwner } from '../../../shared/engine/app/ownership';
import { legacyDouble } from '../../../test/engine/FakeGame';
import { GameMenu } from './Menu';
import type { FullMap } from './Map';
import { bindFlatTerrain } from '../../../test/engine/terrain';
import { installAssetTables } from '../../../shared/engine/boot/tables';

const tableSlot = Symbol.for('engine.asset-tables');
const previousTables = Object.getOwnPropertyDescriptor(globalThis, tableSlot);
beforeAll(() => { installAssetTables({ bytes: {}, versions: {}, music: {}, sfx: {}, packs: {} }); });
afterAll(() => {
  if (previousTables === undefined) Reflect.deleteProperty(globalThis, tableSlot);
  else Object.defineProperty(globalThis, tableSlot, previousTables);
});
const owners: Scope[] = [];
afterEach(() => { for (const owner of owners.splice(0)) owner.dispose(); vi.restoreAllMocks(); });

test('MN15: every Bag tab wears the A sheet (one header), PAUSE never does', () => {
  const owner = new Scope('bag-sheet'); owners.push(owner);
  owner.onDispose(bindFlatTerrain());
  const map = legacyDouble<FullMap>({ mount: () => undefined, setZoom: () => undefined, fit: () => undefined, show: () => undefined, hide: () => undefined, hasRoom: false, stops: [{ label: 1, zoom: 1 }], quest: null, zoom: 1 });
  const menu = withOwner(owner, () => new GameMenu({ fullMap: map, settings: () => ({ weapons: new Set(), melee: false, tracers: false, huntersEye: false }) }));
  const tabs = [{ id: 'gear', order: 10 }, { id: 'finds', order: 20 }, { id: 'inventory', order: 30 }, { id: 'achievements', order: 40 }];
  for (const tab of tabs) menu.addTab({ ...tab, title: tab.id.toUpperCase(), icon: 'pack' });
  const bars = new Set<Element | null>();
  for (const tab of ['map', ...tabs.map(row => row.id)]) {
    menu.open(tab);
    expect(menu.root.classList.contains('play'), tab).toBe(true); expect(menu.root.classList.contains('pause'), tab).toBe(false);
    expect(menu.root.querySelector<HTMLElement>('.ws-gmenu-tabs')?.hidden, tab).toBe(false);
    bars.add(menu.root.querySelector('.ws-gmenu-bar'));
    menu.close();
  }
  expect(bars.size).toBe(1);
  menu.open('settings');
  expect(menu.root.classList.contains('pause')).toBe(true); expect(menu.root.classList.contains('play')).toBe(false);
  menu.close();
});

test('MN15: the sheet CSS keys the A rules on .play, never on "not PAUSE" (the title Settings is not PAUSE)', () => {
  const css = readFileSync('src/client/engine/ui/styles/gmenu.css', 'utf8');
  expect(css).not.toContain(':not(.pause)');
  for (const rule of ['.ws-gmenu.play .ws-gmenu-bar {', '.ws-gmenu.play .ws-gmenu-panel {', '.ws-gmenu.play { padding: 0; }', '.ws-gmenu.play { padding-left: 0;']) expect(css).toContain(rule);
});

// J499 (Jake 2026-11-23 ~12:55 Cancun, QA-FEEDBACK-2026-11-23-b row 16): "We should make the map a 1.3 height", the Bag "full
// page ... get rid of this weird curved thing", and real padding above and below the map.
test('J499: the Bag is the whole screen with no frame of its own, its map 1.3 tall with room above and below', () => {
  const css = readFileSync('src/client/engine/ui/styles/gmenu.css', 'utf8');
  const play = css.slice(css.indexOf('.ws-gmenu.play .ws-gmenu-sheet {'));
  const sheet = play.slice(0, play.indexOf('}'));
  for (const part of ['max-width: none', 'background: rgb(8, 12, 20)', 'border: 0', 'border-radius: 0', 'box-shadow: none', 'safe-area-inset-bottom', 'var(--ws-top)']) expect(sheet).toContain(part);
  expect(css).toContain('.ws-gmenu.play .ws-gmenu-sheet::before, .ws-gmenu.play .ws-gmenu-sheet::after { display: none; }');
  expect(css).toContain('.ws-gmenu.play { padding: 0; }');
  expect(css).toContain('height: calc(100cqw * 1.3);'); expect(css).toContain('aspect-ratio: 10 / 13;');
  expect(css).not.toContain('100cqw * 1.4'); expect(css).not.toContain('aspect-ratio: 5 / 7');
  expect(css).toMatch(/\.ws-gmenu-mapquest \{[^}]*margin-bottom: 16px/u); expect(css).toMatch(/\.ws-gmenu-mapfoot \{[^}]*margin-top: 16px/u);
});

// QA 11-23-b row 16 (polish board, Quest A): the quest card is one line, the objective, and a tap opens its chapter and hint
test('row 16: the quest card is one 36 px line until opened', () => {
  const css = readFileSync('src/client/engine/ui/styles/gmenu.css', 'utf8');
  expect(css).toMatch(/\.ws-gmenu-mapquest \{[^}]*min-height: 36px/u);
  expect(css).toContain('.ws-gmenu .ws-gmenu-mapquest:not([data-open]) .ws-gmenu-mapquest-title, .ws-gmenu .ws-gmenu-mapquest:not([data-open]) .ws-gmenu-mapquest-hint { display: none; }');
  expect(css).toMatch(/\.ws-gmenu-mapquest-text \{[^}]*white-space: nowrap/u);
});
