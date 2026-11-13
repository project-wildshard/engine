// GRID-CROSSING GC36 / ROAD-PRELOAD RP4 (J322, Jake 11-13: "There should never be any walls"): the page's readiness walls hold only a
// loading neighbour's edge. No wall, closed or open, ever stands at the home cell's own edge, so nothing walls a player off the road.
import { expect, test } from 'vitest';
import { CHUNK_HALF } from '@wildshard/engine/core/config';
import { GridAssembly } from './assembly';
import { neighbourEdges, readinessWallCells } from './readinessEdges';

test('the home cell has no readiness wall; every neighbour keeps its four', () => {
  const assembly = new GridAssembly({ developer: false, devserver: false });
  for (const instance of ['driftwood-isle', 'sunscar-dunes', 'pine-hollow']) {
    const home = assembly.cell(instance), cells = readinessWallCells(assembly.cells, home);
    const edges = cells.flatMap(cell => neighbourEdges(cell, home));
    expect(edges.some(edge => edge.instance === home.instance)).toBe(false);
    // nothing on the home's own outline (5 m past its edge, on either axis, within its span)
    const r = CHUNK_HALF + 5;
    expect(edges.filter(edge => Math.abs(edge.axis === 'x' ? edge.x : edge.z) === r && Math.abs(edge.axis === 'x' ? edge.z : edge.x) < CHUNK_HALF)).toEqual([]);
    expect(edges).toHaveLength((assembly.cells.length - 1) * 4);
  }
});
