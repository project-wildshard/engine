// @vitest-environment node
// TEMPLATE-E2E TC-E1b: a grid data cell's declared items are in hand while the feet stand in it. Brasscap's lever held bare hands
// on the grid (G68), since a data cell had no client to build its items; leaving the cell gives the road's bare hands back.
// oxlint-disable-next-line import/no-nodejs-modules -- The fixture is the author's rows on disk.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import { EquipmentService } from '@wildshard/engine/combat/EquipmentService';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { EmptyEquipment } from '../shardfile/emptyEquipment';
import { copyPrompts } from './copyPrompts';
import { EnteredEquipment } from './enteredEquipment';
import { enterDataCellKit, holdsItems } from './dataCellKit';
import type { RegionalRuntimePage } from './regionalRuntime';

interface LeverFixture {
  readonly context: Shardfile['items']['contexts'][number]; readonly row: Shardfile['items']['rows'][number];
  readonly interaction: Shardfile['targets']['interactions'][number]; readonly itemActions: NonNullable<Shardfile['targets']['itemActions']>;
}
const fixture = JSON.parse(readFileSync('test/fixtures/declared-lever/rows.json', 'utf8')) as LeverFixture;
const source = { identity: { slug: 'blender-template', seed: 1 }, runtime: null,
  items: { version: 1, contexts: [fixture.context], rows: [fixture.row], loadout: { primary: fixture.row.id, secondary: null, tools: [] } },
  targets: { interactions: [fixture.interaction], itemActions: fixture.itemActions } } as unknown as Shardfile;

function page(scope: Scope): { page: RegionalRuntimePage; controls: EnteredEquipment; systems: { id: string; run: (dt: number, t: number) => void }[] } {
  const binds = new Map<string, number>(), systems: { id: string; run: (dt: number, t: number) => void }[] = [];
  const input = { bind: (action: string) => { binds.set(action, (binds.get(action) ?? 0) + 1); }, held: () => false, register: () => undefined, has: () => true, bindings: { describe: () => undefined } };
  const road = new EquipmentService(new EmptyEquipment(), { scope });
  const controls = new EnteredEquipment(road);
  const app = { input, events: undefined, combat: { targets: () => [] }, effects: null, player: null, state: 'play', get equipment() { return controls.service; },
    addContentSystem: (spec: { id: string; run: (dt: number, t: number) => void }, owner: Scope) => { systems.push(spec); owner.onDispose(() => { systems.splice(systems.indexOf(spec), 1); }); } };
  const camera = new PerspectiveCamera();
  return { controls, systems, page: { equipment: controls, world: { game: { camera }, player: { position: new Vector3() } }, play: {}, context: { app } } as unknown as RegionalRuntimePage };
}

test('a data copy with declared items holds them while entered, and the road\'s bare hands come back on leaving', async () => {
  expect(holdsItems(source)).toBe(true);
  const scope = new Scope('data-cell-kit'), { page: lent, controls, systems } = page(scope), entry = scope.child('entry');
  const kit = await enterDataCellKit(source, new Map(), lent, entry);
  expect(kit).not.toBeNull();
  // the page's controls now read the copy's kit: its declared lever, its one weapon
  expect(controls.service.current.row.id).toBe(fixture.row.id);
  expect(controls.service.available.map((weapon) => weapon.row.id)).toEqual([fixture.row.id]);
  expect(systems.map((system) => system.id)).toEqual(['grid.data-cell-kit']);
  entry.dispose();
  expect(controls.service.current.row.id).toBe('weapon.empty');
  expect(systems).toHaveLength(0);
  scope.dispose();
});

test('a copy with no declared items keeps bare hands, and its rack prompt is offered', async () => {
  const bare = { ...source, items: { ...source.items, rows: [], loadout: { primary: null, secondary: null, tools: [] } } } as unknown as Shardfile;
  expect(holdsItems(bare)).toBe(false);
  const scope = new Scope('data-cell-bare'), { page: lent, controls } = page(scope);
  expect(await enterDataCellKit(bare, new Map(), lent, scope.child('entry'))).toBeNull();
  expect(controls.service.current.row.id).toBe('weapon.empty');
  // the rack's prompt names an item scene: the server runs it on the held lever, so the copy offers it
  expect(copyPrompts(source).map((prompt) => prompt.wireId)).toEqual([fixture.interaction.id]);
  scope.dispose();
});
