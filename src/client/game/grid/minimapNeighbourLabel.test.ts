import { expect, test } from 'vitest';
import { CHUNK_HALF } from '@wildshard/engine/core/config';
import { GridAssembly } from '../../../shared/game/grid/assembly';
import { GridCellEvents } from '../../../shared/game/grid/cellEvents';
import { minimapLabelText } from '@wildshard/engine/ui/Minimap';
import { minimapOverlay } from './minimapBlend';

// STAGING-BUGBASH SB32c (opus-pineload, v0.1.31 and main): at Pine Hollow's spawn, 5 m inside its south edge, the minimap read
// "DRIFTWOOD ISLE" under the arrow like the minimap's own title: Driftwood's name across the road (E435). Jake picked option 3
// on the SB32c board: no neighbour name inside a cell; the names show only while you stand on the road between cells, each
// on its own cell's ground with an arrow toward it. Before, the road showed no name at all.

function pineAndDriftwood(): { readonly host: Parameters<typeof minimapOverlay>[0]; readonly cells: GridCellEvents; readonly feet: { x: number; z: number }; readonly pine: GridAssembly['cells'][number]; readonly home: GridAssembly['cells'][number] } {
  const assembly = new GridAssembly({ developer: true, devserver: true });
  const pine = assembly.cells.find(cell => cell.slug === 'pine-hollow'), home = assembly.cells.find(cell => cell.slug === 'driftwood-isle');
  if (pine === undefined || home === undefined) throw new Error('the live grid places Pine Hollow and Driftwood Isle');
  const cells = new GridCellEvents(), feet = { x: pine.origin.x, z: pine.origin.z };
  const host = { assembly, home, cells, worldFeet: () => feet, name: (cell: { slug: string }) => cell.slug, image: () => null };
  return { host, cells, feet, pine, home };
}

test('inside Pine Hollow, 5 m from the road to Driftwood, the minimap names no shard', () => {
  const { host, cells, feet, pine } = pineAndDriftwood();
  cells.enter(pine);
  feet.z = pine.origin.z - (CHUNK_HALF - 5);
  expect(minimapOverlay(host, []).labels.map(label => label.text)).toEqual([]);
});

test('on the road between Pine Hollow and Driftwood, each names itself on its own ground, pointed at', () => {
  const { host, cells, feet, pine, home } = pineAndDriftwood();
  cells.leave();
  // the road's centre line, between Pine's south edge and Driftwood's north edge
  feet.z = (pine.origin.z - CHUNK_HALF + home.origin.z + CHUNK_HALF) / 2;
  const labels = minimapOverlay(host, []).labels, at = (slug: string) => labels.find(label => label.text === slug);
  expect(labels.map(label => label.text).sort()).toEqual(['driftwood-isle', 'pine-hollow']);
  expect(labels.every(label => label.toward === true)).toBe(true);
  // each name sits on its own cell's ground (home-frame metres), across the road from the other
  expect(at('pine-hollow')?.z ?? -Infinity).toBeGreaterThan(pine.origin.z - CHUNK_HALF - home.origin.z);
  expect(at('driftwood-isle')?.z ?? Infinity).toBeLessThan(CHUNK_HALF);
  // far down a road, past the disc, no name
  feet.x = pine.origin.x + 4 * CHUNK_HALF;
  feet.z = pine.origin.z;
  expect(minimapOverlay(host, []).labels.map(label => label.text).filter(text => text === 'pine-hollow')).toEqual([]);
});

test('a neighbour\'s name points outward at its cell; any other label is its text alone', () => {
  const c = 100, across = { x: 0, z: 0, text: 'Driftwood Isle', color: '#fff', toward: true } as const;
  expect(minimapLabelText(across, c + 60, c, 0), 'below the arrow').toBe('▼ DRIFTWOOD ISLE');
  expect(minimapLabelText(across, c - 60, c, 0), 'above it').toBe('▲ DRIFTWOOD ISLE');
  // along the left or right rim the text turns so its top faces out, and the up-arrow with it
  expect(minimapLabelText(across, c, c, -Math.PI / 2)).toBe('▲ DRIFTWOOD ISLE');
  expect(minimapLabelText(across, c, c, Math.PI / 2)).toBe('▲ DRIFTWOOD ISLE');
  expect(minimapLabelText({ x: 0, z: 0, text: 'Driftwood Isle', color: '#fff' }, c + 60, c, 0), 'a place of this map').toBe('DRIFTWOOD ISLE');
});
