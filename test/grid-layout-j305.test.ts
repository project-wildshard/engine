import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import catalogue from '../test/pins/catalogue.json' with { type: 'json' };

// J305 (Jake, 2026-11-12): the centre 3x3 holds the six main shards, the two new templates and one of Ink & Cel Valley or
// Pastel Plain; the outer ring holds the other one, then unique open plots, then copies of the two new templates. The
// legacy grey template (`open-plot-showcase-template`) is on no cell. J434 (Jake, 2026-11-18) retired the Template: its (1,1)
// is empty walkable floor, so the 5x5 holds 24 and Brasscap is the centre's one template. J493 (Jake, 2026-11-22) took Ink &
// Cel Valley and Pastel Plain off the grid (J453): their (-1,2) and (-1,1) are empty too, so the 5x5 holds 22.
const MAIN = ['driftwood-isle', 'pine-hollow', 'nalati-grasslands', 'nine-dragon-stack', 'sunscar-dunes', 'far-reach'];
const TEMPLATES = ['brasscap-mesa'];
const EMPTY = ['1,1', '-1,1', '-1,2'];
const LEGACY = ['open-plot-showcase-template'];
type Cell = { readonly slug: string; readonly cell: readonly number[] };
const grids: readonly (readonly [string, readonly Cell[]])[] = [
  ['in-tree', catalogue.grid.cells],
  ['pinned', (JSON.parse(readFileSync('test/pins/catalogue.json', 'utf8')) as { grid: { cells: Cell[] } }).grid.cells],
];
const centre = (row: Cell): boolean => Math.max(Math.abs(row.cell[0] ?? 9), Math.abs(row.cell[1] ?? 9)) <= 1;

for (const [name, selected] of grids) {
  // SA34 permits later channel placements in ring 3. J305 still owns the
  // complete 5x5 core; test that core without discarding any of its rules.
  const cells = selected.filter(row => row.cell.every(axis => Math.abs(axis) <= 2));
  test(`J305 ${name}: every slot of the 5x5 but the three emptied is filled once`, () => {
    expect(cells).toHaveLength(22);
    expect(new Set(cells.map(row => row.cell.join(','))).size).toBe(22);
    for (const empty of EMPTY) expect(cells.map(row => row.cell.join(','))).not.toContain(empty);
    for (const row of cells) for (const axis of row.cell) expect(Math.abs(axis)).toBeLessThanOrEqual(2);
  });
  test(`J305 ${name}: the centre holds the six main shards and Brasscap`, () => {
    const middle = cells.filter(centre).map(row => row.slug);
    expect(middle).toHaveLength(7);
    for (const slug of [...MAIN, ...TEMPLATES]) expect(middle).toContain(slug);
    expect(cells.find(row => row.cell[0] === 0 && row.cell[1] === 0)?.slug).toBe('driftwood-isle');
  });
  test(`J305 ${name}: the ring holds unique open plots, and only template copies beyond them`, () => {
    const ring = cells.filter(row => !centre(row)).map(row => row.slug);
    expect(ring).toHaveLength(15);
    const plots = cells.map(row => row.slug).filter(slug => slug.startsWith('open-plot-'));
    expect(new Set(plots).size).toBe(plots.length);
    for (const slug of ring) expect(slug.startsWith('open-plot-') || TEMPLATES.includes(slug)).toBe(true);
    for (const slug of MAIN) expect(cells.filter(row => row.slug === slug)).toHaveLength(1);
    // a template copy takes a ring slot only once no catalogue open plot is left off the grid
    const unplaced = catalogue.placements.map(row => row.slug).filter(slug => slug.startsWith('open-plot-') && !LEGACY.includes(slug) && !plots.includes(slug));
    if (unplaced.length > 0) expect(ring.filter(slug => TEMPLATES.includes(slug))).toEqual([]);
  });
  test(`J305 ${name}: no legacy grey template on the grid`, () => {
    for (const slug of LEGACY) expect(selected.map(row => row.slug)).not.toContain(slug);
  });
}
