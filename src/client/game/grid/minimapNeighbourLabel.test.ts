import { expect, test } from 'vitest';
import { CHUNK_HALF } from '@wildshard/engine/core/config';
import { GridAssembly } from '../../../shared/game/grid/assembly';
import { GridCellEvents } from '../../../shared/game/grid/cellEvents';
import { minimapLabelText } from '@wildshard/engine/ui/Minimap';
import { minimapOverlay } from './minimapBlend';

// STAGING-BUGBASH SB33 (opus-pineload, v0.1.31 and main): at Pine Hollow's spawn, 5 m inside its south edge, the minimap read
// "DRIFTWOOD ISLE" under the arrow like the minimap's own title. It is Driftwood's name across the road (E435), so a
// neighbour's name now carries an arrow toward its cell, and only a neighbour's.

test('at Pine Hollow\'s south entryway the only minimap name is Driftwood\'s, marked as across the road', () => {
  const assembly = new GridAssembly({ developer: true, devserver: true });
  const pine = assembly.cells.find(cell => cell.slug === 'pine-hollow'), home = assembly.cells.find(cell => cell.slug === 'driftwood-isle');
  if (pine === undefined || home === undefined) throw new Error('the live grid places Pine Hollow and Driftwood Isle');
  const cells = new GridCellEvents();
  cells.enter(pine);
  const host = { assembly, home, cells, worldFeet: () => ({ x: pine.origin.x, z: pine.origin.z - (CHUNK_HALF - 5) }), name: (cell: { slug: string }) => cell.slug, image: () => null };
  const { labels } = minimapOverlay(host, []);
  expect(labels.map(label => ({ text: label.text, toward: label.toward }))).toEqual([{ text: 'driftwood-isle', toward: true }]);
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
