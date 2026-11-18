// @vitest-environment happy-dom
// SHARD-SOURCE SS-GP3: a grid data cell's declared HUD and boss panels. A one-shard page mounts its `ui` rows reading the
// shard's fields and draws a boss bar per declared boss panel off the wire's encounter rows (`client.ts`,
// `installDeclaredHud`); a grid copy did neither. While the feet stand in the copy its HUD reads the cell server's rows,
// holds its last word mid-crossing, and leaves with the stay.
import { afterEach, expect, test, vi } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import type { SystemSpec } from '@wildshard/engine/app/systems';
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { EncounterRow } from '../boss/barFeed';
import { hasDeclaredHud } from '../shardfile/declaredHud';
import { wirePage } from '../shardfile/wirePage';
import { installCellHud } from './dataCellHud';

const counter = { kind: 'counter', id: 'lamps.lit', label: 'Lamps lit', band: 'band.2', order: 0, min: 0, max: 1, field: 'lamps' }; // happy-dom's meter keeps 0 to 1
const panel = { kind: 'bossPanel', id: 'wyrm.panel', encounter: 'wyrm', name: 'The Wyrm', title: 'Of the dunes', retry: 'Again' };
const source = {
  ui: [counter, panel],
  state: { shared: [{ id: 1, name: 'lamps', privacy: 'public', default: 0 }], player: [] },
  encounters: [{ id: 'wyrm', phases: [{ at: 1, caption: 'I', name: 'one' }, { at: 0.5, caption: 'II', name: 'two' }] }],
  targets: { itemFields: [] }, sim: { scripts: [], bindings: [] },
} as unknown as Shardfile;
const fight = (hp: number): EncounterRow => ({ id: 'wyrm', kind: 'boss', state: 'fight', hp, phase: 0, shield: false, body: 0, skip: 0, banners: 0, signatures: 0, known: true, sleep: 0, reward: null });

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

test('a copy\'s declared HUD reads the cell server\'s rows while entered and drops on leaving; its boss panel draws off the cell\'s encounters', () => {
  expect(hasDeclaredHud(source)).toBe(true);
  expect(hasDeclaredHud({ ui: [] })).toBe(false);
  const rows = new Map<string, number>();
  let encounters: readonly EncounterRow[] = [];
  vi.spyOn(wirePage, 'row').mockImplementation((name) => rows.get(name));
  vi.spyOn(wirePage, 'encounters').mockImplementation(() => encounters);
  const stay = new Scope('grid.data-hud.fixture'), shelf = document.createElement('div'), systems: SystemSpec[] = [], locks: boolean[] = [];
  document.body.append(shelf);
  // the stay's HUD: what it shows leaves with the stay, as the page's context bound to the stay does (`stayContext.ts`)
  const shown = (el: HTMLElement): void => { shelf.append(el); stay.onDispose(() => { el.remove(); }); };
  let here = true;
  const handles = installCellHud(source, stay, () => here, {
    hud: { pin: (_at, el) => { shown(el); }, widget: (_band, el) => { shown(el); }, relabel: () => () => undefined },
    bag: { tab: () => undefined, fragment: () => undefined }, bossRoot: shelf, system: (spec) => { systems.push(spec); },
    boss: { lock: (on) => { locks.push(on); }, attempt: () => undefined, died: () => undefined } });
  const frame = (): void => { for (const system of systems) system.run(1 / 60, 0); };
  const meter = shelf.querySelector('meter');
  if (meter === null) throw new Error('The counter is on the HUD');
  frame();
  expect(meter.value).toBe(0); // no row yet: the field's default
  rows.set('lamps', 0.3); frame();
  expect(meter.value).toBe(0.3);
  const bar = handles.bosses.get('wyrm')?.presentation;
  if (bar === undefined) throw new Error('The boss panel is mounted');
  expect(bar.barShown).toBe(false);
  encounters = [fight(0.8)]; frame();
  expect(bar.barShown).toBe(true); // drawn off the cell's encounter row
  // mid-crossing the wire is another cell's: the HUD holds this cell's last word
  here = false; rows.set('lamps', 0.1); encounters = []; frame();
  expect(meter.value).toBe(0.3);
  expect(bar.barShown).toBe(true);
  here = true; rows.set('lamps', 0.6); encounters = [fight(0.5)]; frame();
  expect(meter.value).toBe(0.6);
  // leaving the copy ends the stay: its counter and its boss bar are gone
  stay.dispose();
  expect(shelf.querySelector('meter')).toBeNull();
  expect(shelf.children).toHaveLength(0);
});
