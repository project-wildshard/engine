// @vitest-environment happy-dom
// J455 (QA 2026-11-19 rows 31 and 57): the Bag map opens on you with your zone filling 72% of the short side and a rim of
// every neighbour around it, zoom 1 shows the whole 7 by 7, and the
// pan is clamped so a whole grid cell always stays in view. Row 58 (Jake's A-1.4): the chips are 0.25x (the whole 7 by 7),
// 0.5x, 1x (the opening view) and 2x, and a pinch settles on the nearest one.
import { afterEach, expect, test, vi } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { withOwner } from '../../../shared/engine/app/ownership';
import { legacyDouble } from '../../../test/engine/FakeGame';
import { FullMap } from './Map';
import type { MapExtras, Minimap } from './Minimap';
import { OPEN_ZONE_FILL, SHARD_STOPS, cellAt, clampView, gridPpm, gridStops, namesPlaces, nearestStop, openZoom, wholeCellsIn, type MapGrid } from './mapView';

afterEach(() => { vi.restoreAllMocks(); });

const PITCH = 562.5;
/** the format's 7 by 7 (GRID_RADIUS 3) seen from the centre cell's frame */
const GRID: MapGrid = { x0: -3.5 * PITCH, z0: -3.5 * PITCH, pitch: PITCH, cells: 7 };

/** the zone's walled square (the chunk) inside its pitch */
const ZONE = 500;

test('the map opens with the zone at 72% of the short side and a rim of road and next zone around it', () => {
  expect(OPEN_ZONE_FILL).toBe(0.72);
  const short = 1000, across = short / gridPpm(GRID, short, openZoom(GRID));
  expect(ZONE / across).toBeCloseTo(0.72);
  // each side shows the zone's whole road (its half and the neighbour's) and a slice of the next zone past it
  const rim = (across - ZONE) / 2, road = PITCH - ZONE;
  expect(rim).toBeGreaterThan(road + 20);
  expect(rim).toBeLessThan(road + ZONE / 4);
  expect(short / gridPpm(GRID, short, 1) / PITCH).toBeCloseTo(7);
});

test('MN18 (J496): fit is the whole 7 by 7, 0.25x a literal quarter of 1x (about 5 cells), 0.5x and 2x halve and double 1x', () => {
  const stops = gridStops(GRID), open = openZoom(GRID);
  expect(stops.map(s => s.label)).toEqual(['fit', 0.25, 0.5, 1, 2]);
  expect(stops.map(s => s.zoom)).toEqual([1, open / 4, open / 2, open, 2 * open]);
  const cellsAcross = (zoom: number): number => 1000 / gridPpm(GRID, 1000, zoom) / PITCH;
  // fit: the 7 by 7 exactly across the short side, all 49 cells
  expect(cellsAcross(stops[0]?.zoom ?? 0)).toBeCloseTo(7);
  expect(wholeCellsIn(GRID, { x0: GRID.x0, x1: GRID.x0 + 7 * PITCH, z0: GRID.z0, z1: GRID.z0 + 7 * PITCH })).toBe(49);
  // 0.25x: a quarter of 1x, about 5 cells across, measured from the opening view like the others
  expect(cellsAcross(stops[1]?.zoom ?? 0)).toBeGreaterThan(4.5); expect(cellsAcross(stops[1]?.zoom ?? 0)).toBeLessThan(5.5);
  expect(cellsAcross(stops[1]?.zoom ?? 0) / cellsAcross(open)).toBeCloseTo(4);
  // a grid too small for a 0.25x past fit keeps fit only
  expect(gridStops({ ...GRID, cells: 3 }).map(s => s.label)).toEqual(['fit', 0.5, 1, 2]);
  expect(SHARD_STOPS.map(s => s.label)).toEqual([1, 2, 4]);
});

test('MN8: a pinch settles on the nearest stop by log distance, either side of each midpoint and past both ends', () => {
  const stops = gridStops(GRID);
  for (const [i, stop] of stops.entries()) {
    const next = stops[i + 1];
    if (next === undefined) continue;
    const mid = Math.sqrt(stop.zoom * next.zoom);
    expect(nearestStop(stops, mid * 0.99)).toBe(stop);
    expect(nearestStop(stops, mid * 1.01)).toBe(next);
  }
  expect(nearestStop(stops, 0.5).label).toBe('fit');
  expect(stops).toHaveLength(5);
  expect(nearestStop(stops, 100).label).toBe(2);
});

test('panning away leaves exactly one whole corner cell in view, at every zoom', () => {
  for (const zoom of [1.2, 2, 3, 4]) {
    const ppm = gridPpm(GRID, 1000, zoom), halfX = 500 / ppm, halfZ = 700 / ppm;
    for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
      const at = clampView(GRID, { cx: dx * 1e6, cz: dz * 1e6, halfX, halfZ });
      const box = { x0: at.cx - halfX, x1: at.cx + halfX, z0: at.cz - halfZ, z1: at.cz + halfZ };
      expect(wholeCellsIn(GRID, box), `zoom ${String(zoom)} corner ${String(dx)},${String(dz)}`).toBeGreaterThanOrEqual(1);
      // the corner cell is the one left: the view ends a cell inside the grid's edge on the side you panned toward
      const corner = { x: dx * 3 * PITCH, z: dz * 3 * PITCH };
      expect(box.x0 <= corner.x - PITCH / 2 + 1e-6 && box.x1 >= corner.x + PITCH / 2 - 1e-6).toBe(true);
      expect(box.z0 <= corner.z - PITCH / 2 + 1e-6 && box.z1 >= corner.z + PITCH / 2 - 1e-6).toBe(true);
    }
  }
});

test('a view wider than the grid keeps all of it in view', () => {
  const ppm = gridPpm(GRID, 1000, 1), halfX = 500 / ppm, halfZ = 900 / ppm;
  const at = clampView(GRID, { cx: 1e6, cz: -1e6, halfX, halfZ });
  expect(wholeCellsIn(GRID, { x0: at.cx - halfX, x1: at.cx + halfX, z0: at.cz - halfZ, z1: at.cz + halfZ })).toBe(49);
});

test('the cell you are in', () => {
  expect(cellAt(GRID, 10, -20)).toEqual({ x: 0, z: 0 });
  expect(cellAt(GRID, -3 * PITCH + 100, 3 * PITCH)).toEqual({ x: -3 * PITCH, z: 3 * PITCH });
  expect(cellAt(GRID, 4 * PITCH, 0)).toBeNull();
});

function fixture(extras: MapExtras | null) {
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((frame: FrameRequestCallback) => { frames.push(frame); return frames.length; });
  vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => undefined);
  const strokeRect = vi.fn<CanvasRenderingContext2D['strokeRect']>(), fillText = vi.fn<(text: string, x: number, y: number) => void>();
  const ctx = legacyDouble<CanvasRenderingContext2D>({
    setTransform: () => undefined, clearRect: () => undefined, fillRect: () => undefined,
    drawImage: () => undefined, strokeRect, strokeText: () => undefined, fillText,
    measureText: text => legacyDouble<TextMetrics>({ width: text.length * 7 }),
    beginPath: () => undefined, moveTo: () => undefined, lineTo: () => undefined,
    closePath: () => undefined, save: () => undefined, restore: () => undefined,
    translate: () => undefined, rotate: () => undefined, fill: () => undefined,
    stroke: () => undefined, arc: () => undefined, setLineDash: () => undefined,
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function canvasContext(this: HTMLCanvasElement) { return Object.assign(ctx, { canvas: this }); });
  const image = document.createElement('canvas');
  const minimap = legacyDouble<Minimap>({ room: null, bakedGround: true, marks: [], layerGen: 0, layers: { terrain: image, cover: image } });
  const scope = new Scope('map-view'), map = withOwner(scope, () => new FullMap(minimap));
  map.mount(document.body);
  map.setPois(() => []);
  map.setExtras(() => extras);
  return { map, scope, frames, strokeRect, fillText };
}
const gridExtras: MapExtras = { rects: [], images: [], labels: [], grid: GRID };
const cellsAcross = (box: { x0: number; x1: number; z0: number; z1: number }): number => Math.min(box.x1 - box.x0, box.z1 - box.z0) / PITCH;

test('the Bag map opens centred on you with the zone at 72%, in a corner cell too', () => {
  const { map, scope } = fixture(gridExtras);
  try {
    const you = { x: -3 * PITCH + 40, z: 3 * PITCH - 60 };
    map.update(you, 0); map.show();
    expect(map.zoom).toBeCloseTo(openZoom(GRID));
    const box = map.viewBox();
    expect((box.x0 + box.x1) / 2).toBeCloseTo(you.x);
    expect((box.z0 + box.z1) / 2).toBeCloseTo(you.z);
    expect(ZONE / (cellsAcross(box) * PITCH)).toBeCloseTo(0.72);
    map.hide();
    map.update({ x: 0, z: 0 }, 0); map.show();
    expect(map.viewBox().x0).toBeCloseTo(-map.viewBox().x1);
  } finally { scope.dispose(); }
});

test('zoom 1 shows the whole 7 by 7, and a drag far away stops with a whole cell in view', () => {
  const { map, scope } = fixture(gridExtras);
  try {
    map.update({ x: 0, z: 0 }, 0); map.show();
    map.setZoom(1);
    expect(wholeCellsIn(GRID, map.viewBox())).toBe(49);
    map.setZoom(4);
    const canvas = map.root.querySelector('canvas');
    if (canvas === null) throw new Error('no canvas');
    canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 0, clientY: 0 }));
    for (let i = 1; i <= 40; i++) canvas.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: i * 400, clientY: i * 400 }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }));
    const box = map.viewBox();
    expect(wholeCellsIn(GRID, box)).toBeGreaterThanOrEqual(1);
    // dragged right and down = the view moved to world +X and +Z (the minimap's convention): the +X, +Z corner cell stays
    expect(box.x0).toBeLessThanOrEqual(2.5 * PITCH + 1e-6);
    expect(box.z0).toBeLessThanOrEqual(2.5 * PITCH + 1e-6);
    expect(box.x1).toBeGreaterThan(3.5 * PITCH);
  } finally { scope.dispose(); }
});

test('the map outlines the cell you are in, not the home chunk', () => {
  const { map, scope, frames, strokeRect } = fixture(gridExtras);
  try {
    map.update({ x: PITCH + 10, z: 0 }, 0); map.show();
    for (const frame of frames.splice(0)) frame(16);
    const box = map.viewBox(), w = window.innerWidth, ppm = w / (box.x1 - box.x0);
    // the cell at +X sits left of the centre on screen (-X is east, screen right)
    const outlined = strokeRect.mock.calls.map(([x, , width]) => ({ x, width }));
    const cellLeft = w / 2 + ((box.x0 + box.x1) / 2 - (PITCH + 250)) * ppm;
    expect(outlined.some(o => Math.abs(o.x - cellLeft) < 1 && Math.abs(o.width - 500 * ppm) < 1)).toBe(true);
  } finally { scope.dispose(); }
});

test('a one-shard map keeps its old fit: the chunk, centred, at 1x', () => {
  const { map, scope } = fixture(null);
  try {
    map.update({ x: 200, z: 200 }, 0); map.show();
    expect(map.zoom).toBe(1);
    const box = map.viewBox();
    expect((box.x0 + box.x1) / 2).toBeCloseTo(0);
  } finally { scope.dispose(); }
});

test('row 58: the grid map\'s chips are its stops, and a pinch settles on the nearest one about the fingers', () => {
  const { map, scope, frames } = fixture(gridExtras);
  try {
    map.update({ x: 0, z: 0 }, 0); map.show();
    expect(map.stops).toEqual(gridStops(GRID));
    const open = openZoom(GRID), canvas = map.root.querySelector('canvas');
    if (canvas === null) throw new Error('no canvas');
    const at = (id: number, x: number, y: number, type = 'pointermove'): void => { canvas.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y })); };
    // pinch out 1.3 times from 1x: under the halfway (1.41x) to 2x, so it settles back on 1x
    at(1, 400, 300, 'pointerdown'); at(2, 600, 300, 'pointerdown');
    at(1, 370, 300); at(2, 630, 300);
    expect(map.zoom).toBeCloseTo(open * 1.3);
    at(2, 630, 300, 'pointerup');
    for (let t = 0; frames.length > 0 && t < 40; t++) for (const frame of frames.splice(0)) frame(1000 + t * 16);
    expect(map.zoom).toBeCloseTo(open);
    // pinch out 1.6 times: past the halfway, so it settles on 2x
    at(2, 600, 300, 'pointerdown'); at(1, 370, 300); at(2, 370 + 1.6 * 230, 300);
    at(1, 370, 300, 'pointerup');
    for (let t = 0; frames.length > 0 && t < 40; t++) for (const frame of frames.splice(0)) frame(5000 + t * 16);
    expect(map.zoom).toBeCloseTo(2 * open);
    at(2, 0, 0, 'pointerup');
  } finally { scope.dispose(); }
});

test('a one-shard map keeps its 1x 2x 4x chips and its free pinch', () => {
  const { map, scope } = fixture(null);
  try {
    map.update({ x: 0, z: 0 }, 0); map.show();
    expect(map.stops).toBe(SHARD_STOPS);
    const canvas = map.root.querySelector('canvas');
    if (canvas === null) throw new Error('no canvas');
    const at = (id: number, x: number, type = 'pointermove'): void => { canvas.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: 300 })); };
    at(1, 400, 'pointerdown'); at(2, 600, 'pointerdown'); at(1, 370); at(2, 630); at(2, 630, 'pointerup');
    expect(map.zoom).toBeCloseTo(1.3);
  } finally { scope.dispose(); }
});

test('MN7: a 386 x 540 pt frame at each stop, every chip zooming about you', () => {
  const { map, scope } = fixture(gridExtras);
  try {
    Object.defineProperty(map.root, 'clientWidth', { value: 386 });
    Object.defineProperty(map.root, 'clientHeight', { value: 540 });
    const you = { x: 40, z: -30 };
    map.update(you, 0); map.show();
    const across = (): number => { const b = map.viewBox(); return b.x1 - b.x0; };
    const centred = (): void => { const b = map.viewBox(); expect((b.x0 + b.x1) / 2).toBeCloseTo(you.x); expect((b.z0 + b.z1) / 2).toBeCloseTo(you.z); };
    expect((map.viewBox().z1 - map.viewBox().z0) / across()).toBeCloseTo(540 / 386);
    const [fit, quarter, half, one, two] = map.stops;
    if (fit === undefined || quarter === undefined || half === undefined || one === undefined || two === undefined) throw new Error('five stops');
    map.setZoom(two.zoom); expect(ZONE / across()).toBeCloseTo(1.44); centred();
    map.setZoom(half.zoom); expect(across() / PITCH).toBeCloseTo(2.47, 1); centred();
    // MN18: 0.25x about 5 cells across (about you, clamped inside the grid), fit all 49
    map.setZoom(quarter.zoom); expect(across() / PITCH).toBeCloseTo(4.94, 1);
    map.setZoom(fit.zoom); expect(wholeCellsIn(GRID, map.viewBox())).toBe(49);
    // pan far away: at 1x the clamp keeps a whole cell in view; at 2x the frame is narrower than a cell (347 m of 562.5),
    // so the clamp keeps the whole view inside the corner cell. The 1x chip brings back the opening view on you
    const canvas = map.root.querySelector('canvas');
    if (canvas === null) throw new Error('no canvas');
    const panFar = (): void => {
      canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 0, clientY: 0 }));
      for (let i = 1; i <= 40; i++) canvas.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: i * 400, clientY: -i * 400 }));
      canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }));
    };
    map.setZoom(one.zoom); panFar();
    expect(wholeCellsIn(GRID, map.viewBox())).toBeGreaterThanOrEqual(1);
    map.setZoom(two.zoom); panFar();
    const box = map.viewBox(), edge = 3.5 * PITCH;
    expect(box.x1).toBeLessThanOrEqual(edge + 1e-6); expect(box.x0).toBeGreaterThanOrEqual(edge - PITCH - 1e-6);
    expect(box.z0).toBeGreaterThanOrEqual(-edge - 1e-6); expect(box.z1).toBeLessThanOrEqual(-edge + PITCH + 1e-6);
    map.setZoom(one.zoom); expect(ZONE / across()).toBeCloseTo(0.72); centred();
  } finally { scope.dispose(); }
});

test('MN13: the grid map names its places at 1x and 2x, and only marks them at 0.5x, 0.25x and fit', () => {
  expect(gridStops(GRID).map(stop => namesPlaces(GRID, stop.zoom))).toEqual([false, false, false, true, true]);
  expect(namesPlaces(undefined, 1)).toBe(true); // a one-shard map always names them
  const { map, scope, frames, fillText } = fixture(gridExtras);
  try {
    Object.defineProperty(map.root, 'clientWidth', { value: 386 });
    Object.defineProperty(map.root, 'clientHeight', { value: 540 });
    map.setPois(() => [{ x: 30, z: 40, label: 'THE PIER', kind: 'place' }, { x: -60, z: 80, label: 'CASTAWAY', kind: 'quest' }]);
    map.update({ x: 0, z: 0 }, 0); map.show();
    const named = (): string[] => { fillText.mockClear(); for (const frame of frames.splice(0)) frame(16); return fillText.mock.calls.map(([text]) => text).filter(text => text === 'THE PIER' || text === 'CASTAWAY'); };
    for (const stop of gridStops(GRID)) {
      map.setZoom(stop.zoom);
      expect(named().sort(), `${String(stop.label)}x`).toEqual(stop.label !== 'fit' && stop.label >= 1 ? ['CASTAWAY', 'THE PIER'] : []);
    }
  } finally { scope.dispose(); }
});

test('MN9: at 0.25x a zone\'s name too long for the strip by its cell\'s edge fills its whole cell', () => {
  const name = { x: PITCH, z: 250 - 90, text: 'Coral Drift', short: 'Coral Drift', color: '#eaf6ff', width: 468, height: 160 };
  for (const fill of [undefined, { x: PITCH, z: 0, width: 468, height: 468 }]) {
    const { map, scope, frames, fillText } = fixture({ ...gridExtras, labels: [fill === undefined ? name : { ...name, fill }] });
    try {
      Object.defineProperty(map.root, 'clientWidth', { value: 386 });
      Object.defineProperty(map.root, 'clientHeight', { value: 540 });
      map.update({ x: 0, z: 0 }, 0); map.show(); map.setZoom(1);
      for (const frame of frames.splice(0)) frame(16);
      const drawn = new Set(fillText.mock.calls.map(([text]) => text));
      expect(drawn.has('CORAL') && drawn.has('DRIFT')).toBe(fill !== undefined);
    } finally { scope.dispose(); }
  }
});
