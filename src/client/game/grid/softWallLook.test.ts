import { BufferAttribute, BufferGeometry, Group, Mesh } from 'three';
import { expect, test } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { GridAssembly } from '../../../shared/game/grid/assembly';
import { parseGridCatalogue } from '../../../shared/game/grid/catalogue';
import catalogue from '../../../shared/game/grid/singleplayer.json' with { type: 'json' };
import { neighbourEdges } from '../../../shared/game/grid/readinessEdges';
import { MEET_METRES, edgeDistance, installSoftWallLook } from './softWallLook';

test('layout curtain height is admitted separately from unchanged readiness edges', () => {
  const assembly = new GridAssembly({ developer: false, devserver: false });
  const market = assembly.cell('open-plot-3-0');
  expect(market.edgeLook).toEqual({ height: 1.2 });
  expect(Object.isFrozen(market.edgeLook)).toBe(true);
  const { edgeLook: _look, ...original } = market;
  expect(neighbourEdges(market, market)).toEqual(neighbourEdges(original, market));
  expect(assembly.cell('driftwood-isle').edgeLook).toBeUndefined();
  for (const height of [0, 7.1, Number.NaN, Infinity]) {
    const cells = parseGridCatalogue(catalogue.grid).cells, at = cells.findIndex(row => row.instance === market.instance), row = cells[at];
    if (row === undefined) throw new Error('Missing market placement');
    cells[at] = { ...row, edgeLook: { height } };
    expect(() => parseGridCatalogue({ ...catalogue.grid, cells })).toThrow();
  }
});

test('low and default curtains share the same live closed flags and disposal', () => {
  const scene = new Group(), scope = new Scope('curtain-layout');
  let closed = true;
  const look = installSoftWallLook({ scene, scope, time: () => 2,
    edges: [{ instance: 'low', x: 0, z: 0, axis: 'x', halfLength: 250, height: 1.2 },
      { instance: 'default', x: 10, z: 0, axis: 'z', halfLength: 250 }],
    ports: { closed: () => closed } });
  try {
    const mesh = scene.getObjectByName('grid-soft-wall');
    if (!(mesh instanceof Mesh)) throw new Error('Missing curtain mesh');
    const geometry: unknown = mesh.geometry;
    if (!(geometry instanceof BufferGeometry)) throw new Error('Missing curtain geometry');
    const attribute = (name: string): { getX: (index: number) => number; getY: (index: number) => number } => {
      const value: unknown = geometry.getAttribute(name);
      if (!(value instanceof BufferAttribute)) throw new Error(`Missing curtain ${name}`);
      return { getX: index => value.getX(index), getY: index => value.getY(index) };
    };
    const position = attribute('position'), uv = attribute('uv');
    const heights = attribute('aHeight'), flags = attribute('aClosed');
    expect(position.getY(2)).toBeCloseTo(1.2);
    expect(uv.getY(2)).toBeCloseTo(1.2);
    expect(heights.getX(2)).toBeCloseTo(1.2);
    expect(position.getY(6)).toBe(7);
    expect(uv.getY(6)).toBe(7);
    expect(heights.getX(6)).toBe(7);
    expect(geometry.index?.count).toBe(12);
    look.step(); expect(look.state().closed).toBe(2);
    for (let at = 0; at < 8; at++) expect(flags.getX(at)).toBe(1);
    closed = false; look.step(); expect(look.state().closed).toBe(0);
    for (let at = 0; at < 8; at++) expect(flags.getX(at)).toBe(0);
  } finally { scope.dispose(); }
  expect(scene.children).toEqual([]);
});

// GRID-CROSSING GC12 (Jake, 2026-11-13 ~22:50 Cancún, board A): today's hex wall, shown only when a player meets a closed edge.
test('a closed wall shows only while the feet stand at it; an open one never', () => {
  const scene = new Group(), scope = new Scope('gc12-meet');
  let closed = true, feet = { x: -40, z: 0 };
  const edge = { instance: 'east', x: 0, z: 0, axis: 'x' as const, halfLength: 250 };
  const look = installSoftWallLook({ scene, scope, time: () => 0, edges: [edge], ports: { closed: () => closed, feet: () => feet } });
  try {
    look.step(); expect(look.state()).toEqual({ closed: 1, shown: 0 });
    feet = { x: -MEET_METRES + 1, z: 120 }; look.step(); expect(look.state()).toEqual({ closed: 1, shown: 1 });
    feet = { x: -2, z: 400 }; look.step(); expect(look.state()).toEqual({ closed: 1, shown: 0 });
    feet = { x: -2, z: 0 }; closed = false; look.step(); expect(look.state()).toEqual({ closed: 0, shown: 0 });
  } finally { scope.dispose(); }
  expect(edgeDistance(edge, { x: 3, z: 260 })).toBeCloseTo(Math.hypot(3, 10));
});
