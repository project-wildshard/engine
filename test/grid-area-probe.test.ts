// T2E-1b (TEMPLATE-E2E): on a grid page the test probe reports the cell the player is in (its shard, its door panels and
// the server's quest flags there), not the page shell `platform.grid`, whose level has no door and no flags.
import { Group } from 'three';
import { expect, test } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import { gridArea, shardArea } from '../src/client/game/grid/area';
import { NeighbourPanels, type PanelRegion } from '../src/client/game/grid/neighbourPanels';
import type { ClientTileViews } from '../src/client/game/shardfile/clientViews';
import type { GridCell } from '../src/shared/game/grid/assembly';
import type { Shardfile } from '@wildshard/format/shardSchema';

/** Template 2's hall door as the format's handwritten corpus declares it (ui.json, collision.json, state.json). */
const SOURCE = {
  props: { panels: [{ id: 'blender.door', visible: true }] },
  targets: { panels: [{ panel: 'blender.door', scope: 'shared', fieldId: 101, equals: 1, visibleWhenMatched: false, colliders: ['blender.door.collider'], activeWhenMatched: false }] },
  state: { shared: [{ id: 101, name: 'blender.door.open', default: false }], player: [] },
} as unknown as Shardfile;

function doorCell(): { panels: NeighbourPanels; region: { open: number }; admit: () => Promise<void> } {
  const scope = new Scope('grid-area-probe'), region = { open: 0 };
  let standing = true;
  const collider = { active: (): boolean => standing, setActive: (active: boolean): void => { standing = active; } };
  const port: PanelRegion = { colliders: new Map([['blender.door.collider', collider]]), field: name => name === 'blender.door.open' ? region.open : undefined };
  const panels = new NeighbourPanels({ scope: scope as Parameters<ClientTileViews['panels']>[3], region: id => id === 'pine-hollow' ? port : undefined });
  const views = { panels: () => Promise.resolve(new Map([['blender.door', new Group()]])) } as unknown as ClientTileViews;
  const cell = { instance: 'pine-hollow', slug: 'blender-template' } as unknown as GridCell;
  return { panels, region, admit: () => panels.admit(cell, new Group(), SOURCE, new Map(), views) };
}

test('a grid cell reports its door panel standing until its row opens it', async () => {
  const { panels, region, admit } = doorCell();
  await admit();
  expect(panels.targets('pine-hollow')).toEqual([{ panel: 'blender.door', visible: true, solid: true }]);
  region.open = 1;
  panels.late();
  expect(panels.targets('pine-hollow')).toEqual([{ panel: 'blender.door', visible: false, solid: false }]);
  expect(panels.targets('ink-cel-valley')).toEqual([]);
});

test("the grid area is the current cell's shard, panels and flags, not the page shell", async () => {
  const { panels, admit } = doorCell();
  await admit();
  const cells = [{ instance: 'open-plot-2-4', slug: 'open-plot' }, { instance: 'pine-hollow', slug: 'blender-template' }];
  const flags = (id: string): readonly string[] => id === 'pine-hollow' ? ['blender.door', 'blender.complete', 'blender.door'] : ['elsewhere'];
  const area = gridArea({ current: 'pine-hollow', cells, targets: id => panels.targets(id), flags });
  expect(area).toEqual({ slug: 'blender-template', instance: 'pine-hollow', targets: [{ panel: 'blender.door', visible: true, solid: true }], flags: ['blender.complete', 'blender.door'] });
  // On the road between cells the player is in no area.
  expect(gridArea({ current: null, cells, targets: () => [], flags })).toBeNull();
});

test("a one-shard page's area is its shard, its exposed targets and its flags", () => {
  const exposed = { targets: () => [{ panel: 'blender.door', visible: true, solid: true }] };
  expect(shardArea('blender-template', exposed, ['blender.door'])).toEqual({ slug: 'blender-template', instance: null, targets: [{ panel: 'blender.door', visible: true, solid: true }], flags: ['blender.door'] });
  expect(shardArea('blender-template', undefined, [])).toEqual({ slug: 'blender-template', instance: null, targets: [], flags: [] });
});
