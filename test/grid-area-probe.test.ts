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
  sim: { scripts: [] }, movers: [],
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
  expect(panels.targets('mossgate')).toEqual([]);
});

test.each([false, true])('warm-up restores authored NPC panels with a target panel present: %s', async (withDoor) => {
  const scope = new Scope('grid-panel-warmup'), root = new Group();
  const sheriff = new Group(), hidden = new Group(), door = new Group();
  hidden.visible = false;
  const loaded = new Map([['sheriff', sheriff], ['hidden', hidden], ...(withDoor ? [['blender.door', door] as const] : [])]);
  const source = {
    ...SOURCE,
    props: { panels: [...loaded].map(([id, view]) => ({ id, visible: view.visible })) },
    targets: { panels: withDoor ? SOURCE.targets.panels : [] },
  } as Shardfile;
  const panels = new NeighbourPanels({
    scope: scope as Parameters<ClientTileViews['panels']>[3],
    region: () => ({ colliders: new Map(), field: () => 1 }),
    prepare: view => { expect(view.visible).toBe(false); return Promise.resolve(); },
  });
  const views = { panels: () => { root.add(...loaded.values()); return Promise.resolve(loaded); } } as unknown as ClientTileViews;
  const cell = { instance: 'brasscap-mesa', slug: 'brasscap-mesa' } as unknown as GridCell;
  try {
    await panels.admit(cell, root, source, new Map(), views);
    panels.late();
    expect(sheriff.parent).toBe(root);
    expect(sheriff.visible).toBe(true);
    expect(hidden.visible).toBe(false);
    if (withDoor) expect(door.visible).toBe(false);
  } finally { scope.dispose(); }
});

// SHARD-SOURCE SS-GF1a2 (staging, opus-ss10l): Glowfen's socket glow is a panel shown by a player field a script writes. On a
// grid page that field is this player's owned line, not a shared row, so the cell reads the line: the socket lights for its
// owner. Before, a grid cell read only rows, and the glow stayed at its default on staging.
test("a grid cell's player-field panel follows this player's owned line", async () => {
  const source = {
    props: { panels: [{ id: 'glowfen.socket.1.glow', visible: false }] },
    targets: { panels: [{ panel: 'glowfen.socket.1.glow', scope: 'player', fieldId: 6001, equals: 1, visibleWhenMatched: true, colliders: [], activeWhenMatched: true }] },
    state: { shared: [], player: [{ id: 6001, name: 'glowfen.socket.1', default: false, type: 'bool', privacy: 'owner' }] },
    sim: { scripts: [{ id: 'scene' }] }, movers: [],
  } as unknown as Shardfile;
  const scope = new Scope('grid-socket'), lines = new Map<string, number>();
  const port: PanelRegion = { colliders: new Map(), field: () => undefined, line: name => lines.get(name) ?? 0 };
  const panels = new NeighbourPanels({ scope: scope as Parameters<ClientTileViews['panels']>[3], region: id => id === 'glowfen' ? port : undefined });
  const views = { panels: () => Promise.resolve(new Map([['glowfen.socket.1.glow', new Group()]])) } as unknown as ClientTileViews;
  await panels.admit({ instance: 'glowfen', slug: 'glowfen' } as unknown as GridCell, new Group(), source, new Map(), views);
  expect(panels.targets('glowfen')).toEqual([{ panel: 'glowfen.socket.1.glow', visible: false, solid: true }]);
  lines.set('glowfen.socket.1', 1);
  panels.late();
  expect(panels.targets('glowfen')).toEqual([{ panel: 'glowfen.socket.1.glow', visible: true, solid: true }]);
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
