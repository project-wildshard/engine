// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';
import { legacyDouble } from '../../../test/engine/FakeGame';
import type { MapPoi } from './Map';
import { MapPainter } from './mapPainter';
import type { Minimap } from './Minimap';

afterEach(() => { vi.restoreAllMocks(); });

function fixture() {
  const clearRect = vi.fn<CanvasRenderingContext2D['clearRect']>();
  const ctx = legacyDouble<CanvasRenderingContext2D>({
    setTransform: () => undefined, clearRect, fillRect: () => undefined, drawImage: () => undefined, strokeRect: () => undefined,
    strokeText: () => undefined, fillText: () => undefined, measureText: text => legacyDouble<TextMetrics>({ width: text.length * 7 }),
    beginPath: () => undefined, moveTo: () => undefined, lineTo: () => undefined, closePath: () => undefined, save: () => undefined,
    restore: () => undefined, translate: () => undefined, rotate: () => undefined, fill: () => undefined, stroke: () => undefined,
    arc: () => undefined, setLineDash: () => undefined,
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function canvasContext(this: HTMLCanvasElement) { return Object.assign(ctx, { canvas: this }); });
  const canvas = document.createElement('canvas'); canvas.width = 390; canvas.height = 844;
  const image = document.createElement('canvas');
  const minimap = legacyDouble<Minimap>({ room: null, bakedGround: true, marks: [], layerGen: 0, layers: { terrain: image, cover: image } });
  const state = { cx: 0, cz: 0, zoom: 1, pose: { x: 12, z: 14, yaw: 0 }, pois: [{ x: 0, z: 0, label: 'COVE', kind: 'place' }] as MapPoi[] };
  const painter = new MapPainter({
    canvas, ctx, minimap, open: () => true, _zoom: () => state.zoom, cx: () => state.cx, cz: () => state.cz, dpr: () => 3, dash: () => [9, 7.5],
    pose: state.pose, zones: () => [], pois: () => state.pois, fallbackPois: () => [], poiSources: new Set(), extras: () => null,
    tally: () => false, ppm: () => 2 * state.zoom, now: () => 0,
  });
  return { painter, state, clearRect };
}

test('FC4: an untouched map repaints nothing; a pan, a zoom, a pin, you or a resize repaints once', () => {
  const { painter, state, clearRect } = fixture();
  expect(painter.draw()).toBe(true);
  for (let i = 0; i < 30; i++) expect(painter.draw()).toBe(false);
  state.cx = 10; expect(painter.draw()).toBe(true); expect(painter.draw()).toBe(false);
  state.zoom = 2; expect(painter.draw()).toBe(true);
  state.pois = [{ x: 0, z: 0, label: 'CAVE', kind: 'place' }]; expect(painter.draw()).toBe(true); // same length, new name
  state.pose.yaw = 0.5; expect(painter.draw()).toBe(true);
  painter.invalidate(); expect(painter.draw()).toBe(true); // a resized canvas comes back cleared
  expect(painter.draw()).toBe(false);
  expect(clearRect).toHaveBeenCalledTimes(6 * 2); // six paints, each clearing the map and its fog (one shared double)
});

test('FC4: a quest pin hands its pulse to the map instead of animating the canvas', () => {
  const { painter, state } = fixture();
  state.pois = [{ x: 0, z: 0, label: 'FIND THE RANGER', short: 'RANGER', kind: 'quest' }];
  expect(painter.draw()).toBe(true);
  expect(painter.pulses).toHaveLength(1);
  expect(painter.draw()).toBe(false); // the pulse is no reason to repaint
  expect(painter.pulses).toHaveLength(1);
});
