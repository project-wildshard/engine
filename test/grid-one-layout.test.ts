import { expect, test } from 'vitest';
import catalogue from '../src/shared/game/grid/singleplayer.json' with { type: 'json' };
import { Scope } from '../src/shared/engine/app/scope';
import { CHUNK_HALF } from '../src/shared/engine/core/config';
import { GridAssembly } from '../src/shared/game/grid/assembly';
import { installGridCrossing } from '../src/shared/game/grid/crossing';
import { gridPrefetchOrder } from '../src/client/game/grid/prefetch';

const publicMode = { developer: false, devserver: false, nineDragon: false };
for (const developer of [false, true]) for (const devserver of [false, true]) for (const nineDragon of [false, true]) {
  const mode = { developer, devserver, nineDragon };
  test(`G972: one complete placement and prefetch layout ${JSON.stringify(mode)}`, () => {
    const grid = new GridAssembly(mode), canonical = new GridAssembly(publicMode);
    expect(grid.cells).toHaveLength(25);
    expect(grid.cells).toEqual(canonical.cells);
    expect(grid.cell('nine-dragon-stack')).toMatchObject({ slug: 'nine-dragon-stack', cell: [1, -1],
      origin: { x: grid.pitch, y: 0, z: -grid.pitch } });
    for (const tier of ['phone', 'desktop'] as const) expect(gridPrefetchOrder(grid, {x: 0, z: 0}, tier)).toEqual(gridPrefetchOrder(canonical, {x: 0, z: 0}, tier));
  });
}

test('G972: no alternate Developer catalogue swaps remain in the shipped grid', () => {
  expect(Object.hasOwn(catalogue.grid, 'developer')).toBe(false);
  const slugs = catalogue.grid.cells.map(cell => cell.slug);
  // J305 (Jake 11-12): Brasscap and Pastel join the centre, Ink & Cel the ring; the grey Showcase Template, Thin Ice and
  // Desert Ruin leave the grid
  for (const slug of ['open-plot-showcase-template', 'open-plot-thin-ice', 'open-plot-desert-ruin']) expect(slugs).not.toContain(slug);
  expect(catalogue.grid.cells.filter(cell => cell.slug === 'open-plot-lantern-bayou').map(cell => cell.cell)).toEqual([[-2, -1]]);
  // NU3: changing any cell to an already used slug fails this shipped-grid invariant.
  expect(new Set(slugs).size).toBe(25);
  for (const [slug, cell] of [
    ['open-plot-fossil-badlands', [-1, -2]], ['open-plot-patchwork-fairground', [-2, -2]],
    ['open-plot-saltwind-lighthouse', [0, 2]], ['open-plot-jungle-ziggurat', [-2, 2]],
    // G993 (Jake 11-03): the centre 3x3 as before G986, the Showcase Template in Frostline's old (-1, -1); Frostline,
    // Coral Drift and Lantern Bayou hold the back line (x = -2), Mosslight and Ember Forge their east cells
    ['pine-hollow', [0, 1]], ['nalati-grasslands', [1, 0]], ['pastel-plain', [-1, 1]],
    ['driftwood-isle', [0, 0]], ['sunscar-dunes', [-1, 0]], ['far-reach', [0, -1]], ['nine-dragon-stack', [1, -1]],
    ['_template', [1, 1]], ['blender-template', [-1, -1]], ['ink-cel-valley', [-1, 2]], ['open-plot-night-market', [1, -2]],
    ['open-plot-frostline-peaks', [-2, 1]], ['open-plot-coral-drift', [-2, 0]],
    ['open-plot-mosslight-ruins', [2, 0]], ['open-plot-ember-forge', [2, -1]],
  ]) expect(catalogue.grid.cells.find(row => row.slug === slug)?.cell).toEqual(cell);
  expect(slugs).not.toContain('open-plot-mushroom-hollow');
});

for (const developer of [false, true]) test(`G972: the real cell lookup crosses from the road into Nine (Developer=${developer})`, async () => {
  const grid = new GridAssembly({ developer, devserver: false }), cell = grid.cell('nine-dragon-stack');
  const road = { x: cell.origin.x - CHUNK_HALF - 1, y: 1.7, z: cell.origin.z };
  const interior = { ...road, x: cell.origin.x - CHUNK_HALF + 1 };
  const scope = new Scope('nine-cell-crossing'), prepared: [string | null, string | null][] = [], changed: [string | null, string | null][] = [];
  let current: string | null = null, admitted = false, commits = 0;
  const session = installGridCrossing({ current: () => current, target: feet => grid.at(feet.x, feet.z)?.instance ?? null,
    prepare: (from, to) => { prepared.push([from, to]); return Promise.resolve({ commit: () => { commits++; current = to; }, cancel: () => undefined }); },
    ready: instance => admitted && instance === cell.instance, checkpoint: () => true,
  }, grid, () => undefined, scope, (from, to) => { changed.push([from, to]); });
  try {
    expect(grid.at(road.x, road.z)).toBeUndefined(); expect(session.step(road)).toBe(false);
    expect(grid.at(interior.x, interior.z)?.slug).toBe('nine-dragon-stack');
    expect(grid.local(interior, cell)).toEqual({ x: -CHUNK_HALF + 1, y: 1.7, z: 0 });
    expect(session.step(interior)).toBe(false); await Promise.resolve();
    expect(prepared).toEqual([[null, 'nine-dragon-stack']]);
    expect(session.step(interior)).toBe(false); expect(commits).toBe(0); expect(current).toBeNull();
    admitted = true; expect(session.step(interior)).toBe(true);
    expect(commits).toBe(1); expect(changed).toEqual([[null, 'nine-dragon-stack']]);
    expect(session.crossing.state()).toMatchObject({ current: 'nine-dragon-stack', target: 'nine-dragon-stack', phase: 'settled', issue: null });
  } finally { scope.dispose(); }
});
