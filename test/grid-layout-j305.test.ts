import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import catalogue from '../src/shared/game/grid/singleplayer.json' with { type: 'json' };

// J305 (Jake, 2026-11-12): the centre 3x3 holds the six main shards, the two new templates and one of Ink & Cel Valley or
// Pastel Plain; the outer ring holds the other one, then unique open plots, then copies of the two new templates. The
// legacy grey template (`open-plot-showcase-template`) is on no cell.
const MAIN = ['driftwood-isle', 'pine-hollow', 'nalati-grasslands', 'nine-dragon-stack', 'sunscar-dunes', 'far-reach'];
const TEMPLATES = ['_template', 'blender-template'];
const PICK = ['ink-cel-valley', 'pastel-plain'];
const LEGACY = ['open-plot-showcase-template'];
type Cell = { readonly slug: string; readonly cell: readonly number[] };
const grids: readonly (readonly [string, readonly Cell[]])[] = [
  ['in-tree', catalogue.grid.cells],
  ['pinned', (JSON.parse(readFileSync('test/pins/catalogue.json', 'utf8')) as { grid: { cells: Cell[] } }).grid.cells],
];
const centre = (row: Cell): boolean => Math.max(Math.abs(row.cell[0] ?? 9), Math.abs(row.cell[1] ?? 9)) <= 1;

for (const [name, cells] of grids) {
  test(`J305 ${name}: every slot of the 5x5 is filled once`, () => {
    expect(cells).toHaveLength(25);
    expect(new Set(cells.map(row => row.cell.join(','))).size).toBe(25);
    for (const row of cells) for (const axis of row.cell) expect(Math.abs(axis)).toBeLessThanOrEqual(2);
  });
  test(`J305 ${name}: the centre holds the six main shards, both templates and one of Ink & Cel or Pastel`, () => {
    const middle = cells.filter(centre).map(row => row.slug);
    expect(middle).toHaveLength(9);
    for (const slug of [...MAIN, ...TEMPLATES]) expect(middle).toContain(slug);
    expect(middle.filter(slug => PICK.includes(slug))).toHaveLength(1);
    expect(cells.find(row => row.cell[0] === 0 && row.cell[1] === 0)?.slug).toBe('driftwood-isle');
  });
  test(`J305 ${name}: the ring holds the other pick, unique open plots, and only template copies beyond them`, () => {
    const ring = cells.filter(row => !centre(row)).map(row => row.slug);
    expect(ring).toHaveLength(16);
    expect(ring.filter(slug => PICK.includes(slug))).toHaveLength(1);
    const plots = cells.map(row => row.slug).filter(slug => slug.startsWith('open-plot-'));
    expect(new Set(plots).size).toBe(plots.length);
    for (const slug of ring) expect(slug.startsWith('open-plot-') || PICK.includes(slug) || TEMPLATES.includes(slug)).toBe(true);
    for (const slug of [...MAIN, ...PICK]) expect(cells.filter(row => row.slug === slug)).toHaveLength(1);
  });
  test(`J305 ${name}: no legacy grey template on the grid`, () => {
    for (const slug of LEGACY) expect(cells.map(row => row.slug)).not.toContain(slug);
  });
}
