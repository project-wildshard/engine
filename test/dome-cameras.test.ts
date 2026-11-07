import { expect, test } from 'vitest';
import { assertDomeAnchorReady, domeGroundAnchor, domeWorldCamera, parseDomeCameras } from '../scripts/dome-cameras.mjs';
import type { FloorGridState } from '../scripts/frame-floor-grid.mjs';

// Exact 903baf53bc camera blobs: test fixtures remain present in CI's sparse checkout, unlike art/.
const manifests = import.meta.glob<unknown>('./fixtures/night-market-domes/*.json', { eager: true, import: 'default' });
const plans = Object.values(manifests).map(parseDomeCameras);
function cameras(id: string) {
  const found = plans.find(row => row.dome.startsWith(id));
  if (found === undefined) throw new Error(`Missing ${id} camera manifest`);
  return found;
}
const grid: FloorGridState = {
  home: 'home', pitch: 562.5, inside: 'market',
  cells: [{ instance: 'market', slug: 'open-plot-night-market', cell: [-1, 1] },
    { instance: 'south', slug: 'open-plot-neighbour', cell: [-1, 0] }],
  live: { crossing: { phase: 'settled', issue: null }, live: { current: 'market', worldFeet: { x: -562.5, y: 0, z: 562.5 },
    crossings: 1, transitions: [], residents: ['market'], gameplayReady: true, pending: [] } },
};

test('all eight committed domes preserve their exact 72 eye/look vectors and view order', () => {
  expect(plans).toHaveLength(8);
  for (const plan of plans) {
    expect(plan.views.map(row => row.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (const view of plan.views) {
      const before = structuredClone(view), world = domeWorldCamera(view, { x: -562.5, z: 562.5 }, 2 / 3);
      expect(world.eye).toEqual([view.eye[0] - 562.5, view.eye[1], view.eye[2] + 562.5]);
      expect(world.look).toEqual([view.look[0] - 562.5, view.look[1], view.look[2] + 562.5]);
      const horizontal = 2 * Math.atan(Math.tan(world.fov * Math.PI / 360) * 2 / 3) * 180 / Math.PI;
      expect(horizontal).toBeCloseTo(62, 12);
      expect(view).toEqual(before);
    }
  }
});

test('outside stands use the actual road or neighbour, never the market streaming anchor', () => {
  expect(domeGroundAnchor(cameras('A1'), grid, 'market')).toEqual({ x: -562.5, z: 300.5, instance: null });
  expect(domeGroundAnchor(cameras('B1'), grid, 'market')).toEqual({ x: -562.5, z: 262.5, instance: null });
  expect(domeGroundAnchor(cameras('C1'), grid, 'market')).toEqual({ x: -562.5, z: 162.5, instance: 'south' });
  for (const id of ['A2', 'B2', 'C2', 'D1', 'D2']) {
    expect(domeGroundAnchor(cameras(id), grid, 'market').instance).toBe('market');
  }
});

test('fresh and historical pitches place the anchor from the served lattice', () => {
  const old = { cells: grid.cells };
  expect(domeGroundAnchor(cameras('D2'), old, 'market')).toEqual({ x: -555, z: 537, instance: 'market' });
  expect(() => domeGroundAnchor(cameras('D2'), { ...old, pitch: 500 }, 'market')).toThrow('pitch');
  expect(() => domeGroundAnchor(cameras('D2'), grid, 'missing')).toThrow('assembled');
  expect(() => domeGroundAnchor(cameras('D2'), { ...grid, cells: [...grid.cells, ...grid.cells] }, 'market')).toThrow('overlaps');
});

test('posing requires an already entered ready cell; pending, crossing and mismatched cells refuse', () => {
  const anchor = domeGroundAnchor(cameras('D2'), grid, 'market');
  expect(() => assertDomeAnchorReady(grid, anchor)).not.toThrow();
  for (const live of [{ ...grid.live.live, gameplayReady: false }, { ...grid.live.live, pending: ['south'] },
    { ...grid.live.live, current: null }, { ...grid.live.live, residents: [] }]) {
    expect(() => assertDomeAnchorReady({ ...grid, live: { ...grid.live, live } }, anchor)).toThrow('normal ready');
  }
  expect(() => assertDomeAnchorReady({ ...grid, inside: null }, anchor)).toThrow('normal ready');
  expect(() => assertDomeAnchorReady({ ...grid, live: { ...grid.live, crossing: { phase: 'preparing', issue: null } } }, anchor)).toThrow('normal ready');
  expect(() => assertDomeAnchorReady({ ...grid, live: { ...grid.live, crossing: { phase: 'settled', issue: 'refused' } } }, anchor)).toThrow('normal ready');
  const road = { ...grid, inside: null, live: { ...grid.live, live: { ...grid.live.live, current: null } } };
  expect(() => assertDomeAnchorReady(road, domeGroundAnchor(cameras('A1'), grid, 'market'))).not.toThrow();
});

test('malformed lenses, vectors, duplicate views and unknown camera fields refuse', () => {
  const plan = cameras('A1'), first = plan.views[0];
  if (first === undefined) throw new Error('Missing first view');
  for (const change of [{ eye: [0, 1] }, { look: first.eye }, { hfov: 0 }, { hfov: Infinity }, { n: 2 }, { lens: 'wide' }]) {
    expect(() => parseDomeCameras({ ...plan, views: [{ ...first, ...change }, ...plan.views.slice(1)] })).toThrow();
  }
  expect(() => parseDomeCameras({ ...plan, views: plan.views.slice(1) })).toThrow();
  for (const aspect of [0, -1, Number.NaN, Infinity]) expect(() => domeWorldCamera(first, { x: 0, z: 0 }, aspect)).toThrow('frame');
  expect(() => domeWorldCamera(first, { x: Number.NaN, z: 0 }, 2 / 3)).toThrow('frame');
});
