// @vitest-environment happy-dom
// QA 11-19 row 58 (Jake's A-1.4): the Bag's MAP tab shows the map's own stops as its chips (0.25x 0.5x 1x 2x on the grid),
// a chip sets its stop's zoom, the chip at the map's zoom is lit, and no hint line sits under the zoom row.
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { withOwner } from '../../../shared/engine/app/ownership';
import { legacyDouble } from '../../../test/engine/FakeGame';
import { GameMenu } from './Menu';
import type { FullMap } from './Map';
import { gridStops, type MapGrid } from './mapView';
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

const GRID: MapGrid = { x0: -3.5 * 562.5, z0: -3.5 * 562.5, pitch: 562.5, cells: 7 };

test('row 58, MN18: the grid map\'s chips read fit 0.25x 0.5x 1x 2x, open lit on 1x, and set their stop', () => {
  const owner = new Scope('bag-map-chips'); owners.push(owner);
  owner.onDispose(bindFlatTerrain());
  const stops = gridStops(GRID), half = stops[2], one = stops[3];
  if (half === undefined || one === undefined) throw new Error('no stops');
  const state = { zoom: one.zoom };
  const setZoom = vi.fn((z: number) => { state.zoom = z; });
  const map = legacyDouble<FullMap>({ mount: () => undefined, setZoom, fit: () => undefined, show: () => undefined, hide: () => undefined, hasRoom: false, stops, quest: null, get zoom() { return state.zoom; } });
  const menu = withOwner(owner, () => new GameMenu({ fullMap: map, settings: () => ({ weapons: new Set(), melee: false, tracers: false, huntersEye: false }) }));
  menu.open('map');
  const chips = [...menu.root.querySelectorAll<HTMLButtonElement>('.ws-gmenu-zoom')];
  expect(chips.map(c => c.textContent)).toEqual(['fit', '0.25×', '0.5×', '1×', '2×']);
  expect(chips.map(c => c.classList.contains('active'))).toEqual([false, false, false, true, false]);
  expect(menu.root.querySelector('.ws-gmenu-hint')?.textContent).toBe('');
  chips[2]?.click();
  expect(setZoom.mock.calls).toEqual([[half.zoom]]);
  expect(chips.map(c => c.classList.contains('active'))).toEqual([false, false, true, false, false]);
  // MN8: while a pinch runs, the chip of the stop it will settle on is lit
  state.zoom = one.zoom * 1.3; map.onZoom?.(state.zoom);
  expect(chips.map(c => c.classList.contains('active'))).toEqual([false, false, false, true, false]);
  state.zoom = one.zoom * 1.5; map.onZoom?.(state.zoom);
  expect(chips.map(c => c.classList.contains('active'))).toEqual([false, false, false, false, true]);
  menu.close();
});
