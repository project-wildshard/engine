// oxlint-disable-next-line import/no-nodejs-modules -- The fixtures are the authors' rows on disk.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { SystemSpec } from '../src/client/engine/app/systems';
import { Scope } from '../src/shared/engine/app/scope';
import { ItemRuntime } from '../src/shared/engine/combat/items';
import type { EquipmentRow } from '../src/shared/engine/combat/Equipment';
import type { Interactable } from '../src/shared/engine/world/interact/types';
import { declaredKitItemFamilies, declaredLever } from '../src/client/game/plugin/weaponFamily';
import { installDeclaredTargets, spentUses } from '../src/client/game/shard/declaredTargets';

// TE-ENG6: a use target whose action can no longer run drops its prompt (and so the touch USE band, which shows the picked
// prompt). Rows only: Mossgate's brazier A names its own lit condition in `unless`; a kit.lever's rack (TE-ENG2) needs no row,
// the page knows its lever is in hand. Rows that name neither keep their prompt whatever the fields say.
type Targets = Shardfile['targets'];
interface Mossgate { readonly interactions: Targets['interactions']; readonly conditions: Shardfile['hooks']['conditions'] }
interface LeverFixture { readonly row: Extract<Shardfile['items']['rows'][number], { kind: 'weapon' }>; readonly interaction: Targets['interactions'][number]; readonly itemActions: NonNullable<Targets['itemActions']> }
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The fixtures are the authors' rows, typed as the format reads them.
const mossgate = JSON.parse(readFileSync('test/fixtures/spent-prompt/mossgate.json', 'utf8')) as Mossgate;
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The fixtures are the authors' rows, typed as the format reads them.
const lever = JSON.parse(readFileSync('test/fixtures/declared-lever/rows.json', 'utf8')) as LeverFixture;

function source(interactions: Targets['interactions'], itemActions: Targets['itemActions'] = []): Pick<Shardfile, 'targets' | 'hooks' | 'items'> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Only the rows the prompt path reads.
  return { targets: { panels: [], interactions, itemActions }, hooks: { conditions: mossgate.conditions, scenes: [] }, items: { rows: [lever.row], contexts: [] } } as unknown as Pick<Shardfile, 'targets' | 'hooks' | 'items'>;
}
/** A page's prompt list and frame loop, with the shared fields the server would publish. */
function page(rows: Pick<Shardfile, 'targets' | 'hooks' | 'items'>, taken: (item: string) => boolean, spent = true): { labels: () => string[]; frame: () => void; fields: Map<number, number>; scope: Scope } {
  const interactables: Interactable[] = [], systems: SystemSpec[] = [], fields = new Map<number, number>(), scope = new Scope('spent');
  const read = (_scope: 'shared' | 'player', id: number): number => fields.get(id) ?? 0;
  installDeclaredTargets(rows.targets, { panels: new Map(), colliders: new Map(), read, scene: () => undefined, interactables, scope, system: spec => { systems.push(spec); },
    ...(spent ? { spent: spentUses(rows, { read, taken }) } : {}) });
  return { labels: () => interactables.map(prompt => prompt.label), frame: () => { for (const system of systems) system.run(1 / 60, 0); }, fields, scope };
}

test('Mossgate: "Light brazier A" shows until A is lit, then is gone; the hut door stays', () => {
  const run = page(source(mossgate.interactions), () => false);
  expect(run.labels()).toEqual(['Open hut door', 'Light brazier A']);
  run.fields.set(101, 1); run.fields.set(102, 1); run.frame(); // the door open, A lit
  expect(run.labels()).toEqual(['Open hut door']);
  run.fields.set(102, 0); run.frame(); // a reset puts A out: the prompt is back
  expect(run.labels()).toEqual(['Open hut door', 'Light brazier A']);
  run.scope.dispose(); run.frame();
  expect(run.labels()).toEqual([]);
});

test('A kit.lever rack: "Take the rifle" shows until the server says it is taken', () => {
  const family = declaredKitItemFamilies().get('kit.lever');
  if (family?.kind !== 'weapon') throw new Error('kit.lever is a weapon family');
  const scope = new Scope('lever');
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The view runtime's actor and ports are never stepped here.
  const runtime = new ItemRuntime(lever.row, { actor: { id: 'actor.player', alive: true }, combat: { hit: () => null }, targets: () => [], hook: null, effect: () => undefined } as unknown as ConstructorParameters<typeof ItemRuntime>[1]);
  const equipment: EquipmentRow = { id: lever.row.id, legacySlot: lever.row.id as NonNullable<EquipmentRow['legacySlot']>, ui: { name: lever.row.ui.name, icon: 'lever' as EquipmentRow['ui']['icon'], swapIcon: '', touch: 'melee', lockOn: true, melee: true, tracers: false }, meta: { name: lever.row.ui.name, icon: 'lever' as EquipmentRow['ui']['icon'], blurb: '', category: 'weapon' } };
  const held = declaredLever(family.create(equipment, lever.row, { scope, runtime, input: { bind: () => undefined, held: () => false }, aim: () => ({ origin: { x: 0, y: 1.6, z: 0 }, direction: { x: 0, y: 0, z: -1 } }), view: lever.row.view, profile: lever.row.profile }));
  if (held === null) throw new Error('kit.lever builds a DeclaredLever');
  const run = page(source([...mossgate.interactions, lever.interaction], lever.itemActions), item => item === held.row.id && held.taken);
  expect(run.labels()).toContain('Take the rifle');
  held.mirror(6, 12, false, true); run.frame(); // the server's owned `.taken` line
  expect(run.labels()).not.toContain('Take the rifle');
  expect(run.labels()).toEqual(['Open hut door', 'Light brazier A']);
  run.scope.dispose(); scope.dispose();
});

test('Rows that name no condition and take no lever keep their prompts, as before', () => {
  const plain = mossgate.interactions.map(({ unless: _unless, ...row }) => row);
  for (const spent of [true, false]) {
    const run = page(source(plain), () => true, spent);
    run.fields.set(101, 1); run.fields.set(102, 1); run.frame();
    expect(run.labels()).toEqual(['Open hut door', 'Light brazier A']);
    run.scope.dispose();
  }
  expect(() => spentUses(source([{ ...plain[0], unless: 'nobody' } as Targets['interactions'][number]]), { read: () => 0, taken: () => false })).toThrow(/nobody/u);
});
