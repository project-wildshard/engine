import { expect, test } from 'vitest';
import { frameFloorPending, type FloorPendingContext } from '../scripts/frame-floor-pending.mjs';

function context(): FloorPendingContext {
  return { pending: ['neighbour'], pendingWork: [{ instance: 'neighbour', kind: 'optional-metadata', trigger: 'radial' }],
    current: null, residents: [], gameplayReady: true, crossing: 'settled', pitch: 562.5,
    worldFeet: { x: 843.75, z: 281.25 },
    cells: [{ instance: 'neighbour', cell: [1, 0], shows: 'near', drawn: { near: true } }] };
}

test('G872 lists evidenced optional radial metadata outside the drawn neighbour', () => {
  const row = frameFloorPending(context());
  expect(row.pendingWorld).toEqual([]);
  expect(row.pendingOptionalMetadata).toEqual([{ instance: 'neighbour', kind: 'optional-metadata', trigger: 'radial', outsideMetres: Math.hypot(31.25, 31.25) }]);
});

test.each(['world', 'required-metadata'])('%s remains blocking outside a drawn cell', kind => {
  const row = frameFloorPending({ ...context(), pendingWork: [{ instance: 'neighbour', kind, trigger: 'entry' }] });
  expect(row).toEqual({ pendingWorld: ['neighbour'], pendingOptionalMetadata: [] });
});

test('a superseded world request vetoes metadata even when crossing is settled', () => {
  const row = frameFloorPending({ ...context(), pendingWork: [
    { instance: 'neighbour', kind: 'optional-metadata', trigger: 'radial' },
    { instance: 'neighbour', kind: 'world', trigger: 'entry' },
  ] });
  expect(row.pendingWorld).toEqual(['neighbour']);
});

test('older union-only telemetry cannot earn the metadata exception', () => {
  const { pendingWork: _work, ...old } = context();
  expect(frameFloorPending(old).pendingWorld).toEqual(['neighbour']);
});

test.each<Partial<FloorPendingContext>>([
  { current: 'neighbour' }, { residents: ['neighbour'] }, { gameplayReady: false }, { crossing: 'preparing' },
  { worldFeet: { x: 562.5, z: 0 } }, { worldFeet: { x: Number.NaN, z: 0 } },
  { cells: [{ instance: 'neighbour', cell: [1, 0], shows: 'loading', drawn: { near: false } }] },
  { pendingWork: [{ instance: 'neighbour', kind: 'optional-metadata', trigger: 'boulevard' }] },
  { pendingWork: [{ instance: 'neighbour', kind: 'optional-metadata', trigger: 'explicit' }] },
])('required residency, missing view or unproved trigger remains blocking: %j', patch => {
  expect(frameFloorPending({ ...context(), ...patch })).toEqual({ pendingWorld: ['neighbour'], pendingOptionalMetadata: [] });
});

test('mixed requests preserve the original blocking world list', () => {
  expect(frameFloorPending({ ...context(), pending: ['neighbour', 'world'], pendingWork: [
    { instance: 'neighbour', kind: 'optional-metadata', trigger: 'radial' },
    { instance: 'world', kind: 'world', trigger: 'entry' },
  ] }).pendingWorld).toEqual(['world']);
});

test('a world row missing from the legacy union cannot disappear', () => {
  expect(frameFloorPending({ ...context(), pending: [], pendingWork: [{ instance: 'neighbour', kind: 'world', trigger: 'entry' }] }).pendingWorld).toEqual(['neighbour']);
});
