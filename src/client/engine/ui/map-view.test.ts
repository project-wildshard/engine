// @vitest-environment happy-dom
// J455 (QA 2026-11-19 row 31): the Bag map opens on you at about 3.5 by 3.5 cells, zoom 1 shows the whole 7 by 7, and the
// pan is clamped so a whole grid cell always stays in view.
import { afterEach, expect, test, vi } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { withOwner } from '../../../shared/engine/app/ownership';
import { legacyDouble } from '../../../test/engine/FakeGame';
import { FullMap } from './Map';
import type { MapExtras, Minimap } from './Minimap';
import { GRID_ZOOMS, OPEN_CELLS, cellAt, clampView, gridPpm, openZoom, wholeCellsIn, type MapGrid } from './mapView';

afterEach(() => { vi.restoreAllMocks(); });

const PITCH = 562.5;
/** the format's 7 by 7 (GRID_RADIUS 3) seen from the centre cell's frame */
const GRID: MapGrid = { x0: -3.5 * PITCH, z0: -3.5 * PITCH, pitch: PITCH, cells: 7 };

test('the opening zoom is 3.5 cells across the short side, the chips reach the whole 7 by 7', () => {
  expect(openZoom(GRID)).toBe(2);
  expect(GRID_ZOOMS).toContain(1);
  expect(GRID_ZOOMS).toContain(openZoom(GRID));
  const short = 1000;
  expect(short / gridPpm(GRID, short, openZoom(GRID)) / PITCH).toBeCloseTo(OPEN_CELLS);
  expect(short / gridPpm(GRID, short, 1) / PITCH).toBeCloseTo(7);
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
  const strokeRect = vi.fn<CanvasRenderingContext2D['strokeRect']>();
  const ctx = legacyDouble<CanvasRenderingContext2D>({
    setTransform: () => undefined, clearRect: () => undefined, fillRect: () => undefined,
    drawImage: () => undefined, strokeRect, strokeText: () => undefined, fillText: () => undefined,
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
  return { map, scope, frames, strokeRect };
}
const gridExtras: MapExtras = { rects: [], images: [], labels: [], grid: GRID };
const cellsAcross = (box: { x0: number; x1: number; z0: number; z1: number }): number => Math.min(box.x1 - box.x0, box.z1 - box.z0) / PITCH;

test('the Bag map opens centred on you at 3.5 cells, in a corner cell too', () => {
  const { map, scope } = fixture(gridExtras);
  try {
    const you = { x: -3 * PITCH + 40, z: 3 * PITCH - 60 };
    map.update(you, 0); map.show();
    expect(map.zoom).toBe(2);
    const box = map.viewBox();
    expect((box.x0 + box.x1) / 2).toBeCloseTo(you.x);
    expect((box.z0 + box.z1) / 2).toBeCloseTo(you.z);
    expect(cellsAcross(box)).toBeCloseTo(OPEN_CELLS);
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
