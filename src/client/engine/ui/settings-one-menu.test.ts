// @vitest-environment happy-dom
import { afterEach, expect, test } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { withOwner } from '../../../shared/engine/app/ownership';
import { engineString } from '../../../shared/engine/strings';
import { isDev, setDev } from '../core/devMode';
import { buildSettingsTabs, SETTINGS_TABS, tabOf } from './settingsTabs';
import { graphicsRow, graphicsSettingsControls } from './graphicsBlock';

// J458 (Jake, 2026-11-19, the One Settings Menu board's A, with his change: "we must keep the dev menu. The dev menu is
// behind the dev toggle ... I need the dev menu. I need the dev toggle."): Saves folds into System as Progress file, the
// phone's developer rows leave Graphics for DEV ▸ Graphics, the cards carry no explainer, and DEV shows only in Developer mode.
const scopes: Scope[] = [];
const wasDev = isDev();
afterEach(() => { for (const scope of scopes.splice(0)) scope.dispose(); setDev(wasDev); document.body.replaceChildren(); });
const menu = (graphics = graphicsSettingsControls()) => {
  const scope = new Scope('one-menu'); scopes.push(scope);
  const tabs = withOwner(scope, () => buildSettingsTabs(scope, { applyPending: () => undefined, graphics }));
  document.body.append(tabs.root);
  return tabs;
};
const pane = (root: HTMLElement, tab: string): HTMLElement => {
  const found = root.querySelector<HTMLElement>(`.ws-gmenu-svpane[data-sv-pane="${tab}"]`);
  if (found === null) throw new Error(`no ${tab} pane`); return found;
};
const tabShown = (root: HTMLElement, tab: string): boolean => root.querySelector<HTMLElement>(`[data-sv-tab="${tab}"]`)?.hidden === false;

test('J458: four tabs, Saves is System ▸ Progress file, and a game\'s saves.game section still lands there', () => {
  expect(SETTINGS_TABS).toEqual(['graphics', 'sound', 'controls', 'system', 'dev']);
  expect(tabOf('saves.game')).toBe('system'); expect(tabOf('saves.file')).toBe('system');
  setDev(false);
  const tabs = menu(), file = document.createElement('div'), cards = document.createElement('div');
  file.textContent = 'export / import';
  tabs.put('system.name', [document.createElement('div')]);
  tabs.put('saves.file', [file]); tabs.sync();
  const system = pane(tabs.root, 'system');
  expect(system.contains(file)).toBe(true);
  expect(tabs.root.querySelector('[data-sv-tab="saves"]')).toBeNull();
  const label = [...system.querySelectorAll<HTMLElement>('.ws-gmenu-label')].find((head) => head.textContent === engineString('s_st_g_progress'));
  expect(label?.textContent).toBe('Progress file');
  // one label over both groups: the shard's cards come first, under it, then the file
  expect(label?.hidden).toBe(false);
  tabs.put('saves.game', [cards], true); tabs.sync();
  expect((label?.compareDocumentPosition(cards) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(cards.compareDocumentPosition(file) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect([...system.querySelectorAll('.ws-gmenu-label')].filter((head) => head.textContent === 'Progress file')).toHaveLength(1);
  // with neither group holding a row the label goes too
  file.hidden = true; cards.hidden = true; tabs.sync();
  expect(label?.hidden).toBe(true);
});

test('J458: a Graphics control in section dev shows in DEV ▸ Graphics, and DEV shows only with the Developer switch on', () => {
  setDev(false);
  const row = document.createElement('button'); row.textContent = 'dev row';
  const tabs = menu([{ id: 'proofDev', section: 'dev', order: 1, build: () => row }]);
  tabs.sync();
  expect(pane(tabs.root, 'dev').querySelector('[data-sv-group="dev.graphics"] [data-gfx="proofDev"]')).toBe(row);
  expect(pane(tabs.root, 'graphics').contains(row)).toBe(false);
  expect(tabShown(tabs.root, 'dev')).toBe(false);
  setDev(true); tabs.sync();
  expect(tabShown(tabs.root, 'dev')).toBe(true);
  setDev(false); tabs.sync();
  expect(tabShown(tabs.root, 'dev')).toBe(false);
});

test('J458: the phone\'s pixel count, frame readout and In-world toggle are DEV rows; the presets and effects stay in Graphics', () => {
  const sections = new Map(graphicsSettingsControls().map((control) => [control.id, control.section]));
  for (const id of ['gfxDrawing', 'gfxReadout', 'gfxWorld']) expect(sections.get(id), id).toBe('dev');
  expect(sections.get('mode')).toBe('main'); expect(sections.get('gfxDensity')).toBe('main');
  for (const id of ['gfxShadows', 'gfxBloom', 'gfxRays', 'gfxAa']) expect(sections.get(id), id).toBe('effects');
  // the cards say what each preset is, with no explainer under them; Pixel density carries no pixel count
  const scope = new Scope('cards'); scopes.push(scope);
  const cards = withOwner(scope, () => graphicsRow('modeCards', scope)).root;
  expect(cards.textContent).not.toContain('Every control applies at once');
  expect(cards.querySelector('[data-mode="custom"]')?.textContent).toContain('lights up when you change one');
  const density = withOwner(scope, () => graphicsRow('density', scope)).root;
  expect(density.textContent).not.toContain('Drawing');
});
